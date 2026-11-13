// A project sheet read with no database: rows of a project and of a
// participant gathered into one object each, a separator and a decimal comma
// taken from the sheet, every cell it cannot read named with its line and
// never corrected, and a sheet written back that reads the same.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PROJECT_SHEET_COLUMNS, readProjectSheet, writeProjectSheet } from '@nexgen-os/project-sheet';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('reading a project sheet', () => {
  it('gathers the rows of a project and of its participants, with a semicolon and decimal commas', async () => {
    const sheet = readProjectSheet(await fixture('community-semicolon.csv'));
    expect(sheet.delimiter).toBe(';');
    expect(sheet.problems).toEqual([{ code: 'column_unknown', level: 'warning', line: 1, column: 'notes' }]);
    expect(sheet.projects).toHaveLength(1);
    const [project] = sheet.projects;
    expect(project).toMatchObject({ name: 'Sunny Street Community', country: 'BE', kind: 'energy_community', identifiers: [] });
    expect(project!.participants.map((p) => p.name)).toEqual(['School', 'Bakery', 'Town hall']);
    const [school, bakery, hall] = project!.participants;
    expect(school).toEqual({
      name: 'School', category: 'prosumer', time_zone: 'Europe/Brussels',
      identifiers: [{ scheme: 'crm', value: 'S-001' }],
      place: { country: 'BE', address_line1: "Rue de l'Ecole 1; block A", postal_code: '1000', city: 'Brussels', latitude: 50.8466, longitude: 4.3528, location_precision: 'rooftop' },
      meters: [
        { scheme: 'ean', identifier: '541448800000000017', direction: 'both' },
        { scheme: 'ean', identifier: '541448800000000024', direction: 'offtake' },
      ],
      devices: [
        { device_type: 'pv_system', name: 'Roof array', rated_power_kw: 36.5, unit_count: 1, identifiers: [] },
        { device_type: 'battery', name: 'Basement battery', rated_power_kw: 10, identifiers: [] },
      ],
    });
    expect(bakery!.identifiers).toEqual([{ scheme: 'crm', value: 'S-002' }, { scheme: 'vat', value: 'BE0123456789' }]);
    expect(bakery!.place).toBeUndefined();
    expect(hall).toEqual({ name: 'Town hall', identifiers: [], meters: [], devices: [] });
  });

  it('names every cell it cannot read, with its line, and corrects none', async () => {
    const sheet = readProjectSheet(await fixture('problems.csv'));
    expect(sheet.delimiter).toBe(',');
    expect(sheet.problems).toEqual([
      { code: 'column_repeated', level: 'error', line: 1, column: 'participant' },
      { code: 'invalid_identifier', level: 'error', line: 2, column: 'project_identifiers', value: 'crm' },
      { code: 'coordinates_incomplete', level: 'error', line: 2, column: 'longitude' },
      { code: 'meter_incomplete', level: 'error', line: 2, column: 'meter_identifier' },
      { code: 'invalid_number', level: 'error', line: 2, column: 'device_unit_count', value: '2.5' },
      { code: 'invalid_date', level: 'error', line: 2, column: 'device_installed_on', value: '2026-02-30' },
      { code: 'device_incomplete', level: 'error', line: 2, column: 'device_name' },
      { code: 'project_required', level: 'error', line: 3, column: 'project' },
      { code: 'values_disagree', level: 'error', line: 4, column: 'country', value: 'DE' },
      { code: 'invalid_number', level: 'error', line: 4, column: 'device_rated_power_kw', value: '12,5' },
      { code: 'participant_required', level: 'error', line: 5, column: 'meter_scheme', value: 'ean' },
    ]);
    expect(sheet.projects[0]!.country).toBe('FR');
    expect(sheet.projects[0]!.participants.map((p) => [p.name, p.devices.length])).toEqual([['A', 0], ['C', 1]]);
  });

  it('gives no project without the columns that name one, and says which', () => {
    const sheet = readProjectSheet('name,country\nOne,FR\n');
    expect(sheet.projects).toEqual([]);
    expect(sheet.problems.map((p) => [p.code, p.column])).toEqual([
      ['column_unknown', 'name'], ['column_missing', 'project'], ['column_missing', 'participant'],
    ]);
  });

  it('reads quotes, line breaks inside them and a tab separator, and tells a quote left open', () => {
    const sheet = readProjectSheet('project\tparticipant\taddress_line1\tparticipant_country\nP\t"The ""Old"" Mill"\t"Line one\nline two"\tLU\n');
    expect(sheet.delimiter).toBe('\t');
    expect(sheet.problems).toEqual([]);
    expect(sheet.projects[0]!.participants[0]).toMatchObject({ name: 'The "Old" Mill', place: { address_line1: 'Line one\nline two', country: 'LU' } });
    expect(readProjectSheet('project,participant\nP,"open\n').problems).toEqual([{ code: 'quote_unterminated', level: 'error', line: 2 }]);
  });
});

describe('writing a project sheet', () => {
  it('writes every column and reads back the same projects, with either separator', async () => {
    const { projects } = readProjectSheet(await fixture('community-semicolon.csv'));
    const comma = writeProjectSheet(projects);
    expect(comma.split('\r\n')[0]).toBe(PROJECT_SHEET_COLUMNS.join(','));
    expect(readProjectSheet(comma)).toEqual({ delimiter: ',', projects, problems: [] });
    expect(readProjectSheet(writeProjectSheet(projects, { delimiter: ';' }))).toEqual({ delimiter: ';', projects, problems: [] });
  });

  it('publishes a template that is the header the writer gives', async () => {
    const template = await readFile(new URL('../template.csv', import.meta.url), 'utf8');
    expect(template).toBe(writeProjectSheet([]).replace('\r\n', '\n'));
  });

  it('keeps a project without participants', () => {
    const projects = [{ name: 'Empty', country: 'SN', identifiers: [{ scheme: 'crm', value: 'P-9' }], participants: [] }];
    expect(readProjectSheet(writeProjectSheet(projects)).projects).toEqual(projects);
  });
});

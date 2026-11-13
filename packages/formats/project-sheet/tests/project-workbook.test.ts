// A project sheet kept as an .xlsx workbook, saved by LibreOffice Calc from
// the same rows as a CSV: read into the same projects, its dates from their
// serial numbers, and an identifier the spreadsheet rounded named, never
// given.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readProjectSheet, readProjectWorkbook, writeProjectSheet } from '@nexgen-os/project-sheet';

const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));

describe('reading a project sheet from a workbook', () => {
  it('reads the first worksheet into projects, its dates as days and its numbers as written', async () => {
    const sheet = readProjectWorkbook(await fixture('community-libreoffice.xlsx'));
    expect([sheet.format, sheet.delimiter, sheet.problems]).toEqual(['xlsx', null, []]);
    const [project] = sheet.projects;
    expect(project!.country).toBe('BE');
    const [school, bakery] = project!.participants;
    expect(school).toEqual({
      name: 'School', category: 'prosumer', time_zone: 'Europe/Brussels', identifiers: [],
      place: { country: 'BE', city: 'Brussels', latitude: 50.8466, longitude: 4.3528, location_precision: 'rooftop' },
      meters: [{ scheme: 'gs1_gsrn', identifier: '541448800000000017', valid_from: '2026-01-01' }],
      devices: [
        { device_type: 'inverter', name: 'Roof inverter', rated_power_kw: 36.5, installed_on: '2025-06-30', identifiers: [] },
        { device_type: 'battery', name: 'Basement battery', rated_power_kw: 10, identifiers: [] },
      ],
    });
    expect(bakery!.meters).toEqual([{ scheme: 'gs1_gsrn', identifier: '541448800000000031' }]);
  });

  it('gives the projects a CSV of the same rows gives', async () => {
    const fromWorkbook = readProjectWorkbook(await fixture('community-libreoffice.xlsx')).projects;
    expect(readProjectSheet(writeProjectSheet(fromWorkbook)).projects).toEqual(fromWorkbook);
  });

  it('names an identifier the spreadsheet stored as a number and rounded', async () => {
    const sheet = readProjectWorkbook(await fixture('community-libreoffice-rounded.xlsx'));
    expect(sheet.problems).toEqual([
      { code: 'number_rounded', level: 'error', line: 2, column: 'L2', value: '5.414488E+017' },
      { code: 'number_rounded', level: 'error', line: 4, column: 'L4', value: '5.414488E+017' },
      { code: 'meter_incomplete', level: 'error', line: 2, column: 'meter_identifier' },
      { code: 'meter_incomplete', level: 'error', line: 4, column: 'meter_identifier' },
    ]);
  });

  it('refuses a file that is not a workbook, and a sheet it does not hold', async () => {
    expect(() => readProjectWorkbook(new TextEncoder().encode('project,participant\n'))).toThrow(/^workbook_unreadable/);
    expect(() => readProjectWorkbook(new Uint8Array(0))).toThrow(/^workbook_unreadable/);
    await expect(fixture('community-libreoffice.xlsx').then((b) => readProjectWorkbook(b, { sheet: 'Projects' }))).rejects.toThrow(/^sheet_not_found: Projects/);
  });
});

// A project sheet saved by a spreadsheet becomes rows through importProject(),
// is refused whole when a cell cannot be read, and written again creates
// nothing.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, one, organisation } from './helpers/db.js';
import { importProjectSheet, projectOfSheet } from '@nexgen-os/core';
import { readProjectSheet } from '@nexgen-os/project-sheet';

let db: PGlite;
let org: string;

const SHEET = [
  'project;country;participant;category;time_zone;participant_identifiers;address_line1;postal_code;city;participant_country;latitude;longitude;location_precision;meter_scheme;meter_identifier;meter_direction;device_type;device_name;device_rated_power_kw;remarks',
  'Garibaldi community;FR;School;prosumer;Europe/Paris;osm=way/123456;12 rue Garibaldi;69003;Lyon;FR;45,7597;4,8522;rooftop;gs1_gsrn;541448000000000017;both;inverter;Roof inverter;36,5;seen on site',
  'Garibaldi community;;School;;;;;;;;;;;;;;battery;Cellar battery;5;',
  'Garibaldi community;;Bakery;;Europe/Paris;;14 rue Garibaldi;69003;Lyon;FR;;;;gs1_gsrn;541448000000000024;offtake;;;;',
].join('\r\n');

const count = async (table: string) => (await one<{ n: number }>(db, `select count(*)::int n from ${table}`)).n;

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'Community operator');
});

afterAll(async () => {
  await db.close();
});

describe('a project sheet imported', () => {
  it('reads as the description importProject() takes, its place with its point', () => {
    const [project] = readProjectSheet(SHEET).projects;
    const description = projectOfSheet(project!);
    expect(description).toMatchObject({ name: 'Garibaldi community', country: 'FR' });
    expect(description.participants![0]).toEqual({
      name: 'School', category: 'prosumer', time_zone: 'Europe/Paris', identifiers: [{ scheme: 'osm', value: 'way/123456' }],
      place: {
        address_line1: '12 rue Garibaldi', postal_code: '69003', city: 'Lyon', country: 'FR',
        geometry: { type: 'Point', coordinates: [4.8522, 45.7597, 0] }, location_precision: 'rooftop',
      },
      meters: [{ identifier: '541448000000000017', scheme: 'gs1_gsrn', direction: 'both' }],
      devices: [
        { device_type: 'inverter', name: 'Roof inverter', rated_power_kw: 36.5 },
        { device_type: 'battery', name: 'Cellar battery', rated_power_kw: 5 },
      ],
    });
  });

  it('writes nothing on a dry run, and gives back the column it left aside', async () => {
    const plan = await asUser(db, USER_A, () => importProjectSheet(db, org, SHEET, { dryRun: true }));
    expect(plan.dry_run).toBe(true);
    expect(plan.warnings).toEqual([{ code: 'column_unknown', level: 'warning', line: 1, column: 'remarks' }]);
    expect(plan.projects.map((p) => p.counts)).toEqual([{
      project: { found: 0, created: 1 }, participant: { found: 0, created: 2 },
      meter: { found: 0, created: 2 }, device: { found: 0, created: 2 },
    }]);
    expect(await count('projects')).toBe(0);
  });

  it('creates the project, its participants with their place, meters and devices', async () => {
    const done = await asUser(db, USER_A, () => importProjectSheet(db, org, SHEET));
    const projectId = done.projects[0]!.project_id;
    expect(await one(db, `select name, country, time_zone, city, location_precision,
                             round(ST_X(geometry)::numeric, 4)::float8 lon, round(ST_Y(geometry)::numeric, 4)::float8 lat
                        from participants where name = 'School'`))
      .toEqual({ name: 'School', country: 'FR', time_zone: 'Europe/Paris', city: 'Lyon', location_precision: 'rooftop', lon: 4.8522, lat: 45.7597 });
    expect(await one(db, `select rated_power_kw::float8 kw from devices where name = 'Roof inverter'`)).toEqual({ kw: 36.5 });
    expect([await count('projects'), await count('participants'), await count('meters'), await count('devices')]).toEqual([1, 2, 2, 2]);
    expect(projectId).not.toBeNull();
  });

  it('written again, finds every object and creates none', async () => {
    const again = await asUser(db, USER_A, () => importProjectSheet(db, org, SHEET));
    expect(Object.values(again.projects[0]!.counts).every((c) => c.created === 0)).toBe(true);
    expect([await count('projects'), await count('participants'), await count('meters'), await count('devices')]).toEqual([1, 2, 2, 2]);
  });

  it('refuses a sheet with a cell it cannot read, naming each by line, before writing anything', async () => {
    const broken = SHEET.replace('Garibaldi community;;Bakery', 'Other community;;Bakery').replace(';36,5;', ';about 36;');
    await expect(asUser(db, USER_A, () => importProjectSheet(db, org, broken)))
      .rejects.toThrow(/^sheet_unreadable: line 2 invalid_number device_rated_power_kw "about 36"$/);
    expect(await count('projects')).toBe(1);
    await expect(importProjectSheet(db, org, 'project,participant\r\n')).rejects.toThrow(/^sheet_empty/);
  });

  it('imports the .xlsx workbook a spreadsheet keeps, as it imports a CSV', async () => {
    const workbook = new Uint8Array(await readFile(new URL('../packages/formats/project-sheet/tests/fixtures/community-libreoffice.xlsx', import.meta.url)));
    const plan = await asUser(db, USER_A, () => importProjectSheet(db, org, workbook, { dryRun: true }));
    expect(plan.projects.map((p) => p.counts)).toEqual([{
      project: { found: 0, created: 1 }, participant: { found: 0, created: 2 },
      meter: { found: 0, created: 2 }, device: { found: 0, created: 2 },
    }]);
    const rounded = new Uint8Array(await readFile(new URL('../packages/formats/project-sheet/tests/fixtures/community-libreoffice-rounded.xlsx', import.meta.url)));
    await expect(asUser(db, USER_A, () => importProjectSheet(db, org, rounded))).rejects.toThrow(/^sheet_unreadable: line 2 number_rounded L2 "5.414488E\+017"; /);
  });

  it('passes on what the model refuses, by its name', async () => {
    const noCountry = 'project,participant\r\nNowhere,Someone\r\n';
    await expect(asUser(db, USER_A, () => importProjectSheet(db, org, noCountry))).rejects.toThrow(/^country_required: project/);
  });
});

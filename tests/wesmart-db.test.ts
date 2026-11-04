// The history of a WeSmart Database imported table to table into the core:
// first the plan, pure, row by row; then the plan written on a fresh
// installation as a person, twice, the second time writing nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  importWesmartHistory, importedRowKey, meterSchemesOf, personSession, planWesmartImport,
  type MeterScheme, type WesmartSnapshot,
} from '../packages/core/src/index.js';
import { USER_A, asUser, freshDatabase, one, organisation, sqlClient } from './helpers/db.js';

const ORG = '10000000-0000-4000-8000-000000000001';
const BE_PROJECT = '20000000-0000-4000-8000-000000000001';
const FR_PROJECT = '20000000-0000-4000-8000-000000000002';
const NO_COUNTRY = '20000000-0000-4000-8000-000000000003';
const OWN_PROJECT = '20000000-0000-4000-8000-000000000004';
const P = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const D = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A snapshot shaped as `select * from <table>` returns it: numerics as text, columns this import does not carry. */
const snapshot: WesmartSnapshot = {
  organisations: [{ id: ORG, name: 'A cooperative', created_at: '2026-01-01T00:00:00Z', watch_level: 'normal' }],
  projects: [
    { id: BE_PROJECT, name: 'Riverside community', organisation_id: ORG, country: 'be', status: 'active', start_date: '2026-02-01', created_at: '2026-01-02T00:00:00Z', flows: [{ category: 'production' }] },
    { id: FR_PROJECT, name: 'Depot', organisation_id: ORG, country: 'FR', status: 'simulation', created_at: '2026-01-03T00:00:00Z' },
    { id: NO_COUNTRY, name: 'Somewhere', organisation_id: ORG, country: null, created_at: '2026-01-04T00:00:00Z' },
    { id: OWN_PROJECT, name: 'My roof', organisation_id: null, owner_id: USER_A, country: 'BE', created_at: '2026-01-05T00:00:00Z' },
  ],
  participants: [
    // Carries its meter, with spaces as typed, and its address with its point.
    { id: P(1), project_id: BE_PROJECT, name: 'Unit 1', status: 'active', address: 'Rue de la Loi 16', postal_code: '1000', city: 'Bruxelles',
      latitude: '50.8466', longitude: '4.3528', smart_meter_id: '5414 4880 0000 0000 01', consumption: '3500', power: '6',
      join_date: '2026-02-01', profile_id: 'residential', created_at: '2026-01-10T00:00:00Z' },
    // The same meter, entered second: one connection point is one meter.
    { id: P(2), project_id: BE_PROJECT, name: 'Unit 1 (S2)', status: 'simulation', smart_meter_id: '541448800000000001',
      consumption: '1200', created_at: '2026-01-11T00:00:00Z' },
    // A placeholder number, and a plant that only produces.
    { id: P(3), project_id: BE_PROJECT, name: 'Plant', status: 'active', smart_meter_id: 'VIRTUAL-PLANT-1', consumption: 0, created_at: '2026-01-12T00:00:00Z' },
    // A number of no scheme of its country.
    { id: P(4), project_id: BE_PROJECT, name: 'Shop', status: 'active', smart_meter_id: '1234', consumption: '9000', created_at: '2026-01-13T00:00:00Z' },
    // In France, a PRM; archived, so inactive, gone on its leave date.
    { id: P(5), project_id: FR_PROJECT, name: 'Warehouse', status: 'active', country: null, city: 'Lyon', smart_meter_id: '12345678901234',
      consumption: '50000', join_date: '2026-01-01', leave_date: '2026-06-30', archived_at: '2026-07-01T09:00:00Z', created_at: '2026-01-14T00:00:00Z' },
    { id: P(6), project_id: NO_COUNTRY, name: 'Lost', created_at: '2026-01-15T00:00:00Z' },
    { id: P(7), project_id: BE_PROJECT, name: null, created_at: '2026-01-16T00:00:00Z' },
    { id: P(8), project_id: BE_PROJECT, name: 'Half placed', latitude: '50.8', longitude: null, created_at: '2026-01-17T00:00:00Z' },
  ],
  devices: [
    { id: D(1), participant_id: P(1), name: 'Roof array', device_type: 'solar', power: '6', installation_date: '2026-02-01', status: 'active',
      tilt: 35, orientation: 180, manufacturer: 'Acme', created_at: '2026-01-20T00:00:00Z' },
    { id: D(2), participant_id: P(1), name: null, device_type: 'heatpump', manufacturer: 'Acme', model: 'HP-8', status: null, created_at: '2026-01-21T00:00:00Z' },
    { id: D(3), participant_id: P(3), name: 'Turbine', device_type: 'wind', power: '250', status: 'active', created_at: '2026-01-22T00:00:00Z' },
    { id: D(4), participant_id: P(1), name: 'Something', device_type: 'other', created_at: '2026-01-23T00:00:00Z' },
    { id: D(5), participant_id: P(6), name: 'Battery', device_type: 'battery', created_at: '2026-01-24T00:00:00Z' },
    { id: D(6), participant_id: P(1), name: 'Charger', device_type: 'ev', status: 'maintenance', created_at: '2026-01-25T00:00:00Z' },
  ],
};

const meterSchemes: MeterScheme[] = [
  { country: 'BE', scheme: 'gs1_gsrn', pattern: '^[0-9]{18}$' },
  { country: 'FR', scheme: 'prm', pattern: '^[0-9]{14}$' },
];

const plan = planWesmartImport(snapshot, { meterSchemes });
const refusalOf = (id: string) => plan.refusals.filter((r) => r.id === id).map((r) => r.code);

describe('the plan of a WeSmart Database, table to table', () => {
  it('maps organisations and projects, the country upper case, the status word for word', () => {
    expect(plan.organisations).toEqual([{ key: `wesmart_db:organisations:${ORG}`, name: 'A cooperative' }]);
    expect(plan.projects.map((p) => [p.name, p.country, p.status, p.start_date])).toEqual([
      ['Riverside community', 'BE', 'active', '2026-02-01'],
      ['Depot', 'FR', 'simulation', null],
    ]);
    expect(plan.projects[0]!.organisation).toEqual({ key: importedRowKey('organisations', ORG) });
  });

  it('refuses a project without its country, and a project in no organisation unless one is given', () => {
    expect(refusalOf(NO_COUNTRY)).toEqual(['country_required']);
    expect(refusalOf(OWN_PROJECT)).toEqual(['project_organisation_required']);
    const own = planWesmartImport(snapshot, { meterSchemes, organisationForOwnProjects: 'org-of-the-core' });
    expect(own.projects.find((p) => p.name === 'My roof')?.organisation).toEqual({ id: 'org-of-the-core' });
  });

  it('turns participants.address into the participant\'s place, with its point when both coordinates are numbers', () => {
    const unit = plan.participants.find((p) => p.name === 'Unit 1')!;
    expect(unit.place).toEqual({
      country: 'BE', address_line1: 'Rue de la Loi 16', postal_code: '1000', city: 'Bruxelles',
      geometry: { type: 'Point', coordinates: [4.3528, 50.8466, 0] },
    });
    expect(plan.participants.find((p) => p.name === 'Half placed')!.place).toEqual({ country: 'BE' });
    expect(plan.notCarried).toContainEqual({ table: 'participants', column: 'latitude, longitude (not a point)', rows: 1 });
  });

  it('takes the project\'s country for a participant whose row names none', () => {
    expect(plan.participants.find((p) => p.name === 'Warehouse')!.place).toEqual({ country: 'FR', city: 'Lyon' });
  });

  it('turns participants.smart_meter_id into a meter of the participant, in the scheme its country issues', () => {
    expect(plan.meters).toEqual([
      { key: `wesmart_db:participants:${P(1)}:smart_meter_id`, participant_key: importedRowKey('participants', P(1)), identifier: '541448800000000001', scheme: 'gs1_gsrn' },
      { key: `wesmart_db:participants:${P(5)}:smart_meter_id`, participant_key: importedRowKey('participants', P(5)), identifier: '12345678901234', scheme: 'prm' },
    ]);
  });

  it('refuses by name the meters it cannot declare, and keeps their participants', () => {
    expect(refusalOf(P(2))).toEqual(['meter_shared']);
    expect(refusalOf(P(3))).toEqual(['meter_virtual']);
    expect(refusalOf(P(4))).toEqual(['meter_scheme_unknown']);
    for (const id of [P(2), P(3), P(4)]) expect(plan.participants.some((p) => p.key === importedRowKey('participants', id))).toBe(true);
    const ambiguous = planWesmartImport(snapshot, { meterSchemes: [...meterSchemes, { country: 'BE', scheme: 'other', pattern: null }] });
    expect(ambiguous.refusals.find((r) => r.id === P(1))?.code).toBe('meter_scheme_ambiguous');
  });

  it('says what a participant does from what its row carries', () => {
    const category = (name: string) => plan.participants.find((p) => p.name === name)!.category;
    expect(category('Unit 1')).toBe('prosumer');
    expect(category('Plant')).toBe('producer');
    expect(category('Shop')).toBe('consumer');
  });

  it('reads an archived participant as inactive, with its dates', () => {
    const warehouse = plan.participants.find((p) => p.name === 'Warehouse')!;
    expect([warehouse.status, warehouse.join_date, warehouse.leave_date]).toEqual(['inactive', '2026-01-01', '2026-06-30']);
  });

  it('keeps devices.participant_id: each device stays with its participant, in the core\'s device type', () => {
    expect(plan.devices.map((d) => [d.name, d.device_type, d.participant_key, d.rated_power_kw, d.status])).toEqual([
      ['Roof array', 'solar', importedRowKey('participants', P(1)), 6, 'in_service'],
      ['Acme HP-8', 'heat_pump', importedRowKey('participants', P(1)), null, null],
      ['Turbine', 'wind', importedRowKey('participants', P(3)), 250, 'in_service'],
    ]);
  });

  it('refuses by name every row it does not write, and what hangs from it', () => {
    expect(refusalOf(P(6))).toEqual(['parent_refused']);
    expect(refusalOf(P(7))).toEqual(['participant_name_required']);
    expect(refusalOf(D(4))).toEqual(['device_type_unmapped']);
    expect(refusalOf(D(5))).toEqual(['parent_refused']);
    expect(refusalOf(D(6))).toEqual(['device_status_unknown']);
  });

  it('accounts for every row: written, or refused', () => {
    const written = plan.organisations.length + plan.projects.length + plan.participants.length + plan.devices.length;
    const rowsRefused = new Set(plan.refusals.filter((r) => !r.code.startsWith('meter_')).map((r) => `${r.table}:${r.id}`)).size;
    const rows = snapshot.organisations!.length + snapshot.projects.length + snapshot.participants.length + snapshot.devices!.length;
    expect(written + rowsRefused).toBe(rows);
  });

  it('counts the values it does not carry, by column, and never the bookkeeping', () => {
    expect(plan.notCarried).toEqual(expect.arrayContaining([
      { table: 'organisations', column: 'watch_level', rows: 1 },
      { table: 'projects', column: 'flows', rows: 1 },
      { table: 'participants', column: 'profile_id', rows: 1 },
      { table: 'devices', column: 'orientation', rows: 1 },
      { table: 'devices', column: 'tilt', rows: 1 },
    ]));
    expect(plan.notCarried.some((n) => n.column === 'created_at')).toBe(false);
  });

  it('refuses a row given twice, and a row without its id', () => {
    const twice = planWesmartImport({ projects: [snapshot.projects[0]!, snapshot.projects[0]!], participants: [{ id: '' }] , organisations: snapshot.organisations }, { meterSchemes });
    expect(twice.refusals.map((r) => r.code)).toEqual(['row_duplicated', 'row_id_required']);
  });
});

describe('the plan written on a fresh installation, as a person', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDatabase(['grid'], ['be', 'fr']);
    await organisation(db, 'Somebody else\'s');
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('finds the schemes of the connection points in the grid operators of each country', async () => {
    const schemes = await asUser(db, USER_A, () => meterSchemesOf(db));
    expect(schemes).toEqual(expect.arrayContaining([
      { country: 'BE', scheme: 'gs1_gsrn', pattern: '^[0-9]{18}$' },
      { country: 'FR', scheme: 'prm', pattern: '^[0-9]{14}$' },
    ]));
  });

  it('writes the hierarchy through the gestures, then writes nothing the second time', async () => {
    const schemes = await asUser(db, USER_A, () => meterSchemesOf(db));
    const ours = planWesmartImport(snapshot, { meterSchemes: schemes });
    const first = await asUser(db, USER_A, () => importWesmartHistory(db, ours));
    expect(first.created).toEqual({ organisations: 1, projects: 2, participants: 6, meters: 2, devices: 3 });

    const r = await one<{ project: string; status: string; participant: string; city: string; zone: string; lon: number; identifier: string; scheme: string; devices: string[] }>(db,
      `select pr.name project, pr.status, p.name participant, p.city, p.time_zone zone, round(ST_X(p.geometry)::numeric, 4)::float lon,
              m.identifier, m.scheme, (select array_agg(d.name order by d.name) from devices d where d.participant_id = p.id) devices
         from projects pr join participants p on p.project_id = pr.id join meters m on m.participant_id = p.id
        where p.id = $1`, [first.ids[importedRowKey('participants', P(1))]]);
    expect(r).toEqual({ project: 'Riverside community', status: 'active', participant: 'Unit 1', city: 'Bruxelles', zone: 'Europe/Brussels',
      lon: 4.3528, identifier: '541448800000000001', scheme: 'gs1_gsrn', devices: ['Acme HP-8', 'Roof array'] });

    const left = await one<{ status: string; leave_date: string; category: string }>(db,
      `select status, leave_date::text, category from participants where id = $1`, [first.ids[importedRowKey('participants', P(5))]]);
    expect(left).toEqual({ status: 'inactive', leave_date: '2026-06-30', category: 'consumer' });

    const heatPump = await one<{ manufacturer: string; model: string; status: string }>(db,
      `select manufacturer, model, status from devices where id = $1`, [first.ids[importedRowKey('devices', D(2))]]);
    expect(heatPump).toEqual({ manufacturer: 'Acme', model: 'HP-8', status: 'planned' });

    const again = await asUser(db, USER_A, () => importWesmartHistory(db, ours));
    expect(again.created).toEqual({ organisations: 0, projects: 0, participants: 0, meters: 0, devices: 0 });
    expect(again.alreadyImported).toEqual(first.created);
    expect(again.ids).toEqual(first.ids);
    const counts = await one<{ n: number }>(db, `select (select count(*) from participants) + (select count(*) from meters) + (select count(*) from devices) n`);
    expect(Number(counts.n)).toBe(11);
  });

  it('stops whole on a refusal of the database, with its name and the row it was writing', async () => {
    // A scheme handed in without its pattern lets a number through that the database refuses.
    const broken = planWesmartImport({
      projects: [{ id: '20000000-0000-4000-8000-000000000009', name: 'Elsewhere', organisation_id: null, country: 'FR' }],
      participants: [{ id: P(9), project_id: '20000000-0000-4000-8000-000000000009', name: 'Typo', smart_meter_id: '1234' }],
    }, { meterSchemes: [{ country: 'FR', scheme: 'prm', pattern: null }], organisationForOwnProjects: await asUser(db, USER_A, async () =>
      (await one<{ id: string }>(db, `select id from organisations where name = 'A cooperative'`)).id) });
    const before = await one<{ n: number }>(db, 'select count(*)::int n from projects');
    const session = personSession(sqlClient(db), { kind: 'user', userId: USER_A }, { writable: true });
    await expect(session.run((person) => importWesmartHistory(person, broken)))
      .rejects.toThrow(/^invalid_identifier: .*while importing wesmart_db:participants:.*:smart_meter_id/);
    expect(await one(db, 'select count(*)::int n from projects')).toEqual(before);
  });
});

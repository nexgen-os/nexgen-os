// A house, described the way an installer, an architect and a resident each
// would: a participant with its place and its meter, a building with its
// footprint, a roof face, a PV system behind the meter, a module deriving that PV system into its own
// table, attributes with their history, a drone video as a document, a
// measured series and a simulated one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation, square, participant } from './helpers/db.js';

let db: PGlite;
let org: string;
let home: string;
let house: string;
let roof: string;
let meter: string;
let pv: string;

beforeAll(async () => {
  db = await freshDatabase(['building']);
  org = await organisation(db, 'A family');
  home = await participant(db, { organisation_id: org, name: 'Garden plot', country: 'ES', city: 'Sevilla' });
  house = await insert(db, 'building.buildings', {
    organisation_id: org, participant_id: home, name: 'House', use: 'residential',
    footprint: square(-5.98, 37.39, 10, 8), elevation_m: 12, height_m: 7.5,
  });
  roof = await insert(db, 'building.surfaces', {
    organisation_id: org, building_id: house, name: 'South roof face', kind: 'roof', azimuth_deg: 180, tilt_deg: 30,
  });
  meter = await insert(db, 'meters', {
    organisation_id: org, participant_id: home, identifier: '871000000000000001', scheme: 'gs1_gsrn',
  });
  pv = await insert(db, 'devices', {
    organisation_id: org, participant_id: home,
    name: 'PV system', device_type: 'solar', rated_power_kw: 3.6, unit_count: 9,
  });
});

afterAll(async () => {
  await db.close();
});

describe('a house', () => {
  it('stores its footprint in 3D WGS 84 and measures it in metres anywhere', async () => {
    const r = await one<{ dims: number; srid: number; area: string; utm: number }>(
      db,
      `select ST_NDims(footprint) dims, ST_SRID(footprint) srid, area_m2(footprint) area, metric_srid(footprint) utm
         from building.buildings where id = $1`,
      [house],
    );
    expect(r.dims).toBe(3);
    expect(r.srid).toBe(4326);
    expect(Number(r.area)).toBeCloseTo(80, 0);
    expect(r.utm).toBe(32630);
  });

  it('derives a level-of-detail 1 block from footprint, elevation and height', async () => {
    const r = await one<{ type: string; zmin: number; zmax: number }>(
      db,
      `select GeometryType(g) type, ST_ZMin(g) zmin, ST_ZMax(g) zmax from (select building.building_volume($1) g) b`,
      [house],
    );
    expect(r.type).toBe('POLYHEDRALSURFACE');
    expect(r.zmin).toBe(12);
    expect(r.zmax).toBe(19.5);
  });

  it('knows where everything is and whose rules apply', async () => {
    const r = await one<{ participant: string; country: string; meters: string[] }>(
      db, `select participant_of('device', $1) participant, country_of('device', $1) country,
                  (select array_agg(meter_id) from participant_meters(participant_of('device', $1))) meters`, [pv]);
    expect(r.participant).toBe(home);
    expect(r.meters).toEqual([meter]);
    expect(r.country).toBe('ES');
  });

  it('holds every object once, in the table of its kind', async () => {
    const r = await db.query<{ kind: string; n: number }>(
      `select 'building' kind, count(*)::int n from building.buildings where organisation_id = $1
       union all select 'device', count(*)::int from devices where organisation_id = $1
       union all select 'meter', count(*)::int from meters where organisation_id = $1
       union all select 'organisation', count(*)::int from organisations where id = $1
       union all select 'participant', count(*)::int from participants where organisation_id = $1
       union all select 'surface', count(*)::int from building.surfaces where organisation_id = $1
       order by kind`,
      [org],
    );
    expect(r.rows).toEqual([
      { kind: 'building', n: 1 }, { kind: 'device', n: 1 }, { kind: 'meter', n: 1 }, { kind: 'organisation', n: 1 }, { kind: 'participant', n: 1 }, { kind: 'surface', n: 1 },
    ]);
  });

  it('describes the roof face and says nothing of where a device sits on it', async () => {
    expect((await one<{ participant: string }>(db, `select building.participant_of('surface', $1) participant`, [roof])).participant).toBe(home);
    expect((await one<{ t: string | null }>(db, `select to_regclass('building.devices')::text t`)).t).toBeNull();
  });

  it('lets a module derive the PV system into its own table, with the same id', async () => {
    await db.exec(`
      create schema energy;
      create table energy.devices (
        id uuid primary key,
        inverter_count integer not null default 1,
        panel_technology text,
        annual_degradation numeric(5, 4) not null default 0.005
      );
      call derive_devices('energy.devices', 'solar');
    `);
    await db.query(`insert into energy.devices (id, inverter_count, panel_technology) values ($1, 1, 'mono')`, [pv]);
    const r = await one<{ name: string; rated_power_kw: string; panel_technology: string }>(
      db,
      `select d.name, d.rated_power_kw, p.panel_technology from devices d join energy.devices p using (id) where d.id = $1`,
      [pv],
    );
    expect(r).toEqual({ name: 'PV system', rated_power_kw: '3.600', panel_technology: 'mono' });
    const battery = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Not a PV', device_type: 'battery' });
    await expect(db.query(`insert into energy.devices (id) values ($1)`, [battery])).rejects.toThrow(/device_type_mismatch/);
    await db.query('delete from devices where id = $1', [battery]);
  });

  it('describes the house in the columns of the building module', async () => {
    await db.query(`update building.buildings set year_built = 1998, energy_label = 'C' where id = $1`, [house]);
    await expect(db.query(`update building.buildings set energy_label = 'Z' where id = $1`, [house])).rejects.toThrow(/buildings_energy_label/);
    await expect(db.query(`update building.buildings set year_built = 98 where id = $1`, [house])).rejects.toThrow(/buildings_year_built/);
  });

  it('attaches typed attributes with their history and reads them at any date', async () => {
    await db.query(
      `insert into attributes (object_kind, object_id, attribute_type, value, valid_from, valid_to, source) values
         ('participant', $1, 'annual_consumption', '5200', null, '2025-06-01', 'invoices 2024'),
         ('participant', $1, 'annual_consumption', '3900', '2025-06-01', null, 'invoices 2025, after insulation')`,
      [home],
    );
    const before = await one<{ p: Record<string, number> }>(db, `select attributes_of($1, '2024-01-01') p`, [home]);
    const after = await one<{ p: Record<string, number> }>(db, `select attributes_of($1, '2026-01-01') p`, [home]);
    expect(before.p.annual_consumption).toBe(5200);
    expect(after.p.annual_consumption).toBe(3900);
  });

  it('refuses an attribute of the wrong type, out of range, on the wrong kind, or on an object that is not of the core', async () => {
    await expect(
      db.query(`insert into attributes (object_kind, object_id, attribute_type, value) values ('device', $1, 'efficiency', '"high"')`, [pv]),
    ).rejects.toThrow(/must be a number/);
    await expect(
      db.query(`insert into attributes (object_kind, object_id, attribute_type, value) values ('device', $1, 'efficiency', '1.4')`, [pv]),
    ).rejects.toThrow(/at most 1/);
    await expect(
      db.query(`insert into attributes (object_kind, object_id, attribute_type, value) values ('participant', $1, 'efficiency', '0.9')`, [home]),
    ).rejects.toThrow(/attribute_type_not_applicable/);
    await expect(
      db.query(`insert into attributes (object_kind, object_id, attribute_type, value) values ('surface', $1, 'efficiency', '0.9')`, [roof]),
    ).rejects.toThrow(/attributes_object_kind|kind_unknown/);
  });

  it('refuses two attributes over overlapping periods', async () => {
    await expect(
      db.query(
        `insert into attributes (object_kind, object_id, attribute_type, value, valid_from, source) values ('participant', $1, 'annual_consumption', '4000', '2026-01-01', 'a guess')`,
        [home],
      ),
    ).rejects.toThrow(/overlapping_value/);
  });

  it('keeps a drone video and a permit as documents of the participant', async () => {
    await db.query(
      `insert into documents (object_kind, object_id, name, kind, uri, media_type, source, captured_at, metadata) values
         ('participant', $1, 'Orbit video', 'video', 's3://films/house-orbit.mp4', 'video/mp4', 'drone flight', '2026-09-30', '{"camera": "orbit"}'),
         ('participant', $1, 'Building permit', 'permit', 's3://docs/permit-1998.pdf', 'application/pdf', 'town hall', null, '{}')`,
      [home],
    );
    const r = await one<{ n: number }>(db, 'select count(*)::int n from documents where object_id = $1', [home]);
    expect(r.n).toBe(2);
  });

  it('compares a measured series with a simulated one, through one function', async () => {
    const measured = await one<{ id: string }>(
      db,
      `insert into series (object_kind, object_id, quantity_code, kind, step) values ('device', $1, 'energy', 'measured', '15 minutes') returning id`,
      [pv],
    );
    const simulated = await one<{ id: string }>(
      db,
      `insert into series (object_kind, object_id, quantity_code, kind, step, source_code) values ('device', $1, 'energy', 'simulated', '1 hour', 'pvgis') returning id`,
      [pv],
    );
    await db.query(
      `insert into series_values (series_id, at, value)
       select $1, ts, 0.25 from generate_series('2026-07-01 12:00+00'::timestamptz, '2026-07-01 13:45+00', '15 minutes') ts`,
      [measured.id],
    );
    await db.query(
      `insert into series_values (series_id, at, value) values ($1, '2026-07-01 12:00+00', 1.1), ($1, '2026-07-01 13:00+00', 0.9)`,
      [simulated.id],
    );
    const m = await db.query<{ value: number }>(
      `select value from resample($1, '2026-07-01 12:00+00', '2026-07-01 14:00+00', '1 hour')`,
      [measured.id],
    );
    const s = await db.query<{ value: number }>(
      `select value from resample($1, '2026-07-01 12:00+00', '2026-07-01 14:00+00', '1 hour')`,
      [simulated.id],
    );
    expect(m.rows.map((r) => r.value)).toEqual([1, 1]);
    expect(s.rows.map((r) => r.value)).toEqual([1.1, 0.9]);
  });

  it('removes everything attached when a device goes', async () => {
    const heater = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Water heater', device_type: 'boiler' });
    await db.query(`insert into attributes (object_kind, object_id, attribute_type, value, source) values ('device', $1, 'efficiency', '0.9', 'datasheet')`, [heater]);
    await db.query(`insert into documents (object_kind, object_id, name, uri) values ('device', $1, 'Photo', 's3://photos/heater.jpg')`, [heater]);
    await db.query(`select series_ensure('device', $1, 'temperature', 'measured', 'instant')`, [heater]);
    await db.query('delete from devices where id = $1', [heater]);
    const r = await one<{ attrs: number; docs: number; series: number }>(
      db,
      `select (select count(*)::int from attributes where object_kind = 'device' and object_id = $1) attrs,
              (select count(*)::int from documents where object_kind = 'device' and object_id = $1) docs,
              (select count(*)::int from series where object_kind = 'device' and object_id = $1) series`,
      [heater],
    );
    expect(r).toEqual({ attrs: 0, docs: 0, series: 0 });
  });
});

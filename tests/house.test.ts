// A house, described the way an installer, an architect and a resident each
// would: a site, a building with its footprint, a roof face, a PV system on
// it behind the house's meter, a module deriving that PV system into its own
// table, attributes with their history, a drone video as a document, a
// measured series and a simulated one in a scenario.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation, square } from './helpers/db.js';

let db: PGlite;
let org: string;
let site: string;
let house: string;
let roof: string;
let meter: string;
let pv: string;

beforeAll(async () => {
  db = await freshDatabase(['building']);
  org = await organisation(db, 'A family');
  site = await insert(db, 'sites', { organisation_id: org, name: 'Garden plot', country: 'ES', city: 'Sevilla' });
  house = await insert(db, 'building.buildings', {
    organisation_id: org, site_id: site, name: 'House', profile: 'residential',
    footprint: square(-5.98, 37.39, 10, 8), elevation_m: 12, height_m: 7.5,
  });
  roof = await insert(db, 'building.surfaces', {
    organisation_id: org, building_id: house, name: 'South roof face', kind: 'roof', azimuth_deg: 180, tilt_deg: 30,
  });
  meter = await insert(db, 'meters', {
    organisation_id: org, site_id: site, identifier: '871000000000000001', scheme: 'gs1_gsrn',
  });
  pv = await insert(db, 'devices', {
    organisation_id: org, site_id: site,
    name: 'PV system', device_type: 'solar', rated_power_kw: 3.6, unit_count: 9, tags: ['solar', 'electric'],
  });
  await db.query('select building.place_device($1, p_surface_id => $2)', [pv, roof]);
  await db.query(`select connect_device($1, $2)`, [pv, meter]);
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
    const r = await one<{ site: string; country: string }>(db, `select site_of('device', $1) site, country_of('device', $1) country`, [pv]);
    expect(r.site).toBe(site);
    expect(r.country).toBe('ES');
  });

  it('holds every object once, in the table of its kind', async () => {
    const r = await db.query<{ kind: string; n: number }>(
      `select 'building' kind, count(*)::int n from building.buildings where organisation_id = $1
       union all select 'device', count(*)::int from devices where organisation_id = $1
       union all select 'meter', count(*)::int from meters where organisation_id = $1
       union all select 'organisation', count(*)::int from organisations where id = $1
       union all select 'site', count(*)::int from sites where organisation_id = $1
       union all select 'surface', count(*)::int from building.surfaces where organisation_id = $1
       order by kind`,
      [org],
    );
    expect(r.rows).toEqual([
      { kind: 'building', n: 1 }, { kind: 'device', n: 1 }, { kind: 'meter', n: 1 }, { kind: 'organisation', n: 1 }, { kind: 'site', n: 1 }, { kind: 'surface', n: 1 },
    ]);
  });

  it('refuses a device on a surface of another site', async () => {
    const other = await insert(db, 'sites', { organisation_id: org, name: 'Elsewhere', country: 'ES' });
    const stray = await insert(db, 'devices', { organisation_id: org, site_id: other, name: 'Stray', device_type: 'battery' });
    await expect(db.query('select building.place_device($1, p_surface_id => $2)', [stray, roof])).rejects.toThrow(/device_surface_site_mismatch/);
    await db.query('delete from devices where id = $1', [stray]);
  });

  it('lets a module derive the PV system into its own table, with the same id', async () => {
    await db.exec(`
      create schema energy;
      create table energy.pv_systems (
        id uuid primary key,
        inverter_count integer not null default 1,
        panel_technology text,
        annual_degradation numeric(5, 4) not null default 0.005
      );
      call derive_devices('energy.pv_systems', 'solar');
    `);
    await db.query(`insert into energy.pv_systems (id, inverter_count, panel_technology) values ($1, 1, 'mono')`, [pv]);
    const r = await one<{ name: string; rated_power_kw: string; panel_technology: string }>(
      db,
      `select d.name, d.rated_power_kw, p.panel_technology from devices d join energy.pv_systems p using (id) where d.id = $1`,
      [pv],
    );
    expect(r).toEqual({ name: 'PV system', rated_power_kw: '3.600', panel_technology: 'mono' });
    const battery = await insert(db, 'devices', { organisation_id: org, site_id: site, name: 'Not a PV', device_type: 'battery' });
    await expect(db.query(`insert into energy.pv_systems (id) values ($1)`, [battery])).rejects.toThrow(/device_type_mismatch/);
    await db.query('delete from devices where id = $1', [battery]);
  });

  it('attaches typed attributes with their history and reads them at any date', async () => {
    await db.query(
      `insert into attributes (object_kind, object_id, property_code, value, valid_from, valid_to, source) values
         ('building', $1, 'energy_label', '"E"', null, '2025-06-01', 'EPC 2019'),
         ('building', $1, 'energy_label', '"C"', '2025-06-01', null, 'EPC 2025 after insulation')`,
      [house],
    );
    const before = await one<{ p: Record<string, string> }>(db, `select attributes_of($1, '2024-01-01') p`, [house]);
    const after = await one<{ p: Record<string, string> }>(db, `select attributes_of($1, '2026-01-01') p`, [house]);
    expect(before.p.energy_label).toBe('E');
    expect(after.p.energy_label).toBe('C');
  });

  it('refuses an attribute of the wrong type, out of range, outside its list, or on the wrong kind', async () => {
    await expect(
      db.query(`insert into attributes (object_kind, object_id, property_code, value) values ('device', $1, 'efficiency', '"high"')`, [pv]),
    ).rejects.toThrow(/must be a number/);
    await expect(
      db.query(`insert into attributes (object_kind, object_id, property_code, value) values ('device', $1, 'efficiency', '1.4')`, [pv]),
    ).rejects.toThrow(/at most 1/);
    await expect(
      db.query(`insert into attributes (object_kind, object_id, property_code, value) values ('building', $1, 'energy_label', '"Z"')`, [house]),
    ).rejects.toThrow(/must be one of/);
    await expect(
      db.query(`insert into attributes (object_kind, object_id, property_code, value) values ('surface', $1, 'efficiency', '0.9')`, [roof]),
    ).rejects.toThrow(/property_not_applicable/);
  });

  it('refuses two attributes over overlapping periods', async () => {
    await expect(
      db.query(
        `insert into attributes (object_kind, object_id, property_code, value, valid_from) values ('building', $1, 'energy_label', '"B"', '2026-01-01')`,
        [house],
      ),
    ).rejects.toThrow(/overlapping_value/);
  });

  it('keeps a drone video and a permit as documents of the building', async () => {
    await db.query(
      `insert into documents (object_kind, object_id, name, kind, uri, media_type, source, captured_at, metadata) values
         ('building', $1, 'Orbit video', 'video', 's3://films/house-orbit.mp4', 'video/mp4', 'drone flight', '2026-09-30', '{"camera": "orbit"}'),
         ('building', $1, 'Building permit', 'permit', 's3://docs/permit-1998.pdf', 'application/pdf', 'town hall', null, '{}')`,
      [house],
    );
    const r = await one<{ n: number }>(db, 'select count(*)::int n from documents where object_id = $1', [house]);
    expect(r.n).toBe(2);
  });

  it('compares a measured series with a simulated one in a scenario, through one function', async () => {
    const sc = await one<{ id: string }>(
      db,
      `insert into scenarios (organisation_id, name) values ($1, 'Add a battery') returning id`,
      [org],
    );
    const measured = await one<{ id: string }>(
      db,
      `insert into series (object_kind, object_id, quantity_code, kind, step) values ('device', $1, 'energy', 'measured', '15 minutes') returning id`,
      [pv],
    );
    const simulated = await one<{ id: string }>(
      db,
      `insert into series (object_kind, object_id, quantity_code, kind, step, scenario_id, source_code) values ('device', $1, 'energy', 'simulated', '1 hour', $2, 'pvgis') returning id`,
      [pv, sc.id],
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

  it('lets a scenario add a device and override an attribute without touching reality', async () => {
    const sc = await one<{ id: string }>(db, `select id from scenarios where name = 'Add a battery'`);
    const battery = await insert(db, 'devices', {
      organisation_id: org, site_id: site, name: 'Battery', device_type: 'battery',
      rated_power_kw: 5, scenario_id: sc.id,
    });
    await db.query('select building.place_device($1, $2)', [battery, house]);
    await db.query(
      `insert into attributes (object_kind, object_id, property_code, value, scenario_id) values ('device', $1, 'efficiency', '0.92', $2)`,
      [battery, sc.id],
    );
    await db.query(
      `insert into attributes (object_kind, object_id, property_code, value, valid_from, scenario_id) values ('building', $1, 'energy_label', '"A"', '2025-06-01', $2)`,
      [house, sc.id],
    );
    const real = await one<{ p: Record<string, string> }>(db, `select attributes_of($1, '2026-07-01') p`, [house]);
    const variant = await one<{ p: Record<string, string> }>(db, `select attributes_of($1, '2026-07-01', $2) p`, [house, sc.id]);
    expect(real.p.energy_label).toBe('C');
    expect(variant.p.energy_label).toBe('A');
    const inReality = await one<{ n: number }>(
      db,
      `select count(*)::int n from devices where device_type = 'battery' and scenario_id is null`,
    );
    expect(inReality.n).toBe(0);
    await expect(
      db.query(`insert into attributes (object_kind, object_id, property_code, value) values ('device', $1, 'efficiency', '0.9')`, [battery]),
    ).rejects.toThrow(/attachment_outside_object_scenario/);
  });

  it('removes everything attached when the building goes', async () => {
    const shed = await insert(db, 'building.buildings', { organisation_id: org, site_id: site, name: 'Shed', footprint: square(-5.9795, 37.39, 3, 3), height_m: 2.5 });
    await db.query(`insert into attributes (object_kind, object_id, property_code, value) values ('building', $1, 'floor_area', '9')`, [shed]);
    await db.query(`insert into documents (object_kind, object_id, name, uri) values ('building', $1, 'Photo', 's3://photos/shed.jpg')`, [shed]);
    await db.query('delete from building.buildings where id = $1', [shed]);
    const r = await one<{ attrs: number; docs: number }>(
      db,
      `select (select count(*)::int from attributes where object_kind = 'building' and object_id = $1) attrs,
              (select count(*)::int from documents where object_kind = 'building' and object_id = $1) docs`,
      [shed],
    );
    expect(r).toEqual({ attrs: 0, docs: 0 });
  });
});

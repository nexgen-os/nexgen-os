// A house, described the way an architect, an installer and a resident each
// would: a tree of places, a roof face with its orientation, a PV array
// mounted on it, values with their history, a drone point cloud and a video
// as representations, a measured series and a simulated one in a scenario.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { entity, freshDatabase, one, workspace } from './helpers/db.js';

// A 10 m × 8 m footprint, around 37.39° N (Seville), in WGS 84.
const LON = -5.98;
const LAT = 37.39;
const dLon = (m: number) => m / (111_320 * Math.cos((LAT * Math.PI) / 180));
const dLat = (m: number) => m / 111_320;
const footprint = {
  type: 'Polygon',
  coordinates: [[
    [LON, LAT], [LON + dLon(10), LAT], [LON + dLon(10), LAT + dLat(8)], [LON, LAT + dLat(8)], [LON, LAT],
  ]],
};

let db: PGlite;
let ws: string;
let house: string;
let roof: string;
let pv: string;

beforeAll(async () => {
  db = await freshDatabase();
  ws = await workspace(db, 'A family');
  const site = await entity(db, { workspace_id: ws, class: 'site', name: 'Garden plot', country: 'ES' });
  house = await entity(db, {
    workspace_id: ws, class: 'building', name: 'House', parent_id: site,
    geometry: footprint, elevation_m: 12, height_m: 7.5,
  });
  const ground = await entity(db, { workspace_id: ws, class: 'storey', name: 'Ground floor', parent_id: house });
  await entity(db, { workspace_id: ws, class: 'space', name: 'Living room', parent_id: ground });
  roof = await entity(db, {
    workspace_id: ws, class: 'roof', name: 'South roof face', parent_id: house, azimuth_deg: 180, tilt_deg: 30,
  });
  pv = await entity(db, { workspace_id: ws, class: 'pv_array', name: 'PV array', parent_id: house, tags: ['solar', 'elec'] });
  await db.query(
    `insert into relationships (subject_id, type_code, object_id) values ($1, 'mounted_on', $2)`,
    [pv, roof],
  );
});

afterAll(async () => {
  await db.close();
});

describe('a house', () => {
  it('stores its footprint in 3D WGS 84 and measures it in metres anywhere', async () => {
    const r = await one<{ dims: number; srid: number; area: string; utm: number }>(
      db,
      `select ST_NDims(geometry) dims, ST_SRID(geometry) srid, plan_area_m2(geometry) area, metric_srid(geometry) utm
         from entities where id = $1`,
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
      `select GeometryType(g) type, ST_ZMin(g) zmin, ST_ZMax(g) zmax from (select lod1_block($1) g) b`,
      [house],
    );
    expect(r.type).toBe('POLYHEDRALSURFACE');
    expect(r.zmin).toBe(12);
    expect(r.zmax).toBe(19.5);
  });

  it('inherits its country from the site', async () => {
    const r = await one<{ c: string }>(db, 'select entity_country($1) c', [roof]);
    expect(r.c).toBe('ES');
  });

  it('refuses a storey directly on a site', async () => {
    const site = await one<{ parent_id: string }>(db, 'select parent_id from entities where id = $1', [house]);
    await expect(
      entity(db, { workspace_id: ws, class: 'storey', name: 'Floating storey', parent_id: site.parent_id }),
    ).rejects.toThrow(/entity_class_not_allowed_under/);
  });

  it('attaches typed values with their history and reads them at any date', async () => {
    await db.query(
      `insert into entity_values (entity_id, property_code, value, valid_from, valid_to, source) values
         ($1, 'peak_power', '3.6', null, '2025-06-01', 'installer datasheet'),
         ($1, 'peak_power', '6.0', '2025-06-01', null, 'extension of 2025')`,
      [pv],
    );
    const before = await one<{ p: Record<string, number> }>(db, `select entity_properties($1, '2024-01-01') p`, [pv]);
    const after = await one<{ p: Record<string, number> }>(db, `select entity_properties($1, '2026-01-01') p`, [pv]);
    expect(before.p.peak_power).toBe(3.6);
    expect(after.p.peak_power).toBe(6);
  });

  it('refuses a value of the wrong type, out of range, or on the wrong class', async () => {
    await expect(
      db.query(`insert into entity_values (entity_id, property_code, value) values ($1, 'peak_power', '"big"')`, [pv]),
    ).rejects.toThrow(/must be a number/);
    await expect(
      db.query(`insert into entity_values (entity_id, property_code, value) values ($1, 'efficiency', '1.4')`, [pv]),
    ).rejects.toThrow(/at most 1/);
    await expect(
      db.query(`insert into entity_values (entity_id, property_code, value) values ($1, 'peak_power', '5')`, [roof]),
    ).rejects.toThrow(/property_not_applicable/);
  });

  it('refuses two values over overlapping periods', async () => {
    await expect(
      db.query(
        `insert into entity_values (entity_id, property_code, value, valid_from) values ($1, 'peak_power', '7', '2026-01-01')`,
        [pv],
      ),
    ).rejects.toThrow(/overlapping_value/);
  });

  it('keeps a drone point cloud, a mesh and a video as representations', async () => {
    await db.query(
      `insert into representations (entity_id, kind, lod, uri, media_type, source, captured_at, metadata) values
         ($1, 'point_cloud', null, 's3://captures/house.copc.laz', 'application/vnd.laszip+copc', 'drone flight', '2026-09-30', '{"points_per_m2": 400}'),
         ($1, 'mesh', 2, 's3://models/house.glb', 'model/gltf-binary', 'photogrammetry', '2026-09-30', '{}'),
         ($1, 'video', null, 's3://films/house-orbit.mp4', 'video/mp4', 'render', null, '{"camera": "orbit"}')`,
      [house],
    );
    await db.query(
      `insert into representations (entity_id, kind, lod, geometry, source) values ($1, 'solid', 1, lod1_block($1), 'derived')`,
      [house],
    );
    const r = await one<{ n: number }>(db, 'select count(*)::int n from representations where entity_id = $1', [house]);
    expect(r.n).toBe(4);
  });

  it('compares a measured series with a simulated one in a scenario, through one function', async () => {
    const sc = await one<{ id: string }>(
      db,
      `insert into scenarios (workspace_id, name) values ($1, 'Add a battery') returning id`,
      [ws],
    );
    const measured = await one<{ id: string }>(
      db,
      `insert into datastreams (entity_id, quantity_code, kind, step) values ($1, 'energy', 'measured', '15 minutes') returning id`,
      [pv],
    );
    const simulated = await one<{ id: string }>(
      db,
      `insert into datastreams (entity_id, quantity_code, kind, step, scenario_id) values ($1, 'energy', 'simulated', '1 hour', $2) returning id`,
      [pv, sc.id],
    );
    await db.query(
      `insert into observations (datastream_id, at, value)
       select $1, ts, 0.25 from generate_series('2026-07-01 12:00+00'::timestamptz, '2026-07-01 13:45+00', '15 minutes') ts`,
      [measured.id],
    );
    await db.query(
      `insert into observations (datastream_id, at, value) values ($1, '2026-07-01 12:00+00', 1.1), ($1, '2026-07-01 13:00+00', 0.9)`,
      [simulated.id],
    );
    const m = await db.query<{ value: number }>(
      `select value from series($1, '2026-07-01 12:00+00', '2026-07-01 14:00+00', '1 hour')`,
      [measured.id],
    );
    const s = await db.query<{ value: number }>(
      `select value from series($1, '2026-07-01 12:00+00', '2026-07-01 14:00+00', '1 hour')`,
      [simulated.id],
    );
    expect(m.rows.map((r) => r.value)).toEqual([1, 1]);
    expect(s.rows.map((r) => r.value)).toEqual([1.1, 0.9]);
  });

  it('lets a scenario add equipment and override a value without touching reality', async () => {
    const sc = await one<{ id: string }>(db, `select id from scenarios where name = 'Add a battery'`);
    const battery = await entity(db, {
      workspace_id: ws, class: 'battery', name: 'Battery', parent_id: house, scenario_id: sc.id,
    });
    await db.query(
      `insert into entity_values (entity_id, property_code, value, scenario_id) values ($1, 'energy_capacity', '10', $2)`,
      [battery, sc.id],
    );
    await db.query(
      `insert into entity_values (entity_id, property_code, value, valid_from, scenario_id) values ($1, 'peak_power', '9', '2025-06-01', $2)`,
      [pv, sc.id],
    );
    const real = await one<{ p: Record<string, number> }>(db, `select entity_properties($1, '2026-07-01') p`, [pv]);
    const variant = await one<{ p: Record<string, number> }>(db, `select entity_properties($1, '2026-07-01', $2) p`, [pv, sc.id]);
    expect(real.p.peak_power).toBe(6);
    expect(variant.p.peak_power).toBe(9);
    const inReality = await one<{ n: number }>(
      db,
      `select count(*)::int n from entities where class = 'battery' and scenario_id is null`,
    );
    expect(inReality.n).toBe(0);
  });
});

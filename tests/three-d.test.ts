// The `3d` module: the physical description of a place, beside a core that
// keeps the site. A block of flats on one site, its floors and units, a
// roof face, devices placed in a unit and on the roof, a participant of a
// project occupying a unit, and a PV array of the solar module placed on
// the roof face, which keeps its own orientation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { detachedModuleTables } from '../packages/cli/src/doctor.js';
import { freshDatabase, insert, one, organisation, sqlClient, square } from './helpers/db.js';

let db: PGlite;
let org: string;
let site: string;
let block: string;
let ground: string;
let flatA: string;
let roof: string;
let heatPump: string;

beforeAll(async () => {
  db = await freshDatabase(['3d', 'solar']);
  org = await organisation(db, 'A housing cooperative');
  site = await insert(db, 'sites', { organisation_id: org, name: 'Canal block', country: 'NL', time_zone: 'Europe/Amsterdam' });
  block = (await one<{ id: string }>(
    db, `select three_d.add_building($1, 'Block A', ST_GeomFromGeoJSON($2), 2, 9) id`, [site, JSON.stringify(square(4.9, 52.37, 20, 12))])).id;
  ground = (await one<{ id: string }>(db, `select three_d.add_space($1, 'floor', 'Ground floor', null, 0) id`, [block])).id;
  flatA = (await one<{ id: string }>(db, `select three_d.add_space($1, 'unit', 'Flat A', $2) id`, [block, ground])).id;
  roof = (await one<{ id: string }>(db, `select three_d.add_surface($1, 'roof', 'South roof', null, 180, 35) id`, [block])).id;
  heatPump = (await one<{ id: string }>(db, `select install_device($1, 'heat_pump', 'Heat pump flat A') id`, [site])).id;
});

afterAll(async () => {
  await db.close();
});

describe('the module', () => {
  it('registers under its code, owns its schema and declares its kinds, link types and properties', async () => {
    const m = await one<{ code: string; schema_name: string; requires_core_min: string }>(
      db, `select code, schema_name, requires_core_min from modules where code = '3d'`);
    expect(m).toEqual({ code: '3d', schema_name: 'three_d', requires_core_min: '0.3.0' });
    const kinds = await db.query<{ kind: string; table_name: string; published_by: string }>(
      `select kind, table_name, published_by from object_kinds where kind in ('building', 'space', 'surface') order by kind`);
    expect(kinds.rows).toEqual([
      { kind: 'building', table_name: 'three_d.buildings', published_by: '3d' },
      { kind: 'space', table_name: 'three_d.spaces', published_by: '3d' },
      { kind: 'surface', table_name: 'three_d.surfaces', published_by: '3d' },
    ]);
    const links = await db.query<{ code: string }>(`select code from link_types where published_by = '3d' order by code`);
    expect(links.rows.map((r) => r.code)).toEqual(['occupies', 'placed_in', 'placed_on']);
    const props = await one<{ n: number }>(db, `select count(*)::int n from property_defs where published_by = '3d'`);
    expect(props.n).toBe(9);
  });

  it('leaves no building, space or surface in the core, and no column of the core naming one', async () => {
    const tables = await db.query<{ table_schema: string; table_name: string }>(
      `select table_schema, table_name from information_schema.tables
        where table_name in ('buildings', 'spaces', 'surfaces', 'placements') order by table_name`);
    expect(tables.rows.every((r) => r.table_schema === 'three_d')).toBe(true);
    const columns = await one<{ n: number }>(
      db, `select count(*)::int n from information_schema.columns
            where table_schema = 'nexgen' and column_name in ('building_id', 'space_id', 'surface_id')`);
    expect(columns.n).toBe(0);
  });

  it('starts from the core: every table has row level security and reaches a table of the core', async () => {
    const open = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'three_d' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(open.rows).toEqual([]);
    expect(await detachedModuleTables(sqlClient(db), ['three_d'])).toEqual([]);
  });

  it('keeps site_of, country_of and the parent checks of the core working on its kinds', async () => {
    const r = await one<{ site: string; country: string; building: string }>(
      db, 'select site_of($1) site, country_of($1) country, three_d.building_of($1) building', [flatA]);
    expect(r).toEqual({ site, country: 'NL', building: block });
    const other = await organisation(db, 'Someone else');
    await expect(insert(db, 'three_d.buildings', { organisation_id: other, site_id: site, name: 'Intruder' }))
      .rejects.toThrow(/parent_in_other_organisation/);
  });
});

describe('the placement of a device', () => {
  it('places a device in a unit, and fills the building from it', async () => {
    await db.query('select three_d.place_device($1, p_space_id => $2)', [heatPump, flatA]);
    const p = await one<{ building_id: string; space_id: string; organisation_id: string }>(
      db, 'select building_id, space_id, organisation_id from three_d.placements where device_id = $1', [heatPump]);
    expect(p).toEqual({ building_id: block, space_id: flatA, organisation_id: org });
    const r = await one<{ site: string; building: string }>(db, 'select site_of($1) site, three_d.building_of($1) building', [heatPump]);
    expect(r).toEqual({ site, building: block });
  });

  it('refuses a place of another site, and a space and a surface of two buildings', async () => {
    const elsewhere = await insert(db, 'sites', { organisation_id: org, name: 'Depot', country: 'NL' });
    const shed = (await one<{ id: string }>(db, `select three_d.add_building($1, 'Shed') id`, [elsewhere])).id;
    const shedRoof = (await one<{ id: string }>(db, `select three_d.add_surface($1, 'roof', 'Shed roof', null, 90, 10) id`, [shed])).id;
    await expect(db.query('select three_d.place_device($1, $2)', [heatPump, shed])).rejects.toThrow(/device_building_site_mismatch/);
    await expect(db.query('select three_d.place_device($1, p_surface_id => $2)', [heatPump, shedRoof])).rejects.toThrow(/device_surface_site_mismatch/);
    const annex = (await one<{ id: string }>(db, `select three_d.add_building($1, 'Annex') id`, [site])).id;
    await expect(db.query('select three_d.place_device($1, $2, $3)', [heatPump, annex, flatA])).rejects.toThrow(/device_space_building_mismatch/);
  });

  it('moves a device and keeps where it was as a dated placed_in link', async () => {
    await db.query(`select three_d.move_device($1, p_surface_id => $2, p_at => '2026-05-01')`, [heatPump, roof]);
    const now = await one<{ building_id: string; space_id: string | null; surface_id: string }>(
      db, 'select building_id, space_id, surface_id from three_d.placements where device_id = $1', [heatPump]);
    expect(now).toEqual({ building_id: block, space_id: null, surface_id: roof });
    const was = await db.query<{ object_id: string; valid_to: string }>(
      `select object_id, valid_to::date::text valid_to from links where subject_id = $1 and type_code = 'placed_in'`, [heatPump]);
    expect(was.rows).toEqual([{ object_id: flatA, valid_to: '2026-05-01' }]);
  });

  it('lets the cascade of parameter_of go through the place of a device', async () => {
    await db.query(`select set_attribute($1, 'annual_consumption', '3200', null, null, 'survey')`, [block]);
    const r = await one<{ p: { value: number; level: string } }>(db, `select parameter_of($1, 'annual_consumption') p`, [heatPump]);
    expect(r.p).toMatchObject({ value: 3200, level: 'building' });
  });

  it('goes with its device, and loses a place that goes', async () => {
    const probe = (await one<{ id: string }>(db, `select install_device($1, 'sensor', 'Probe') id`, [site])).id;
    await db.query('select three_d.place_device($1, p_space_id => $2)', [probe, flatA]);
    await db.query('delete from devices where id = $1', [probe]);
    const r = await one<{ n: number }>(db, 'select count(*)::int n from three_d.placements where device_id = $1', [probe]);
    expect(r.n).toBe(0);
  });
});

describe('a participant occupies a unit', () => {
  it('links a participant of a project to the unit it occupies, and refuses a site as the object', async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Block community', kind: 'energy_community', country: 'NL' });
    const tenant = (await one<{ id: string }>(db, `select join_project($1, $2, 'Flat A', 'consumer', null, '2026-01-01') id`, [project, site])).id;
    await db.query(`insert into links (subject_id, type_code, object_id, valid_from) values ($1, 'occupies', $2, '2026-01-01')`, [tenant, flatA]);
    const r = await one<{ unit: string; floor: string }>(
      db,
      `select u.name unit, f.name floor from links l join three_d.spaces u on u.id = l.object_id join three_d.spaces f on f.id = u.parent_id
        where l.subject_id = $1 and l.type_code = 'occupies'`,
      [tenant],
    );
    expect(r).toEqual({ unit: 'Flat A', floor: 'Ground floor' });
    await expect(db.query(`insert into links (subject_id, type_code, object_id) values ($1, 'occupies', $2)`, [tenant, site]))
      .rejects.toThrow(/link_object_kind/);
  });
});

describe('a PV array on a roof face', () => {
  let system: string;

  beforeAll(async () => {
    system = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Roof PV') id`, [site])).id;
    await db.query('insert into solar.pv_systems (id) values ($1)', [system]);
  });

  it('is placed by a dated placed_on link, and takes the face\'s orientation when it has none', async () => {
    const array = await insert(db, 'solar.pv_arrays', { organisation_id: org, pv_system_id: system, name: 'South', kwp_dc: 6 });
    await db.query(`select three_d.place_array($1, $2, '2026-03-01')`, [array, roof]);
    const a = await one<{ azimuth_deg: string; tilt_deg: string }>(db, 'select azimuth_deg, tilt_deg from solar.pv_arrays where id = $1', [array]);
    expect(a).toEqual({ azimuth_deg: '180.00', tilt_deg: '35.00' });
    const link = await one<{ object_id: string; valid_from: string; valid_to: string | null }>(
      db, `select object_id, valid_from::date::text valid_from, valid_to from links where subject_id = $1 and type_code = 'placed_on'`, [array]);
    expect(link).toEqual({ object_id: roof, valid_from: '2026-03-01', valid_to: null });
    expect((await one<{ b: string }>(db, 'select three_d.building_of($1) b', [array])).b).toBe(block);
  });

  it('keeps its own orientation over the face\'s: a tilted frame on a flat roof', async () => {
    const flat = (await one<{ id: string }>(db, `select three_d.add_surface($1, 'roof', 'Flat roof', null, 0, 0) id`, [block])).id;
    const rack = await insert(db, 'solar.pv_arrays', { organisation_id: org, pv_system_id: system, name: 'Rack', azimuth_deg: 180, tilt_deg: 15, kwp_dc: 3 });
    await db.query('select three_d.place_array($1, $2)', [rack, flat]);
    const a = await one<{ azimuth_deg: string; tilt_deg: string }>(db, 'select azimuth_deg, tilt_deg from solar.pv_arrays where id = $1', [rack]);
    expect(a).toEqual({ azimuth_deg: '180.00', tilt_deg: '15.00' });
  });

  it('moves to another face, the one it leaves ending that day', async () => {
    const array = await insert(db, 'solar.pv_arrays', { organisation_id: org, pv_system_id: system, name: 'Moved', azimuth_deg: 180, tilt_deg: 35, kwp_dc: 2 });
    const east = (await one<{ id: string }>(db, `select three_d.add_surface($1, 'roof', 'East roof', null, 90, 35) id`, [block])).id;
    await db.query(`select three_d.place_array($1, $2, '2026-03-01')`, [array, roof]);
    await db.query(`select three_d.place_array($1, $2, '2026-08-01')`, [array, east]);
    const links = await db.query<{ object_id: string; valid_to: string | null }>(
      `select object_id, valid_to::date::text valid_to from links where subject_id = $1 and type_code = 'placed_on' order by valid_from`, [array]);
    expect(links.rows).toEqual([{ object_id: roof, valid_to: '2026-08-01' }, { object_id: east, valid_to: null }]);
  });

  it('refuses a face of another site', async () => {
    const elsewhere = await insert(db, 'sites', { organisation_id: org, name: 'Field', country: 'NL' });
    const field = (await one<{ id: string }>(db, `select three_d.add_surface($1, 'ground', 'Field', null, 180, 0) id`, [elsewhere])).id;
    const array = await insert(db, 'solar.pv_arrays', { organisation_id: org, pv_system_id: system, name: 'Stray', azimuth_deg: 180, tilt_deg: 20 });
    await expect(db.query('select three_d.place_array($1, $2)', [array, field])).rejects.toThrow(/array_outside_system_site/);
  });
});

describe('without the solar module', () => {
  it('installs alone, and says by name that an array needs solar', async () => {
    const alone = await freshDatabase(['3d']);
    try {
      const o = await organisation(alone, 'Alone');
      const s = await insert(alone, 'sites', { organisation_id: o, name: 'Plot', country: 'NL' });
      const b = (await one<{ id: string }>(alone, `select three_d.add_building($1, 'House') id`, [s])).id;
      const f = (await one<{ id: string }>(alone, `select three_d.add_surface($1, 'roof', 'Roof', null, 180, 30) id`, [b])).id;
      await expect(alone.query('select three_d.place_array($1, $2)', [s, f])).rejects.toThrow(/module_required: solar/);
    } finally {
      await alone.close();
    }
  });
});

// The `building` module: the physical description of the place of a
// participant, beside a core that keeps the participant and its place. The
// ground of a block, the block on it, its floors and units, a roof face, a
// tenant of a project occupying a unit; and what the module no longer does:
// place a device or a PV array, which belong to their participant.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { detachedModuleTables } from '../packages/cli/src/doctor.js';
import { freshDatabase, insert, one, organisation, sqlClient, square, participant } from './helpers/db.js';

let db: PGlite;
let org: string;
let owner: string;
let plot: string;
let block: string;
let ground: string;
let flatA: string;
let roof: string;

beforeAll(async () => {
  db = await freshDatabase(['building', 'solar']);
  org = await organisation(db, 'A housing cooperative');
  owner = await participant(db, { organisation_id: org, name: 'Canal block', country: 'NL', time_zone: 'Europe/Amsterdam' });
  plot = (await one<{ id: string }>(
    db, `select building.add_site($1, 'Canal plot', ST_GeomFromGeoJSON($2), p_profile => 'land') id`, [owner, JSON.stringify(square(4.8999, 52.3699, 30, 20))])).id;
  block = (await one<{ id: string }>(
    db, `select building.add_building($1, 'Block A', ST_GeomFromGeoJSON($2), 2, 9, p_site_id => $3) id`, [owner, JSON.stringify(square(4.9, 52.37, 20, 12)), plot])).id;
  ground = (await one<{ id: string }>(db, `select building.add_space($1, 'floor', 'Ground floor', null, 0) id`, [block])).id;
  flatA = (await one<{ id: string }>(db, `select building.add_space($1, 'unit', 'Flat A', $2) id`, [block, ground])).id;
  roof = (await one<{ id: string }>(db, `select building.add_surface($1, 'roof', 'South roof', null, 180, 35) id`, [block])).id;
});

afterAll(async () => {
  await db.close();
});

describe('the module', () => {
  it('registers under its code, owns its schema and declares its kinds, link types and properties', async () => {
    const m = await one<{ code: string; schema_name: string; requires_core_min: string }>(
      db, `select code, schema_name, requires_core_min from modules where code = 'building'`);
    expect(m).toEqual({ code: 'building', schema_name: 'building', requires_core_min: '0.3.0' });
    const kinds = await db.query<{ kind: string; table_name: string; published_by: string }>(
      `select kind, table_name, published_by from kinds where published_by = 'building' order by kind`);
    expect(kinds.rows).toEqual([
      { kind: 'building', table_name: 'building.buildings', published_by: 'building' },
      { kind: 'site', table_name: 'building.sites', published_by: 'building' },
      { kind: 'space', table_name: 'building.spaces', published_by: 'building' },
      { kind: 'surface', table_name: 'building.surfaces', published_by: 'building' },
    ]);
    const links = await db.query<{ code: string }>(`select code from link_types where published_by = 'building' order by code`);
    expect(links.rows.map((r) => r.code)).toEqual(['occupies']);
    const props = await one<{ n: number }>(db, `select count(*)::int n from property_defs where published_by = 'building'`);
    expect(props.n).toBe(9);
  });

  it('leaves no site, building, space or surface in the core, and places no device', async () => {
    const tables = await db.query<{ table_schema: string; table_name: string }>(
      `select table_schema, table_name from information_schema.tables
        where table_name in ('sites', 'buildings', 'spaces', 'surfaces', 'devices') order by table_schema, table_name`);
    expect(tables.rows).toEqual([
      { table_schema: 'building', table_name: 'buildings' }, { table_schema: 'building', table_name: 'sites' },
      { table_schema: 'building', table_name: 'spaces' }, { table_schema: 'building', table_name: 'surfaces' },
      { table_schema: 'nexgen', table_name: 'devices' },
    ]);
    const columns = await one<{ n: number }>(
      db, `select count(*)::int n from information_schema.columns
            where table_schema = 'nexgen' and column_name in ('site_id', 'building_id', 'space_id', 'surface_id')`);
    expect(columns.n).toBe(0);
    const gestures = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('building', 'nexgen') and p.proname in ('place_device', 'move_device', 'place_array', 'connect_device')`);
    expect(gestures.rows).toEqual([]);
  });

  it('starts from the core: every table has row level security and reaches a table of the core', async () => {
    const open = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'building' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(open.rows).toEqual([]);
    expect(await detachedModuleTables(sqlClient(db), ['building'])).toEqual([]);
  });

  it('answers participant_of and country_of of the core for its kinds, and keeps the parent checks working', async () => {
    const r = await one<{ space: string; ground: string; country: string; building: string }>(
      db, `select participant_of('space', $1) space, participant_of('site', $2) ground, country_of('space', $1) country,
                  building.building_of('space', $1) building`, [flatA, plot]);
    expect(r).toEqual({ space: owner, ground: owner, country: 'NL', building: block });
    const other = await organisation(db, 'Someone else');
    await expect(insert(db, 'building.buildings', { organisation_id: other, participant_id: owner, name: 'Intruder' }))
      .rejects.toThrow(/parent_in_other_organisation/);
  });
});

describe('the ground of a participant', () => {
  it('holds its parcel, its area and its use; its buildings and ground surfaces stand on it', async () => {
    const r = await one<{ area: number; profile: string; buildings: number }>(
      db, `select area_m2(geometry)::float area, profile, (select count(*)::int from building.buildings where site_id = s.id) buildings
             from building.sites s where id = $1`, [plot]);
    expect(r.area).toBeCloseTo(600, -1);
    expect(r).toMatchObject({ profile: 'land', buildings: 1 });
    const yard = (await one<{ id: string }>(db, `select building.add_surface($1, 'ground', 'Yard', null, 180, 0) id`, [plot])).id;
    expect((await one<{ p: string }>(db, `select participant_of('surface', $1) p`, [yard])).p).toBe(owner);
  });

  it('refuses a building on the ground of another participant', async () => {
    const neighbour = await participant(db, { organisation_id: org, name: 'Depot', country: 'NL' });
    await expect(db.query(`select building.add_building($1, 'Shed', p_site_id => $2)`, [neighbour, plot]))
      .rejects.toThrow(/building_site_of_other_participant/);
  });

  it('resolves a parameter through what is built, then asks the core from the participant', async () => {
    await db.query(`select set_attribute('building', $1, 'annual_consumption', '3200', null, null, 'survey')`, [block]);
    const fromSpace = await one<{ p: { value: number; level: string } }>(db, `select building.parameter_of('space', $1, 'annual_consumption') p`, [flatA]);
    expect(fromSpace.p).toMatchObject({ value: 3200, level: 'building' });
    await db.query(`select set_attribute('participant', $1, 'annual_consumption', '9000', null, null, 'survey')`, [owner]);
    const fromGround = await one<{ p: { value: number; level: string } }>(db, `select building.parameter_of('site', $1, 'annual_consumption') p`, [plot]);
    expect(fromGround.p).toMatchObject({ value: 9000, level: 'participant' });
    const heatPump = (await one<{ id: string }>(db, `select install_device($1, 'heat_pump', 'Heat pump flat A') id`, [owner])).id;
    const fromDevice = await one<{ p: { value: number; level: string } }>(db, `select building.parameter_of('device', $1, 'annual_consumption') p`, [heatPump]);
    expect(fromDevice.p).toMatchObject({ value: 9000, level: 'participant' });
  });
});

describe('a participant occupies a unit', () => {
  it('links a participant of a project to the unit it occupies, and refuses a ground as the object', async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Block community', kind: 'energy_community', country: 'NL' });
    const tenant = (await one<{ id: string }>(
      db, `select join_project($1, 'Flat A', '{"street": "Canal 1", "address_extra": "Flat A", "country": "NL"}', 'consumer', null, '2026-01-01') id`, [project])).id;
    await db.query(`select link_objects('participant', $1, 'occupies', 'space', $2, '2026-01-01')`, [tenant, flatA]);
    const r = await one<{ unit: string; floor: string }>(
      db,
      `select u.name unit, f.name floor from links l join building.spaces u on u.id = l.object_id join building.spaces f on f.id = u.parent_id
        where l.subject_kind = 'participant' and l.subject_id = $1 and l.type_code = 'occupies'`,
      [tenant],
    );
    expect(r).toEqual({ unit: 'Flat A', floor: 'Ground floor' });
    await expect(db.query(`select link_objects('participant', $1, 'occupies', 'site', $2)`, [tenant, plot]))
      .rejects.toThrow(/link_object_kind/);
  });
});

describe('a PV array', () => {
  it('belongs to its system and keeps its own orientation, whatever the roof face below it', async () => {
    const system = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Roof PV') id`, [owner])).id;
    await db.query('insert into solar.pv_systems (id) values ($1)', [system]);
    const rack = await insert(db, 'solar.pv_arrays', { organisation_id: org, pv_system_id: system, name: 'Rack', azimuth_deg: 180, tilt_deg: 15, kwp_dc: 3 });
    const r = await one<{ participant: string; azimuth_deg: string; tilt_deg: string }>(
      db, `select participant_of('pv_array', id) participant, azimuth_deg, tilt_deg from solar.pv_arrays where id = $1`, [rack]);
    expect(r).toEqual({ participant: owner, azimuth_deg: '180.00', tilt_deg: '15.00' });
    expect((await one<{ b: string | null }>(db, `select building.building_of('pv_array', $1) b`, [rack])).b).toBeNull();
  });
});

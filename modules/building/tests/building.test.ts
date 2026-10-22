// The `building` module: the physical description of the place of a
// participant, beside a core that keeps the participant and its place. The
// ground of a block, the block on it, its floors and units, a roof face,
// what describes them in their columns, a tenant of a project occupying a
// unit; and what the module does not do: place a device or a PV array,
// which belong to their participant.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { detachedModuleTables } from '../../../packages/cli/src/doctor.js';
import { freshDatabase, insert, one, organisation, sqlClient, square, participant } from '../../../tests/helpers/db.js';

let db: PGlite;
let org: string;
let owner: string;
let plot: string;
let block: string;
let ground: string;
let flatA: string;

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
  await db.query(`select building.add_surface($1, 'roof', 'South roof', null, 180, 35)`, [block]);
});

afterAll(async () => {
  await db.close();
});

describe('the module', () => {
  it('registers under its code, owns its schema, its vocabulary of uses and the one property it declares', async () => {
    const m = await one<{ code: string; schema_name: string; requires_core_min: string }>(
      db, `select code, schema_name, requires_core_min from modules where code = 'building'`);
    expect(m).toEqual({ code: 'building', schema_name: 'building', requires_core_min: '0.3.0' });
    const uses = await one<{ n: number; land: string }>(db, `select count(*)::int n, max(applies_to) filter (where code = 'land') land from building.profiles`);
    expect(uses).toEqual({ n: 14, land: 'place' });
    const props = await db.query<{ code: string; applies_to: string[] }>(`select code, applies_to from property_defs where published_by = 'building'`);
    expect(props.rows).toEqual([{ code: 'file_record', applies_to: ['device'] }]);
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

  it('answers whose its objects are through their foreign keys, and keeps the parent checks working', async () => {
    const r = await one<{ space: string; ground: string; building: string }>(
      db, `select building.participant_of('space', $1) space, building.participant_of('site', $2) ground,
                  building.building_of('space', $1) building`, [flatA, plot]);
    expect(r).toEqual({ space: owner, ground: owner, building: block });
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
    expect((await one<{ p: string }>(db, `select building.participant_of('surface', $1) p`, [yard])).p).toBe(owner);
  });

  it('refuses a building on the ground of another participant', async () => {
    const neighbour = await participant(db, { organisation_id: org, name: 'Depot', country: 'NL' });
    await expect(db.query(`select building.add_building($1, 'Shed', p_site_id => $2)`, [neighbour, plot]))
      .rejects.toThrow(/building_site_of_other_participant/);
  });

  it('says what a register, a drawing or a survey gives of a building, a space and a surface in their columns', async () => {
    await db.query(`update building.buildings set year_built = 1931, floors_above_ground = 4, floor_area_m2 = 960, energy_label = 'D' where id = $1`, [block]);
    await db.query(`update building.spaces set floor_area_m2 = 64 where id = $1`, [flatA]);
    await db.query(`update building.surfaces set material = 'slate', u_value = 0.3, is_external = true where building_id = $1`, [block]);
    const r = await one<{ year_built: number; area: string; material: string }>(
      db, `select b.year_built, s.floor_area_m2::text area, f.material from building.buildings b
             join building.spaces s on s.building_id = b.id and s.id = $2 join building.surfaces f on f.building_id = b.id where b.id = $1`, [block, flatA]);
    expect(r).toEqual({ year_built: 1931, area: '64.00', material: 'slate' });
    await expect(db.query(`select set_attribute('building', $1, 'annual_consumption', '3200')`, [block])).rejects.toThrow(/kind_unknown: building/);
  });
});

describe('a participant occupies a unit', () => {
  it('names the participant of a project that occupies a unit, of the same organisation', async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Block community', kind: 'energy_community', country: 'NL' });
    const tenant = (await one<{ id: string }>(
      db, `select join_project($1, 'Flat A', '{"street": "Canal 1", "address_extra": "Flat A", "country": "NL"}', 'consumer', null, '2026-01-01') id`, [project])).id;
    await db.query(`update building.spaces set occupant_id = $1 where id = $2`, [tenant, flatA]);
    const r = await one<{ unit: string; floor: string }>(
      db,
      `select u.name unit, f.name floor from building.spaces u join building.spaces f on f.id = u.parent_id where u.occupant_id = $1`,
      [tenant],
    );
    expect(r).toEqual({ unit: 'Flat A', floor: 'Ground floor' });
    const stranger = await participant(db, { organisation_id: await organisation(db, 'Another landlord'), name: 'Stranger', country: 'NL' });
    await expect(db.query(`update building.spaces set occupant_id = $1 where id = $2`, [stranger, flatA])).rejects.toThrow(/parent_in_other_organisation/);
  });
});

describe('a PV array', () => {
  it('belongs to its system and keeps its own orientation, whatever the roof face below it', async () => {
    const system = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Roof PV') id`, [owner])).id;
    await db.query('insert into solar.pv_systems (id) values ($1)', [system]);
    const rack = await insert(db, 'solar.pv_arrays', { organisation_id: org, pv_system_id: system, name: 'Rack', azimuth_deg: 180, tilt_deg: 15, kwp_dc: 3 });
    const r = await one<{ participant: string; azimuth_deg: string; tilt_deg: string }>(
      db, `select participant_of('device', pv_system_id) participant, azimuth_deg, tilt_deg from solar.pv_arrays where id = $1`, [rack]);
    expect(r).toEqual({ participant: owner, azimuth_deg: '180.00', tilt_deg: '15.00' });
  });
});

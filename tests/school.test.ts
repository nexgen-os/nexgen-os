// A school, inside and out, with the core alone: two floors and their
// classrooms as one tree of spaces, a multisensor in a classroom whose
// readings are series, a heating setpoint asked of the heat pump, the heat
// pump that serves the building, and everything findable from the site.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation, square } from './helpers/db.js';

let db: PGlite;
let org: string;
let site: string;
let school: string;
let ground: string;
let first: string;
let classroom1: string;
let classroom5: string;
let probe: string;
let heatPump: string;

beforeAll(async () => {
  db = await freshDatabase(['3d']);
  org = await organisation(db, 'A municipality');
  site = await insert(db, 'sites', {
    organisation_id: org, name: 'École du Centre', country: 'BE', street: "Rue de l'École 12", postal_code: '1380', city: 'Valbrisée', profile: 'school',
  });
  school = await insert(db, 'three_d.buildings', {
    organisation_id: org, site_id: site, name: 'Main building', profile: 'school',
    footprint: square(4.4702, 50.6802, 40, 20), elevation_m: 112, height_m: 9.5,
  });
  ground = (await one<{ id: string }>(db, `select three_d.add_space($1, 'floor', 'Ground floor', null, 0, null, 112, 3.2) id`, [school])).id;
  first = (await one<{ id: string }>(db, `select three_d.add_space($1, 'floor', 'First floor', null, 1, null, 115.2, 3) id`, [school])).id;
  classroom1 = (await one<{ id: string }>(db, `select three_d.add_space($1, 'room', 'Classroom 1', $2) id`, [school, ground])).id;
  await db.query(`select three_d.add_space($1, 'room', 'Canteen', $2)`, [school, ground]);
  classroom5 = (await one<{ id: string }>(db, `select three_d.add_space($1, 'room', 'Classroom 5', $2) id`, [school, first])).id;
  probe = (await one<{ id: string }>(db, `select install_device($1, 'sensor_box', 'Multisensor classroom 1') id`, [site])).id;
  await db.query('select three_d.place_device($1, p_space_id => $2)', [probe, classroom1]);
  heatPump = (await one<{ id: string }>(db, `select install_device($1, 'heat_pump', 'Air-to-water heat pump', null, null, 24, '2023-10-02') id`, [site])).id;
  await db.query('select three_d.place_device($1, $2)', [heatPump, school]);
  for (const [quantity, kind, device, ref] of [
    ['temperature', 'measured', probe, 'mqtt://school/c1/temp'],
    ['co2', 'measured', probe, 'mqtt://school/c1/co2'],
    ['temperature', 'setpoint', heatPump, 'modbus://10.0.0.5/4001'],
  ]) {
    await db.query(`select series_ensure($1, $2, $3, 'instant', null, $4, $5)`, [classroom1, quantity, kind, device, ref]);
  }
  await db.query(`select series_ensure($1, 'temperature', 'measured', 'instant')`, [classroom5]);
});

afterAll(async () => {
  await db.close();
});

describe('a school, inside', () => {
  it('finds the site, the country and the building from a room', async () => {
    const r = await one<{ site: string; country: string; building: string }>(
      db,
      'select site_of($1) site, country_of($1) country, three_d.building_of($1) building',
      [classroom5],
    );
    expect(r).toEqual({ site, country: 'BE', building: school });
  });

  it('lists the rooms of the building with their points, floor by floor', async () => {
    const r = await db.query<{ floor: string; room: string; points: number }>(
      `select f.name floor, r.name room, count(se.id)::int points
         from three_d.spaces f
         join three_d.spaces r on r.parent_id = f.id
         left join series se on se.object_id = r.id
        where f.building_id = $1 and f.kind = 'floor'
        group by f.level, f.name, r.name
        order by f.level, r.name`,
      [school],
    );
    expect(r.rows).toEqual([
      { floor: 'Ground floor', room: 'Canteen', points: 0 },
      { floor: 'Ground floor', room: 'Classroom 1', points: 3 },
      { floor: 'First floor', room: 'Classroom 5', points: 1 },
    ]);
  });

  it('places the multisensor in its room, and its building with it', async () => {
    const r = await one<{ space: string; building: string }>(db, 'select space_id space, building_id building from three_d.devices where device_id = $1', [probe]);
    expect(r).toEqual({ space: classroom1, building: school });
  });

  it('refuses two floors at one level, a floor inside a room, a room of another building and a loop', async () => {
    await expect(db.query(`select three_d.add_space($1, 'floor', 'Another ground floor', null, 0)`, [school])).rejects.toThrow(/duplicate key/);
    await expect(db.query(`select three_d.add_space($1, 'floor', 'Mezzanine', $2, 2)`, [school, classroom1])).rejects.toThrow(/spaces_floor_at_top/);
    await expect(db.query(`select three_d.add_space($1, 'room', 'A room with a level', null, 3)`, [school])).rejects.toThrow(/spaces_level_for_floors/);
    const annex = await insert(db, 'three_d.buildings', { organisation_id: org, site_id: site, name: 'Annex' });
    await expect(db.query(`select three_d.add_space($1, 'room', 'Store', $2)`, [annex, ground])).rejects.toThrow(/space_outside_building/);
    const zone = (await one<{ id: string }>(db, `select three_d.add_space($1, 'zone', 'North zone') id`, [school])).id;
    const wing = (await one<{ id: string }>(db, `select three_d.add_space($1, 'zone', 'North wing', $2) id`, [school, zone])).id;
    await expect(db.query('update three_d.spaces set parent_id = $1 where id = $2', [wing, zone])).rejects.toThrow(/space_cycle/);
  });

  it('refuses a device in a room of another site', async () => {
    const elsewhere = await insert(db, 'sites', { organisation_id: org, name: 'Gym', country: 'BE' });
    const stray = (await one<{ id: string }>(db, `select install_device($1, 'sensor', 'Stray') id`, [elsewhere])).id;
    await expect(db.query('select three_d.place_device($1, p_space_id => $2)', [stray, classroom1]))
      .rejects.toThrow(/device_space_site_mismatch/);
  });

  it('records a measured temperature and its setpoint the same way, by their devices', async () => {
    const measured = await one<{ id: string }>(db, `select id from series where object_id = $1 and quantity_code = 'temperature' and kind = 'measured'`, [classroom1]);
    const asked = await one<{ id: string; device: string }>(db, `select id, device_id device from series where object_id = $1 and kind = 'setpoint'`, [classroom1]);
    expect(asked.device).toBe(heatPump);
    await db.query(`select store($1, array['2026-01-10 08:00+00', '2026-01-10 08:30+00']::timestamptz[], array[18.5, 19.5]::float8[])`, [measured.id]);
    await db.query(`select store($1, array['2026-01-10 08:00+00']::timestamptz[], array[20]::float8[])`, [asked.id]);
    const r = await one<{ value: number }>(
      db,
      `select value from resample($1, '2026-01-10 08:00+00', '2026-01-10 09:00+00', '1 hour')`,
      [measured.id],
    );
    expect(r.value).toBe(19);
  });

  it('serves the building with the heat pump, linked to it', async () => {
    await db.query(`select link_objects($1, 'serves', $2)`, [heatPump, school]);
    const r = await one<{ name: string }>(
      db,
      `select d.name from links l join devices d on d.id = l.subject_id where l.type_code = 'serves' and l.object_id = $1`,
      [school],
    );
    expect(r.name).toBe('Air-to-water heat pump');
  });

  it('attaches an attribute to a room like to anything else', async () => {
    await expect(db.query(`select set_attribute($1, 'roof_area', '12')`, [classroom1])).rejects.toThrow(/property_not_applicable/);
    await db.query(`select set_attribute($1, 'floor_area', '62', null, null, 'as-built drawings')`, [classroom1]);
    await db.query(
      `insert into property_defs (code, name, datatype, applies_to, published_by) values ('acoustic_class', 'Acoustic class', 'text', '{space}', 'installation')`,
    );
    await db.query(`select set_attribute($1, 'acoustic_class', '"B"')`, [classroom1]);
    const p = await one<{ p: Record<string, unknown> }>(db, 'select attributes_of($1) p', [classroom1]);
    expect(p.p).toEqual({ acoustic_class: 'B', floor_area: 62 });
  });

  it('removes the floors, rooms, devices in them and their series when the building goes', async () => {
    await db.query('delete from three_d.buildings where id = $1', [school]);
    const r = await one<{ spaces: number; series: number; objects: number; placed: number }>(
      db,
      `select (select count(*)::int from three_d.spaces where building_id = $1) spaces,
              (select count(*)::int from series) series,
              (select count(*)::int from objects where kind = 'space') objects,
              (select count(*)::int from three_d.devices where space_id is not null or building_id is not null) placed`,
      [school],
    );
    expect(r).toEqual({ spaces: 0, series: 0, objects: 0, placed: 0 });
  });
});

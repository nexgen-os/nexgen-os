// A school, inside and out, with the architecture module: two floors, classrooms,
// sensors for several quantities in the rooms, a heating setpoint, the heat
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

beforeAll(async () => {
  db = await freshDatabase(['architecture']);
  org = await organisation(db, 'A municipality');
  site = await insert(db, 'sites', {
    organisation_id: org, name: 'École du Centre', country: 'BE', street: "Rue de l'École 12", postal_code: '1380', city: 'Lasne', profile: 'school',
  });
  school = await insert(db, 'buildings', {
    organisation_id: org, site_id: site, name: 'Main building', profile: 'school',
    footprint: square(4.4702, 50.6802, 40, 20), elevation_m: 112, height_m: 9.5, floors_above_ground: 2, year_built: 1968,
  });
  ground = await insert(db, 'architecture.floors', { organisation_id: org, building_id: school, name: 'Ground floor', level: 0, elevation_m: 112, height_m: 3.2 });
  first = await insert(db, 'architecture.floors', { organisation_id: org, building_id: school, name: 'First floor', level: 1, elevation_m: 115.2, height_m: 3 });
  classroom1 = await insert(db, 'architecture.spaces', { organisation_id: org, floor_id: ground, name: 'Classroom 1', kind: 'room', area_m2: 62 });
  await insert(db, 'architecture.spaces', { organisation_id: org, floor_id: ground, name: 'Canteen', kind: 'room', area_m2: 140 });
  classroom5 = await insert(db, 'architecture.spaces', { organisation_id: org, floor_id: first, name: 'Classroom 5', kind: 'room', area_m2: 60 });
  for (const [name, quantity, kind, ref] of [
    ['Temperature classroom 1', 'temperature', 'sensor', 'mqtt://school/c1/temp'],
    ['CO2 classroom 1', 'co2', 'sensor', 'mqtt://school/c1/co2'],
    ['Heating setpoint classroom 1', 'temperature', 'setpoint', 'modbus://10.0.0.5/4001'],
  ]) {
    await insert(db, 'sensors', { organisation_id: org, host_id: classroom1, name, quantity_code: quantity, kind, external_ref: ref });
  }
  await insert(db, 'sensors', { organisation_id: org, host_id: classroom5, name: 'Temperature classroom 5', quantity_code: 'temperature' });
});

afterAll(async () => {
  await db.close();
});

describe('a school with the architecture module', () => {
  it('finds the site and the country from a room', async () => {
    const r = await one<{ site: string; country: string; building: string }>(
      db,
      'select site_of($1) site, country_of($1) country, architecture.building_of($1) building',
      [classroom5],
    );
    expect(r).toEqual({ site, country: 'BE', building: school });
  });

  it('lists the rooms of the building with their sensors, floor by floor', async () => {
    const r = await db.query<{ level: string; room: string; sensors: number }>(
      `select st.name level, sp.name room, count(se.id)::int sensors
         from architecture.floors st
         join architecture.spaces sp on sp.floor_id = st.id
         left join sensors se on se.host_id = sp.id
        where st.building_id = $1
        group by st.level, st.name, sp.name
        order by st.level, sp.name`,
      [school],
    );
    expect(r.rows).toEqual([
      { level: 'Ground floor', room: 'Canteen', sensors: 0 },
      { level: 'Ground floor', room: 'Classroom 1', sensors: 3 },
      { level: 'First floor', room: 'Classroom 5', sensors: 1 },
    ]);
  });

  it('refuses two floors with the same level', async () => {
    await expect(
      insert(db, 'architecture.floors', { organisation_id: org, building_id: school, name: 'Another ground floor', level: 0 }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('records a measured temperature and its setpoint the same way', async () => {
    const t = await one<{ id: string }>(db, `select id from sensors where name = 'Temperature classroom 1'`);
    const sp = await one<{ id: string }>(db, `select id from sensors where name = 'Heating setpoint classroom 1'`);
    const measured = await one<{ id: string }>(
      db,
      `insert into series (object_id, quantity_code, sensor_id, kind, value_kind) values ($1, 'temperature', $2, 'measured', 'instant') returning id`,
      [classroom1, t.id],
    );
    const asked = await one<{ id: string }>(
      db,
      `insert into series (object_id, quantity_code, sensor_id, kind, value_kind) values ($1, 'temperature', $2, 'setpoint', 'instant') returning id`,
      [classroom1, sp.id],
    );
    await db.query(
      `insert into series_values (series_id, at, value) values
         ($1, '2026-01-10 08:00+00', 18.5), ($1, '2026-01-10 08:30+00', 19.5), ($2, '2026-01-10 08:00+00', 20)`,
      [measured.id, asked.id],
    );
    const r = await one<{ value: number }>(
      db,
      `select value from resample($1, '2026-01-10 08:00+00', '2026-01-10 09:00+00', '1 hour')`,
      [measured.id],
    );
    expect(r.value).toBe(19);
  });

  it('serves the building with a heat pump, linked to it', async () => {
    const hp = await insert(db, 'devices', {
      organisation_id: org, site_id: site, building_id: school, name: 'Air-to-water heat pump', device_type: 'heat_pump', rated_power_kw: 24,
    });
    await db.query(`insert into links (subject_id, type_code, object_id) values ($1, 'serves', $2)`, [hp, school]);
    const r = await one<{ name: string }>(
      db,
      `select d.name from links l join devices d on d.id = l.subject_id where l.type_code = 'serves' and l.object_id = $1`,
      [school],
    );
    expect(r.name).toBe('Air-to-water heat pump');
  });

  it('attaches an attribute to a room like to anything else', async () => {
    await db.query(`insert into attributes (object_id, property_code, value) values ($1, 'usage', '"classroom"')`, [classroom1]).catch((e) => e);
    // usage applies to buildings and sites; a room takes the module's own properties.
    const r = await one<{ n: number }>(db, 'select count(*)::int n from attributes where object_id = $1', [classroom1]);
    expect(r.n).toBe(0);
    await db.query(
      `insert into property_defs (code, name, datatype, applies_to, published_by) values ('acoustic_class', 'Acoustic class', 'text', '{space}', 'architecture')`,
    );
    await db.query(`insert into attributes (object_id, property_code, value) values ($1, 'acoustic_class', '"B"')`, [classroom1]);
    const p = await one<{ p: Record<string, string> }>(db, 'select attributes_of($1) p', [classroom1]);
    expect(p.p.acoustic_class).toBe('B');
  });

  it('removes the floors, rooms and sensors when the building goes', async () => {
    await db.query('delete from buildings where id = $1', [school]);
    const r = await one<{ floors: number; spaces: number; sensors: number; objects: number }>(
      db,
      `select (select count(*)::int from architecture.floors where building_id = $1) floors,
              (select count(*)::int from architecture.spaces) spaces,
              (select count(*)::int from sensors) sensors,
              (select count(*)::int from objects where kind in ('floor', 'space', 'sensor')) objects`,
      [school],
    );
    expect(r).toEqual({ floors: 0, spaces: 0, sensors: 0, objects: 0 });
  });
});

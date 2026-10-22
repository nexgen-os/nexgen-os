// A school, inside and out: two floors and their classrooms as one tree of
// spaces of the `building` module, a multisensor whose readings are series
// named after the room it measures, a heating setpoint asked of the heat
// pump, and everything findable from the participant whose school it is.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation, square, participant } from '../../../tests/helpers/db.js';

let db: PGlite;
let org: string;
let municipality: string;
let school: string;
let ground: string;
let first: string;
let classroom1: string;
let classroom5: string;
let probe: string;
let heatPump: string;

beforeAll(async () => {
  db = await freshDatabase(['building']);
  org = await organisation(db, 'A municipality');
  municipality = await participant(db, {
    organisation_id: org, name: 'École du Centre', country: 'BE', street: "Rue de l'École 12", postal_code: '1380', city: 'Valbrisée',
  });
  school = await insert(db, 'building.buildings', {
    organisation_id: org, participant_id: municipality, name: 'Main building', profile: 'school',
    footprint: square(4.4702, 50.6802, 40, 20), elevation_m: 112, height_m: 9.5,
  });
  ground = (await one<{ id: string }>(db, `select building.add_space($1, 'floor', 'Ground floor', null, 0, null, 112, 3.2) id`, [school])).id;
  first = (await one<{ id: string }>(db, `select building.add_space($1, 'floor', 'First floor', null, 1, null, 115.2, 3) id`, [school])).id;
  classroom1 = (await one<{ id: string }>(db, `select building.add_space($1, 'room', 'Classroom 1', $2) id`, [school, ground])).id;
  await db.query(`select building.add_space($1, 'room', 'Canteen', $2)`, [school, ground]);
  classroom5 = (await one<{ id: string }>(db, `select building.add_space($1, 'room', 'Classroom 5', $2) id`, [school, first])).id;
  probe = (await one<{ id: string }>(db, `select install_device($1, 'sensor_box', 'Multisensor classroom 1') id`, [municipality])).id;
  heatPump = (await one<{ id: string }>(db, `select install_device($1, 'heat_pump', 'Air-to-water heat pump', null, 24, '2023-10-02') id`, [municipality])).id;
  const thermometer = (await one<{ id: string }>(db, `select install_device($1, 'sensor', 'Thermometer classroom 5') id`, [municipality])).id;
  // A point is a series of the device that reads or is asked it, named after the room.
  for (const [quantity, kind, device, ref] of [
    ['temperature', 'measured', probe, 'mqtt://school/c1/temp'],
    ['co2', 'measured', probe, 'mqtt://school/c1/co2'],
    ['temperature', 'setpoint', heatPump, 'modbus://10.0.0.5/4001'],
  ]) {
    await db.query(`select series_ensure('device', $1, $2, $3, 'instant', null, $1, $4, null, 'Classroom 1')`, [device, quantity, kind, ref]);
  }
  await db.query(`select series_ensure('device', $1, 'temperature', 'measured', 'instant', null, $1, null, null, 'Classroom 5')`, [thermometer]);
});

afterAll(async () => {
  await db.close();
});

describe('a school, inside', () => {
  it('finds the participant, the country and the building from a room', async () => {
    const r = await one<{ participant: string; country: string; building: string }>(
      db,
      `select building.participant_of('space', $1) participant, country_of('participant', building.participant_of('space', $1)) country,
              building.building_of('space', $1) building`,
      [classroom5],
    );
    expect(r).toEqual({ participant: municipality, country: 'BE', building: school });
  });

  it('lists the rooms of the building with their points, floor by floor', async () => {
    const r = await db.query<{ floor: string; room: string; points: number }>(
      `select f.name floor, r.name room, count(se.id)::int points
         from building.spaces f
         join building.spaces r on r.parent_id = f.id
         left join series se on se.name = r.name
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

  it('knows the room a multisensor measures by its series, and the multisensor by its participant', async () => {
    const r = await one<{ rooms: string[]; participant: string }>(
      db, `select array_agg(distinct name) rooms, participant_of('device', $1) participant from series where device_id = $1`, [probe]);
    expect(r).toEqual({ rooms: ['Classroom 1'], participant: municipality });
  });

  it('refuses two floors at one level, a floor inside a room, a room of another building and a loop', async () => {
    await expect(db.query(`select building.add_space($1, 'floor', 'Another ground floor', null, 0)`, [school])).rejects.toThrow(/duplicate key/);
    await expect(db.query(`select building.add_space($1, 'floor', 'Mezzanine', $2, 2)`, [school, classroom1])).rejects.toThrow(/spaces_floor_at_top/);
    await expect(db.query(`select building.add_space($1, 'room', 'A room with a level', null, 3)`, [school])).rejects.toThrow(/spaces_level_for_floors/);
    const annex = await insert(db, 'building.buildings', { organisation_id: org, participant_id: municipality, name: 'Annex' });
    await expect(db.query(`select building.add_space($1, 'room', 'Store', $2)`, [annex, ground])).rejects.toThrow(/space_outside_building/);
    const zone = (await one<{ id: string }>(db, `select building.add_space($1, 'zone', 'North zone') id`, [school])).id;
    const wing = (await one<{ id: string }>(db, `select building.add_space($1, 'zone', 'North wing', $2) id`, [school, zone])).id;
    await expect(db.query('update building.spaces set parent_id = $1 where id = $2', [wing, zone])).rejects.toThrow(/space_cycle/);
  });

  it('records a measured temperature and its setpoint the same way, by their devices', async () => {
    const measured = await one<{ id: string }>(db, `select id from series where name = 'Classroom 1' and quantity_code = 'temperature' and kind = 'measured'`);
    const asked = await one<{ id: string; device: string }>(db, `select id, device_id device from series where name = 'Classroom 1' and kind = 'setpoint'`);
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

  it('says the floor area of a room in its column, and attaches nothing to a room', async () => {
    await db.query(`update building.spaces set floor_area_m2 = 62 where id = $1`, [classroom1]);
    expect((await one<{ a: string }>(db, 'select floor_area_m2::text a from building.spaces where id = $1', [classroom1])).a).toBe('62.00');
    await expect(db.query(`select set_attribute('space', $1, 'annual_consumption', '120')`, [classroom1])).rejects.toThrow(/kind_unknown: space/);
  });

  it('removes the floors and rooms when the building goes, and leaves the devices and their series to their participant', async () => {
    await db.query('delete from building.buildings where id = $1', [school]);
    const r = await one<{ spaces: number; series: number; devices: number }>(
      db,
      `select (select count(*)::int from building.spaces where building_id = $1) spaces,
              (select count(*)::int from series) series,
              (select count(*)::int from devices where participant_id = $2) devices`,
      [school, municipality],
    );
    expect(r).toEqual({ spaces: 0, series: 4, devices: 3 });
  });
});

// A logistics hall shared by three tenants: one building, three units, a
// shared roof array, one grid connection point per unit with a meter that is
// swapped, tenants as agents occupying their unit for a period, sensors in
// the rooms, and the units grouped in an energy community.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { entity, freshDatabase, one, workspace } from './helpers/db.js';

let db: PGlite;
let ws: string;
let hall: string;
const units: string[] = [];
const tenants: string[] = [];

beforeAll(async () => {
  db = await freshDatabase();
  ws = await workspace(db, 'A property company');
  hall = await entity(db, { workspace_id: ws, class: 'building', name: 'Hall', country: 'NL' });
  const storey = await entity(db, { workspace_id: ws, class: 'storey', name: 'Level 0', parent_id: hall });
  const community = await entity(db, { workspace_id: ws, class: 'energy_community', name: 'Hall community' });
  for (const n of [1, 2, 3]) {
    const unit = await entity(db, { workspace_id: ws, class: 'space', name: `Unit ${n}`, parent_id: storey });
    const tenant = await entity(db, { workspace_id: ws, class: 'organisation', name: `Tenant ${n}` });
    const cp = await entity(db, { workspace_id: ws, class: 'connection_point', name: `Connection ${n}`, parent_id: unit });
    await db.query(`insert into external_ids (entity_id, scheme, value) values ($1, 'gs1_gsrn', $2)`, [cp, `87100000000000000${n}`]);
    await db.query(
      `insert into relationships (subject_id, type_code, object_id, valid_from) values ($1, 'occupies', $2, '2025-01-01')`,
      [tenant, unit],
    );
    await db.query(`insert into relationships (subject_id, type_code, object_id) values ($1, 'member_of', $2)`, [unit, community]);
    units.push(unit);
    tenants.push(tenant);
  }
  const roofArray = await entity(db, { workspace_id: ws, class: 'pv_array', name: 'Shared roof array', parent_id: hall });
  await db.query(`insert into entity_values (entity_id, property_code, value) values ($1, 'peak_power', '250')`, [roofArray]);
});

afterAll(async () => {
  await db.close();
});

describe('a hall with three tenants', () => {
  it('holds everything under the building, at any depth', async () => {
    const r = await one<{ n: number }>(db, 'select count(*)::int n from entity_subtree($1)', [hall]);
    // hall, storey, 3 units, 3 connection points, the roof array
    expect(r.n).toBe(9);
  });

  it('keeps the connection point when the meter is swapped', async () => {
    const cp = await one<{ id: string }>(db, `select id from entities where name = 'Connection 1'`);
    const oldMeter = await entity(db, { workspace_id: ws, class: 'electricity_meter', name: 'Meter A', parent_id: cp.id });
    const newMeter = await entity(db, { workspace_id: ws, class: 'electricity_meter', name: 'Meter B', parent_id: cp.id });
    await db.query(
      `insert into relationships (subject_id, type_code, object_id, valid_to) values ($1, 'meters', $2, '2026-03-01')`,
      [oldMeter, cp.id],
    );
    await db.query(
      `insert into relationships (subject_id, type_code, object_id, valid_from) values ($1, 'meters', $2, '2026-03-01')`,
      [newMeter, cp.id],
    );
    const r = await one<{ name: string }>(
      db,
      `select e.name from relationships r join entities e on e.id = r.subject_id
        where r.object_id = $1 and r.type_code = 'meters'
          and (r.valid_from is null or r.valid_from <= '2026-06-01') and (r.valid_to is null or r.valid_to > '2026-06-01')`,
      [cp.id],
    );
    expect(r.name).toBe('Meter B');
  });

  it('refuses a relationship whose classes do not fit', async () => {
    await expect(
      db.query(`insert into relationships (subject_id, type_code, object_id) values ($1, 'occupies', $2)`, [units[0], units[1]]),
    ).rejects.toThrow(/relationship_subject_class/);
  });

  it('refuses a metering point number that is not one', async () => {
    await expect(
      db.query(`insert into external_ids (entity_id, scheme, value) values ($1, 'gs1_gsrn', '12AB')`, [units[0]]),
    ).rejects.toThrow(/invalid_identifier/);
  });

  it('lists the members of the community and who occupies them', async () => {
    const r = await db.query<{ unit: string; tenant: string }>(
      `select u.name unit, t.name tenant
         from relationships m
         join entities u on u.id = m.subject_id
         join relationships o on o.object_id = u.id and o.type_code = 'occupies'
         join entities t on t.id = o.subject_id
        where m.type_code = 'member_of'
        order by u.name`,
    );
    expect(r.rows).toEqual([
      { unit: 'Unit 1', tenant: 'Tenant 1' },
      { unit: 'Unit 2', tenant: 'Tenant 2' },
      { unit: 'Unit 3', tenant: 'Tenant 3' },
    ]);
  });

  it('attaches a room sensor and a writable setpoint the same way as any series', async () => {
    const sensor = await entity(db, { workspace_id: ws, class: 'sensor', name: 'Temperature unit 2', parent_id: units[1], tags: ['his'] });
    const setpoint = await entity(db, { workspace_id: ws, class: 'setpoint', name: 'Heating setpoint unit 2', parent_id: units[1], tags: ['writable'] });
    await db.query(`insert into relationships (subject_id, type_code, object_id) values ($1, 'monitors', $2)`, [sensor, units[1]]);
    const t = await one<{ id: string }>(
      db,
      `insert into datastreams (entity_id, quantity_code, sensor_id, kind, value_kind) values ($1, 'temperature', $2, 'measured', 'instant') returning id`,
      [units[1], sensor],
    );
    const sp = await one<{ id: string }>(
      db,
      `insert into datastreams (entity_id, quantity_code, sensor_id, kind, value_kind) values ($1, 'temperature', $2, 'setpoint', 'instant') returning id`,
      [units[1], setpoint],
    );
    await db.query(
      `insert into observations (datastream_id, at, value) values ($1, '2026-01-10 08:00+00', 18.5), ($1, '2026-01-10 08:30+00', 19.5), ($2, '2026-01-10 08:00+00', 20)`,
      [t.id, sp.id],
    );
    const r = await one<{ value: number }>(
      db,
      `select value from series($1, '2026-01-10 08:00+00', '2026-01-10 09:00+00', '1 hour')`,
      [t.id],
    );
    expect(r.value).toBe(19);
  });

  it('reads a cumulative register as its index per step', async () => {
    const meter = await one<{ id: string }>(db, `select id from entities where name = 'Meter B'`);
    const ds = await one<{ id: string }>(
      db,
      `insert into datastreams (entity_id, quantity_code, kind, value_kind) values ($1, 'energy_import', 'measured', 'cumulative') returning id`,
      [meter.id],
    );
    await db.query(
      `insert into observations (datastream_id, at, value) values ($1, '2026-04-01 00:00+00', 1000), ($1, '2026-04-01 12:00+00', 1012), ($1, '2026-04-02 00:00+00', 1030)`,
      [ds.id],
    );
    const r = await db.query<{ value: number }>(
      `select value from series($1, '2026-04-01', '2026-04-03', '1 day')`,
      [ds.id],
    );
    expect(r.rows.map((x) => x.value)).toEqual([1012, 1030]);
  });
});

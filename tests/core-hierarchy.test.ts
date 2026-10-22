// The hierarchy of the core, in the order a page walks it: an organisation,
// a project, a participant taking part in it with its place, a meter it
// carries, a device behind it; then two flats of one building, two
// participants each carrying its own meter, grouped, and a meter given to
// the participant that carries it next. No module is needed for any of it; the
// grid module, installed on a second database, adds the operator of the
// meter on top.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { detachedModuleTables } from '../packages/cli/src/doctor.js';
import { freshDatabase, insert, one, organisation, sqlClient } from './helpers/db.js';

let db: PGlite;
let org: string;
let project: string;
let unit: string;
let meter: string;
let device: string;

const place = (street: string) => JSON.stringify({ street, city: 'Rotterdam', country: 'NL' });

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative');
  project = await insert(db, 'projects', { organisation_id: org, name: 'Riverside community', kind: 'energy_community', country: 'NL', status: 'creation' });
  unit = (await one<{ id: string }>(
    db, `select join_project($1, 'Unit 1', $2, 'prosumer', null, '2026-01-01', p_time_zone => 'Europe/Amsterdam') id`, [project, place('Kade 1')])).id;
  meter = (await one<{ id: string }>(db, `select declare_meter($1, '871000000000000001', 'gs1_gsrn') id`, [unit])).id;
  device = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Roof array', null, 6, '2026-02-01') id`, [unit])).id;
});

afterAll(async () => {
  await db.close();
});

describe('the hierarchy of the core', () => {
  it('needs no module: projects, participants, meters and devices are the core\'s', async () => {
    const r = await one<{ modules: number }>(db, 'select count(*)::int modules from modules');
    expect(r).toEqual({ modules: 0 });
  });

  it('walks from the project to the meter and the device through the participant, which carries the place', async () => {
    const r = await one<{ project: string; participant: string; street: string; identifier: string; device: string }>(
      db,
      `select pr.name project, p.name participant, p.street, m.identifier, d.name device
         from projects pr
         join participants p on p.project_id = pr.id
         join meters m on m.participant_id = p.id
         join devices d on d.participant_id = p.id
        where pr.id = $1`,
      [project],
    );
    expect(r).toEqual({ project: 'Riverside community', participant: 'Unit 1', street: 'Kade 1', identifier: '871000000000000001', device: 'Roof array' });
  });

  it('has one path from a device to its meters and its place: its participant', async () => {
    const r = await one<{ participant: string; country: string; meters: string[] }>(
      db,
      `select participant_of('device', $1) participant, country_of('device', $1) country,
              (select array_agg(meter_id) from participant_meters(participant_of('device', $1))) meters`,
      [device],
    );
    expect(r).toEqual({ participant: unit, country: 'NL', meters: [meter] });
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'nexgen' and table_name = 'devices' and column_name in ('site_id', 'meter_id', 'geometry')`,
    );
    expect(columns.rows).toEqual([]);
  });

  it('refuses a device of a participant of another organisation', async () => {
    const theirs = await organisation(db, 'Another cooperative');
    await expect(insert(db, 'devices', { organisation_id: theirs, participant_id: unit, name: 'Battery', device_type: 'battery' }))
      .rejects.toThrow(/parent_in_other_organisation/);
  });
});

describe('two flats of one building', () => {
  const flats: { participant: string; meter: string; device: string }[] = [];

  beforeAll(async () => {
    for (const [n, gsrn] of [[1, '871000000000000011'], [2, '871000000000000012']] as const) {
      const participant = (await one<{ id: string }>(
        db, `select join_project($1, $2, $3, 'consumer', null, '2026-01-01') id`,
        [project, `Flat ${n}`, JSON.stringify({ street: 'Kade 2', address_extra: `Flat ${n}`, city: 'Rotterdam', country: 'NL' })])).id;
      const meter = (await one<{ id: string }>(db, `select declare_meter($1, $2, 'gs1_gsrn') id`, [participant, gsrn])).id;
      const device = (await one<{ id: string }>(db, `select install_device($1, 'heat_pump', $2, null, 4, '2026-01-15') id`, [participant, `Heat pump ${n}`])).id;
      flats.push({ participant, meter, device });
    }
  });

  it('are two participants, each carrying its own meter and the devices behind it', async () => {
    const r = await db.query<{ participant: string; identifier: string; device: string }>(
      `select p.name participant, m.identifier, d.name device
         from participants p
         join meters m on m.participant_id = p.id
         join devices d on d.participant_id = p.id
        where p.street = 'Kade 2'
        order by p.name`,
    );
    expect(r.rows).toEqual([
      { participant: 'Flat 1', identifier: '871000000000000011', device: 'Heat pump 1' },
      { participant: 'Flat 2', identifier: '871000000000000012', device: 'Heat pump 2' },
    ]);
    for (const f of flats) {
      const own = await db.query<{ meter_id: string }>('select meter_id from participant_meters($1)', [f.participant]);
      expect(own.rows.map((x) => x.meter_id)).toEqual([f.meter]);
    }
  });

  it('are grouped by a participant without a place, which finds both meters and carries none of its own', async () => {
    const group = (await one<{ id: string }>(db, `select join_project($1, 'Kade 2 owners') id`, [project])).id;
    expect((await one<{ place: unknown }>(db, 'select place_of($1) place', [group])).place).toBeNull();
    await db.query('update participants set parent_id = $1 where id = any ($2)', [group, flats.map((f) => f.participant)]);
    const r = await db.query<{ meter_id: string }>('select meter_id from participant_meters($1)', [group]);
    expect(r.rows.map((x) => x.meter_id).sort()).toEqual(flats.map((f) => f.meter).sort());
    await expect(db.query(`select assign_meter($1, $2)`, [flats[0].meter, group])).rejects.toThrow(/participant_group_carries/);
    await expect(db.query(`select declare_meter($1, '871000000000000013', 'gs1_gsrn')`, [group])).rejects.toThrow(/participant_group_carries/);
    await expect(db.query(`select install_device($1, 'battery', 'Shared battery')`, [group])).rejects.toThrow(/participant_group_carries/);
    await expect(db.query(`select join_project($1, 'Flat 3', $2, p_parent_id => $3)`, [project, place('Kade 2'), flats[0].participant]))
      .rejects.toThrow(/participant_parent_not_a_group/);
    await expect(db.query(`update participants set country = null, street = null, city = null where id = $1`, [flats[0].participant]))
      .rejects.toThrow(/participant_group_carries|participants_group_has_no_place/);
  });

  it('gives a meter to the participant that carries it next', async () => {
    const tenant = (await one<{ id: string }>(
      db, `select join_project($1, 'Flat 1, new tenant', $2, 'consumer', null, '2026-07-01') id`, [project, place('Kade 2')])).id;
    await db.query(`select leave_project($1, '2026-06-30')`, [flats[0].participant]);
    await db.query(`select assign_meter($1, $2)`, [flats[0].meter, tenant]);
    const today = await one<{ participant_id: string }>(db, 'select participant_id from meters where id = $1', [flats[0].meter]);
    expect(today.participant_id).toBe(tenant);
    await expect(db.query(`select assign_meter($1, $2)`, ['00000000-0000-4000-8000-0000000000ff', tenant])).rejects.toThrow(/meter_not_found/);
  });
});

describe('the grid module on top of a meter of the core', () => {
  let grid: PGlite;
  let gridMeter: string;

  beforeAll(async () => {
    grid = await freshDatabase(['grid']);
    const o = await organisation(grid, 'A cooperative');
    const pr = await insert(grid, 'projects', { organisation_id: o, name: 'Riverside', country: 'NL' });
    const p = (await one<{ id: string }>(grid, `select join_project($1, 'Unit 1', $2) id`, [pr, place('Kade 1')])).id;
    gridMeter = (await one<{ id: string }>(grid, `select declare_meter($1, '871000000000000001', 'gs1_gsrn') id`, [p])).id;
    await grid.query(`insert into grid.operators (code, name, kind, country, published_by) values ('dso_x', 'Operator X', 'dso', 'NL', 'installation')`);
  });

  afterAll(async () => {
    await grid.close();
  });

  it('says which operator runs the meter, with the meter\'s id and organisation', async () => {
    await grid.query(`select grid.connect_to_operator($1, 'dso_x', 'lv')`, [gridMeter]);
    await grid.query(`select grid.connect_to_operator($1, 'dso_x')`, [gridMeter]);
    const r = await one<{ grid_operator: string; voltage_level: string; same_org: boolean }>(
      grid,
      `select c.grid_operator, c.voltage_level, c.organisation_id = m.organisation_id same_org
         from grid.meters c join meters m on m.id = c.id where c.id = $1`,
      [gridMeter],
    );
    expect(r).toEqual({ grid_operator: 'dso_x', voltage_level: 'lv', same_org: true });
    await expect(grid.query(`select grid.connect_to_operator($1, 'nobody')`, [gridMeter])).rejects.toThrow(/grid_operator_unknown/);
  });

  it('goes with its meter', async () => {
    await grid.query('delete from meters where id = $1', [gridMeter]);
    const r = await one<{ n: number }>(grid, 'select count(*)::int n from grid.meters');
    expect(r.n).toBe(0);
  });
});

describe('every module', () => {
  it('starts from an object of the core: no table of a module schema is detached', async () => {
    const all = await freshDatabase(['building', 'billing', 'community', 'consumption', 'grid', 'planning', 'solar', 'weather']);
    try {
      const schemas = (await all.query<{ schema_name: string }>('select schema_name from modules')).rows.map((r) => r.schema_name);
      expect(schemas).toHaveLength(8);
      expect(await detachedModuleTables(sqlClient(all), schemas)).toEqual([]);
    } finally {
      await all.close();
    }
  });
});

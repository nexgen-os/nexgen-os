// The hierarchy of the core, in the order a page walks it: an organisation,
// a project, a participant taking part in it on a site, a meter it carries,
// a device installed behind it, and the meter it leaves kept as a dated
// link; then a building with two flats, one site with two participants each
// carrying its own meter. No module is needed for any of it; the grid
// module, installed on a second database, adds the operator of the meter on
// top.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { detachedModuleTables } from '../packages/cli/src/doctor.js';
import { freshDatabase, insert, one, organisation, sqlClient } from './helpers/db.js';

let db: PGlite;
let org: string;
let project: string;
let site: string;
let participant: string;
let meter: string;
let device: string;

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative');
  project = await insert(db, 'projects', { organisation_id: org, name: 'Riverside community', kind: 'energy_community', country: 'NL', status: 'creation' });
  site = await insert(db, 'sites', { organisation_id: org, name: 'Unit 1', country: 'NL', time_zone: 'Europe/Amsterdam' });
  participant = (await one<{ id: string }>(db, `select join_project($1, $2, 'Unit 1', 'prosumer', null, '2026-01-01') id`, [project, site])).id;
  meter = (await one<{ id: string }>(
    db, `select declare_meter($1, '871000000000000001', 'gs1_gsrn', p_participant_id => $2) id`, [site, participant])).id;
  device = (await one<{ id: string }>(
    db, `select install_device($1, 'solar', 'Roof array', '{}', null, 6, '2026-02-01', p_meter_id => $2) id`, [site, meter])).id;
});

afterAll(async () => {
  await db.close();
});

describe('the hierarchy of the core', () => {
  it('needs no module: projects, participants and meters are the core\'s', async () => {
    const r = await one<{ modules: number; kinds: string[] }>(
      db,
      `select (select count(*)::int from modules) modules,
              (select array_agg(kind order by kind) from object_kinds where published_by = 'core' and kind in ('project', 'participant', 'meter')) kinds`,
    );
    expect(r).toEqual({ modules: 0, kinds: ['meter', 'participant', 'project'] });
  });

  it('walks from the project to the device through the participant, its site and its meter', async () => {
    const r = await one<{ project: string; participant: string; identifier: string; device: string }>(
      db,
      `select pr.name project, p.name participant, m.identifier, d.name device
         from projects pr
         join participants p on p.project_id = pr.id
         join meters m on m.participant_id = p.id
         join devices d on d.meter_id = m.id
        where pr.id = $1`,
      [project],
    );
    expect(r).toEqual({ project: 'Riverside community', participant: 'Unit 1', identifier: '871000000000000001', device: 'Roof array' });
  });

  it('lists the meters a participant carries without the grid module', async () => {
    const r = await db.query<{ meter_id: string }>('select meter_id from participant_meters($1)', [participant]);
    expect(r.rows.map((x) => x.meter_id)).toEqual([meter]);
  });

  it('keeps the meter a device leaves as a dated behind_meter link', async () => {
    const second = (await one<{ id: string }>(db, `select declare_meter($1, '871000000000000002', 'gs1_gsrn', 'electricity', 'injection') id`, [site])).id;
    await db.query(`select connect_device($1, $2, '2026-06-01')`, [device, second]);
    const today = await one<{ meter_id: string }>(db, 'select meter_id from devices where id = $1', [device]);
    expect(today.meter_id).toBe(second);
    const history = await db.query<{ object_id: string; valid_from: string; valid_to: string }>(
      `select object_id, valid_from::date::text valid_from, valid_to::date::text valid_to
         from links where subject_id = $1 and type_code = 'behind_meter'`,
      [device],
    );
    expect(history.rows).toEqual([{ object_id: meter, valid_from: '2026-02-01', valid_to: '2026-06-01' }]);
    // Back to the first meter: the second stint starts where the first ended.
    await db.query(`select connect_device($1, $2, '2026-09-01')`, [device, meter]);
    const back = await db.query<{ object_id: string; valid_from: string; valid_to: string }>(
      `select object_id, valid_from::date::text valid_from, valid_to::date::text valid_to
         from links where subject_id = $1 and type_code = 'behind_meter' order by valid_to`,
      [device],
    );
    expect(back.rows).toEqual([
      { object_id: meter, valid_from: '2026-02-01', valid_to: '2026-06-01' },
      { object_id: second, valid_from: '2026-06-01', valid_to: '2026-09-01' },
    ]);
  });

  it('refuses a device behind a meter of another site', async () => {
    const other = await insert(db, 'sites', { organisation_id: org, name: 'Unit 2', country: 'NL' });
    const elsewhere = (await one<{ id: string }>(db, `select declare_meter($1, '871000000000000003', 'gs1_gsrn') id`, [other])).id;
    await expect(db.query(`select connect_device($1, $2)`, [device, elsewhere])).rejects.toThrow(/device_meter_site_mismatch/);
    await expect(db.query(`select install_device($1, 'battery', 'Battery', p_meter_id => $2)`, [site, elsewhere]))
      .rejects.toThrow(/device_meter_site_mismatch/);
  });
});

describe('a building with two flats', () => {
  let block: string;
  const flats: { participant: string; meter: string; device: string }[] = [];

  beforeAll(async () => {
    block = await insert(db, 'sites', { organisation_id: org, name: 'Canal block', country: 'NL', time_zone: 'Europe/Amsterdam' });
    for (const [n, gsrn] of [[1, '871000000000000011'], [2, '871000000000000012']] as const) {
      const participant = (await one<{ id: string }>(
        db, `select join_project($1, $2, $3, 'consumer', null, '2026-01-01') id`, [project, block, `Flat ${n}`])).id;
      const meter = (await one<{ id: string }>(
        db, `select declare_meter($1, $2, 'gs1_gsrn', p_participant_id => $3) id`, [block, gsrn, participant])).id;
      const device = (await one<{ id: string }>(
        db, `select install_device($1, 'heat_pump', $2, '{}', null, 4, '2026-01-15', p_meter_id => $3) id`, [block, `Heat pump ${n}`, meter])).id;
      flats.push({ participant, meter, device });
    }
  });

  it('is one site with two participants, each carrying its own meter and the devices behind it', async () => {
    const r = await db.query<{ participant: string; identifier: string; device: string }>(
      `select p.name participant, m.identifier, d.name device
         from participants p
         join meters m on m.participant_id = p.id
         join devices d on d.meter_id = m.id
        where p.site_id = $1
        order by p.name`,
      [block],
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

  it('groups the two flats, and finds both meters behind the group', async () => {
    const group = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'Canal block owners' });
    await db.query('update participants set parent_id = $1 where id = any ($2)', [group, flats.map((f) => f.participant)]);
    const r = await db.query<{ meter_id: string }>('select meter_id from participant_meters($1)', [group]);
    expect(r.rows.map((x) => x.meter_id).sort()).toEqual(flats.map((f) => f.meter).sort());
    // A group has no site, so it carries no meter of its own.
    await expect(db.query(`select assign_meter($1, $2)`, [flats[0].meter, group])).rejects.toThrow(/meter_participant_site_mismatch/);
  });

  it('keeps the participant a meter leaves as a dated carried_by link', async () => {
    const tenant = (await one<{ id: string }>(
      db, `select join_project($1, $2, 'Flat 1, new tenant', 'consumer', null, '2026-07-01') id`, [project, block])).id;
    await db.query(`select leave_project($1, '2026-06-30')`, [flats[0].participant]);
    await db.query(`select assign_meter($1, $2, '2026-07-01')`, [flats[0].meter, tenant]);
    const today = await one<{ participant_id: string }>(db, 'select participant_id from meters where id = $1', [flats[0].meter]);
    expect(today.participant_id).toBe(tenant);
    const history = await db.query<{ object_id: string; valid_from: string; valid_to: string }>(
      `select object_id, valid_from::date::text valid_from, valid_to::date::text valid_to
         from links where subject_id = $1 and type_code = 'carried_by'`,
      [flats[0].meter],
    );
    expect(history.rows).toEqual([{ object_id: flats[0].participant, valid_from: '2026-01-01', valid_to: '2026-07-01' }]);
  });

  it('refuses a meter carried by a participant of another site', async () => {
    await expect(db.query(`select assign_meter($1, $2)`, [flats[1].meter, participant])).rejects.toThrow(/meter_participant_site_mismatch/);
    await expect(db.query(`select declare_meter($1, '871000000000000013', 'gs1_gsrn', p_participant_id => $2)`, [site, flats[1].participant]))
      .rejects.toThrow(/meter_participant_site_mismatch/);
  });
});

describe('the grid module on top of a meter of the core', () => {
  let grid: PGlite;
  let gridMeter: string;

  beforeAll(async () => {
    grid = await freshDatabase(['grid']);
    const o = await organisation(grid, 'A cooperative');
    const s = await insert(grid, 'sites', { organisation_id: o, name: 'Unit 1', country: 'NL' });
    gridMeter = (await one<{ id: string }>(grid, `select declare_meter($1, '871000000000000001', 'gs1_gsrn') id`, [s])).id;
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
    const all = await freshDatabase(['3d', 'billing', 'community', 'consumption', 'grid', 'solar', 'tasks', 'weather']);
    try {
      const schemas = (await all.query<{ schema_name: string }>('select schema_name from modules')).rows.map((r) => r.schema_name);
      expect(schemas).toHaveLength(8);
      expect(await detachedModuleTables(sqlClient(all), schemas)).toEqual([]);
    } finally {
      await all.close();
    }
  });
});

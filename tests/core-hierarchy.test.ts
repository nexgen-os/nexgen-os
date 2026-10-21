// The hierarchy of the core, in the order a page walks it: an organisation,
// a project, a site taking part in it as a participant, a meter declared on
// the site, a device installed behind it, and the meter it leaves kept as a
// dated link. No module is needed for any of it; the grid module, installed
// on a second database, adds the operator of the meter on top.
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
  meter = (await one<{ id: string }>(db, `select declare_meter($1, '871000000000000001', 'gs1_gsrn') id`, [site])).id;
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
         join meters m on m.site_id = p.site_id
         join devices d on d.meter_id = m.id
        where pr.id = $1`,
      [project],
    );
    expect(r).toEqual({ project: 'Riverside community', participant: 'Unit 1', identifier: '871000000000000001', device: 'Roof array' });
  });

  it('lists the meters a participant is behind without the grid module', async () => {
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
    const all = await freshDatabase(['accounting', 'community', 'consumption', 'grid', 'solar', 'tasks', 'weather']);
    try {
      const schemas = (await all.query<{ schema_name: string }>('select schema_name from modules')).rows.map((r) => r.schema_name);
      expect(schemas).toHaveLength(7);
      expect(await detachedModuleTables(sqlClient(all), schemas)).toEqual([]);
    } finally {
      await all.close();
    }
  });
});

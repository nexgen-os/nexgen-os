// What each person may see and do, and what never changes once written.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, entity, freshDatabase, one, workspace } from './helpers/db.js';

const VIEWER = '00000000-0000-4000-8000-0000000000c1';

let db: PGlite;
let wsA: string;
let wsB: string;
let buildingA: string;

beforeAll(async () => {
  db = await freshDatabase();
  wsA = await workspace(db, 'Firm A', USER_A);
  wsB = await workspace(db, 'Firm B', USER_B);
  await db.query('insert into auth.users (id) values ($1)', [VIEWER]);
  await db.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')`, [wsA, VIEWER]);
  buildingA = await entity(db, { workspace_id: wsA, class: 'building', name: 'Building A', country: 'FR' });
  await entity(db, { workspace_id: wsB, class: 'building', name: 'Building B', country: 'DE' });
  await db.query(
    `insert into modules (code, name, version, schema_name, requires_core_min) values ('pv', 'PV production', '0.1.0', 'pv', '0.1.0')`,
  );
});

afterAll(async () => {
  await db.close();
});

describe('row level security', () => {
  it('shows each member the entities of their workspace only', async () => {
    const a = await asUser(db, USER_A, () => db.query<{ name: string }>('select name from entities'));
    const b = await asUser(db, USER_B, () => db.query<{ name: string }>('select name from entities'));
    expect(a.rows.map((r) => r.name)).toEqual(['Building A']);
    expect(b.rows.map((r) => r.name)).toEqual(['Building B']);
  });

  it('refuses a write in another workspace', async () => {
    await expect(
      asUser(db, USER_B, () =>
        db.query(`insert into entities (workspace_id, class, name, country) values ($1, 'building', 'Intruder', 'FR')`, [wsA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('lets a viewer read and nothing else', async () => {
    const r = await asUser(db, VIEWER, () => db.query('select id from entities'));
    expect(r.rows).toHaveLength(1);
    await expect(
      asUser(db, VIEWER, () =>
        db.query(`insert into entity_values (entity_id, property_code, value) values ($1, 'year_of_construction', '1975')`, [buildingA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('lets a member create a workspace and become its owner', async () => {
    const r = await asUser(db, USER_B, async () => {
      await db.query(`insert into workspaces (name) values ('Firm B — second office')`);
      return db.query<{ name: string }>('select name from workspaces order by name');
    });
    expect(r.rows.map((x) => x.name)).toEqual(['Firm B', 'Firm B — second office']);
  });

  it('lets everyone signed in read the vocabularies', async () => {
    const r = await asUser(db, USER_B, () => one<{ n: number }>(db, 'select count(*)::int n from classes'));
    expect(r.n).toBeGreaterThan(40);
  });
});

describe('computation runs', () => {
  it('returns the same run for the same inputs and engine version', async () => {
    const inputs = { horizon: '2027', weather: 'tmy' };
    const first = await asUser(db, USER_A, () =>
      one<{ id: string }>(db, `select record_run('pv', '0.1.0', $1, null, $2, '{"kwh": 5400}') id`, [buildingA, inputs]),
    );
    const again = await asUser(db, USER_A, () =>
      one<{ id: string }>(db, `select record_run('pv', '0.1.0', $1, null, $2, '{"kwh": 5400}') id`, [
        buildingA,
        { weather: 'tmy', horizon: '2027' },
      ]),
    );
    const newer = await asUser(db, USER_A, () =>
      one<{ id: string }>(db, `select record_run('pv', '0.2.0', $1, null, $2, '{"kwh": 5410}') id`, [buildingA, inputs]),
    );
    expect(again.id).toBe(first.id);
    expect(newer.id).not.toBe(first.id);
  });

  it('never changes a finished run', async () => {
    await expect(db.query(`update runs set results = '{"kwh": 1}'`)).rejects.toThrow(/run_is_final/);
  });
});

describe('the vocabularies', () => {
  it('root every class in one of the six roots', async () => {
    const r = await db.query<{ code: string }>(
      `select code from classes c
        where not (class_is_a(code, 'location') or class_is_a(code, 'element') or class_is_a(code, 'equipment')
                or class_is_a(code, 'point') or class_is_a(code, 'agent') or class_is_a(code, 'collection'))`,
    );
    expect(r.rows).toEqual([]);
  });

  it('name no country in what the core publishes', async () => {
    const r = await db.query(
      `select code from id_schemes where code ~ '_(be|fr|nl|es|de|lu|sn)$'
       union all select code from classes where code ~ '_(be|fr|nl|es|de|lu|sn)$'`,
    );
    expect(r.rows).toEqual([]);
  });
});

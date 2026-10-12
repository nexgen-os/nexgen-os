// What each person may see and do, what never changes once written, and
// what the core publishes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';

const VIEWER = '00000000-0000-4000-8000-0000000000c1';

let db: PGlite;
let orgA: string;
let orgB: string;
let siteA: string;

beforeAll(async () => {
  db = await freshDatabase();
  orgA = await organisation(db, 'Firm A', USER_A);
  orgB = await organisation(db, 'Firm B', USER_B);
  await db.query('insert into auth.users (id) values ($1)', [VIEWER]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'viewer')`, [orgA, VIEWER]);
  siteA = await insert(db, 'sites', { organisation_id: orgA, name: 'Site A', country: 'FR' });
  await insert(db, 'sites', { organisation_id: orgB, name: 'Site B', country: 'DE' });
  await db.query(
    `insert into modules (code, name, version, schema_name, requires_core_min) values ('pv', 'PV production', '0.1.0', 'pv', '0.1.0')`,
  );
});

afterAll(async () => {
  await db.close();
});

describe('row level security', () => {
  it('shows each member the sites of their organisation only', async () => {
    const a = await asUser(db, USER_A, () => db.query<{ name: string }>('select name from sites'));
    const b = await asUser(db, USER_B, () => db.query<{ name: string }>('select name from sites'));
    expect(a.rows.map((r) => r.name)).toEqual(['Site A']);
    expect(b.rows.map((r) => r.name)).toEqual(['Site B']);
  });

  it('refuses a write in another organisation', async () => {
    await expect(
      asUser(db, USER_B, () =>
        db.query(`insert into sites (organisation_id, name, country) values ($1, 'Intruder', 'FR')`, [orgA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('refuses a building on a site of another organisation', async () => {
    await expect(
      insert(db, 'buildings', { organisation_id: orgB, site_id: siteA, name: 'Cross-border' }),
    ).rejects.toThrow(/parent_in_other_organisation/);
  });

  it('lets a viewer read and nothing else', async () => {
    const r = await asUser(db, VIEWER, () => db.query('select id from sites'));
    expect(r.rows).toHaveLength(1);
    await expect(
      asUser(db, VIEWER, () =>
        db.query(`insert into attributes (object_id, property_code, value) values ($1, 'annual_consumption', '12000')`, [siteA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('lets a member create an organisation and become its owner', async () => {
    const r = await asUser(db, USER_B, async () => {
      await db.query(`insert into organisations (name) values ('Firm B — second office')`);
      return db.query<{ name: string }>('select name from organisations order by name');
    });
    expect(r.rows.map((x) => x.name)).toEqual(['Firm B', 'Firm B — second office']);
  });

  it('lets everyone signed in read the vocabularies and the shared catalogue', async () => {
    await db.query(
      `insert into device_directory (device_type, manufacturer, model_ref, unit_power_kw, published_by) values ('solar', 'Acme', 'Sun 425', 0.425, 'energy')`,
    );
    const r = await asUser(db, USER_B, () =>
      one<{ types: number; products: number }>(db, 'select (select count(*)::int from device_types) types, (select count(*)::int from device_directory) products'),
    );
    expect(r.types).toBeGreaterThan(10);
    expect(r.products).toBe(1);
  });
});

describe('computation runs', () => {
  it('returns the same run for the same inputs and engine version', async () => {
    const inputs = { horizon: '2027', weather: 'tmy' };
    const first = await asUser(db, USER_A, () =>
      one<{ id: string }>(db, `select record_run('pv', '0.1.0', $1, null, $2, '{"kwh": 5400}') id`, [siteA, inputs]),
    );
    const again = await asUser(db, USER_A, () =>
      one<{ id: string }>(db, `select record_run('pv', '0.1.0', $1, null, $2, '{"kwh": 5400}') id`, [
        siteA,
        { weather: 'tmy', horizon: '2027' },
      ]),
    );
    const newer = await asUser(db, USER_A, () =>
      one<{ id: string }>(db, `select record_run('pv', '0.2.0', $1, null, $2, '{"kwh": 5410}') id`, [siteA, inputs]),
    );
    expect(again.id).toBe(first.id);
    expect(newer.id).not.toBe(first.id);
  });

  it('never changes a finished run', async () => {
    await expect(db.query(`update runs set results = '{"kwh": 1}'`)).rejects.toThrow(/run_is_final/);
  });
});

describe('what the core publishes', () => {
  it('names a module for every device type', async () => {
    const r = await db.query<{ code: string }>(`select code from device_types where module_code is null`);
    expect(r.rows).toEqual([]);
  });

  it('names no country in what the core publishes', async () => {
    const r = await db.query(
      `select code from id_schemes where code ~ '_(be|fr|nl|es|de|lu|sn)$'
       union all select code from device_types where code ~ '_(be|fr|nl|es|de|lu|sn)$'
       union all select code from profiles where code ~ '_(be|fr|nl|es|de|lu|sn)$'`,
    );
    expect(r.rows).toEqual([]);
  });

  it('keeps the registry and the named tables in step', async () => {
    const r = await one<{ registered: number; named: number }>(
      db,
      `select (select count(*)::int from objects) registered,
              (select count(*) from projects) + (select count(*) from sites) + (select count(*) from buildings)
              + (select count(*) from surfaces) + (select count(*) from participants) + (select count(*) from meters)
              + (select count(*) from devices) + (select count(*) from sensors) as named`,
    );
    expect(Number(r.named)).toBe(r.registered);
  });
});

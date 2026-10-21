// What each person may see and do, what never changes once written, and
// what the core publishes.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, repoRoot } from './helpers/db.js';

const VIEWER = '00000000-0000-4000-8000-0000000000c1';

let db: PGlite;
let orgA: string;
let orgB: string;
let siteA: string;

beforeAll(async () => {
  db = await freshDatabase(['building']);
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
      insert(db, 'building.buildings', { organisation_id: orgB, site_id: siteA, name: 'Cross-border' }),
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

  it('never changes the series a finished run computed', async () => {
    const run = await asUser(db, USER_A, () =>
      one<{ id: string }>(db, `select record_run('pv', '0.3.0', $1, null, '{"horizon": "2028"}', '{"kwh": 5420}', $2) id`, [
        siteA,
        JSON.stringify([{ key: 'production', object_id: siteA, quantity_code: 'production_energy', step: '1 hour', at: ['2028-06-01T10:00:00Z', '2028-06-01T11:00:00Z'], value: [1.5, 1.7] }]),
      ]),
    );
    const owned = await one<{ id: string; results: { kwh: number; series: Record<string, string> } }>(
      db, `select s.id, r.results from runs r join series s on s.run_id = r.id where r.id = $1`, [run.id]);
    expect(owned.results).toEqual({ kwh: 5420, series: { production: owned.id } });
    await expect(asUser(db, USER_A, () => db.query(`update series_values set value = 0 where series_id = $1`, [owned.id]))).rejects.toThrow(/permission denied/);
    await expect(db.query(`select store($1, array['2028-06-01T12:00:00Z']::timestamptz[], array[1.0]::float8[])`, [owned.id])).rejects.toThrow(/run_is_final/);
    await expect(db.query(`delete from series_values where series_id = $1`, [owned.id])).rejects.toThrow(/run_is_final/);
  });
});

describe('organisations', () => {
  it('never lose their last owner', async () => {
    await expect(asUser(db, USER_A, () => db.query(`select remove_member($1, $2)`, [orgA, USER_A]))).rejects.toThrow(/last_owner/);
    await expect(asUser(db, USER_A, () => db.query(`select set_member_role($1, $2, 'editor')`, [orgA, USER_A]))).rejects.toThrow(/last_owner/);
    await asUser(db, USER_A, () => db.query(`select set_member_role($1, $2, 'editor')`, [orgA, VIEWER]));
    await asUser(db, USER_A, () => db.query(`select set_member_role($1, $2, 'viewer')`, [orgA, VIEWER]));
  });

  it('are objects: an attribute attaches to one, readable by its members only', async () => {
    await expect(db.query(`insert into attributes (object_id, property_code, value, source) values ($1, 'roof_area', '120', 'a guess')`, [orgA]))
      .rejects.toThrow(/property_not_applicable/);
    await db.query(`insert into property_defs (code, name, datatype, published_by) values ('discount_rate', 'Discount rate', 'number', 'installation')`);
    await asUser(db, USER_A, () => db.query(`select set_attribute($1, 'discount_rate', '0.04', null, null, 'board decision')`, [orgA]));
    const mine = await asUser(db, USER_A, () => db.query(`select value from attributes where object_id = $1`, [orgA]));
    const theirs = await asUser(db, USER_B, () => db.query(`select value from attributes where object_id = $1`, [orgA]));
    expect(mine.rows).toEqual([{ value: 0.04 }]);
    expect(theirs.rows).toEqual([]);
  });

  it('read the pack\'s defaults and write none of them: their own are their attributes', async () => {
    await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by) values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz')`);
    await db.query(`insert into sources (code, name, kind) values ('zz_statistics', 'Testland statistics', 'text')`);
    await db.query(`insert into defaults (property_code, country, value, source_code, reference, published_by) values ('discount_rate', 'ZZ', '0.05', 'zz_statistics', 'table 1', 'pack:zz')`);
    const a = await asUser(db, USER_A, () => db.query<{ value: number }>(`select value from defaults`));
    const b = await asUser(db, USER_B, () => db.query<{ value: number }>(`select value from defaults`));
    expect(a.rows.map((r) => r.value)).toEqual([0.05]);
    expect(b.rows.map((r) => r.value)).toEqual([0.05]);
    await expect(asUser(db, USER_A, () => db.query(`insert into defaults (property_code, country, value, source_code, valid_from, published_by) values ('discount_rate', 'ZZ', '0.03', 'zz_statistics', '2030-01-01', 'firm a')`)))
      .rejects.toThrow(/permission denied/);
    await expect(asUser(db, USER_B, () => db.query(`update defaults set reference = 'edited' where country = 'ZZ'`))).rejects.toThrow(/permission denied/);
  });
});

describe('what the core publishes', () => {
  it('names no module that does not ship in a device type', async () => {
    const shipped = (await readdir(join(repoRoot, 'modules'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    const r = await db.query<{ code: string; module_code: string }>(`select code, module_code from device_types where module_code is not null`);
    expect(r.rows.filter((t) => !shipped.includes(t.module_code))).toEqual([]);
  });

  it('has row level security on every table of the schema', async () => {
    const r = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'nexgen' and c.relkind in ('r', 'p') and not c.relrowsecurity and not c.relispartition`,
    );
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
              (select count(*) from organisations) + (select count(*) from sites) + (select count(*) from building.buildings)
              + (select count(*) from building.spaces) + (select count(*) from building.surfaces) + (select count(*) from devices) as named`,
    );
    expect(Number(r.named)).toBe(r.registered);
  });
});

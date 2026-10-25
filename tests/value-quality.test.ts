// One word for the kind of a value, `quality` (decision 0057): the domain
// that holds its words, the code a simulated series stores when nobody says
// one, the presets `role_capabilities` resolves, and the way an installation
// of 0.3.0 is brought to it.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { install, migrate } from '../packages/cli/src/index.js';
import { USER_A, emptyDatabase, freshDatabase, insert, one, organisation, participant, repoRoot, sqlClient } from './helpers/db.js';

let db: PGlite;
let org: string;
let site: string;
const temp: string[] = [];

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative', USER_A);
  site = await participant(db, { organisation_id: org, name: 'Depot', country: 'ZZ', time_zone: 'UTC' });
});

afterAll(async () => {
  await db.close();
  for (const dir of temp) await rm(dir, { recursive: true, force: true });
});

const domainWords = async (on: PGlite): Promise<string[]> => {
  const r = await one<{ check: string }>(on, `select pg_get_constraintdef(c.oid) "check" from pg_constraint c
    join pg_type t on t.oid = c.contypid join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'nexgen' and t.typname = 'value_quality'`);
  return [...r.check.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
};

describe('the quality of a value', () => {
  it('is one domain of four words, which every column holding one carries', async () => {
    expect(await domainWords(db)).toEqual(['published', 'measured', 'estimated', 'assumed']);
    const columns = await db.query<{ c: string }>(
      `select table_name || '.' || column_name c from information_schema.columns
        where domain_schema = 'nexgen' and domain_name = 'value_quality' order by 1`);
    expect(columns.rows.map((r) => r.c)).toEqual(['attributes.quality', 'defaults.quality']);
    expect((await one<{ t: string | null }>(db, `select to_regclass('nexgen.value_statuses')::text t`)).t).toBeNull();
  });

  it('is the list a pack may write, word for word', async () => {
    const schema = JSON.parse(await readFile(join(repoRoot, 'packs/schema/pack.1.json'), 'utf8'));
    const value = schema.$defs.default.properties;
    expect(value).not.toHaveProperty('status');
    expect(value.quality.enum).toEqual(await domainWords(db));
  });
});

describe('the quality store() writes', () => {
  const series = (kind: string) => ({
    object_kind: 'participant', object_id: site, quantity_code: 'offtake_energy', kind,
    value_kind: 'interval', step: '1 hour', source: `a test of ${kind}`,
  });
  const write = async (kind: string, quality: number[] | null) =>
    (await one<{ series_id: string }>(db,
      `select series_id from store(null, array['2026-06-01 00:00+00', '2026-06-01 01:00+00']::timestamptz[], array[1, 2]::float8[], $1::smallint[], null, null, $2::jsonb)`,
      [quality, JSON.stringify(series(kind))])).series_id;
  const qualities = async (id: string) =>
    (await db.query<{ quality: number }>('select quality from series_values where series_id = $1 order by at', [id])).rows.map((r) => r.quality);

  it('is measured (0) for a value delivered without one, estimated (1) for a value a computation simulated', async () => {
    expect(await qualities(await write('measured', null))).toEqual([0, 0]);
    expect(await qualities(await write('simulated', null))).toEqual([1, 1]);
  });

  it('is the one given when the writer says it, whatever the series', async () => {
    const id = await write('simulated', [0, 2]);
    expect(await qualities(id)).toEqual([0, 2]);
  });
});

describe('the presets of role_capabilities', () => {
  it('are owner, editor, viewer and participant, and no other word', async () => {
    const roles = await db.query<{ role: string }>('select distinct role from role_capabilities order by role');
    expect(roles.rows.map((r) => r.role)).toEqual(['editor', 'owner', 'participant', 'viewer']);
    await expect(db.query(`insert into role_capabilities (role, capability) values ('auditor', 'data.read')`)).rejects.toThrow(/role_capabilities_role/);
  });
});

describe('an installation of 0.3.0', () => {
  it('is brought to quality by migrate: every word kept, default read as assumed, the solar loss chain converted', async () => {
    // The files as release 0.3.0 shipped them: the core without the
    // migrations of 0.4.0, the solar module with its foreign key.
    const old = await mkdtemp(join(tmpdir(), 'nexgen-0.3.0-'));
    temp.push(old);
    await cp(join(repoRoot, 'supabase'), join(old, 'supabase'), { recursive: true });
    await cp(join(repoRoot, 'modules/solar'), join(old, 'modules/solar'), { recursive: true });
    await rm(join(old, 'supabase/migrations/20261025000000_core_value_quality.sql'));
    await rm(join(old, 'modules/solar/supabase/migrations/0004_estimate_losses_quality.sql'));
    const solar = join(old, 'modules/solar/supabase/migrations/0001_solar.sql');
    await writeFile(solar, (await readFile(solar, 'utf8')).replace(
      'status           value_quality not null,', 'status           text not null references value_statuses(code),'));

    const before = await emptyDatabase();
    try {
      await install(sqlClient(before), { root: old, modules: ['solar'], packs: [] });
      await before.exec('set search_path = nexgen, extensions, public');
      const o = await organisation(before, 'A cooperative', USER_A);
      const p = await participant(before, { organisation_id: o, name: 'Farm', country: 'ZZ' });
      await insert(before, 'attributes', { organisation_id: o, object_kind: 'participant', object_id: p, attribute_type: 'annual_consumption', value: 4000, valid_to: '2026-01-01', status: 'default' });
      await insert(before, 'attributes', { organisation_id: o, object_kind: 'participant', object_id: p, attribute_type: 'annual_consumption', value: 4350, valid_from: '2026-01-01', status: 'measured' });
      await before.query(`insert into sources (code, name, kind, published_by) values ('zz_statistics', 'Statistics', 'text', 'solar')`);
      await before.query(`insert into defaults (attribute_type, country, value, valid_from, source_code, status, published_by)
                            values ('energy_price_household', null, '180', '2020-01-01', 'zz_statistics', 'default', 'solar')`);

      const r = await migrate(sqlClient(before), { root: repoRoot });
      expect(r.applied.map((s) => s.name)).toEqual(expect.arrayContaining([
        'supabase/migrations/20261025000000_core_value_quality.sql',
        'modules/solar/supabase/migrations/0004_estimate_losses_quality.sql',
      ]));
      const kept = await before.query<{ quality: string }>('select quality from attributes where object_id = $1 order by valid_from nulls first', [p]);
      expect(kept.rows.map((x) => x.quality)).toEqual(['assumed', 'measured']);
      expect((await one<{ quality: string }>(before, `select quality from defaults where attribute_type = 'energy_price_household'`)).quality).toBe('assumed');
      const losses = await one<{ domain_name: string }>(before,
        `select domain_name from information_schema.columns where table_schema = 'solar' and table_name = 'estimate_losses' and column_name = 'quality'`);
      expect(losses.domain_name).toBe('value_quality');
      expect((await one<{ t: string | null }>(before, `select to_regclass('nexgen.value_statuses')::text t`)).t).toBeNull();
    } finally {
      await before.close();
    }
  });
});

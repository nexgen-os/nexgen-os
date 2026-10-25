// One word for the kind of a value, `quality` (decision 0057): the domain
// that holds its words, the code a simulated series stores when nobody says
// one, and the presets `role_capabilities` resolves. The upgrade of an
// installation of 0.3.0: tests/from-0.3.test.ts.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, freshDatabase, one, organisation, participant, repoRoot } from './helpers/db.js';

let db: PGlite;
let org: string;
let site: string;

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative', USER_A);
  site = await participant(db, { organisation_id: org, name: 'Depot', country: 'ZZ', time_zone: 'UTC' });
});

afterAll(async () => {
  await db.close();
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

// An installation on a new Supabase project, as far as a database in memory can be one: the
// schemas the project already holds (tests/fixtures/supabase-project.sql), then every module and
// every pack. A module whose schema one of them takes stops `init` with `schema_taken`, as the
// storage module did on a real project; this is where the CI meets it first.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { emptyDatabase, repoRoot, shippedModules, sqlClient } from './helpers/db.js';
import { doctor, install, readCatalogue } from '../packages/cli/src/index.js';

const FIXTURE = join(repoRoot, 'tests/fixtures/supabase-project.sql');

/** The schemas the fixture creates, read from it: one list, the file's. */
async function hostedSchemas(): Promise<string[]> {
  const sql = await readFile(FIXTURE, 'utf8');
  return [...sql.matchAll(/^create schema if not exists ([a-z_]+);$/gm)].map((m) => m[1]!);
}

let db: PGlite;

beforeAll(async () => {
  db = await emptyDatabase();
  await db.exec(await readFile(FIXTURE, 'utf8'));
});

afterAll(async () => {
  await db.close();
});

describe('a new Supabase project', () => {
  it('holds no schema a module of this release creates', async () => {
    const catalogue = await readCatalogue(repoRoot);
    const hosted = new Set([...(await hostedSchemas()), 'auth', 'extensions', 'public']);
    expect(hosted.size).toBeGreaterThan(10);
    for (const [module, schema] of catalogue.schemas) expect(hosted.has(schema), `module ${module} creates schema ${schema}`).toBe(false);
    expect(hosted.has('nexgen')).toBe(false);
  });

  it('takes every module and every pack, and the doctor finds nothing wrong', async () => {
    const catalogue = await readCatalogue(repoRoot);
    const packs = [...catalogue.packs.keys()];
    expect(packs.length).toBeGreaterThan(0);
    const dry = await install(sqlClient(db), { root: repoRoot, modules: shippedModules, packs, dryRun: true });
    expect(dry.applied.length).toBeGreaterThan(0);
    const r = await install(sqlClient(db), { root: repoRoot, modules: shippedModules, packs });
    expect(r.applied.map((s) => s.name)).toEqual(dry.applied.map((s) => s.name));
    const report = await doctor(sqlClient(db), catalogue);
    expect(report.problems).toEqual([]);
    expect(report.modules.map((m) => m.code).sort()).toEqual([...shippedModules].sort());
    expect(report.packs.sort()).toEqual(packs.sort());
  });

  it('keeps the objects of the project as they were', async () => {
    for (const schema of await hostedSchemas()) {
      const rows = await db.query<{ n: number }>(
        `select ((select count(*) from pg_class c where c.relnamespace = n.oid and c.relkind = 'r')
                 + (select count(*) from pg_proc f where f.pronamespace = n.oid))::int as n
           from pg_namespace n where n.nspname = $1`,
        [schema],
      );
      expect(rows.rows[0]?.n, schema).toBe(1);
    }
  });
});

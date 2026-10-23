// The engine: what is applied, in which order, recorded once, and a dry run
// that leaves nothing behind.
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { emptyDatabase, freshDatabase, one, repoRoot, sqlClient } from '../../../tests/helpers/db.js';
import { install, migrate, plan, readCatalogue, type Catalogue, type Step } from '../src/index.js';

const opened: PGlite[] = [];
const temp: string[] = [];
async function track(db: Promise<PGlite>): Promise<PGlite> {
  const d = await db;
  opened.push(d);
  return d;
}

afterAll(async () => {
  for (const d of opened) await d.close();
  for (const t of temp) await rm(t, { recursive: true, force: true });
});

const step = (name: string, scope: string): Step => ({ name, scope });

/** A catalogue written by hand: a core, two modules, one pack that needs one of them. */
const synthetic: Catalogue = {
  root: '/nowhere',
  core: [step('supabase/migrations/1_a.sql', 'core'), step('supabase/seed/1_seed.sql', 'core')],
  modules: new Map([
    ['alpha', [step('modules/alpha/supabase/migrations/0001_alpha.sql', 'module:alpha')]],
    ['beta', [step('modules/beta/supabase/migrations/0001_beta.sql', 'module:beta'), step('modules/beta/supabase/migrations/0002_beta.sql', 'module:beta')]],
  ]),
  schemas: new Map([['alpha', 'alpha'], ['beta', 'beta']]),
  formerly: new Map(),
  packs: new Map([['xx', { code: 'xx', modules: ['beta'], steps: [step('supabase/seed/12_pack_xx.sql', 'pack:xx')] }]]),
};

describe('plan', () => {
  it('puts the core first, then the modules in the catalogue order, then the packs', () => {
    const p = plan(synthetic, { modules: ['beta', 'alpha'], packs: ['xx'] }, new Set());
    expect(p.steps.map((s) => s.scope)).toEqual(['core', 'core', 'module:alpha', 'module:beta', 'module:beta', 'pack:xx']);
    expect(p.pending).toEqual(p.steps);
  });

  it('leaves out what is recorded', () => {
    const recorded = new Set(['supabase/migrations/1_a.sql', 'supabase/seed/1_seed.sql', 'modules/alpha/supabase/migrations/0001_alpha.sql']);
    const p = plan(synthetic, { modules: ['alpha'], packs: [] }, recorded);
    expect(p.steps).toHaveLength(3);
    expect(p.pending).toEqual([]);
  });

  it('refuses a pack whose module is neither asked nor installed, by name', () => {
    expect(() => plan(synthetic, { modules: ['alpha'], packs: ['xx'] }, new Set())).toThrow(/^pack_requires_module: pack xx needs module beta/);
    const installed = new Set(['modules/beta/supabase/migrations/0001_beta.sql']);
    expect(plan(synthetic, { modules: [], packs: ['xx'] }, installed).pending.map((s) => s.scope)).toEqual(['core', 'core', 'pack:xx']);
  });

  it('refuses a module or a pack it does not ship', () => {
    expect(() => plan(synthetic, { modules: ['gamma'], packs: [] }, new Set())).toThrow(/^unknown_module: gamma; shipped: alpha, beta/);
    expect(() => plan(synthetic, { modules: [], packs: ['yy'] }, new Set())).toThrow(/^unknown_pack: yy/);
  });

  it('reads the release in the repository: the version migration last of the core migrations, the seed after', async () => {
    const c = await readCatalogue(repoRoot);
    const names = c.core.map((s) => s.name);
    expect(names.at(-2)).toBe('supabase/migrations/20261013000000_schema_version_0_3_0.sql');
    expect(names.at(-1)).toBe('supabase/seed/0001_core_vocabularies.sql');
    expect([...c.modules.keys()]).toEqual(['actions', 'battery', 'billing', 'building', 'charging', 'community', 'consumption', 'grid', 'kpis', 'solar', 'weather']);
    // Every folder of packs/ with a pack.json, whichever countries the release holds.
    const folders = (await readdir(join(repoRoot, 'packs'))).filter((d) => existsSync(join(repoRoot, 'packs', d, 'pack.json'))).sort();
    expect(folders.length).toBeGreaterThan(0);
    expect([...c.packs.keys()]).toEqual(folders);
  });
});

describe('install on a database', () => {
  it('records every step once: applying twice applies once', async () => {
    const db = await track(freshDatabase(['grid'], ['fr']));
    const before = await one<{ n: number }>(db, 'select count(*)::int n from nexgen.schema_migrations');
    const again = await install(sqlClient(db), { root: repoRoot, modules: ['grid'], packs: ['fr'] });
    expect(again.applied).toEqual([]);
    expect(again.skipped).toBe(before.n);
    const after = await one<{ n: number }>(db, 'select count(*)::int n from nexgen.schema_migrations');
    expect(after.n).toBe(before.n);
    const scopes = await db.query<{ scope: string; n: number }>('select scope, count(*)::int n from nexgen.schema_migrations group by 1 order by 1');
    expect(scopes.rows).toEqual([
      { scope: 'core', n: 14 },
      { scope: 'module:grid', n: 1 },
      { scope: 'pack:fr', n: 1 },
    ]);
  });

  it('applies a module after the core and a pack after its modules, and adds a module later', async () => {
    const db = await track(emptyDatabase());
    const order: string[] = [];
    await install(sqlClient(db), { root: repoRoot, modules: ['weather', 'grid'], packs: ['fr'], onStep: (s) => order.push(s.scope) });
    const firstModule = order.indexOf('module:grid');
    expect(order.slice(0, firstModule).every((s) => s === 'core')).toBe(true);
    expect(order.lastIndexOf('module:weather')).toBeLessThan(order.indexOf('pack:fr'));
    const later = await install(sqlClient(db), { root: repoRoot, modules: ['solar'], packs: [] });
    expect(later.applied.map((s) => s.scope)).toEqual(['module:solar', 'module:solar', 'module:solar']);
    const modules = await db.query<{ code: string }>('select code from nexgen.modules order by code');
    expect(modules.rows.map((r) => r.code)).toEqual(['grid', 'solar', 'weather']);
  });

  it('dry run: reports what it would apply and leaves nothing', async () => {
    const db = await track(emptyDatabase());
    const r = await install(sqlClient(db), { root: repoRoot, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.applied.length).toBeGreaterThan(12);
    const left = await one<{ schema: string | null; postgis: string | null }>(
      db,
      `select to_regnamespace('nexgen')::text as schema, (select extversion from pg_extension where extname = 'postgis') as postgis`,
    );
    expect(left.schema).toBeNull();
    expect(left.postgis).not.toBeNull();
  });

  it('refuses a module whose schema the database already holds, by name, before applying anything', async () => {
    // As every Supabase project holds `storage` for Supabase Storage: a
    // schema of somebody else's, with a table and a function of its own.
    const db = await track(emptyDatabase());
    await db.exec(`create schema battery; create table battery.objects (id int primary key);
      create function battery.search() returns int language sql as 'select 1';`);
    const refusal = /^schema_taken: schema battery already exists with 2 objects of its own, and module battery creates it; nothing was applied/;
    await expect(install(sqlClient(db), { root: repoRoot, dryRun: true })).rejects.toThrow(refusal);
    await expect(install(sqlClient(db), { root: repoRoot })).rejects.toThrow(refusal);
    expect((await one<{ s: string | null }>(db, `select to_regnamespace('nexgen')::text s`)).s).toBeNull();
    const r = await install(sqlClient(db), { root: repoRoot, modules: ['grid'] });
    expect(r.applied.map((s) => s.scope)).toContain('module:grid');
    expect((await one<{ n: number }>(db, 'select count(*)::int n from battery.objects')).n).toBe(0);
  });

  it('refuses without PostGIS, with the line to run', async () => {
    const db = await track(emptyDatabase({ postgis: false }));
    await expect(install(sqlClient(db), { root: repoRoot })).rejects.toThrow(
      /^postgis_required: .*create extension if not exists postgis with schema extensions;/,
    );
  });
});

describe('migrate', () => {
  it('refuses a database with no Nexgen OS in it', async () => {
    const db = await track(emptyDatabase());
    await expect(migrate(sqlClient(db), { root: repoRoot })).rejects.toThrow(/^not_installed:/);
  });

  it('applies only what a newer release adds, to the core and the modules installed', async () => {
    const db = await track(freshDatabase(['grid']));
    const root = await mkdtemp(join(tmpdir(), 'nexgen-release-'));
    temp.push(root);
    for (const dir of ['supabase', 'modules', 'packs']) await cp(join(repoRoot, dir), join(root, dir), { recursive: true });
    await writeFile(
      join(root, 'supabase/migrations/20991231000000_core_later.sql'),
      'set search_path = nexgen, public, extensions;\ncreate table later (id int primary key);\nalter table later enable row level security;\n',
    );
    const r = await migrate(sqlClient(db), { root });
    expect(r.applied).toEqual([{ name: 'supabase/migrations/20991231000000_core_later.sql', scope: 'core' }]);
    expect((await migrate(sqlClient(db), { root })).applied).toEqual([]);
  });

  it('refuses an installation that holds a module under its former code, naming the new one', async () => {
    const db = await track(freshDatabase(['grid']));
    await db.exec(`insert into nexgen.modules (code, name, version, schema_name, requires_core_min, description)
      values ('storage', 'Storage', '0.3.0', 'storage', '0.3.0', 'Batteries, as release 0.3.0 named them.');`);
    await expect(migrate(sqlClient(db), { root: repoRoot })).rejects.toThrow(
      /^module_renamed: the database holds module storage, which this package ships as battery \(schema battery\); it is not renamed in place before 1\.0/,
    );
  });

});

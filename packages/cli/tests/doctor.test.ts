// doctor and status, and the command line that prints them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { emptyDatabase, freshDatabase, insert, organisation, repoRoot, sqlClient } from '../../../tests/helpers/db.js';
import { doctor, main, readCatalogue, status } from '../src/index.js';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase(['architecture', 'solar', 'weather'], ['fr']);
});

afterAll(async () => {
  await db.close();
});

async function run(argv: string[], database: PGlite = db) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: { NEXGEN_DB_URL: 'pglite://' }, open: async () => sqlClient(database) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('doctor', () => {
  it('finds nothing wrong on a fresh installation', async () => {
    const r = await doctor(sqlClient(db), await readCatalogue(repoRoot));
    expect(r.problems).toEqual([]);
    expect(r.schemaVersion).toBe('0.1.0');
    expect(r.postgis).toMatch(/^3\./);
    expect(r.applied).toEqual({ core: 13, 'module:architecture': 1, 'module:solar': 2, 'module:weather': 1, 'pack:fr': 1 });
    expect(r.modules.map((m) => m.code)).toEqual(['architecture', 'solar', 'weather']);
    expect(r.packs).toEqual(['fr']);
    expect(r.vocabularies.quantities).toBeGreaterThan(0);
    expect(r.vocabularies.id_schemes).toBeGreaterThan(0);
  });

  it('names a table whose row level security was disabled, in the core and in a module, and exits 1', async () => {
    await db.exec('begin; alter table nexgen.sites disable row level security; alter table solar.pv_arrays disable row level security;');
    try {
      const r = await doctor(sqlClient(db), await readCatalogue(repoRoot));
      expect(r.problems).toEqual([
        { code: 'rls_disabled', detail: 'nexgen.sites has no row level security' },
        { code: 'rls_disabled', detail: 'solar.pv_arrays has no row level security' },
      ]);
      const cli = await run(['doctor']);
      expect(cli.code).toBe(1);
      expect(cli.out).toContain('  rls_disabled: nexgen.sites has no row level security');
    } finally {
      await db.exec('rollback');
    }
  });

  it('names a step recorded as missing and a module without its row', async () => {
    await db.exec(`begin; delete from nexgen.schema_migrations where name = 'packs/fr/seed/0001_fr.sql'; delete from nexgen.modules where code = 'architecture';`);
    try {
      const codes = (await doctor(sqlClient(db), await readCatalogue(repoRoot))).problems.map((p) => p.code);
      expect(codes).toEqual(['module_unregistered']);
    } finally {
      await db.exec('rollback');
    }
    await db.exec(`begin; delete from nexgen.schema_migrations where name = 'modules/solar/migrations/0002_wind_speed.sql';`);
    try {
      const problems = (await doctor(sqlClient(db), await readCatalogue(repoRoot))).problems;
      expect(problems).toEqual([{ code: 'migrations_pending', detail: '1 to apply, run nexgen-os migrate: modules/solar/migrations/0002_wind_speed.sql' }]);
    } finally {
      await db.exec('rollback');
    }
  });

  it('says an empty database has no Nexgen OS', async () => {
    const empty = await emptyDatabase();
    try {
      const r = await doctor(sqlClient(empty), await readCatalogue(repoRoot));
      expect(r.problems.map((p) => p.code)).toEqual(['not_installed']);
    } finally {
      await empty.close();
    }
  });
});

describe('status and the command line', () => {
  it('counts organisations, sites, buildings and series', async () => {
    const org = await organisation(db, 'Status firm');
    await insert(db, 'sites', { organisation_id: org, name: 'One', country: 'ZZ', time_zone: 'UTC' });
    const r = await status(sqlClient(db));
    expect(r).toMatchObject({ schemaVersion: '0.1.0', packs: ['fr'], counts: { organisations: 1, sites: 1, buildings: 0, series: 0 } });
    expect([...r.modules].sort()).toEqual(['architecture', 'solar', 'weather']);
    const cli = await run(['status']);
    expect(cli.code).toBe(0);
    expect(cli.out).toMatch(/^Nexgen OS 0\.1\.0\nmodules {8}architecture, solar, weather\npacks {10}fr\norganisations {2}1\nsites/);
  });

  it('init through the command line: a dry run, then the run, then nothing to apply', async () => {
    const empty = await emptyDatabase();
    try {
      const dry = await run(['init', '--modules', 'architecture', '--dry-run'], empty);
      expect(dry.code).toBe(0);
      expect(dry.out).toMatch(/would apply 14 step\(s\), 0 already recorded — dry run, rolled back$/);
      const real = await run(['init', '--modules=architecture'], empty);
      expect(real.out).toMatch(/applied 14 step\(s\), 0 already recorded$/);
      const again = await run(['init', '--modules=architecture'], empty);
      expect(again.out).toBe('nothing to apply: 14 step(s) already recorded');
      expect((await run(['migrate'], empty)).out).toBe('nothing to apply: 14 step(s) already recorded');
    } finally {
      await empty.close();
    }
  });

  it('refuses by name: no connection string, an unknown flag, an unknown module', async () => {
    const noUrl = await main(['status'], { out: () => {}, err: (l) => expect(l).toMatch(/^db_url_required:/), env: {} });
    expect(noUrl).toBe(1);
    expect(await run(['init', '--modlues', 'x'])).toMatchObject({ code: 2, err: 'usage: unknown flag --modlues' });
    expect((await run(['init', '--modules', 'nope'])).err).toMatch(/^unknown_module: nope; shipped: architecture, solar, weather/);
  });
});

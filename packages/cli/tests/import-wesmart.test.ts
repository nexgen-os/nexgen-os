// `nexgen-os import wesmart`: the platform read only, registered once as the
// owner, then imported as a person, again without a duplicate.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { main } from '../src/index.js';
import { USER_A, freshDatabase, sqlClient } from '../../../tests/helpers/db.js';
import { EAN_SCHOOL, NAMES, SCHOOL, madeUpPlatform } from '../../connectors/wesmart-database/tests/fixtures/platform.js';

let db: PGlite;
let source: PGlite;

async function run(argv: string[], env: Record<string, string> = { NEXGEN_ACT_AS_USER_ID: USER_A }) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    out: (l) => out.push(l), err: (l) => err.push(l),
    env: { NEXGEN_DB_URL: 'pglite://model', NEXGEN_IMPORT_SOURCE_URL: 'pglite://platform', ...env },
    open: async (url) => sqlClient(url === 'pglite://platform' ? source : db),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

beforeAll(async () => {
  source = await madeUpPlatform();
  db = await freshDatabase(['grid'], ['be']);
  await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [USER_A]);
});

afterAll(async () => {
  await source.close();
  await db.close();
});

describe('nexgen-os import wesmart', () => {
  it('asks for the platform to be registered first, by name', async () => {
    const r = await run(['import', 'wesmart', '--time-zone', 'Europe/Brussels']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^source_not_registered/);
  });

  it('registers it as the owner, then plans, applies and applies again without a duplicate', async () => {
    expect((await run(['import', 'wesmart', '--register'], {})).code).toBe(0);
    const plan = await run(['import', 'wesmart', '--time-zone', 'Europe/Brussels', '--dry-run']);
    expect(plan.err).toBe('');
    expect(plan.out).toMatch(/^dry_run {2}wesmart_database/);
    expect((await db.query('select 1 from nexgen.projects')).rows).toHaveLength(0);

    const applied = await run(['import', 'wesmart', '--time-zone', 'Europe/Brussels', '--apply', '--json']);
    expect(applied.err).toBe('');
    const first = JSON.parse(applied.out);
    expect(first.counts.participant.created).toBe(3);
    expect(first.totals.differs).toBe(0);

    const again = JSON.parse((await run(['import', 'wesmart', '--time-zone', 'Europe/Brussels', '--apply', '--json'])).out);
    expect(Object.values(again.counts as Record<string, { created: number }>).every((c) => c.created === 0)).toBe(true);
    expect(again.readings.changed).toBe(0);
    expect(again.months).toEqual(first.months);

    const report = await run(['import', 'wesmart', '--time-zone', 'Europe/Brussels', '--report']);
    expect(report.out).toContain('months: 8 lines, 8 equal');
    for (const text of [report.out, applied.out]) {
      for (const secret of [...NAMES, EAN_SCHOOL]) expect(text).not.toContain(secret);
    }
    expect(applied.out).toContain(SCHOOL);
  });

  it('takes one mode only', async () => {
    const r = await run(['import', 'wesmart', '--time-zone', 'Europe/Brussels', '--apply', '--report']);
    expect(r.code).toBe(2);
  });
});

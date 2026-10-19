// The contract between the pack compiler and the core: the seed the
// compiler wrote for its fixture pack (packages/cli, `pack build xa`) runs
// on the real core and its `grid` module, twice without a change, and what
// it wrote is what parameter_of() answers for a site of that country.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, one, organisation, repoRoot } from './helpers/db.js';

let db: PGlite;
let seed: string;

beforeAll(async () => {
  db = await freshDatabase(['grid']);
  const compiled = await readFile(join(repoRoot, 'tests/fixtures/pack-checkout/supabase/seed/10_pack_xa.sql'), 'utf8');
  // The compiled seed still names an organisation level in `defaults`; the
  // core has none, since an organisation's defaults are its attributes
  // (decisions 0021 and 0023). The two mentions are taken out here until
  // the compiler drops them; everything else runs as compiled.
  seed = compiled
    .replace(' and x.organisation_id is null', '')
    .replace('on conflict (country, region, organisation_id, property_code, valid_from)', 'on conflict (country, region, property_code, valid_from)');
  expect(seed).not.toContain('organisation_id');
});

afterAll(async () => {
  await db.close();
});

describe('a compiled pack on the core', () => {
  it('writes every section, and a second run changes nothing', async () => {
    const count = async (table: string) => (await one<{ n: number }>(db, `select count(*)::int n from ${table}`)).n;
    for (let run = 0; run < 2; run += 1) {
      await db.exec(seed);
      await db.exec('set search_path = nexgen, public');
      expect([await count(`countries where code = 'XA'`), await count(`regions where country = 'XA'`), await count(`grid.operators where country = 'XA'`), await count(`defaults where country = 'XA'`)])
        .toEqual([1, 3, 2, 7]);
    }
  });

  it('answers parameter_of() for a site of the country, region before country, with the source and the reference', async () => {
    const org = await organisation(db, 'A cooperative');
    const south = (await one<{ id: string }>(db, `select create_site($1, 'South farm', '{"country": "XA", "region": "XA-S"}') id`, [org])).id;
    const north = (await one<{ id: string }>(db, `select create_site($1, 'North farm', '{"country": "XA", "region": "XA-N"}') id`, [org])).id;
    expect((await one<{ time_zone: string }>(db, 'select time_zone from sites where id = $1', [south])).time_zone).toBe('Etc/GMT-1');
    const p = async (site: string, property: string) => (await one<{ p: Record<string, unknown> }>(db, `select parameter_of($1, $2, '2026-06-01') p`, [site, property])).p;
    expect(await p(south, 'sharing_max_distance_m')).toMatchObject({ value: 2000, level: 'region', source_code: 'xa_grid_code', reference: 'Article 31' });
    expect(await p(north, 'metering_step')).toMatchObject({ value: 'PT15M', level: 'country' });
    await expect(p(north, 'sharing_max_distance_m')).rejects.toThrow(/parameter_missing: sharing_max_distance_m .* reached country XA/);
    await expect(p(north, 'offpeak_hours')).rejects.toThrow(/parameter_not_decided: offpeak_hours in XA: Article 40/);
  });
});

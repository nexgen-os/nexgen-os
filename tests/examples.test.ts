// Every example loads on a fresh database, registers what it says it does,
// and answers the queries written at its end.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freshDatabase, one, repoRoot } from './helpers/db.js';

const EXPECTED: Record<string, { kinds: Record<string, number>; series: number; runs: number }> = {
  '01-house-pv-battery.sql':   { kinds: { site: 1, building: 1, surface: 2, meter: 1, device: 4, sensor: 3 }, series: 2, runs: 1 },
  '02-school-architecture.sql': { kinds: { site: 1, building: 1, floor: 2, space: 5, sensor: 13, device: 1 }, series: 3, runs: 0 },
  '03-energy-community.sql':   { kinds: { project: 1, site: 4, meter: 4, participant: 5, device: 1 }, series: 4, runs: 1 },
  '04-farm-solar.sql':         { kinds: { site: 1, building: 2, surface: 4, meter: 2, device: 5 }, series: 0, runs: 3 },
  '05-district-open-data.sql': { kinds: { project: 1, site: 8, building: 6, surface: 6, participant: 6 }, series: 0, runs: 0 },
  '06-drone-survey.sql':       { kinds: { project: 1, site: 1, building: 1, surface: 3, participant: 1 }, series: 0, runs: 0 },
  '07-office-heating.sql':     { kinds: { site: 1, building: 1, surface: 5, meter: 2, device: 4, sensor: 3 }, series: 2, runs: 2 },
  '08-ppa-and-community-tariff.sql': { kinds: { project: 1, site: 2, meter: 3, participant: 2, contract: 7 }, series: 0, runs: 0 },
};

const dir = join(repoRoot, 'examples');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

describe('the examples', () => {
  it('are all listed here', () => {
    expect(files).toEqual(Object.keys(EXPECTED));
  });

  for (const file of files) {
    it(`${file} loads and holds what it says`, async () => {
      const db = await freshDatabase(['architecture', 'contracts']);
      try {
        await db.exec(await readFile(join(dir, file), 'utf8'));
        const kinds = await db.query<{ kind: string; n: number }>('select kind, count(*)::int n from objects group by kind');
        expect(Object.fromEntries(kinds.rows.map((r) => [r.kind, r.n]))).toEqual(EXPECTED[file].kinds);
        const counts = await one<{ series: number; values: number; runs: number; orphans: number }>(
          db,
          `select (select count(*)::int from series) series,
                  (select count(*)::int from series_values) values,
                  (select count(*)::int from runs) runs,
                  (select count(*)::int from objects o where site_of(o.id) is null and o.kind <> 'project'
                     and not exists (select 1 from participants p where p.id = o.id and p.is_group)) orphans`,
        );
        expect(counts.series).toBe(EXPECTED[file].series);
        expect(counts.runs).toBe(EXPECTED[file].runs);
        expect(counts.orphans).toBe(0);
        if (counts.series > 0) expect(counts.values).toBeGreaterThan(0);
        // The country of everything is the one the example says.
        const countries = await db.query<{ c: string }>(`select distinct country_of(id) c from objects o where kind <> 'project' and not exists (select 1 from participants p where p.id = o.id and p.is_group)`);
        expect(countries.rows).toHaveLength(1);
      } finally {
        await db.close();
      }
    });
  }
});

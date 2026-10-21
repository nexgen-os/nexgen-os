// Every example loads on a fresh database with the modules it names,
// holds what it says it does, and answers the queries written at its end.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freshDatabase, one, repoRoot } from './helpers/db.js';

const EXPECTED: Record<string, { modules: string[]; kinds: Record<string, number>; series: number; runs: number }> = {
  '01-house-pv-battery.sql':   { modules: [], kinds: { organisation: 1, project: 1, participant: 1, meter: 1, device: 4 }, series: 3, runs: 1 },
  '02-school-architecture.sql': { modules: ['building'], kinds: { organisation: 1, project: 1, participant: 1, building: 1, space: 7, device: 5 }, series: 13, runs: 0 },
  '03-energy-community.sql':   { modules: ['billing', 'community', 'grid'], kinds: { organisation: 1, project: 1, meter: 4, participant: 5, device: 1 }, series: 4, runs: 1 },
  '04-farm-solar.sql':         { modules: [], kinds: { organisation: 1, project: 1, participant: 1, meter: 2, device: 5 }, series: 0, runs: 3 },
  '05-district-open-data.sql': { modules: ['building'], kinds: { organisation: 1, project: 1, site: 8, building: 6, surface: 6, participant: 6 }, series: 0, runs: 0 },
  '06-drone-survey.sql':       { modules: ['building'], kinds: { organisation: 1, project: 1, building: 1, surface: 3, participant: 1 }, series: 0, runs: 0 },
  '07-office-heating.sql':     { modules: ['building'], kinds: { organisation: 1, project: 1, participant: 1, building: 1, surface: 5, meter: 2, device: 4 }, series: 3, runs: 2 },
};

const dir = join(repoRoot, 'examples');

// Every object of every kind the installation knows, read through `kinds`:
// there is no registry, each kind's table is read in turn.
const everyObject = async (db: Awaited<ReturnType<typeof freshDatabase>>): Promise<string> =>
  (await one<{ sql: string }>(db, `select string_agg(format('select %L as kind, id from %s', kind, table_name), ' union all ') sql
                                     from kinds where kind not in ('series', 'run')`)).sql;
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

describe('the examples', () => {
  it('are all listed here', () => {
    expect(files).toEqual(Object.keys(EXPECTED));
  });

  for (const file of files) {
    it(`${file} loads and holds what it says`, async () => {
      const sql = await readFile(join(dir, file), 'utf8');
      // The first lines name the modules an example needs.
      for (const m of EXPECTED[file].modules) expect(sql.split('\n\n')[0]).toContain(`\`${m}\``);
      const db = await freshDatabase(EXPECTED[file].modules);
      try {
        await db.exec(sql);
        const objects = await everyObject(db);
        const kinds = await db.query<{ kind: string; n: number }>(`with o as (${objects}) select kind, count(*)::int n from o group by kind`);
        expect(Object.fromEntries(kinds.rows.map((r) => [r.kind, r.n]))).toEqual(EXPECTED[file].kinds);
        // Everything belongs to a participant, but the organisation and a
        // project; a participant is its own.
        const counts = await one<{ series: number; values: number; runs: number; orphans: number }>(
          db,
          `with o as (${objects})
           select (select count(*)::int from series) series,
                  (select count(*)::int from series_values) values,
                  (select count(*)::int from runs) runs,
                  (select count(*)::int from o where participant_of(o.kind, o.id) is null and o.kind not in ('organisation', 'project')) orphans`,
        );
        expect(counts.series).toBe(EXPECTED[file].series);
        expect(counts.runs).toBe(EXPECTED[file].runs);
        expect(counts.orphans).toBe(0);
        if (counts.series > 0) expect(counts.values).toBeGreaterThan(0);
        // The country of everything with a place is the one the example says.
        const countries = await db.query<{ c: string }>(`with o as (${objects}) select distinct country_of(kind, id) c from o where country_of(kind, id) is not null`);
        expect(countries.rows).toHaveLength(1);
      } finally {
        await db.close();
      }
    });
  }
});

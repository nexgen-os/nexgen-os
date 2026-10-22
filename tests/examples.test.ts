// Every example loads on a fresh database with the modules it names,
// holds what it says it does, and answers the queries written at its end.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freshDatabase, one, repoRoot } from './helpers/db.js';

const EXPECTED: Record<string, { modules: string[]; kinds: Record<string, number>; series: number; calculations: number }> = {
  '01-house-pv-battery.sql':   { modules: [], kinds: { organisation: 1, project: 1, participant: 1, meter: 1, device: 4 }, series: 4, calculations: 0 },
  '02-school.sql': { modules: ['building'], kinds: { organisation: 1, project: 1, participant: 1, building: 1, space: 7, device: 5 }, series: 13, calculations: 0 },
  '03-energy-community.sql':   { modules: ['billing', 'community', 'grid'], kinds: { organisation: 1, project: 1, meter: 4, participant: 5, device: 1 }, series: 4, calculations: 1 },
  '04-farm-solar.sql':         { modules: ['solar'], kinds: { organisation: 1, project: 1, participant: 1, meter: 2, device: 5 }, series: 0, calculations: 3 },
  '05-district-open-data.sql': { modules: ['building'], kinds: { organisation: 1, project: 1, site: 8, building: 6, surface: 6, participant: 6 }, series: 0, calculations: 0 },
  '06-drone-survey.sql':       { modules: ['building'], kinds: { organisation: 1, project: 1, building: 1, surface: 3, participant: 1 }, series: 0, calculations: 0 },
  '07-office-heating.sql':     { modules: ['building'], kinds: { organisation: 1, project: 1, participant: 1, building: 1, surface: 5, meter: 2, device: 4 }, series: 3, calculations: 0 },
};

const dir = join(repoRoot, 'examples');

// Every object of the core, and of the `building` module where it is
// installed: each table is read in turn.
const TABLES: Record<string, string> = {
  organisation: 'organisations', project: 'projects', participant: 'participants', meter: 'meters', device: 'devices',
  site: 'building.sites', building: 'building.buildings', space: 'building.spaces', surface: 'building.surfaces',
};
const everyObject = async (db: Awaited<ReturnType<typeof freshDatabase>>): Promise<string> => {
  const parts: string[] = [];
  for (const [kind, table] of Object.entries(TABLES)) {
    if ((await one<{ e: boolean }>(db, 'select to_regclass($1) is not null e', [table])).e) parts.push(`select '${kind}' as kind, id from ${table}`);
  }
  return parts.join(' union all ');
};
/** The participant of an object: the core's for its kinds, the building module's for its own. */
const participantOf = (built: boolean, kind: string, id: string) =>
  built
    ? `case when ${kind} in ('site', 'building', 'space', 'surface') then building.participant_of(${kind}, ${id}) else participant_of(${kind}, ${id}) end`
    : `participant_of(${kind}, ${id})`;
/** Every figure of every module, in each of its tables of the shape of a figure (provenance, inputs, results). */
const everyCalculation = async (db: Awaited<ReturnType<typeof freshDatabase>>): Promise<string> => {
  const tables = (await db.query<{ t: string }>(
    `select format('%I.%I', n.nspname, c.relname) t
       from modules m join pg_namespace n on n.nspname = m.schema_name join pg_class c on c.relnamespace = n.oid and c.relkind = 'r'
      where (select count(*) from information_schema.columns f
              where f.table_schema = n.nspname and f.table_name = c.relname and f.column_name in ('provenance', 'inputs', 'results')) = 3
      order by 1`,
  )).rows;
  return tables.length ? tables.map((t) => `select id from ${t.t}`).join(' union all ') : 'select null::uuid id where false';
};
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
        const built = EXPECTED[file].modules.includes('building');
        const kinds = await db.query<{ kind: string; n: number }>(`with o as (${objects}) select kind, count(*)::int n from o group by kind`);
        expect(Object.fromEntries(kinds.rows.map((r) => [r.kind, r.n]))).toEqual(EXPECTED[file].kinds);
        // Everything belongs to a participant, but the organisation and a
        // project; a participant is its own.
        const counts = await one<{ series: number; values: number; calculations: number; orphans: number }>(
          db,
          `with o as (${objects}), r as (${await everyCalculation(db)})
           select (select count(*)::int from series) series,
                  (select count(*)::int from series_values) values,
                  (select count(*)::int from r) calculations,
                  (select count(*)::int from o where ${participantOf(built, 'o.kind', 'o.id')} is null and o.kind not in ('organisation', 'project')) orphans`,
        );
        expect(counts.series).toBe(EXPECTED[file].series);
        expect(counts.calculations).toBe(EXPECTED[file].calculations);
        expect(counts.orphans).toBe(0);
        if (counts.series > 0) expect(counts.values).toBeGreaterThan(0);
        // The country of everything with a place is the one the example says.
        const countries = await db.query<{ c: string }>(
          `with o as (${objects}) select distinct country_of('participant', ${participantOf(built, 'kind', 'id')}) c from o where country_of('participant', ${participantOf(built, 'kind', 'id')}) is not null`);
        expect(countries.rows).toHaveLength(1);
      } finally {
        await db.close();
      }
    });
  }
});

// The contract between the pack compiler and the core: the seed the
// compiler wrote for its fixture pack (packages/cli, `pack build xa`) runs
// on the real core and its `grid` module, twice without a change, and what
// it wrote is what parameter_of() answers for a participant of that country.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, one, organisation, repoRoot, joinWithPlace } from './helpers/db.js';

let db: PGlite;
let seed: string;

beforeAll(async () => {
  db = await freshDatabase(['grid']);
  seed = await readFile(join(repoRoot, 'tests/fixtures/pack-checkout/supabase/seed/10_pack_xa.sql'), 'utf8');
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
      await db.exec('set search_path = nexgen, extensions, public');
      expect([await count(`countries where code = 'XA'`), await count(`regions where country = 'XA'`), await count(`grid.operators where country = 'XA'`), await count(`defaults where country = 'XA'`)])
        .toEqual([1, 5, 3, 10]);
      expect(await count(`project_kinds where country = 'XA'`)).toBe(1);
    }
  });

  it('answers parameter_of() for a participant of the country, region before country, with the source and the reference', async () => {
    const org = await organisation(db, 'A cooperative');
    const south = await joinWithPlace(db, org, 'South farm', { country: 'XA', region: 'XA-S' });
    const north = await joinWithPlace(db, org, 'North farm', { country: 'XA', region: 'XA-N' });
    expect((await one<{ time_zone: string }>(db, 'select time_zone from participants where id = $1', [south])).time_zone).toBe('Etc/GMT-1');
    const p = async (home: string, attributeType: string) => (await one<{ p: Record<string, unknown> }>(db, `select parameter_of('participant', $1, $2, '2026-06-01') p`, [home, attributeType])).p;
    expect(await p(south, 'sharing_max_distance_m')).toMatchObject({ value: 2000, level: 'region', source_code: 'xa_grid_code', reference: 'Article 31' });
    expect(await p(north, 'metering_step')).toMatchObject({ value: 'PT15M', level: 'country' });
    await expect(p(north, 'sharing_max_distance_m')).rejects.toThrow(/parameter_missing: sharing_max_distance_m .* reached country XA/);
    await expect(p(north, 'offpeak_hours')).rejects.toThrow(/parameter_not_decided: offpeak_hours in XA: Article 40/);
  });

  it('answers for the municipality, the frame of the project and the density class the pack lists', async () => {
    const org = await organisation(db, 'A sharing group');
    const project = (await one<{ id: string }>(db, `insert into projects (organisation_id, name, kind, country) values ($1, 'Dunmoor sharing', 'xa_sharing', 'XA') returning id`, [org])).id;
    const farm = (await one<{ id: string }>(db, `select join_project($1, 'Moor farm', $2) id`, [project, JSON.stringify({ country: 'XA', region: 'XA-S' })])).id;
    await db.query(`update participants set municipality = '20002' where id = $1`, [farm]);
    const p = async (attributeType: string) => (await one<{ p: Record<string, unknown> }>(db, `select parameter_of('participant', $1, $2, '2026-06-01') p`, [farm, attributeType])).p;
    expect(await p('density_class')).toMatchObject({ value: 'sparse', level: 'municipality', region: 'XA-20002' });
    expect(await p('sharing_max_distance_m')).toMatchObject({
      value: 10000, level: 'region', region: 'XA-S', conditions: { project_kind: 'xa_sharing', density_class: 'sparse' }, reference: 'Article 31, second paragraph',
    });
    const meter = (await one<{ id: string }>(db, `select declare_meter($1, 'XA20000001', 'xa_metering_point') id`, [farm])).id;
    expect((await one<{ o: unknown }>(db, 'select grid.operator_of($1) o', [meter])).o).toEqual({ operator: 'xa_dunmoor_dso', by: 'municipality', municipality: 'XA-20002' });
  });
});

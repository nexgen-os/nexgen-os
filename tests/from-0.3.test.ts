// An installation of 0.3.0 brought to 0.4.0 by `nexgen-os migrate`
// (decision 0057): every row keeps what it says, in the words of 0.4.0 —
// a value's quality (`default` read as `assumed`), a project without a
// frame, a participant's category, a region's parent_code — and the modules
// installed follow, solar's loss chain and community's perimeter.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { install, migrate } from '../packages/cli/src/index.js';
import { USER_A, emptyDatabase, insert, one, organisation, repoRoot, sqlClient } from './helpers/db.js';

const OF_0_4_0 = [
  'supabase/migrations/20261025000000_core_value_quality.sql',
  'supabase/migrations/20261025100000_core_what_a_project_is.sql',
  'supabase/migrations/20261026000000_schema_version_0_4_0.sql',
  'modules/solar/supabase/migrations/0004_estimate_losses_quality.sql',
  'modules/community/supabase/migrations/0003_participant_category.sql',
];
/** Written after 0.4.0, applied by the same `migrate`. */
const SINCE_0_4_0 = ['modules/solar/supabase/migrations/0005_system_loss.sql'];

let old: string;
let db: PGlite;
let farm: string;
let plan: string;
let applied: string[];

beforeAll(async () => {
  // The files as release 0.3.0 shipped them: the core and the two modules
  // without the migrations of 0.4.0, solar's loss chain with its foreign key.
  old = await mkdtemp(join(tmpdir(), 'nexgen-0.3.0-'));
  await cp(join(repoRoot, 'supabase'), join(old, 'supabase'), { recursive: true });
  for (const m of ['solar', 'community']) await cp(join(repoRoot, 'modules', m), join(old, 'modules', m), { recursive: true });
  for (const file of [...OF_0_4_0, ...SINCE_0_4_0]) await rm(join(old, file));
  const solar = join(old, 'modules/solar/supabase/migrations/0001_solar.sql');
  await writeFile(solar, (await readFile(solar, 'utf8')).replace(
    'status           value_quality not null,', 'status           text not null references value_statuses(code),'));

  db = await emptyDatabase();
  await install(sqlClient(db), { root: old, modules: ['solar', 'community'], packs: [] });
  await db.exec('set search_path = nexgen, extensions, public');
  // The generic project kinds the seed of 0.3.0 wrote.
  await db.exec(`insert into project_kinds (code, name, published_by) values
    ('study', 'Study', 'core'), ('other', 'Other', 'core'), ('buildings', 'Set of buildings', 'core'),
    ('construction', 'Construction site', 'core'), ('district_plan', 'District plan', 'core')`);
  await db.exec(`insert into currencies (code, name) values ('ZZZ', 'Testland currency') on conflict do nothing;
    insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by) values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz');
    insert into regions (code, country, name, published_by) values ('ZZ-NO', 'ZZ', 'North', 'pack:zz');
    insert into regions (code, country, name, parent, published_by) values ('ZZ-N1', 'ZZ', 'North One', 'ZZ-NO', 'pack:zz');
    insert into sources (code, name, kind, published_by) values ('zz_statistics', 'Statistics', 'text', 'pack:zz');
    insert into defaults (attribute_type, country, value, valid_from, source_code, status, published_by)
      values ('energy_price_household', 'ZZ', '180', '2020-01-01', 'zz_statistics', 'default', 'pack:zz');`);
  const o = await organisation(db, 'A cooperative', USER_A);
  plan = await insert(db, 'projects', { organisation_id: o, name: 'Plateau', kind: 'district_plan', country: 'ZZ' });
  farm = await insert(db, 'participants', { organisation_id: o, project_id: plan, name: 'Farm', role: 'producer', country: 'ZZ', region: 'ZZ-NO' });
  await insert(db, 'attributes', { organisation_id: o, object_kind: 'participant', object_id: farm, attribute_type: 'annual_consumption', value: 4000, valid_to: '2026-01-01', status: 'default' });
  await insert(db, 'attributes', { organisation_id: o, object_kind: 'participant', object_id: farm, attribute_type: 'annual_consumption', value: 4350, valid_from: '2026-01-01', status: 'measured' });

  applied = (await migrate(sqlClient(db), { root: repoRoot })).applied.map((s) => s.name);
});

afterAll(async () => {
  await db.close();
  await rm(old, { recursive: true, force: true });
});

describe('an installation of 0.3.0, migrated', () => {
  it('applies the migrations of 0.4.0 of the core and of the modules installed, those written since, and nothing else', () => {
    expect([...applied].sort()).toEqual([...OF_0_4_0, ...SINCE_0_4_0].sort());
  });

  it('keeps the quality of every value, a default of 0.3.0 read as assumed', async () => {
    const kept = await db.query<{ quality: string }>('select quality from attributes where object_id = $1 order by valid_from nulls first', [farm]);
    expect(kept.rows.map((x) => x.quality)).toEqual(['assumed', 'measured']);
    expect((await one<{ quality: string }>(db, `select quality from defaults where attribute_type = 'energy_price_household'`)).quality).toBe('assumed');
    const losses = await one<{ domain_name: string }>(db,
      `select domain_name from information_schema.columns where table_schema = 'solar' and table_name = 'estimate_losses' and column_name = 'quality'`);
    expect(losses.domain_name).toBe('value_quality');
    expect((await one<{ t: string | null }>(db, `select to_regclass('nexgen.value_statuses')::text t`)).t).toBeNull();
    expect(await one(db, `select parameter_of('participant', $1, 'annual_consumption', '2026-06-01')->>'quality' q`, [farm])).toEqual({ q: 'measured' });
  });

  it('leaves a project of a removed kind without one, and the kinds nothing read gone', async () => {
    expect(await one(db, 'select kind from projects where id = $1', [plan])).toEqual({ kind: null });
    const kinds = await db.query<{ code: string }>(`select code from project_kinds where published_by = 'core' order by code`);
    expect(kinds.rows.map((r) => r.code)).toEqual(['collective_self_consumption', 'energy_community', 'individual_self_consumption', 'pv_roof', 'self_consumption']);
  });

  it('calls a participant\'s producer, consumer or prosumer its category, which the perimeter of a community reads', async () => {
    expect(await one(db, 'select category from participants where id = $1', [farm])).toEqual({ category: 'producer' });
    const columns = await db.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'nexgen' and table_name = 'participants' and column_name in ('role', 'category')`);
    expect(columns.rows).toEqual([{ c: 'category' }]);
    const perimeter = await db.query<{ c: string }>(
      `select unnest(proargnames) c from pg_proc where oid = 'community.check_perimeter(uuid, date)'::regprocedure`);
    expect(perimeter.rows.map((r) => r.c)).toContain('category');
  });

  it('calls the region a region is part of its parent_code, which the cascade of defaults climbs', async () => {
    expect(await one(db, `select parent_code from regions where code = 'ZZ-N1'`)).toEqual({ parent_code: 'ZZ-NO' });
    expect(await one(db, `select parameter_of('participant', $1, 'energy_price_household', '2026-06-01')->>'level' level`, [farm])).toEqual({ level: 'country' });
  });
});

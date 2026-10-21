/**
 * `doctor` and `status`: what a live installation is, read and never repaired.
 *
 * The fix for a table without row level security is a migration, and the
 * fix for a missing step is `nexgen-os migrate`; the doctor names each
 * problem so that the person or the agent reading it knows which.
 */
import { installedScopes, plan, readCatalogue, type Catalogue } from './catalogue.js';
import { postgisVersion, recordedSteps, registeredModules, POSTGIS_LINE } from './engine.js';
import type { SqlClient } from './sql.js';
import { checkFloor, databaseVersion } from './version.js';

export interface Problem {
  /** A name: `rls_disabled`, `migrations_pending`… */
  code: string;
  detail: string;
}

export interface DoctorReport {
  schemaVersion: string | null;
  postgis: string | null;
  /** Number of recorded steps, by scope. */
  applied: Record<string, number>;
  /** `nexgen.modules`, code and version. */
  modules: { code: string; version: string; schema_name: string }[];
  packs: string[];
  /** Rows of each vocabulary of the core. */
  vocabularies: Record<string, number>;
  problems: Problem[];
}

export const VOCABULARIES = [
  'device_types',
  'profiles',
  'link_types',
  'quantities',
  'property_defs',
  'tags',
  'id_schemes',
  'sources',
  'object_kinds',
  'series_quality_codes',
  'countries',
  'regions',
] as const;

async function exists(db: SqlClient, relation: string): Promise<boolean> {
  const [r] = await db.query<{ e: boolean }>('select to_regclass($1) is not null as e', [relation]);
  return r?.e ?? false;
}

async function count(db: SqlClient, table: string): Promise<number | null> {
  if (!(await exists(db, `nexgen.${table}`))) return null;
  const [r] = await db.query<{ n: number }>(`select count(*)::int as n from nexgen.${table}`);
  return r?.n ?? 0;
}

/**
 * Tables of `nexgen` and of the module schemas without row level security.
 * A partition is left out: it is reached through its parent, whose policies
 * apply, and the API roles hold no grant on it.
 */
export async function tablesWithoutRls(db: SqlClient, schemas: string[]): Promise<string[]> {
  const rows = await db.query<{ t: string }>(
    `select n.nspname || '.' || c.relname as t
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[]) and c.relkind in ('r', 'p')
        and not c.relispartition and not c.relrowsecurity
      order by 1`,
    [schemas],
  );
  return rows.map((r) => r.t);
}

/**
 * Tables of the module schemas that carry `organisation_id` and reach no
 * table of the core but `organisations` by a path of foreign keys, followed
 * transitively (decision 0042): a module enriches an object of the core,
 * through a derived table, a secondary table or vocabulary rows, and never
 * holds a notion of its own beside it. `organisation_id` alone is the
 * tenancy every table carries, not an object it enriches — unless it is the
 * table's primary key: a table keyed by the organisation's id derives the
 * organisation itself (`billing.companies`). A partition is left out, as
 * above.
 */
export async function detachedModuleTables(db: SqlClient, schemas: string[]): Promise<string[]> {
  const rows = await db.query<{ t: string }>(
    `with recursive candidates as (
       select c.oid, n.nspname || '.' || c.relname as t
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any($1::text[]) and n.nspname <> 'nexgen' and c.relkind in ('r', 'p') and not c.relispartition
          and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organisation_id' and not a.attisdropped)
          and not exists (
            select 1 from pg_constraint pk join pg_constraint f on f.conrelid = pk.conrelid and f.contype = 'f' and f.conkey = pk.conkey
             where pk.conrelid = c.oid and pk.contype = 'p' and f.confrelid = 'nexgen.organisations'::regclass)
     ),
     reach (start, rel) as (
       select oid, oid from candidates
       union
       select r.start, f.confrelid from reach r join pg_constraint f on f.conrelid = r.rel and f.contype = 'f'
     )
     select c.t from candidates c
      where not exists (
        select 1 from reach r join pg_class k on k.oid = r.rel join pg_namespace n on n.oid = k.relnamespace
         where r.start = c.oid and n.nspname = 'nexgen' and k.relname <> 'organisations')
      order by 1`,
    [schemas],
  );
  return rows.map((r) => r.t);
}

/**
 * The rows of the `billing` module whose Ekwo id is no longer in Ekwo OS,
 * when Ekwo OS shares the database (decision 0043). The doctor reads no
 * table of Ekwo itself: the module's `billing.unlinked_keys()` does, and
 * answers nothing when the module or Ekwo's tables are absent.
 */
export async function unlinkedBillingKeys(db: SqlClient): Promise<{ table_name: string; id: string; ekwo_id: string }[]> {
  const [r] = await db.query<{ f: boolean }>(`select to_regprocedure('billing.unlinked_keys()') is not null as f`);
  if (!r?.f) return [];
  return db.query('select table_name, id, ekwo_id from billing.unlinked_keys() order by 1, 2');
}

/**
 * The weeks of `series_values` that should have a partition and have none,
 * each as the Monday (UTC) that starts it. A week should have one when values
 * of it sit in the default partition, and, once an installation partitions at
 * all, for the current week and the next. Partitions are read by their
 * bounds, so those of `series_values_partition()` and of `pg_partman` count
 * alike. Read-only: `select nexgen.series_values_partition('<date>')` creates one.
 */
export async function missingSeriesPartitions(db: SqlClient): Promise<string[]> {
  if (!(await exists(db, 'nexgen.series_values_default'))) return [];
  const rows = await db.query<{ monday: string }>(
    `with parts as (
       select (regexp_match(pg_get_expr(c.relpartbound, c.oid), 'FROM \\(''([^'']+)''\\) TO \\(''([^'']+)''\\)'))[1]::timestamptz as lower,
              (regexp_match(pg_get_expr(c.relpartbound, c.oid), 'FROM \\(''([^'']+)''\\) TO \\(''([^'']+)''\\)'))[2]::timestamptz as upper
         from pg_inherits i
         join pg_class c on c.oid = i.inhrelid
         join pg_class p on p.oid = i.inhparent
         join pg_namespace n on n.oid = p.relnamespace
        where n.nspname = 'nexgen' and p.relname = 'series_values'
          and pg_get_expr(c.relpartbound, c.oid) like 'FOR VALUES FROM%'
     ),
     wanted as (
       select distinct date_trunc('week', at at time zone 'UTC')::date as monday from nexgen.series_values_default
       union
       select d::date from generate_series(date_trunc('week', now() at time zone 'UTC'), date_trunc('week', now() at time zone 'UTC') + interval '7 days', interval '7 days') d
        where exists (select 1 from parts)
     )
     select to_char(monday, 'YYYY-MM-DD') as monday from wanted w
      where not exists (
        select 1 from parts where parts.lower <= (w.monday::timestamp at time zone 'UTC') and parts.upper >= ((w.monday + 7)::timestamp at time zone 'UTC'))
      order by monday`,
  );
  return rows.map((r) => r.monday);
}

export async function doctor(db: SqlClient, catalogue?: Catalogue): Promise<DoctorReport> {
  const cat = catalogue ?? (await readCatalogue());
  const problems: Problem[] = [];
  const postgis = await postgisVersion(db);
  if (postgis === null) problems.push({ code: 'postgis_required', detail: `run: ${POSTGIS_LINE}` });

  const schemaVersion = await databaseVersion(db);
  const installed = await exists(db, 'nexgen.organisations');
  const report: DoctorReport = { schemaVersion, postgis, applied: {}, modules: [], packs: [], vocabularies: {}, problems };
  if (!installed) {
    problems.push({ code: 'not_installed', detail: 'there is no Nexgen OS in this database; run nexgen-os init' });
    return report;
  }
  if (schemaVersion === null || schemaVersion === '0.0.0') {
    problems.push({ code: 'schema_version_missing', detail: 'nexgen.nexgen_schema_version() is not there; run nexgen-os migrate' });
  }
  const floor = checkFloor(schemaVersion);
  if (floor) problems.push({ code: floor.code, detail: floor.message.slice(floor.code.length + 2) });

  const recorded = await recordedSteps(db);
  if (recorded.size === 0) {
    problems.push({ code: 'history_missing', detail: 'nexgen.schema_migrations is missing or empty; this database was not installed by nexgen-os' });
  }
  for (const scope of recorded.values()) report.applied[scope] = (report.applied[scope] ?? 0) + 1;

  if (await exists(db, 'nexgen.modules')) {
    report.modules = await db.query('select code, version, schema_name from nexgen.modules order by code');
  }
  const scopes = installedScopes(recorded.values());
  report.packs = scopes.packs;
  const registered = await registeredModules(db);
  for (const m of scopes.modules) {
    if (!registered.has(m)) problems.push({ code: 'module_unregistered', detail: `${m} is recorded as applied but has no row in nexgen.modules` });
  }

  const shipped = new Set([
    ...cat.core,
    ...[...cat.modules.values()].flat(),
    ...[...cat.packs.values()].flatMap((p) => p.steps),
  ].map((s) => s.name));
  const unknown = [...recorded.keys()].filter((n) => !shipped.has(n));
  if (unknown.length > 0) {
    problems.push({ code: 'unknown_migration', detail: `recorded but not shipped by this package (newer installer?): ${unknown.join(', ')}` });
  }
  const modules = [...new Set([...registered, ...scopes.modules])].filter((m) => cat.modules.has(m));
  const packs = scopes.packs.filter((p) => cat.packs.has(p));
  if (recorded.size > 0) {
    const pending = plan(cat, { modules, packs }, new Set(recorded.keys())).pending;
    if (pending.length > 0) {
      problems.push({ code: 'migrations_pending', detail: `${pending.length} to apply, run nexgen-os migrate: ${pending.map((s) => s.name).join(', ')}` });
    }
  }

  const schemas = ['nexgen', ...report.modules.map((m) => m.schema_name)];
  for (const t of await tablesWithoutRls(db, schemas)) {
    problems.push({ code: 'rls_disabled', detail: `${t} has no row level security` });
  }

  for (const t of await detachedModuleTables(db, report.modules.map((m) => m.schema_name))) {
    problems.push({ code: 'module_table_detached', detail: `${t} carries organisation_id and reaches no object of the core by a foreign key` });
  }

  for (const k of await unlinkedBillingKeys(db)) {
    problems.push({ code: 'billing_key_unlinked', detail: `${k.table_name} ${k.id}: Ekwo id ${k.ekwo_id} is no longer in Ekwo OS` });
  }

  const unpartitioned = await missingSeriesPartitions(db);
  if (unpartitioned.length > 0) {
    problems.push({
      code: 'series_partitions_missing',
      detail: `no weekly partition of series_values for the weeks starting ${unpartitioned.join(', ')}; select nexgen.series_values_partition('<date>') creates one, pg_partman keeps them`,
    });
  }

  for (const v of VOCABULARIES) {
    const n = await count(db, v);
    if (n === null) continue;
    report.vocabularies[v] = n;
  }
  for (const v of ['device_types', 'quantities', 'property_defs'] as const) {
    if (report.vocabularies[v] === 0) problems.push({ code: 'vocabulary_empty', detail: `nexgen.${v} has no row; the core seed did not run` });
  }
  return report;
}

export interface StatusReport {
  schemaVersion: string | null;
  modules: string[];
  packs: string[];
  counts: Record<'organisations' | 'sites' | 'buildings' | 'series', number | null>;
}

export async function status(db: SqlClient): Promise<StatusReport> {
  const recorded = await recordedSteps(db);
  return {
    schemaVersion: await databaseVersion(db),
    modules: [...(await registeredModules(db))],
    packs: installedScopes(recorded.values()).packs,
    counts: {
      organisations: await count(db, 'organisations'),
      sites: await count(db, 'sites'),
      buildings: await count(db, 'buildings'),
      series: await count(db, 'series'),
    },
  };
}

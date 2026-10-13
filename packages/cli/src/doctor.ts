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

/**
 * One way to apply a migration, used by `init`, by `migrate`
 * and by the test harness alike.
 *
 * Each file is applied in one transaction together with its record in
 * `nexgen.schema_migrations`, so a file that fails leaves neither a
 * half-applied schema nor a record that lies, and the next run resumes at
 * it. A dry run opens one transaction around everything and rolls it back.
 */
import { NexgenError } from './errors.js';
import { plan, readCatalogue, readStep, type Catalogue, type Selection, type Step } from './catalogue.js';
import { transaction, type SqlClient } from './sql.js';
import { checkFloor, databaseVersion } from './version.js';

/**
 * The record table, defined as the migration
 * `20261013000000_schema_version_0_3_0.sql` defines it. Created before the
 * first migration so that the core migrations before that one are recorded
 * too; `if not exists` makes the two one definition.
 */
export async function ensureHistory(db: SqlClient): Promise<void> {
  await db.exec(`
    create schema if not exists nexgen;
    create table if not exists nexgen.schema_migrations (
      name        text primary key,
      scope       text not null,
      applied_at  timestamptz not null default now(),
      constraint schema_migrations_scope_format check (scope ~ '^(core|module:[a-z0-9][a-z0-9_]*|pack:[a-z]{2})$')
    );
    alter table nexgen.schema_migrations enable row level security;
  `);
}

/** What is recorded, by name, with its scope. Empty when nothing is. */
export async function recordedSteps(db: SqlClient): Promise<Map<string, string>> {
  const [t] = await db.query<{ exists: boolean }>(`select to_regclass('nexgen.schema_migrations') is not null as exists`);
  if (!t?.exists) return new Map();
  const rows = await db.query<{ name: string; scope: string }>('select name, scope from nexgen.schema_migrations order by name');
  return new Map(rows.map((r) => [r.name, r.scope]));
}

/**
 * Applies one step and records it. The caller owns the transaction: the
 * file is sent whole, and no file of a release opens one of its own.
 */
export async function applyStep(db: SqlClient, catalogue: Catalogue, step: Step): Promise<void> {
  await db.exec(await readStep(catalogue, step));
  await db.query('insert into nexgen.schema_migrations (name, scope) values ($1, $2) on conflict (name) do nothing', [
    step.name,
    step.scope,
  ]);
}

/** Applies steps in order, each in its own transaction, or all in one rolled back (`dryRun`). */
export async function applyPlan(
  db: SqlClient,
  catalogue: Catalogue,
  steps: Step[],
  options: { dryRun?: boolean; onStep?: (step: Step) => void } = {},
): Promise<void> {
  if (options.dryRun) {
    await transaction(
      db,
      async () => {
        await ensureHistory(db);
        for (const step of steps) {
          await applyStep(db, catalogue, step);
          options.onStep?.(step);
        }
      },
      true,
    );
    return;
  }
  await transaction(db, () => ensureHistory(db));
  for (const step of steps) {
    await transaction(db, () => applyStep(db, catalogue, step));
    options.onStep?.(step);
  }
}

/** The version of PostGIS, or `null` when the extension is not installed. */
export async function postgisVersion(db: SqlClient): Promise<string | null> {
  const [row] = await db.query<{ v: string }>(`select extversion as v from pg_extension where extname = 'postgis'`);
  return row?.v ?? null;
}

export const POSTGIS_LINE = 'create extension if not exists postgis with schema extensions;';

export interface InstallOptions extends Partial<Selection> {
  /** Where the release's files are; the package's own by default. */
  root?: string;
  dryRun?: boolean;
  onStep?: (step: Step) => void;
}

export interface InstallReport {
  /** The schema version before the run (`null`: nothing to compare). */
  from: string | null;
  /** What was applied, or would have been on a dry run, in order. */
  applied: Step[];
  /** Steps of the selection already recorded, skipped. */
  skipped: number;
  dryRun: boolean;
}

/**
 * Installs the core, the modules and the packs asked for, skipping what is
 * recorded: `init`. Refuses without PostGIS, and below or above the floor.
 */
export async function install(db: SqlClient, options: InstallOptions = {}): Promise<InstallReport> {
  if ((await postgisVersion(db)) === null) {
    throw new NexgenError('postgis_required', `PostGIS is not installed; run this once in the SQL editor: ${POSTGIS_LINE}`);
  }
  const from = await databaseVersion(db);
  const refusal = checkFloor(from);
  if (refusal) throw refusal;
  const catalogue = await readCatalogue(options.root);
  const recorded = await recordedSteps(db);
  const selection: Selection = {
    modules: options.modules ?? [...catalogue.modules.keys()],
    packs: options.packs ?? [],
  };
  const p = plan(catalogue, selection, new Set(recorded.keys()));
  await applyPlan(db, catalogue, p.pending, { dryRun: options.dryRun, onStep: options.onStep });
  return { from, applied: p.pending, skipped: p.steps.length - p.pending.length, dryRun: options.dryRun ?? false };
}

/**
 * Brings an installation up to date: what is missing of the core and of the
 * modules and packs already installed, and nothing else: `migrate`.
 */
export async function migrate(
  db: SqlClient,
  options: Omit<InstallOptions, 'modules' | 'packs'> = {},
): Promise<InstallReport> {
  const from = await databaseVersion(db);
  const recorded = await recordedSteps(db);
  if (from === null && recorded.size === 0) {
    throw new NexgenError('not_installed', 'there is no Nexgen OS in this database; run nexgen-os init');
  }
  const scopes = new Set(recorded.values());
  const modules = await registeredModules(db);
  for (const s of scopes) if (s.startsWith('module:')) modules.add(s.slice('module:'.length));
  const catalogue = await readCatalogue(options.root);
  const unknown = [...modules].filter((m) => !catalogue.modules.has(m));
  if (unknown.length > 0) {
    throw new NexgenError('package_too_old', `the database has modules this package does not ship (${unknown.join(', ')}); run npx nexgen-os@latest migrate`);
  }
  const packs = [...scopes].filter((s) => s.startsWith('pack:')).map((s) => s.slice('pack:'.length));
  const unknownPacks = packs.filter((p) => !catalogue.packs.has(p));
  if (unknownPacks.length > 0) {
    throw new NexgenError('package_too_old', `the database has packs this package does not ship (${unknownPacks.join(', ')}); run npx nexgen-os@latest migrate`);
  }
  return install(db, { ...options, modules: [...modules].sort(), packs: packs.sort() });
}

/** The codes in `nexgen.modules`, empty when the table is not there. */
export async function registeredModules(db: SqlClient): Promise<Set<string>> {
  const [t] = await db.query<{ exists: boolean }>(`select to_regclass('nexgen.modules') is not null as exists`);
  if (!t?.exists) return new Set();
  const rows = await db.query<{ code: string }>('select code from nexgen.modules order by code');
  return new Set(rows.map((r) => r.code));
}

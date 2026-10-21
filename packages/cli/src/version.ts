/**
 * The versions this package is written against.
 *
 * `SCHEMA_VERSION` is what the migrations it carries bring a database to:
 * `nexgen_schema_version()` answers it once they are applied. `SCHEMA_MIN`
 * is the floor: the oldest database this package knows how to bring forward.
 * Both are declared in `package.json` under `nexgenOs` and repeated here;
 * `packages/cli/tests/version.test.ts` keeps them equal.
 */
import { NexgenError } from './errors.js';
import type { SqlClient } from './sql.js';

export const PACKAGE_VERSION = '0.1.0';
export const SCHEMA_VERSION = '0.3.0';
export const SCHEMA_MIN = '0.3.0';

/** Compares two `x.y.z` versions: negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface PackageVersions {
  schemaVersion: string;
  schemaMin: string;
}

const THIS_PACKAGE: PackageVersions = { schemaVersion: SCHEMA_VERSION, schemaMin: SCHEMA_MIN };

/**
 * Whether this package may work on a database at `database`.
 *
 * `null` is a database with no Nexgen OS in it, which `init` installs. A
 * database newer than the package is refused (`package_too_old`), as is one
 * below the floor (`database_too_old`): an older release of the installer
 * has to bring it forward first.
 */
export function checkFloor(database: string | null, pkg: PackageVersions = THIS_PACKAGE): NexgenError | null {
  if (database === null) return null;
  if (compareVersions(database, pkg.schemaVersion) > 0) {
    return new NexgenError(
      'package_too_old',
      `the database is at ${database} and this package at ${pkg.schemaVersion}; run npx nexgen-os@latest`,
    );
  }
  if (compareVersions(database, pkg.schemaMin) < 0) {
    return new NexgenError(
      'database_too_old',
      `run nexgen-os migrate of version ${pkg.schemaMin} first (npx nexgen-os@${pkg.schemaMin} migrate): the database is at ${database}, below this package's floor ${pkg.schemaMin}`,
    );
  }
  return null;
}

/**
 * The schema version of the database. `null` when there is nothing to
 * compare: Nexgen OS is not installed, or an install by this installer
 * stopped before the version migration (it has `schema_migrations`, and the
 * next run resumes it). `0.0.0` when a core is there that no installer
 * recorded: it predates the version function.
 */
export async function databaseVersion(db: SqlClient): Promise<string | null> {
  const [row] = await db.query<{ installed: boolean; versioned: boolean; recorded: boolean }>(
    `select to_regclass('nexgen.organisations') is not null as installed,
            to_regprocedure('nexgen.nexgen_schema_version()') is not null as versioned,
            to_regclass('nexgen.schema_migrations') is not null as recorded`,
  );
  if (!row?.installed) return null;
  if (!row.versioned) return row.recorded ? null : '0.0.0';
  const [v] = await db.query<{ v: string }>('select nexgen.nexgen_schema_version() as v');
  return v?.v ?? null;
}

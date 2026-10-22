/**
 * Versions of the schema, compared — once, for the installer and for every
 * surface that refuses a database older than itself (decision 0040).
 */
import type { Db } from './db.js';
import { GestureError } from './refusal.js';

/** Compares two dotted versions: negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The schema version of the database, refused by name when it is older than `floor`. */
export async function nexgenSchemaFloor(db: Db, floor: string): Promise<string> {
  const { rows } = await db.query<{ v: string }>('select nexgen.nexgen_schema_version() as v');
  const version = rows[0]?.v;
  if (version === undefined || compareVersions(version, floor) < 0) {
    throw new GestureError(`schema_too_old: this database is at ${version ?? 'no version'} and this surface needs ${floor} or newer. Run npx nexgen-os migrate against it.`);
  }
  return version;
}

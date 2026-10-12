import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..');

async function sqlFiles(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(names.map((n) => readFile(join(dir, n), 'utf8')));
}

/**
 * A database built the way an installation is: the Supabase shim (test only),
 * every core migration in order, the core vocabularies, then the modules
 * asked for (each one's migrations in order).
 */
export async function freshDatabase(modules: string[] = []): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { postgis } });
  await db.exec(await readFile(join(here, 'supabase-shim.sql'), 'utf8'));
  for (const sql of await sqlFiles(join(repoRoot, 'supabase', 'migrations'))) await db.exec(sql);
  for (const sql of await sqlFiles(join(repoRoot, 'supabase', 'seed'))) await db.exec(sql);
  for (const m of modules) {
    for (const sql of await sqlFiles(join(repoRoot, 'modules', m, 'migrations'))) await db.exec(sql);
  }
  return db;
}

/** Runs `fn` as a signed-in user, under row level security, then returns to the superuser. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.exec(`set request.jwt.claims = ''`);
  }
}

/** First row of a query, typed. */
export async function one<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  if (r.rows.length === 0) throw new Error(`no row: ${sql}`);
  return r.rows[0];
}

const GEOMETRY_COLUMNS = new Set(['geometry', 'footprint']);

/** Inserts a row in a table and returns its id. GeoJSON goes through ST_GeomFromGeoJSON. */
export async function insert(db: PGlite, table: string, fields: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(fields);
  const vals = cols.map((c, i) => (GEOMETRY_COLUMNS.has(c) ? `ST_GeomFromGeoJSON($${i + 1})` : `$${i + 1}`));
  const params = cols.map((c) => (GEOMETRY_COLUMNS.has(c) ? JSON.stringify(fields[c]) : fields[c]));
  const r = await one<{ id: string }>(
    db,
    `insert into ${table} (${cols.join(', ')}) values (${vals.join(', ')}) returning id`,
    params,
  );
  return r.id;
}

export const USER_A = '00000000-0000-4000-8000-00000000000a';
export const USER_B = '00000000-0000-4000-8000-00000000000b';

/** An organisation owned by `userId`. */
export async function organisation(db: PGlite, name: string, userId = USER_A): Promise<string> {
  await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [userId]);
  const org = await one<{ id: string }>(db, 'insert into organisations (name) values ($1) returning id', [name]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'owner')`, [org.id, userId]);
  return org.id;
}

/** A square footprint of `w` × `h` metres with its south-west corner at (lon, lat), as GeoJSON. */
export function square(lon: number, lat: number, w: number, h: number, z?: number) {
  const dLon = (m: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dLat = (m: number) => m / 111_320;
  const p = (x: number, y: number) => (z === undefined ? [x, y] : [x, y, z]);
  return {
    type: 'Polygon',
    coordinates: [[
      p(lon, lat), p(lon + dLon(w), lat), p(lon + dLon(w), lat + dLat(h)), p(lon, lat + dLat(h)), p(lon, lat),
    ]],
  };
}

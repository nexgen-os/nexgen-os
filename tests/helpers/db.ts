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
 * every core migration in order, then the core vocabularies.
 */
export async function freshDatabase(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { postgis } });
  await db.exec(await readFile(join(here, 'supabase-shim.sql'), 'utf8'));
  for (const sql of await sqlFiles(join(repoRoot, 'supabase', 'migrations'))) await db.exec(sql);
  for (const sql of await sqlFiles(join(repoRoot, 'supabase', 'seed'))) await db.exec(sql);
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

/** Inserts an entity and returns its id. */
export async function entity(
  db: PGlite,
  fields: Record<string, unknown> & { workspace_id: string; class: string; name: string },
): Promise<string> {
  const cols = Object.keys(fields);
  const vals = cols.map((c, i) => (c === 'geometry' ? `ST_GeomFromGeoJSON($${i + 1})` : `$${i + 1}`));
  const params = cols.map((c) => (c === 'geometry' ? JSON.stringify(fields[c]) : fields[c]));
  const r = await one<{ id: string }>(
    db,
    `insert into entities (${cols.join(', ')}) values (${vals.join(', ')}) returning id`,
    params,
  );
  return r.id;
}

export const USER_A = '00000000-0000-4000-8000-00000000000a';
export const USER_B = '00000000-0000-4000-8000-00000000000b';

/** A workspace owned by `userId`. */
export async function workspace(db: PGlite, name: string, userId = USER_A): Promise<string> {
  await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [userId]);
  const ws = await one<{ id: string }>(db, 'insert into workspaces (name) values ($1) returning id', [name]);
  await db.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [ws.id, userId]);
  return ws.id;
}

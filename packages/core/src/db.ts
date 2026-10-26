/**
 * The one thing a library needs from a database driver: a query with
 * positional parameters that answers with rows. PGlite, node-postgres and
 * postgres.js all fit it with a one-line adapter. The connection has `nexgen`
 * on its search path.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Runs `fn` so that what it writes lands whole or not at all. Inside the
 * caller's transaction it holds a savepoint, released when `fn` returns and
 * rolled back to when it throws, so the caller's transaction goes on; outside
 * of one it is a transaction of its own. The throw is re-thrown either way.
 * As everywhere in the core, the `Db` is one connection.
 */
export async function atomically<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  let own = false;
  try {
    await db.query('savepoint nexgen_atomically');
  } catch (error) {
    // 25P01, no_active_sql_transaction: there is no transaction to nest in.
    if ((error as { code?: unknown })?.code !== '25P01') throw error;
    await db.query('begin');
    own = true;
  }
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    await db.query(own ? 'rollback' : 'rollback to savepoint nexgen_atomically');
    if (!own) await db.query('release savepoint nexgen_atomically');
    throw error;
  }
  await db.query(own ? 'commit' : 'release savepoint nexgen_atomically');
  return result;
}

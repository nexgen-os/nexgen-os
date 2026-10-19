/**
 * The one thing a library needs from a database driver: a query with
 * positional parameters that answers with rows. PGlite, node-postgres and
 * postgres.js all fit it with a one-line adapter. The connection has `nexgen`
 * on its search path.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

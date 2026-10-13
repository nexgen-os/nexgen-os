/**
 * The only way the installer talks to Postgres.
 *
 * Everything is written against `SqlClient`, so the same engine runs on a
 * Supabase project through node-postgres and on PGlite in the tests. One
 * connection, no pool: a transaction is `begin` and `commit` on it.
 */
export interface SqlClient {
  /** Multi-statement SQL with no parameters, sent as one command string. */
  exec(sql: string): Promise<void>;
  /** One parameterised statement (`$1`, `$2`, …), returning its rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Closes the connection. */
  close(): Promise<void>;
}

/** Runs `fn` inside a transaction on `db`; a throw rolls it back and is re-thrown. */
export async function transaction<T>(db: SqlClient, fn: () => Promise<T>, rollback = false): Promise<T> {
  await db.exec('begin');
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
  await db.exec(rollback ? 'rollback' : 'commit');
  return result;
}

export interface ConnectOptions {
  /** PEM of the certificate authority to verify the server against (Supabase's, for one). */
  ca?: string;
}

const LOCAL = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Connects with node-postgres, imported lazily so that the tests and
 * `--help` never load a network driver.
 *
 * A remote host without `sslmode` in the URL is reached over TLS; the
 * certificate is verified when a certificate authority is given (`--ca`),
 * and only encrypted otherwise, which is what Supabase's poolers accept
 * without their root certificate.
 */
export async function connect(url: string, options: ConnectOptions = {}): Promise<SqlClient> {
  const { default: pg } = await import('pg');
  const parsed = new URL(url);
  const explicit = parsed.searchParams.has('sslmode');
  const ssl = explicit
    ? undefined
    : options.ca !== undefined
      ? { ca: options.ca, rejectUnauthorized: true }
      : LOCAL.has(parsed.hostname)
        ? undefined
        : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url, ssl, application_name: 'nexgen-os' });
  await client.connect();
  return {
    async exec(sql) {
      await client.query(sql);
    },
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await client.query(sql, params);
      return r.rows as T[];
    },
    async close() {
      await client.end();
    },
  };
}

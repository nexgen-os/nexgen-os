/**
 * One connection, and every transaction on it acting as somebody.
 *
 * The MCP server and the command line reach the database through one
 * connection (decision 0046). A connection is nobody: run as it is, it would
 * bypass row level security rather than satisfy it. So every gesture runs in
 * a transaction that first says who it acts as — the person a key was issued
 * by (`use_api_key()`), or a person named by their user id — then takes the
 * `authenticated` role. The policies bind exactly as for that person.
 *
 * A session that may not write makes its transactions read only, so a write
 * is refused by the database, whatever tool asked for it.
 */
import type { Db } from './db.js';
import { explain } from './refusal.js';
import type { SqlClient } from './sql.js';

/** Who the transactions act as. */
export type Acting = { kind: 'user'; userId: string } | { kind: 'key'; secret: string };

export interface Session {
  /** What the transactions act as, for a status line: a user id, or the prefix of a key. */
  readonly actingAs: string;
  /** Whether this session may write. A key without `write` reads, whatever this says. */
  readonly writable: boolean;
  /** Runs `fn` in one transaction acting as the person; a throw rolls back, and a refusal of the database comes out explained. */
  run<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The prefix of a key (`ngk_<prefix>_…`), which names it without being it. */
export function keyPrefix(secret: string): string {
  return /^ngk_([0-9a-z]+)_/.exec(secret)?.[1] ?? 'unknown';
}

export function personSession(client: SqlClient, acting: Acting, options: { writable: boolean }): Session {
  if (acting.kind === 'user' && !UUID.test(acting.userId)) {
    throw explain(new Error(`bad_act_as_user: ${acting.userId} is not the auth.users id of a person, as a uuid`));
  }
  const db: Db = { query: async (sql, params) => ({ rows: await client.query(sql, params) }) };
  // One transaction at a time on one connection.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    actingAs: acting.kind === 'user' ? acting.userId : `key ${keyPrefix(acting.secret)}`,
    writable: options.writable,
    run<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      const next = queue.then(async () => {
        await client.exec('begin');
        try {
          if (acting.kind === 'key') {
            await client.query('select * from nexgen.use_api_key($1)', [acting.secret]);
          } else {
            await client.query(`select set_config('request.jwt.claims', $1, true)`,
              [JSON.stringify({ sub: acting.userId, role: 'authenticated' })]);
          }
          if (!options.writable) await client.exec('set local transaction_read_only = on');
          await client.exec('set local role authenticated; set local search_path = nexgen, extensions, public');
          const result = await fn(db);
          await client.exec('commit');
          return result;
        } catch (error) {
          await client.exec('rollback').catch(() => {});
          // What the database said is explained; anything else — a usage
          // error of the surface, a refusal of a gesture — goes on as it is.
          const sqlstate = (error as { code?: unknown })?.code;
          throw typeof sqlstate === 'string' && /^[0-9A-Z]{5}$/.test(sqlstate) ? explain(error) : error;
        }
      });
      queue = next.catch(() => {});
      return next;
    },
    close: () => client.close(),
  };
}

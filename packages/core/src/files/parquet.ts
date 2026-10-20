/**
 * Series as a Parquet file, the files door of the series
 * ([0014](../../../../docs/decisions/0014-integrations-dashboards-warehouses-streams.md)).
 *
 * The rows are those of `export_rows()`, under the caller's rights. Where
 * the database has `pg_parquet` or `pg_duckdb` and the caller names a path
 * the server can write to (a bucket, a mounted disk), the server writes the
 * file itself and nothing travels through the client; the extensions are
 * detected, never required. Otherwise the rows are read here and written by
 * the writer the caller gives: `writeSeriesParquet()` of
 * `@nexgen-os/parquet`.
 */
import type { Db } from '../db.js';
import { exportRows, type ExportRow } from '../series.js';

/** The server extension that writes Parquet, when the database has one. */
export async function serverParquetWriter(db: Db): Promise<'pg_parquet' | 'pg_duckdb' | null> {
  const r = await db.query<{ extname: 'pg_parquet' | 'pg_duckdb' }>(
    `select extname from pg_extension where extname in ('pg_parquet', 'pg_duckdb') order by extname = 'pg_parquet' desc limit 1`);
  return r.rows[0]?.extname ?? null;
}

export type ParquetExport =
  | { written: 'client'; bytes: Uint8Array; rows: number }
  | { written: 'server'; writer: 'pg_parquet' | 'pg_duckdb'; path: string };

/**
 * Series between two instants as a Parquet file. With `serverPath` and a
 * server extension, the database writes the file at that path; otherwise
 * the rows are read through `export_rows()` and given to `write`. Either
 * way the caller's rights apply: `export_rows()` refuses a series the
 * caller may not read.
 */
export async function exportSeriesParquet(
  db: Db,
  request: { seriesIds: string[]; from: string; to: string; serverPath?: string; write: (rows: ExportRow[]) => Uint8Array },
): Promise<ParquetExport> {
  const writer = request.serverPath ? await serverParquetWriter(db) : null;
  if (writer && request.serverPath) {
    // COPY takes no parameters: the statement is built by the server, every
    // value quoted as a literal.
    const option = writer === 'pg_parquet' ? `with (format 'parquet')` : `(format parquet)`;
    const statement = await db.query<{ sql: string }>(
      `select format('copy (select * from nexgen.export_rows(%L::uuid[], %L::timestamptz, %L::timestamptz)) to %L ' || $5,
                     $1::uuid[], $2::text, $3::text, $4::text) as sql`,
      [request.seriesIds, request.from, request.to, request.serverPath, option]);
    await db.query(statement.rows[0].sql);
    return { written: 'server', writer, path: request.serverPath };
  }
  const rows = await exportRows(db, request.seriesIds, request.from, request.to);
  return { written: 'client', bytes: request.write(rows), rows: rows.length };
}

// Parquet ⇄ the files door of Nexgen OS (decision 0014).
//
// A file of series has one schema: the series, the instant in UTC, the
// value in the unit of the series' quantity, and the quality code, sorted
// by series and time — the rows of `export_rows()`. This library writes
// them as a Parquet file on the client, with Hyparquet Writer (MIT, pure
// JavaScript), so that it works on every host. Where the database has
// `pg_parquet` or `pg_duckdb` and the caller names a path the server can
// write to (a bucket, a mounted disk), the server writes the file itself
// and nothing travels through the client; the extensions are detected,
// never required.
//
// SPDX-License-Identifier: MIT

import { parquetWriteBuffer } from 'hyparquet-writer';
import type { Db } from '@nexgen-os/core';
import { exportRows } from '@nexgen-os/core';

export type { Db };

/** One row of the files door. */
export interface SeriesRow {
  series_id: string;
  at: string | Date;
  value: number;
  quality: number;
}

/** The columns of a series file, in order, with their Parquet types. */
export const SERIES_FILE_COLUMNS = [
  { name: 'series_id', type: 'UUID', description: 'The series (series.id).' },
  { name: 'at', type: 'TIMESTAMP', description: 'Start of the interval, or the instant, in UTC (milliseconds).' },
  { name: 'value', type: 'DOUBLE', description: 'In the unit of the series quantity (quantities.unit).' },
  { name: 'quality', type: 'INT32', description: 'A code of series_quality_codes: 0 measured, 1 estimated, 2 substituted, 3 missing.' },
] as const;

/** The version of the schema, written in the file's key-value metadata. */
export const SERIES_FILE_SCHEMA = 'nexgen-os.series.1';

/** The rows as a Parquet file, in memory. The rows are written in the order given. */
export function writeSeriesParquet(rows: SeriesRow[]): Uint8Array {
  const buffer = parquetWriteBuffer({
    columnData: [
      { name: 'series_id', data: rows.map((r) => r.series_id), type: 'UUID', nullable: false },
      { name: 'at', data: rows.map((r) => new Date(r.at)), type: 'TIMESTAMP', nullable: false },
      { name: 'value', data: rows.map((r) => r.value), type: 'DOUBLE', nullable: false },
      { name: 'quality', data: rows.map((r) => r.quality), type: 'INT32', nullable: false },
    ],
    kvMetadata: [{ key: 'schema', value: SERIES_FILE_SCHEMA }],
  });
  return new Uint8Array(buffer);
}

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
 * the rows are read through `export_rows()` and the file is written here.
 * Either way the caller's rights apply: `export_rows()` refuses a series
 * the caller may not read.
 */
export async function exportSeriesParquet(
  db: Db,
  request: { seriesIds: string[]; from: string; to: string; serverPath?: string },
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
  return { written: 'client', bytes: writeSeriesParquet(rows), rows: rows.length };
}

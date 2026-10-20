// Series rows → Parquet.
//
// A file of series has one schema: the series, the instant in UTC, the
// value in the unit of the series' quantity, and the quality code, sorted
// by series and time. This library writes such rows as a Parquet file in
// memory, with Hyparquet Writer (MIT, pure JavaScript), so that it works on
// every host. It imports nothing else, opens no connection and calls no
// network: which rows go in is the caller's.
//
// SPDX-License-Identifier: MIT

import { parquetWriteBuffer } from 'hyparquet-writer';

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

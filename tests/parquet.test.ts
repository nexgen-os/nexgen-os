// A small series written as a Parquet file on the client — the rows of
// export_rows() read by the core, the file written by packages/formats/parquet —
// read back with an independent reader, row for row;
// no server extension on PGlite, so the client writes even when a server
// path is named.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import { USER_A, freshDatabase, organisation, participant } from './helpers/db.js';
import { exportSeriesParquet, serverParquetWriter, store } from '@nexgen-os/core';
import { SERIES_FILE_SCHEMA, writeSeriesParquet } from '@nexgen-os/parquet';

let db: PGlite;
let series: string;

beforeAll(async () => {
  db = await freshDatabase();
  const org = await organisation(db, 'A utility', USER_A);
  const home = await participant(db, { organisation_id: org, name: 'Depot', country: 'BE', time_zone: 'Europe/Brussels' });
  series = (await store(db, { object_kind: 'participant', object_id: home, quantity_code: 'offtake_energy', step: '15 minutes' }, [
    { at: '2026-05-04T08:00:00Z', value: 0.25 },
    { at: '2026-05-04T08:15:00Z', value: 0.5, quality: 1 },
    { at: '2026-05-04T08:30:00Z', value: 0, quality: 3 },
  ])).seriesId;
});

afterAll(async () => {
  await db.close();
});

describe('a series as a Parquet file', () => {
  it('is written on the client from export_rows() and reads back row for row', async () => {
    expect(await serverParquetWriter(db)).toBeNull();
    const file = await exportSeriesParquet(db, { seriesIds: [series], from: '2026-05-04T00:00:00Z', to: '2026-05-05T00:00:00Z', serverPath: '/tmp/never.parquet', write: writeSeriesParquet });
    if (file.written !== 'client') throw new Error('expected a client-side file');
    expect(file.rows).toBe(3);
    const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
    const metadata = parquetMetadata(buffer);
    expect(metadata.key_value_metadata).toContainEqual({ key: 'schema', value: SERIES_FILE_SCHEMA });
    const rows = await parquetReadObjects({ file: buffer });
    expect(rows.map((r) => [r.series_id, new Date(r.at as Date).toISOString(), r.value, r.quality])).toEqual([
      [series, '2026-05-04T08:00:00.000Z', 0.25, 0],
      [series, '2026-05-04T08:15:00.000Z', 0.5, 1],
      [series, '2026-05-04T08:30:00.000Z', 0, 3],
    ]);
  });
});

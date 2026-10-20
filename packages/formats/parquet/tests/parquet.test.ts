// Series rows written as a Parquet file with no database, and read back with
// an independent reader: the four columns of the schema, row for row.
import { describe, expect, it } from 'vitest';
import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import { SERIES_FILE_COLUMNS, SERIES_FILE_SCHEMA, writeSeriesParquet } from '@nexgen-os/parquet';

const SERIES = '00000000-0000-4000-8000-000000000001';

describe('a Parquet file of series rows', () => {
  it('holds the four columns, the schema version and the rows in the order given', async () => {
    const bytes = writeSeriesParquet([
      { series_id: SERIES, at: '2026-05-04T08:00:00Z', value: 0.25, quality: 0 },
      { series_id: SERIES, at: new Date('2026-05-04T08:15:00Z'), value: 0.5, quality: 1 },
    ]);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const metadata = parquetMetadata(buffer);
    expect(metadata.key_value_metadata).toContainEqual({ key: 'schema', value: SERIES_FILE_SCHEMA });
    expect(metadata.schema.slice(1).map((c) => c.name)).toEqual(SERIES_FILE_COLUMNS.map((c) => c.name));
    const rows = await parquetReadObjects({ file: buffer });
    expect(rows.map((r) => [r.series_id, new Date(r.at as Date).toISOString(), r.value, r.quality])).toEqual([
      [SERIES, '2026-05-04T08:00:00.000Z', 0.25, 0],
      [SERIES, '2026-05-04T08:15:00.000Z', 0.5, 1],
    ]);
  });

  it('writes an empty file for no rows', async () => {
    const bytes = writeSeriesParquet([]);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(await parquetReadObjects({ file: buffer })).toEqual([]);
  });
});

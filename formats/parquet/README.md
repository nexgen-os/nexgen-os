# `@nexgen-os/parquet` — series ⇄ Parquet

Writes the series of an installation as Parquet files, the files door of
[decision 0014](../../docs/decisions/0014-integrations-dashboards-warehouses-streams.md):
one schema, read as it is by DuckDB, pandas, Polars, Spark, InfluxDB 3 or a
data lake. MIT, like every format library; `writeSeriesParquet()` needs no
database.

| Column | Parquet type | Meaning |
|---|---|---|
| `series_id` | `FIXED_LEN_BYTE_ARRAY(16)`, logical `UUID` | the series (`series.id`) |
| `at` | `INT64`, `TIMESTAMP_MILLIS`, UTC | start of the interval, or the instant |
| `value` | `DOUBLE` | in the unit of the series' quantity |
| `quality` | `INT32` | 0 measured, 1 estimated, 2 substituted, 3 missing; 100 and up a pack's codes |

Rows are sorted by series and time, the order of `export_rows()`; the
file's key-value metadata says `schema = nexgen-os.series.1`.

```ts
import { exportSeriesParquet, writeSeriesParquet } from './formats/parquet/index.js';

// On the client, from export_rows(), on any host.
const file = await exportSeriesParquet(db, { seriesIds, from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' });
if (file.written === 'client') await writeFile('meters-2026.parquet', file.bytes);

// By the server, when it has pg_parquet or pg_duckdb and a path it can write.
await exportSeriesParquet(db, { seriesIds, from, to, serverPath: 's3://bucket/meters-2026.parquet' });
```

`exportSeriesParquet()` writes on the client unless the caller names a
`serverPath` and the database has `pg_parquet` (preferred) or `pg_duckdb`;
it detects them in `pg_extension` and never requires them. The caller's
rights apply either way: `export_rows()` refuses by name a series the
caller may not read (`series_not_found`).

A Parquet file read back into an installation goes through `store()`, the
one write path, with its provenance.

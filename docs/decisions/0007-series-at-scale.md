# 0007 — Series at scale: plain Postgres, partitioned, one read API

**Decided 12/10/2026.** Research: [docs/research/time-series-scale.md](../research/time-series-scale.md).

## Context

Nexgen holds 11.9 million quarter-hour rows for about 1,200 meters. The
core must hold a hundred thousand meters and sensors at 15-minute to
1-minute resolution — tens of millions of rows a day, years of retention —
on Supabase, on AWS, on Azure or on a bare Postgres, without a feature that
exists on one of them only.

TimescaleDB would be the easy answer and is the wrong one: everything that
matters at scale (compression, continuous aggregates, retention) is under
its own licence, and the Apache subset is all that Supabase (dropped with
Postgres 17), AWS RDS (never offered), Neon, Azure and Crunchy install. An
open-source core that needed it would run on self-managed Postgres only.

## Decision

Plain Postgres, in three stages, behind one unchanged read API.

### Now (0.1)

- `series_values` is **partitioned by range on `at`**, weekly. The core
  ships the partitioned table and a default partition, so that it works
  anywhere; an installation adds pg_partman and pg_cron
  (`partman.create_parent(... p_interval := '7 days')`) and the default
  partition empties itself into real ones. Weekly from day one: pg_partman
  cannot change an interval without a rebuild, and a weekly partition at
  today's volume costs nothing.
- The hot table carries **no `organisation_id`**: row level security goes
  through `series` (`series_id in (select id from series where …)`), a hashed
  subplan built once per statement, and `resample()` is `security definer`,
  checks the caller's access to the one `series` row, then reads the values
  without a per-row policy.
- **`quality` is a `smallint`** against a code table (`0` good, `1`
  estimated, `2` substituted, `3` missing): two bytes instead of a varlena,
  and still a word in every query through the join.
- `value` stays `double precision`: a register of 1,234,567.891 kWh does not
  survive `real`, and exact decimals belong to invoicing.
- The primary key `(series_id, at)` is the one B-tree; a **BRIN on `at`**
  serves the rollup and export jobs.
- `at` is the **start** of the interval for `interval` series.
- **Time zones**: `resample()` bins steps shorter than a day with `date_bin`
  on a UTC origin, which is safe across daylight-saving changes; steps of a
  day or more use `date_trunc(unit, at, time_zone)` with the time zone of
  the object's site, never a constant. A site without a time zone cannot be
  resampled by day: `time_zone_required`, named, rather than a silent UTC.
- Ingestion goes through an unlogged staging table, sorted by
  `(series_id, at)`, then `insert … on conflict do update … where distinct`.

### Next (1.0)

- Hourly and daily **rollups** (`series_rollups`: n_points, n_expected,
  sum, avg, min, max, first, last, last_reset_at, worst quality), refreshed
  by pg_cron with a dirty-bucket table fed by ingestion — Home Assistant's
  statistics layer, in Postgres.
- `resample()` routes by step: raw below an hour, the hourly rollup up to a
  day, the daily rollup beyond, falling back to the finer source when a
  bucket is stale. The signature does not change.
- **Retention** is a pack parameter (`raw_retention`), explicit at install;
  rollups stay. Legal floors and ceilings differ by country and even region
  (Germany's three years, Brussels' five, the CNIL's notices in France), so
  no number lives in the core.

### Cloud tier

- A detached weekly partition becomes one Parquet file on object storage
  (sorted, zstd, 2–4 bytes per point), read back through the platform's
  reader (Iceberg wrapper on Supabase, `pg_parquet` or `pg_duckdb`
  elsewhere, DuckDB in a worker everywhere). `resample()` gains the branch;
  nothing else does.
- TimescaleDB's columnstore may accelerate a self-hosted installation when
  detected (`timescaledb.license = 'timescale'`), never as a requirement.

## Consequences

- At the target (50 million rows a day): about 1.9 TB a year hot,
  uncompressed, 400 GB of hourly rollups, 17 GB of daily ones, 40–70 GB a
  year cold. Today's 11.9 million rows weigh 1.4 GB and notice nothing.
- Every piece is available on Supabase, RDS, Crunchy, Azure and bare
  Postgres today.
- The read API is one function; pages and modules never learn where a value
  came from.

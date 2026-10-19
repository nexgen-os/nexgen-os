# Audit — the time-series package of the core

Date: 2026-10-19. Scope: how Nexgen OS stores, writes and reads values over
time, at commit `38f4c32`; what the open-source world offers on managed
Postgres; the series package the core should ship. Builds on
[decision 0007](../decisions/0007-series-at-scale.md) and its research notes
([time-series-scale.md](time-series-scale.md), 2026-10-12), which it does not
repeat: storage sizing, retention law and the TimescaleDB licence history are
there.

Every count below was taken with `grep`, `wc` or `awk` on the files named
next to it.

---

## 1. The current implementation

### 1.1 Tables

All in `supabase/migrations/20261012200600_core_series.sql` (322 lines). No
later core migration touches series: `forecast_values`, the partitions and
the quality codes are in that same file.

| Table | Columns | Keys and indexes | Role |
|---|---|---|---|
| `series` | 13: `id`, `organisation_id`, `object_id`, `quantity_code`, `sensor_id`, `name`, `kind`, `value_kind`, `step`, `scenario_id`, `source_code`, `source`, `created_at` | PK `id`; `series_object_idx (object_id)`; `series_quantity_idx (quantity_code)` | one quantity over time for one object (SensorThings Datastream, Brick point) |
| `series_quality_codes` | 2: `code smallint`, `name` | PK `code`; 4 rows: 0 measured, 1 estimated, 2 substituted, 3 missing | quality vocabulary |
| `series_values` | 4: `series_id uuid`, `at timestamptz`, `value float8`, `quality smallint` | PK `(series_id, at)`; BRIN on `at` (`pages_per_range = 32`); `partition by range (at)` | the hot table |
| `series_values_default` | — | default partition | where every row lands until weekly partitions exist |
| `forecast_values` | 4: `series_id`, `at`, `issued_at`, `value` | PK `(series_id, at, issued_at)`; BRIN on `at`; not partitioned | every issue of a forecast |

Vocabulary around it (`supabase/migrations/20261012200100_core_vocabularies.sql:112`):
`quantities` (7 columns: `code`, `name`, `unit`, `aggregation`
∈ {sum, mean, last}, `qudt_quantity_kind`, `description`, `published_by`).
The unit is a QUDT code on the quantity; no value and no series carries a
unit. Seeded: 20 quantities in `supabase/seed/0001_core_vocabularies.sql:69`,
6 more by the solar module (`ghi`, `dni`, `dhi`, `poa_irradiance`,
`module_temperature` in `modules/solar/migrations/0001_solar.sql:493`,
`wind_speed` in `0002_wind_speed.sql:10`). There is no `units` table and no
`value_kinds` table: value kinds are a check constraint on `series`.

`series` columns `kind` ∈ {measured, simulated, forecast, setpoint} and
`value_kind` ∈ {interval, instant, cumulative} are check constraints; `step`
is a Postgres `interval`, null when irregular.

### 1.2 How a series is attached to an object

- `series.object_id` references `objects(id)`: any kind of object (site,
  meter, device, building, participant, a module's weather point).
- The trigger `series_attach` (`attach('object_id')`,
  `20261012200500_core_attachments.sql:19`) copies the object's
  organisation onto the series and refuses a series outside its object's
  scenario (`attachment_outside_object_scenario`).
- `sensor_id` optionally names the point that produces the values
  (`sensors`, `20261012200400_core_devices.sql:179`), whose own `host_id` is
  again an object. The series thus has two paths to "what it is about"
  (`object_id`, and `sensor_id → host_id`) that nothing keeps consistent.
- A series has no identity beyond its uuid: no unique constraint on
  (object, quantity, kind, source, scenario, name).

### 1.3 Functions

| Function | Lines | Contract | Note |
|---|---|---|---|
| `series_values_partition(date) → text` | 98–117 | creates the ISO-week partition holding a date, moves that week out of the default partition | bounds are written as dates and read in the session `TimeZone`; correct only when the session is UTC (Supabase's default) |
| `series_store_check()` (trigger) | 149–165 | a forecast's values go to `forecast_values`, every other kind to `series_values`: `forecast_values_required`, `not_a_forecast` | `for each row`: one lookup of `series` per inserted row |
| `series_time_zone(uuid) → text` | 178–188 | the time zone of the site of the series' object (`site_of`), null otherwise | a series on a weather point has no site, hence no time zone |
| `resample(series, from, to, step, time_zone?, issued_before?)` | 197–286 | one series on a regular step; `sum`/`mean`/`last` from the quantity; a cumulative gives its last index per bucket; missing (quality 3) excluded; `samples` per bucket | `security definer`; sub-day steps `date_bin` on a UTC origin, a day or more `date_trunc(unit, at, tz)` |

Row level security: `series` through `secure_table`; `series_values` and
`forecast_values` through `series_id in (select id from series where
can_read_organisation(…))`; `authenticated` holds `insert, update, delete` on
both value tables (lines 305, 315).

Tests: `tests/series.test.ts` (110 lines, 6 cases: short and long DST day,
`time_zone_required`, partition move, organisation isolation, missing values
out of aggregates).

### 1.4 Writers and readers today

| Code | Writes | Reads | How |
|---|---|---|---|
| `connectors/index.ts:116` `storeSeries()` | series + values | — | find-or-create by (object, quantity, kind, source, scenario, name) without lock; one `insert … select unnest(...)` per batch; `on conflict do update set value, quality = 0` |
| `modules/solar/yield.ts` (275, 368, 521, 527) | `simulated` hourly production on the PV system, temperature on the site | weather from the connector, not from the database (`weather.history`, line 317) | `storeSeries` then `record_run` with `series_id` in the results |
| `modules/solar/performance.ts:197`, `exceedance.ts:65` | — | `resample(..., '1 hour')` | the one read |
| `formats/weather-files/index.ts:380` | EPW / TMY3 as `simulated` series | `exportEpw` through `resample` | `storeSeries` |
| `formats/homeassistant/index.ts:224–236` | recorder `states` | `exportHomeAssistant` reads `series_values` directly | one `insert` per state, outside `storeSeries`; unknown units published as new quantities `ha_<class>_<unit>`; 14 hard-coded unit factors (lines 95–110) |
| `sdk/python/nexgen_os/client.py:88` | — | `resample` → list of dataclasses | only dependency `psycopg>=3.1` (`sdk/python/pyproject.toml`) |
| `modules/weather/migrations/0001_weather.sql:133` | — | — | declares `weather.points` as an object with no parent: its series have no site, no time zone |

For comparison, the product this core comes from stores quarter-hours in a
wide table, one row per participant and instant with one column per
direction (consumption, injection, production) and a status, written by one
function per column choice; it computes hours, typical years and profiles in
33 functions whose names contain `hourly`, `reading`, `curve`, `profile` or
`typical` (counted in its migrations on 2026-10-19). The core's narrow
`series_values` is the factored form of that table; those 33 functions are
what a series package has to make unnecessary.

### 1.5 What is sound and stays

- One narrow hot table, `(series_id, at, value, quality)`, no organisation on
  it, quality on two bytes, `float8`, PK `(series_id, at)`: the layout every
  reference system converges on (research notes §1).
- Weekly range partitions with a default partition, so that the schema works
  without any extension and pg_partman takes over when present.
- `at` is the start of the interval; measured, simulated, forecast and
  setpoint share one shape; forecasts keep every issue.
- Days and months cut in the site's time zone, refused by name without one.
- One read function, `security definer`, access checked once.

### 1.6 Defects found

| # | Defect | Where | Consequence |
|---|---|---|---|
| D1 | A run's series is overwritten by the next run with the same identity: `storeSeries` finds the series by (object, quantity, kind, source, scenario, name) and upserts its values | `yield.ts:274`, `connectors/index.ts:154` | run A's results name a `series_id` that now holds run B's values: "a finished run never changes" holds for the row, not for its figures |
| D2 | No unique identity on `series`; find-or-create without lock | `connectors/index.ts:125–140` | two concurrent imports create two series for the same meter |
| D3 | `resample()` of a `cumulative` series returns the last index, not the consumption of the bucket | `core_series.sql:239` | a meter register cannot be read as kWh per day; every caller subtracts and handles resets itself |
| D4 | The write path is split: `storeSeries` (TypeScript), direct inserts (Home Assistant, examples), and `insert` granted to `authenticated` | `formats/homeassistant/index.ts:234`, `core_series.sql:305` | quality, dirty tracking or a "latest value" cannot be maintained in one place |
| D5 | `storeSeries` sets `quality = 0` on every write; `SeriesPoint` has no quality; the stream envelope of 0014 has one | `connectors/index.ts:28, 157` | an estimated reading from a data hub is stored as measured |
| D6 | `storeSeries` ignores a `value_kind` or `step` that differs from the existing series' | `connectors/index.ts:133` | an hourly import into a quarter-hour series is accepted silently |
| D7 | Sub-day steps bin on a UTC origin | `core_series.sql:237` | hourly buckets of a site at UTC+05:30 or +09:30 straddle local hours |
| D8 | Steps that are not one calendar unit are rounded down silently (`2 days` → day, `3 months` → month) | `core_series.sql:255–260` | a quarterly read returns months |
| D9 | `resample()` lets any caller without a JWT read any series (`auth.uid() is not null and …`) | `core_series.sql:218` | a dashboard role of decision 0014, which connects without a JWT, would read every organisation once granted `execute` |
| D10 | No coverage: `samples` is returned, the expected count is not | `resample` | gaps are invisible unless the caller knows the step |
| D11 | No upsampling: an hourly energy read on 15 minutes lands in one bucket of four | `resample` | mixing hourly simulation and quarter-hour metering needs client code |
| D12 | Nothing warns that partitions are missing; `doctor` checks RLS, not partitions | `packages/cli/src/doctor.ts:61` | an installation runs for years on the default partition |
| D13 | Quality 0 is "measured" in the table and "good" in decision 0007 | `core_series.sql:75`, `0007` | one vocabulary, two words |
| D14 | Unit conversion lives in one format library as 14 factors | `formats/homeassistant/index.ts:95–110` | the next format repeats it; units outside the list create a new quantity per unit |

### 1.7 Gaps, each with the use case that needs it

| Gap | Use case | Today |
|---|---|---|
| Aggregates by period over many series | an energy community: 50 meters summed per quarter-hour, a portfolio per month | one `resample` call per series, summed by the caller |
| Gap detection and filling | a meter offline for three days before a settlement; a PV performance ratio needs coverage | `samples` only (D10); filling nowhere |
| Downsampling and rollups (15 min → hour → day → month) | a year of 500 meters on one page | raw scan every time; rollups planned in 0007 "Next (1.0)", not built |
| Continuous aggregates | rollups kept fresh as data arrives late | none |
| Compression | ten years of quarter-hours | none; cold Parquet tier planned in 0007 |
| Retention | legal deletion of personal metering data | none; planned as a pack parameter |
| Versioned forecasts | forecast accuracy, "what was known at 06:00" | stored; read only as latest or latest-before, not by horizon |
| Unit conversion | a Wh feed, an MWh market series, °F from a US station | per format (D14) |
| Cumulative vs interval | a gas index read monthly, a heat meter | stored, but not converted on read (D3) |
| Parquet export | a researcher's notebook, a data lake | planned (`formats/parquet`, 0014), absent from `formats/` |
| Streaming in (MQTT) | a gateway publishing every minute | planned (`connectors/mqtt`, 0014), absent |
| Bulk load performance | ten years of a data hub for 1,000 meters | one statement per batch, a row trigger per value, no staging (0007's staging pattern is not implemented) |
| Latest value | a live tile, a "last seen" alarm | none; `max(at)` per series by hand |

---

## 2. The open-source landscape

Researched 2026-10-19; each row cites its source, read on that date unless
another date is given. "[unverified]" marks what no primary source
confirmed. 0007's notes (2026-10-12) hold the TimescaleDB licence history.

### 2.1 Inside Postgres

| Option | What it gives | Licence | Supabase PG17 | AWS RDS PG17 | Azure Flexible Server | Maturity | Would replace |
|---|---|---|---|---|---|---|---|
| Native partitioning + **pg_partman** + **pg_cron** | time partitions, premake, retention by drop, scheduled maintenance | PostgreSQL | yes, 5.3.1 / 1.6.4 ([manifest](https://raw.githubusercontent.com/supabase/postgres/develop/nix/ext/versions.json); [guide](https://supabase.com/docs/guides/database/migrating-to-pg-partman)) | yes, 5.4.3 / 1.6.7 ([RDS extensions](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html)) | yes, 5.4.3 / 1.6, preload; cron jobs run as their owner ([Azure versions](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions), 2026-07-10) | pg_partman 5.5.0 (2026-07-22), pg_cron 1.6.8 | `series_values_partition()` and the hand-run maintenance; the scheduler of the rollups |
| **TimescaleDB**, Apache 2 edition | hypertables, `time_bucket`, chunk drop by hand | Apache-2.0 | no: deprecated on PG17, built for PG15 only ([Supabase](https://supabase.com/docs/guides/database/extensions/timescaledb)) | no | yes, 2.24.0, "the TimescaleDB Apache-2 edition" ([Azure considerations](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-considerations), 2026-08-12) | 2.30.2 (2026-09-29, [releases](https://github.com/timescale/timescaledb/releases)) | partitions only; nothing that pg_partman does not already give |
| **TimescaleDB**, Community edition | columnstore compression, continuous aggregates, retention and job policies, `time_bucket_gapfill`, `locf`, `interpolate` ([editions](https://www.tigerdata.com/docs/about/latest/timescaledb-editions)) | Timescale License (no database-as-a-service) | no | no | no | as above | rollups, retention, compression, gap filling: most of section 3, on self-hosted Postgres or the vendor's cloud only |
| **timescaledb-toolkit** | LTTB / ASAP downsampling, `counter_agg` (resets), `time_weight`, `gauge_agg`, `stats_agg`, percentiles | Timescale License | no | no | no ([Azure Q&A](https://learn.microsoft.com/en-us/answers/questions/1180513/supporting-timescaledb-toolkit-extension-on-azure)) | active | cumulative deltas, time-weighted means |
| **pg_timeseries** (Tembo) | `enable_ts_table` over pg_partman, retention, `date_bin_table` gap rows, compression through Citus columnar | PostgreSQL | no | no | no | 0.1.7 on PGXN, no GitHub release ([repo](https://github.com/tembo-io/pg_timeseries)); the company has moved away from managed Postgres [unverified] | a convenience layer over what section 3 writes; not a dependency to take |
| **pg_ivm** | incremental materialised views: `count`, `sum`, `avg`, `min`, `max` | PostgreSQL | no [unverified: absent from the manifest] | no | yes, 1.13 | 1.15+ upstream ([repo](https://github.com/sraoss/pg_ivm)) | rollups — but its base tables **cannot be partitioned tables**, so not over `series_values` |
| **pg_duckdb** | DuckDB inside Postgres: columnar scans, `read_parquet`, `COPY … TO` Parquet on S3/Azure | MIT | no | no | announced as generally available in 2026, absent from Microsoft's extension list of 2026-07-10 [unverified] | 1.1.1 ([releases](https://github.com/duckdb/pg_duckdb/releases)) | the cold-tier reader and writer, where installed |
| **pg_parquet** | `COPY` to and from Parquet on S3, Azure Blob, GCS | PostgreSQL [unverified] | no | no | no (Azure offers `azure_storage` instead) | active, no tagged release ([repo](https://github.com/CrunchyData/pg_parquet)) | server-side `export_parquet`, where installed |
| **pg_mooncake** (its authors acquired in 2025) | columnstore mirror of a table in Iceberg, read through DuckDB | MIT | no | no | no | no published release ([repo](https://github.com/Mooncake-Labs/pg_mooncake)) | the cold tier; too young, and its future set by its acquirer |
| **Citus columnar** / **Hydra columnar** | append-mostly columnar tables | AGPL-3.0 [unverified] / AGPL + Apache mix | no | no | Citus only as multi-node elastic clusters; columnar not documented | Citus 14.2; Hydra unclear | compression of closed partitions, on self-hosted Postgres only |

The only time-series machinery present on all three hosts is native
partitioning, pg_partman and pg_cron. Everything else is a per-host
accelerator. That confirms 0007 and decides the shape of section 3: rollups,
retention, coverage and filling are written in plain SQL; compression and
columnar reads are optional.

### 2.2 Outside Postgres — integrations, never the core

| System | Licence | Version | Path from or to the core | Why not the core |
|---|---|---|---|---|
| InfluxDB 3 Core | MIT / Apache-2.0 | 3.9.2 (2026-04-30); single node, the vendor recommends its commercial edition for production ([docs](https://docs.influxdata.com/influxdb3/which-influxdb-3/)) | Parquet files (files door, 0014); line protocol import | no relational model, no row level security, a second copy of the data |
| QuestDB | Apache-2.0 | 9.x ([README](https://raw.githubusercontent.com/questdb/questdb/master/README.md)) | Postgres wire protocol, Parquet | same; no PostGIS, no foreign keys to objects |
| ClickHouse | Apache-2.0 [unverified] | 26.9 (2026-09-21, [release](https://clickhouse.com/blog/clickhouse-release-26-09)) | `pg_clickhouse` (Apache-2.0, 0.10.0, [announcement](https://clickhouse.com/blog/introducing-pg_clickhouse)); Supabase Wrappers ClickHouse FDW ([docs](https://supabase.com/docs/guides/database/extensions/wrappers/clickhouse)); change data capture | the right analytics engine when a utility's load is the product; a second system to operate for everyone else |

### 2.3 Client libraries to adopt rather than rewrite

| Need | Library | Licence | Status (2026-10-19) | Use |
|---|---|---|---|---|
| columnar interchange | Apache Arrow (Python `pyarrow`, JS `apache-arrow` 21.2.0) | Apache-2.0 | stable | the result of a read, the Parquet writer of `formats/parquet` |
| dataframes, Python | Polars 2.0.0 (2026-10-06, [PyPI](https://pypi.org/pypi/polars/2.0.0/json)); pandas 3.0.6 (3.0 on 2026-01-21, [what's new](https://pandas.pydata.org/docs/whatsnew/v3.0.0.html)) | MIT / BSD-3 | stable | optional extras of the SDK |
| local analytics, browser | `@duckdb/duckdb-wasm` (MIT), `arquero` 8.0.3 (BSD-3) | — | duckdb-wasm's `latest` tag is a dev build | reading an exported Parquet file in a page; not a second resampler |
| calendar and time-zone arithmetic | `Temporal`: ES2026, Stage 4 in March 2026 ([TC39 Stage 4](https://www.igalia.com/2026/03/13/Temporal-Reaches-Stage-4.html)), on by default in Node.js 26 ([release](https://nodejs.org/en/blog/release/v26.0.0)), in Chrome/Edge 144+ and Firefox 139+, not yet in Safari ([caniuse](https://caniuse.com/temporal)); `@js-temporal/polyfill` 0.5.1 (ISC) | — | polyfill still needed in browsers | local days, DST-aware labels; replaces Luxon or date-fns-tz |

Server-side resampling stays in SQL; the client libraries format, plot and
export, and never compute a bucket a page would show differently from a
module.

### 2.4 Standards whose vocabulary the package speaks

| Standard | Status | Term → core |
|---|---|---|
| OGC SensorThings API | 1.1 in use; 2.0 out of public comment 2026-01-18, publication expected in 2026 ([OGC](https://www.ogc.org/requests/ogc-seeks-public-comment-on-proposed-ogc-sensorthings-api-version-2-0/)) | Thing → object, Sensor → sensor, Datastream → `series`, Observation → a row of `series_values`, `resultQuality` → `quality` |
| Project Haystack | 4.0; Haystack 5 (Xeto) in progress [unverified] ([units](https://www.project-haystack.org/doc/Units)) | point → sensor, `his` → series, `hisTotalized` → `cumulative`; its units database as a source of `units` aliases |
| Brick | 1.4.4 stable, 1.5.0 RC ([releases](https://github.com/BrickSchema/Brick/releases)) | `brick:Point` → sensor, `hasTimeseriesReference` → `series.id` |
| Home Assistant recorder | `statistics_short_term` (5 min, purged), `statistics` (hourly, never purged): `mean`, `min`, `max`, `state`, `sum`, `last_reset_ts` ([reference](https://contributors.home-assistant.io/data/reference/statistics/)) | `state_class` measurement → `instant`, total / total_increasing → `cumulative`; `statistics` maps onto `series_rollups` one to one, and is the import source the library does not read yet |
| IEC 61724-1:2021 | classes A and B (class C of 2017 withdrawn) ([summary](https://www.hukx.com/applications/the-iec-61724-12021-standard-for-pv-monitoring-systems-a-quick-explanation)); sampling and recording intervals per class in the standard itself [unverified] | recording interval → `step`; a solar module's performance ratio is a run, with coverage from `coverage()` |
| CIM / ENTSO-E (IEC 62325-451) | `resolution` PT15M / PT60M, `Period` + `Point.position`, curve types A01 fixed blocks, A03 variable blocks where an absent position repeats the previous value ([ENTSO-E](https://eepublicdownloads.entsoe.eu/clean-documents/EDI/Library/cim_based/Introduction_of_different_Timeseries_possibilities__curvetypes__with_ENTSO-E_electronic_document_v1.4.pdf)) | `at = start + (position − 1) × resolution`, `interval` series; an A03 reader fills forward on import, never on read |
| EU market time unit | day-ahead coupling at 15 minutes from delivery day 2025-10-01 ([NEMO Committee](https://nemo-committee.eu/assets/files/15-minute-mtu-in-sdac-was-implemented.pdf)) | price series at 15 minutes beside hourly history: the `aggregate` and upsampling cases of section 3 |

---

## 3. The recommended series package

### 3.1 Storage: what stays of 0007, what changes

Stays: plain Postgres; `series_values (series_id, at, value, quality)`
partitioned weekly on `at`, default partition, pg_partman and pg_cron when
present; `forecast_values` with issue time; BRIN on `at`; no organisation on
the hot rows; `security definer` reads with one access check; days in the
site's time zone; the rollup design of 0007 "Next"; the cold tier as Parquet.

Changes:

| Change | Why (defect, gap) |
|---|---|
| `series.run_id uuid references runs` (null for measured data); a run writes its own series, never another's | D1 |
| unique index on `series (object_id, quantity_code, kind, source_code, scenario_id, name, run_id) nulls not distinct` | D2 |
| `series_rollups (series_id, step, bucket, n, n_expected, sum, mean, min, max, first, last, delta, quality)`, list-partitioned by step (`1 hour`, `1 day`); month and year computed from days | rollups, coverage, cumulative |
| `series_dirty (series_id, bucket_hour)` fed by the write function, drained by `series_rollup()` | late data, continuous aggregates without TimescaleDB |
| `series_latest (series_id, at, value, quality)`, one row per series, upserted by the write function | latest value without touching the hot table, without churning `series` |
| `units (code, quantity_kind, factor, offset)`: QUDT codes, conversion to the quantity's unit | D14 |
| quality codes unchanged (0–3), one word each, documented once; codes ≥ 100 reserved for a pack's mapping of a data hub | D13 |
| `insert/update/delete` on value tables revoked from `authenticated`; one write function | D4 |
| `series_values_partition` bounds written in UTC explicitly; `doctor` reports `series_partitions_missing` when the default partition holds rows older than a week | D12 |
| `forecast_values` partitioned like `series_values` when an installation asks, BRIN on `issued_at` | horizon reads |

### 3.2 The API: SQL functions in schema `nexgen`

One write, one family of reads. Every read is `security definer`, checks the
caller's organisation on each series once (with `auth.uid()` **or** the
role's organisation claim, D9), and routes to the rollups when the step
allows it.

| Function | Signature | Contract |
|---|---|---|
| `series_ensure` | `(object uuid, quantity text, kind text, value_kind text, step interval, source_code text, scenario uuid default null, name text default null, run uuid default null) → uuid` | the series of that identity, created once; refuses a different `value_kind` or `step` by name (`series_shape_mismatch`) |
| `store` | `(series uuid, at timestamptz[], value float8[], quality smallint[] default null, unit text default null, issued_at timestamptz default null) → int` | converts from `unit`, sorts, upserts where distinct, routes forecasts, marks dirty hours, updates `series_latest`; returns rows changed |
| `resample` | unchanged signature | as today, plus: rollups below the hood, coverage-safe, local origin for sub-day steps, cumulative read as consumption per bucket (decision 3), multiples of a calendar unit honoured, upsampling of `sum` quantities by equal split when asked |
| `aggregate` | `(series uuid[], from, to, step, how text default null, time_zone text default null) → (bucket, value, samples, expected)` | many series combined per bucket (`sum` for a community balance, `mean` for a fleet), one statement |
| `coverage` | `(series uuid, from, to) → (gap_from, gap_to, missing int)` | the gaps of a regular series, from rollups when they exist |
| `fill` | `(series uuid, from, to, step, method text) → (bucket, value, quality)` | a read with gaps filled (`previous`, `linear`, `zero`, `profile`), filled buckets flagged `estimated`; writes nothing |
| `latest` | `(series uuid[]) → (series_id, at, value, quality)` | the last stored value of each series, from `series_latest` |
| `window` | `(series uuid, from, to, limit int default 100000) → (at, value, quality)` | raw values in time order, the only read without aggregation |
| `forecast_at` | `(series uuid, from, to, as_of timestamptz default null, horizon interval default null) → (at, value, issued_at)` | the forecast as known at `as_of`, or the issues made `horizon` before each instant |
| `series_rollup` | `(max_hours int default 10000) → int` | drains `series_dirty` into hourly then daily rollups; called by pg_cron, or by hand where there is none |
| `series_retain` | `(before timestamptz) → int` | detaches and drops the partitions wholly before a date, after their rollups are final; the date comes from configuration |
| `convert_unit` | `(value float8, from_unit text, to_unit text) → float8` | QUDT factor and offset; `unit_incompatible` by name |
| `export_rows` | `(series uuid[], from, to) → (series_id, at, value, quality)` | the documented Parquet schema of 0014 as rows; the file is written by `formats/parquet` |

`export_parquet` is deliberately **not** a core SQL function: writing a file
from the server needs `pg_parquet` or `pg_duckdb`, which the three managed
hosts do not all install (section 2). The format library writes the file on
the client from `export_rows`, and uses a server extension when it detects
one.

### 3.3 Adopted, written, and where each piece lives

| Piece | Adopted / written | Place (decision 0014) |
|---|---|---|
| partitions, maintenance | pg_partman, pg_cron (adopted, optional) | core installs them when present; `series_values_partition` stays as the fallback |
| bucketing | `date_bin`, `date_trunc(…, tz)` (Postgres built-ins) | core |
| rollups, dirty tracking, latest, coverage, fill on read | written (an estimated 400 lines of SQL), after Home Assistant's statistics layer | core |
| units | QUDT codes and factors (data, adopted) | core vocabulary |
| validation, estimation and editing that writes substituted values; IEC 61724 indicators; alarms | written as module runs | modules (`monitoring`, `solar`) |
| Parquet files, cold tier | Apache Arrow / Parquet libraries (adopted) | `formats/parquet` (MIT) |
| MQTT, Kafka, change data capture | broker clients (adopted) | `connectors/mqtt`, `connectors/kafka` |
| InfluxDB line protocol, Grafana dashboards | — | `formats/` |
| columnstore acceleration | TimescaleDB or pg_duckdb when present (adopted, never required) | installation option |

### 3.4 How clients read

Principle 3 of the README ("one way to read") holds: clients never resample.

- **Python** (`sdk/python`): each read function of 3.2 is one method
  returning rows as today; `to_arrow()`, `to_pandas()`, `to_polars()` on the
  result through optional extras (`nexgen-os[arrow]`, `[pandas]`,
  `[polars]`), so the base package keeps one dependency. Timestamps arrive
  as UTC-aware; `bucket` is localised only by the caller.
- **TypeScript**: one module beside `connectors/index.ts` exporting typed
  wrappers of the same functions over the `Db` interface (`formats/db.ts`);
  `storeSeries()` becomes a thin call of `series_ensure` + `store`. Calendar
  arithmetic in the browser (labels, local days) through the `Temporal` API
  or its polyfill, never through a resampling library.
- **REST**: the same functions as PostgREST RPCs (`/rpc/resample`), so a page
  and an agent read the same way.

---

## 4. Benchmark plan (not executed)

**Dataset.** One real site with its time zone; 50 meters × one quantity at
15 minutes for one calendar year = 50 × 35,040 = 1,752,000 rows; a second
pass with 3 quantities per meter (offtake, injection, production) =
5,256,000 rows; one weather point with 5 hourly quantities = 43,800 rows; one
forecast series issued daily with 48 hourly values = 17,520 rows. Loaded with
weekly partitions through pg_partman.

**Target instance.** Supabase Micro, the smallest paid compute: shared CPU,
1 GB memory, 60 connections, 11 MB/s and 500 IOPS baseline
([Supabase compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk),
accessed 2026-10-19). Every query run as `authenticated` with JWT claims set,
so that row level security is in the plan, through SQL and through
PostgREST; cold cache (after restart) and warm, p50 and p95 over 20 runs.

| # | Operation | Good on Micro (p95, warm) |
|---|---|---|
| W1 | bulk load of 1.75 M rows through `store()` in batches of 35,040 | ≥ 30,000 rows/s, under 60 s |
| W2 | one day for 50 meters (4,800 rows) | < 1 s, rollups refreshed < 5 s after |
| W3 | the same day again (idempotent) | 0 rows changed, < 1 s |
| R1 | `window`: one meter, one year raw | < 150 ms |
| R2 | `resample`: one meter, one year, hourly / daily / monthly | < 50 ms from rollups; raw path measured too |
| R3 | `aggregate`: 50 meters summed per 15 min over one month | < 500 ms |
| R4 | `aggregate`: 50 meters per month over one year | < 100 ms |
| R5 | `latest` for 50 meters | < 20 ms |
| R6 | `coverage`: 50 meters, one year, 3 % of days removed | < 300 ms |
| R7 | hourly production joined with irradiance and temperature, one year | < 200 ms |
| R8 | `forecast_at` with `as_of` and with `horizon = 24 h`, one year | < 200 ms |
| R9 | `export_rows` for one week of 50 meters, piped to Parquet | < 2 s |
| M1 | `series_rollup()` over a full year of dirty hours | < 60 s |

**Sizes to measure.** `pg_total_relation_size` of `series_values`, of each
weekly partition, of the PK and BRIN indexes, of `series_rollups` and
`series_latest`; WAL generated by W1 (`pg_current_wal_lsn()` before and
after); the Parquet file of one week. Expected from 0007's ~105 bytes per
row: ~184 MB for 1.75 M rows and ~552 MB for 5.26 M; hourly rollups 438,000
rows, daily 18,250 for 50 series. "Good" is within 20 % of those figures,
no query spilling to disk at the default `work_mem`, and the whole dataset
of the first pass inside the instance's memory once rolled up.

---

## Decisions for the owner

Each item: the question, the options with cost and consequence, the
recommendation.

1. **Which engine stores series?**
   - A. Plain Postgres, pg_partman and pg_cron, rollups written in the core (0007 confirmed): ~400 lines of SQL to write (estimated); runs on Supabase, RDS, Azure and bare Postgres.
   - B. TimescaleDB required: compression and continuous aggregates for free; the core then runs only self-hosted or on its vendor's cloud.
   - C. An external time-series database (ClickHouse, InfluxDB 3, QuestDB) as the store: fastest analytics; a second system to run, a second copy of the model, RLS lost.
   - **Recommendation: A**, with TimescaleDB and pg_duckdb as optional accelerators: the core's promise is "your own Postgres, any host".

2. **Whose series does a run write?**
   - A. `series.run_id`: each run writes its own series, never overwritten; one column, one unique index, a cleanup of superseded simulated series.
   - B. Keep one series per (object, quantity, kind, source, scenario, name), overwritten by the latest run: no change; a past run's figures silently change (D1).
   - C. Store run outputs outside series (jsonb or Parquet on the run): no overwrite; `resample` no longer reads simulations.
   - **Recommendation: A**: it makes "a finished run never changes" true for its numbers, and pages keep reading simulations with `resample`.

3. **What does `resample()` return for a cumulative register?**
   - A. The consumption of each bucket (last − first, resets handled), the index itself through `window` and `latest`: one semantic change, tests updated.
   - B. The last index per bucket, as today: every caller subtracts and handles resets.
   - C. A parameter choosing between the two: no break; two meanings behind one name.
   - **Recommendation: A**: `resample` answers "how much in this bucket" for every series, which is what a page and a module ask.

4. **How are rollups kept fresh?**
   - A. One `series_rollups` table (hour, day), dirty hours marked on write, drained by `series_rollup()` from pg_cron or by hand: written once, runs everywhere.
   - B. Materialised views refreshed whole, or `pg_ivm`: little code; full refreshes grow with history, and `pg_ivm` exists on Azure only and cannot read a partitioned table.
   - C. No rollups, raw reads only: nothing to build; a year of a portfolio stays a multi-second scan.
   - **Recommendation: A**, the Home Assistant statistics design already chosen in 0007.

5. **One write path?**
   - A. One SQL function `store()` (with `series_ensure()`); direct `insert` revoked from `authenticated`; `storeSeries` and the Home Assistant import call it: quality, units, dirty hours and latest value handled once.
   - B. Keep `storeSeries` in TypeScript plus direct inserts: no work; Python and SQL writers each reimplement it.
   - **Recommendation: A**: the database enforces the series contract the way it enforces runs.

6. **Where does unit conversion live?**
   - A. A core `units` vocabulary (QUDT code, quantity kind, factor, offset) and `convert_unit()`; `store()` takes the source unit: one table of data, formats lose their factor lists.
   - B. Factors kept per format library: no change; each format repeats them (D14).
   - C. Store each series in its original unit: no conversion on write; every sum must convert, the "one unit per quantity" rule falls.
   - **Recommendation: A**: storage stays in the quantity's unit and conversion becomes data.

7. **How is the "latest value" read?**
   - A. A one-row-per-series `series_latest` table maintained by `store()`: a few bytes per series, constant-time tiles.
   - B. `max(at)` on `series_values` at read time: no table; a probe per series per partition.
   - C. Columns on `series`: no table; every write updates the metadata row and bloats it.
   - **Recommendation: A**: a live tile reads one small row, and the hot table and the metadata stay untouched.

8. **Where do gap filling and substitution happen?**
   - A. Core reads fill on the fly (`fill()`, flagged estimated, nothing written); writing substituted values is a module's run (`monitoring`): reproducible, traceable.
   - B. The core writes filled values into `series_values`: simpler reads; the core computes figures, against principle 4.
   - **Recommendation: A**: a substituted value is a figure, and a figure is a run anyone can reproduce.

9. **How is Parquet produced?**
   - A. `formats/parquet` (MIT) writes files on the client from `export_rows()`, and uses `pg_parquet` or `pg_duckdb` when the host has them: works everywhere.
   - B. A core SQL `export_parquet()` requiring a server extension: one call; unavailable on part of the managed hosts.
   - **Recommendation: A**: the core does not depend on an extension that one host lacks.

10. **How do the SDKs return series?**
    - A. Rows by default, Arrow / pandas / Polars through optional extras in Python; typed wrappers over the same SQL functions in TypeScript: no heavy dependency, one way to read.
    - B. pandas as a required dependency: convenient for analysts; a heavy install for every user and agent.
    - **Recommendation: A**: analysts get their dataframe in one call, everyone else keeps a one-dependency client.

## Hand-offs

- **audit-core**: whether `sensors` merges into `devices` decides the
  fate of `series.sensor_id` and of the double path object / sensor host
  (1.2); `series.run_id` adds a link to `runs`; a `units` vocabulary joins
  `quantities`; the count of core functions grows by the API of 3.2; the
  `resample()` access check for non-JWT roles (D9) concerns the whole RLS
  model.
- **audit-layout-doctrine**: the place of `formats/parquet`,
  `formats/influx-line-protocol`, `connectors/mqtt`, `connectors/kafka` and
  of a TypeScript client next to `sdk/python`; the doctrine's wording of "one
  way to read" and "one way to write".
- **audit-packs**: `raw_retention` (0007) as a pack value or an
  installation setting; the mapping of a national data hub's quality flags
  to codes ≥ 100; standard load profiles as `simulated` series shipped by a
  pack.

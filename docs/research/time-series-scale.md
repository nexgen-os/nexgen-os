# Time series at scale — research notes

Research done on 12/10/2026 for decision [0007](../decisions/0007-series-at-scale.md). Sources are linked inline; figures are the sources' own.

Date: 2026-10-12. Scope: the `series` / `series_values` / `resample()` shape of Nexgen OS (AGPL, Postgres 16/17 + PostGIS, deployable on Supabase or bare Postgres). Today: 11.9 M quarter-hour rows for ~1,200 meters. Target: 100,000+ meters and sensors at 15-min to 1-min resolution, 10–100 M rows/day, years of retention.

Headline: stay on plain Postgres (declarative partitioning + pg_partman + pg_cron + rollup tables behind a single `resample()`), treat TimescaleDB as a dead end for a portable open-source core, and plan the cold tier as Parquet on object storage read back through DuckDB-family tools. Numbers and sources below.

---

## 1. Storage layout

**Narrow rows win for this workload.** One row per (series, timestamp) is what every reference system does under the hood (Home Assistant `states`/`statistics`, Emoncms fixed-interval feeds, InfluxDB 3 Parquet row groups). Arrays or wide rows (one row per meter per day holding 96 values) cut row overhead ~50× but break `on conflict`, per-point quality, late corrections and `date_bin` reads; they are an optimisation for a sealed cold tier, which is exactly what Parquet already gives for free (section 3).

**Bytes per row (Postgres heap).** Tuple header is 23 bytes, aligned to 24 on 64-bit, plus a 4-byte line pointer per row ([EDB, data alignment](https://www.enterprisedb.com/postgres-tutorials/data-alignment-postgresql); [pgsql-hackers, row size overhead](https://www.postgresql.org/message-id/528853D3C5ED2C4AA8990B504BA7FB850106DF24%40sol.transas.com)). Applied to the current table:

| Layout | Data bytes | Heap row (aligned) | PK index entry (series_id, at) | All-in |
|---|---|---|---|---|
| Today: uuid + timestamptz + float8 + text quality + uuid organisation_id | 16+8+8+~5+16 = 53 → 56 | 28 + 56 = **84 B** | 8 header + 24 key + 4 item ptr ≈ **36–40 B** | **~120–125 B/row** |
| Trimmed: uuid + timestamptz + float8 + smallint quality | 16+8+8+2 = 34 → 40 | 28 + 40 = **68 B** | ~36–40 B | **~105 B/row** |
| Trimmed + int8 series id instead of uuid | 8+8+8+2 = 26 → 32 | **60 B** | 8 + 16 + 4 ≈ 28–32 B | **~90 B/row** |

The 11.9 M rows of today should weigh ~1.4 GB heap + index; `pg_total_relation_size('series_values')` is the check. Dropping `organisation_id` alone saves ~13 % of heap; `quality` as `smallint` saves another ~5–10 % and removes TOAST/varlena handling from the hot path. Switching the series key to `int8` is the largest single saving (~25 %) but touches every API; keep the uuid if the rest of the model is uuid-keyed (single source of truth over bytes).

**`double precision` vs `real` vs `numeric`.** `real` has ~7 significant digits: a cumulative register of 1,234,567.891 kWh does not survive it, so one rule for every value type means `double precision` (8 B). `numeric` is variable-length, slower in aggregation and offers nothing for measured floats. Keep `float8` everywhere; exact decimal belongs in invoicing tables, not in the series store.

**Quality as `smallint`** (0 = good, codes in a small reference table) rather than text or a Postgres enum: enum is 4 bytes and awkward to extend across deployments; smallint is 2 bytes and joins to a documented code table. Alternative worth considering later: store only non-good points in a side table `series_value_flags(series_id, at, quality)` and let the main table carry no quality column at all (values are overwhelmingly "good").

**Partitioning by `at`.** Declarative range partitioning managed by pg_partman is what Supabase itself recommends as the TimescaleDB replacement: `partition by range (sent_at)` then `partman.create_parent(p_control := 'sent_at', p_type := 'range', p_interval := '7 days', p_premake := 7)` and `cron.schedule('@daily', $$call partman.run_maintenance_proc()$$)` ([Supabase, migrating to pg_partman](https://supabase.com/docs/guides/database/migrating-to-pg-partman)). Rule from the same page: the partition key must be part of every unique index, so the PK stays `(series_id, at)`. Partition count guidance: planning time and lock usage grow roughly linearly with partitions that survive pruning; the lock table runs out around "a few thousand" partitions on the default `max_locks_per_transaction = 64` ([postgres.ai, planning time vs partitions, 2024-10-03](https://postgres.ai/blog/20241003-how-does-planning-time-depend-on-number-of-partitions); [OneUptime, how many partitions, 2026-08-13](https://oneuptime.com/blog/post/2026-08-13-postgresql-too-many-partitions-planner-lock-catalog-overhead/view)). Weekly partitions give 52/year, 520 over ten years, well inside that envelope, and keep a partition at 50 M rows/day around 350 M rows (~25 GB heap), which is the right size for a `DROP`/`DETACH` to object storage. Monthly would reach 1.5 G rows (~100 GB) per partition at target scale; daily would hit 3,650 partitions over ten years. **Weekly from day one**: pg_partman cannot change an existing set's interval without a rebuild, and at today's volume a weekly partition is ~60 MB, which costs nothing.

**BRIN vs B-tree.** The hot read is "one series over a time range", which needs the B-tree on `(series_id, at)`, and that is the PK already. BRIN only helps scans that filter on `at` alone (rollup jobs, exports) and only when physical order correlates with `at`; it is "dozens to hundreds of times smaller" than a B-tree on append-only time-ordered tables but "brought no performance improvement" on badly correlated data ([Crunchy Data, BRIN indexes](https://crunchydata.com/blog/postgresql-brin-indexes-big-data-performance-with-minimal-storage); [dev.to, BRIN for telemetry](https://dev.to/software_mvp-factory/postgresql-brin-indexes-for-time-series-mobile-telemetry-when-a-128-page-index-beats-a-50gb-b-tree-3b18)). Recommendation: PK B-tree per partition (mandatory) plus one BRIN on `(at)` with `pages_per_range = 32` for the rollup and export jobs; check `pg_stats.correlation` on `at` after a month of real ingestion.

**Fillfactor.** Table default is already 100; rows are append-only and corrections are rare, so keep 100 for the heap. B-tree default is 90; leave it, the index is written in series order within each batch (section 4) so splits are mostly rightmost.

**RLS on the big table.** Postgres evaluates the policy per candidate row, so cost scales with rows scanned; Supabase's guidance is: index the filtered column, wrap function calls in `(select …)` so they become an InitPlan evaluated once, specify `to authenticated`, avoid joins inside policies in favour of `col in (select …)`, and use a `security definer` function in a private schema when the check itself needs a join ([Supabase, RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security-performance); [Supabase, RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security)). Applied here:

- drop `organisation_id` from `series_values`; the policy becomes `series_id in (select id from series where organisation_id in (select my_orgs()))`, a hashed subplan built once per statement (size = number of visible series, a few thousand entries, milliseconds);
- make `resample()` `security definer` with `set search_path = ''`, owned by a role that bypasses RLS, and have it check access on `series` exactly once; that removes RLS from the 35k-row hot path entirely while the table policy stays as defense in depth for ad-hoc SQL;
- test plans with `set role authenticated` and the JWT claims set, since table owners and `bypassrls` roles skip policies and show a misleading plan ([myhoai, debugging RLS](https://engineering.myhoai.com/posts/debugging-postgres-performance-under-row-level-security/)).

## 2. TimescaleDB: licence and availability in 2025–2026

**Licence split.** Timescale Inc. became TigerData on 2025-06-17. The Apache 2 edition contains hypertables, `time_bucket`, `first`/`last`, chunk management. Everything that matters at scale is Community edition under the Timescale License (TSL): Hypercore/columnstore compression, continuous aggregates, retention policies, the job scheduler, `time_bucket_gapfill`/`locf`/`interpolate`, `time_weight` and the other hyperfunctions ([TigerData, editions feature table](https://www.tigerdata.com/docs/about/latest/timescaledb-editions); [TSL text, posted 2020-09-24](https://raw.githubusercontent.com/timescale/timescaledb/main/tsl/LICENSE-TIMESCALE)). Hypercore replaced the old compression API from 2.18.0.

**What the TSL allows.** Free for "your own internal business purposes" and inside "Value Added Products or Services" (an IoT platform or vertical application is the licence's own example) provided the product "is not primarily a database product", adds substantial value of a different nature, and customers are "contractually or technically prohibited" from running DDL against the Timescale database; unmodified standalone binaries may be redistributed; forbidden: offering it as a DBaaS or any service exposing time-series database functions to third parties (TSL §2.1–2.2, §3.10). An AGPL core may therefore *optionally* use it: the core distributes no TSL code, the operator installs the extension, and feature detection is `SHOW timescaledb.license` returning `timescale` or `apache` ([TigerData forum, licence check](https://forum.tigerdata.com/forum/t/check-which-timescaledb-licence-apache-only-or-community-edition-is-enabled-in-postgresql/3128)). Legally feasible; the DDL-prohibition clause is an awkward fit for an open-source core whose users are expected to run migrations.

**Availability is the real problem.**

| Platform | Status | Source |
|---|---|---|
| Supabase | Dropped from the Postgres 17 bundle (with plv8, plls, plcoffee, pgjwt); Postgres 15 support ends ~May 2026; migration target is pg_partman | [changelog 2025-05-22](https://supabase.com/changelog/35851-forthcoming-postgres-17-release-notes), [timescaledb docs page](https://supabase.com/docs/guides/database/extensions/timescaledb) |
| AWS RDS / Aurora | Never offered; absent from the RDS extension list up to PG 19 beta; pg_partman 5.4.3 and pg_cron 1.6.7 are there | [RDS extension versions](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html) |
| Neon | Apache 2 subset only, "to comply with the license" | [Neon changelog 2023-04-14](https://neon.tech/docs/changelog/2023-04-14) |
| Crunchy Bridge | "TimescaleDB (Apache 2 Edition)"; also pg_partman, pg_cron, pg_parquet, citus_columnar, clickhouse_fdw | [Bridge extensions](https://docs.crunchybridge.com/extensions-and-languages) |
| Azure Flexible Server | Apache edition only; Microsoft: "no plans to support proprietary licensed extensions" | [MS Q&A](https://learn.microsoft.com/en-us/answers/questions/1380687/will-azure-have-the-functionality-to-support-commu), [GA note May 2024](https://azure.microsoft.com/en-in/updates/general-availability-latest-version-of-the-timescaledb-extension-on-azure-database-for-postgresql-flexible-server/) |
| Tiger Cloud | Full Community edition, AWS and Azure regions | [feature comparison](https://www.tigerdata.com/docs/about/latest/feature-comparison) |

Conclusion: on every managed Postgres except TigerData's own, the installable TimescaleDB is the Apache subset, which has none of compression, continuous aggregates or retention. A core that depends on those features would run only on self-managed Postgres or Tiger Cloud. Build on plain Postgres and keep an optional "if hypercore is present" accelerator for later, if ever.

## 3. Alternatives inside Postgres

- **pg_partman + pg_cron** are the common denominator: present on Supabase (PG17, recommended path), RDS (5.4.3 / 1.6.7), Crunchy Bridge, Azure; the Supabase guide schedules `partman.run_maintenance_proc()` from pg_cron ([Supabase pg_partman](https://supabase.com/docs/guides/database/extensions/pg_partman)). Rollups are ordinary tables refreshed by a pg_cron job (section 5 and 8).
- **Native heap compression** is TOAST only, which never applies to 8-byte columns; PG17 brought a new vacuum memory structure ("up to 20× less memory"), streaming sequential reads and faster multi-value B-tree searches; PG18 (2025-09-25) adds asynchronous I/O for sequential/bitmap scans and vacuum, B-tree skip scan, and VACUUM/ANALYZE recursing into partitions by default ([PG17 release notes](https://www.postgresql.org/docs/17/release-17.html); [PG18 release notes](https://www.postgresql.org/docs/release/18/)). None compresses the heap; columnar storage is the only path to 10× smaller.
- **Columnar extensions, status October 2026:**
  - *pg_duckdb 1.0* (DuckDB Labs + Hydra + MotherDuck): embeds DuckDB per backend, reads/writes Parquet on S3/Azure/R2/GCS with `read_parquet('s3://…')` and `COPY … TO 's3://…'`; the de facto standard; not on RDS, Supabase or Crunchy ([MotherDuck, 1.0 announcement](https://motherduck.com/blog/pg-duckdb-release/)).
  - *pg_lake 3.0* (Snowflake, Apache 2, open-sourced 2025-11-04 after the June 2025 Crunchy Data acquisition): Iceberg tables with Postgres as catalog, but needs a separate `pgduck_server` process, so self-hosted only ([Snowflake engineering blog](https://www.snowflake.com/en/engineering-blog/pg-lake-postgres-lakehouse-integration/)).
  - *pg_parquet* (Crunchy, Rust/pgrx): `COPY table TO 's3://…' WITH (format 'parquet')` and back, no DuckDB; available on Crunchy Bridge PG16+ ([GitHub](https://github.com/CrunchyData/pg_parquet); [docs 0.5.1](https://access.crunchydata.com/documentation/pg_parquet/0.5.1/)). The lightest tool for "detach a partition, write it as Parquet".
  - *pg_mooncake 0.2* (Mooncake Labs, acquired by Databricks 2025): Iceberg mirror of a Postgres table with sub-second lag; still beta/experimental on Neon ([Neon docs](https://neon.com/docs/extensions/pg_mooncake)).
  - *Hydra Columnar*: listed as obsolete and unmaintained; *citus_columnar* survives (on Crunchy Bridge) but is append-only and not partition-aware in a useful way ([Pigsty OLAP catalogue](https://ext.pigsty.io/cate/olap)).
  - *ClickHouse via FDW* (`clickhouse_fdw` on Crunchy Bridge): a second system to operate; only worth it when the analytics load is the product.
- **Supabase today**: pg_cron, pg_partman, pg_net, Wrappers (FDW framework), and *Analytics Buckets* (Iceberg tables on S3 as Parquet, Iceberg REST catalog, queried from Postgres through the Iceberg FDW); launched in private alpha on 2025-07-15, docs still say "expect rapid changes, limited features, possible breaking updates", and managed replication into them through Supabase ETL has been dropped, so ingestion is bring-your-own ([Supabase blog](https://supabase.com/blog/analytics-buckets); [query with Postgres](https://supabase.com/docs/guides/storage/analytics/query-with-postgres.md)). No pg_duckdb on Supabase. This is the plausible cloud cold tier: a worker writes weekly Parquet files into an analytics bucket, Postgres reads them through the wrapper.

## 4. Ingestion

- **COPY into an unlogged staging table, then `insert … select … on conflict (series_id, at) do nothing`** is the pattern every source converges on; it is "much faster for large loads than running INSERT … ON CONFLICT directly", and unlogged staging skips WAL ("not crash safe, not on replicas", which is fine for staging). Switching a real table to UNLOGGED and back forces a full-table WAL rewrite, so never do that on `series_values` ([TigerData, upsert](https://www.tigerdata.com/docs/use-timescale/latest/write-data/upsert); [Cybertec, bulk loading](https://www.cybertec-postgresql.com/en/postgresql-bulk-loading-huge-amounts-of-data); [PGConf.DE 2023, bulk load four ways](https://www.postgresql.eu/events/pgconfde2023/sessions/session/4576/slides/393/postgres_bulk_load_four_ways-pgconf-de.pdf)).
- **`do nothing` cost** is one index probe per row on the PK, which the insert pays anyway; `do update … where series_values.value is distinct from excluded.value` is the form for corrections (only rewrites rows that changed, keeps WAL low).
- **Write amplification**: each row writes ~70 B heap + ~36 B index + WAL for both (~2× at least, more with full-page writes after checkpoints). Sort each batch by `(series_id, at)` before the insert so index insertions are sequential per series; batch by partition week so each statement touches one leaf table.
- **Time zones and DST**: `date_bin(interval, timestamptz, origin)` bins in absolute time, so 15-minute and hourly bins are DST-safe when the origin is a UTC-aligned timestamp. Daily and monthly bins are not: `date_bin` has no time-zone argument and a winter origin yields wrong bins after the switch ([pgsql-hackers, date_trunc in interval version](https://www.postgresql.org/message-id/ada834a3-3ad5-4153-80eb-531c5b5c913b%40sztoch.pl); [TigerData, time_bucket DST note](https://docs.timescale.com/api/latest/hyperfunctions/time_bucket)). Rule for `resample()`: step < 1 day → `date_bin` with origin `'2000-01-01 00:00:00+00'`; step ≥ 1 day → `date_trunc(unit, at, site_tz)` (PG14+ three-argument form) with the time zone taken from the site record, never a constant. Store `at` as the **interval start** for `interval` series and document it; the 23-hour/25-hour days of DST are then correct by construction (92 or 100 quarter-hours).

## 5. Reads

**Budgets.** One meter, one year at 15 min = 35,040 rows ≈ 2.5 MB of heap pages through the PK index: 10–50 ms warm. A community of 500 meters over a month from raw = 1.44 M rows (~100 MB): 1–3 s and too slow for a UI; from an hourly rollup = 360 k rows (~0.3 s); from daily = 15 k rows (milliseconds). This is the argument for rollups: a step of 1 hour or more should never touch raw.

**Continuous aggregates vs pg_cron rollups.** Continuous aggregates are TSL-only (section 2). The equivalent in plain Postgres is a rollup table keyed by `(series_id, bucket)` refreshed incrementally: each run recomputes buckets later than `now() - lag` (to absorb late data) plus any bucket touched by a correction (recorded in a small `series_dirty_buckets` table by the ingestion step). Home Assistant's design is the cheap, proven model: 5-minute `statistics_short_term` (purged after 10 days by default) and hourly `statistics` (never purged, "only 24 entries per day"), both with the same columns `mean, min, max` for measurements and `last_reset_ts, state, sum` for meters ([data.home-assistant.io, statistics](https://data.home-assistant.io/docs/statistics)). Emoncms goes further and stores *only* fixed-interval values: 4 bytes per interval "whether or not data arrives", null for gaps, ~12 MB/year at 10 s; variable-interval feeds cost 9 bytes per value ([emoncms docs/feeds.md](https://github.com/emoncms/emoncms/blob/master/docs/feeds.md)).

**`resample()` as the single API that routes by step.** Keep the signature; add a source selection:

| requested step | source |
|---|---|
| < 1 h | raw `series_values` (`date_bin`) |
| 1 h ≤ step < 1 day | `series_rollup_1h` |
| ≥ 1 day | `series_rollup_1d` (built from 1h with the site time zone) |

with fallback to the next finer source when a rollup bucket is missing or stale (compare `rollup.updated_at` to the series' `last_value_at`). The aggregation is still the quantity's rule (`sum` for interval energy, `avg` for power, `last` for cumulative), stored once per quantity.

**Cumulative registers.** Store the register as read; per bucket keep `first`, `last`, and derive consumption as `last − first` over the bucket, with reset handling as Home Assistant does: a decrease is "the start of a new meter cycle or the replacement of the meter" and a new zero point ([HA developer blog, total_increasing, 2021-08-16](https://developers.home-assistant.io/blog/2021/08/16/state_class_total/)). In the rollup, carry `last_reset_at` and a `sum_delta` that already accounts for resets, so readers never see the register discontinuity. Gaps: rollup rows keep `n_points` and `n_expected` (step-derived) so a bucket's completeness is a number, and a `quality` roll-up (`max(quality)`) propagates the worst flag.

## 6. Retention and tiering

**Legal floor and ceiling vary by country, even by region**; keep them in the country pack, never in code:

- EU: Directive (EU) 2019/944 and Implementing Regulation (EU) 2023/1162 (6 June 2023, in force 15 June 2023) define *access* to validated historical and near-real-time metering data and leave retention to GDPR purpose limitation and national law ([EUR-Lex 2023/1162](https://eur-lex.europa.eu/eli/reg_impl/2023/1162/oj)).
- Germany: MsbG §60(6): the metering point operator deletes or anonymises personal metering values "sobald … nicht mehr erforderlich", at the latest three years after the end of the calendar year of collection; §67a(3): five years for downstream processors (law as amended 2025-12-18) ([lxgesetze, MsbG §60](https://lxgesetze.de/msbg/60); [§67a](https://lxgesetze.de/msbg/67a)).
- France: CNIL served formal notices on EDF and Engie in February 2020 for retaining half-hourly consumption five years after contract termination (EDF) and monthly data eight years (Engie), deemed "non justifiées" ([Assemblée nationale, question 26750](https://www.assemblee-nationale.fr/dyn/15/questions/QANR5L15QE26750.pdf); [Soulier Avocats](https://soulier-avocats.com/en/gdpr-and-linky-meters-the-french-data-protection-authority-puts-edf-and-engie-on-notice/)).
- Brussels: BRUGEL decision 323 of 2025-04-28 approves Sibelga's metering rules: a customer may contest metering data up to two years after the invoice; rectification covers two annual periods, up to five in special cases ([BRUGEL decision 323, PDF](https://brugel.brussels/publication/document/decisions/2025/fr/DECISION-323-PRESCRIPTION-DONNEES-COMPTAGE.pdf)). Billing-grade data therefore needs ≥ 5 years there.

So the deployable rule is: raw retention = pack parameter `raw_retention` (explicit at install, error if missing), rollups kept per `rollup_retention` (default "forever" for daily and monthly, since a daily aggregate of one meter is anonymised in practice but still a pack decision). pg_partman applies `p_retention` by dropping or detaching partitions; detach, export, then drop is the tiering path.

**Cold tier.** A detached weekly partition is written as one Parquet file per week (sorted by series_id, at; zstd). Writer options by platform: `pg_parquet` COPY on Crunchy and self-hosted; `pg_duckdb` COPY on self-hosted; an external worker (DuckDB CLI or Python) everywhere, including Supabase, where the file lands in an Analytics Bucket and is read back through the Iceberg wrapper. The read path stays inside `resample()`: for ranges older than the raw horizon it queries the foreign table (or returns rollups only, when the deployment has no cold tier). Octopus Energy's Kraken is the industrial version of the same split: Postgres/Aurora for hot data, Parquet and Delta on S3 queried with Athena and Databricks for the half-hourly history ([AWS case study 2020](https://press.aboutamazon.com/uk/2020/8/octopus-energy-fuels-global-growth-with-aws); [Kraken platform-engineer posting](https://climatebase.org/job/49704965/platform-engineer---data-)); InfluxDB 3 made Parquet on object storage its primary format with DataFusion on top ([InfluxData, architecture of InfluxDB 3](https://www.influxdata.com/learn/architecture-overview-of-influxdb-3/)).

**Compression expectations.** Timescale claims 90–98 % with hypercore; VictoriaMetrics reports 0.4 B per sample in production and quotes Prometheus at 1–2 B, InfluxDB 1.x at ~3 B ([TigerData, compression](https://www.tigerdata.com/docs/use-timescale/latest/compression/about-compression.); [VictoriaMetrics, sample size](https://forge.k3s.fr/github-mirrors/VictoriaMetrics/src/commit/b8300338f0322d0c98a6300e8549ff2d14785797/docs/SampleSizeCalculations.md)). Quarter-hour metering (regular timestamps, slowly varying floats) in Parquet with delta/zstd realistically lands at 2–4 B per point including the timestamp; budget on 4.

## 7. Reference designs in one table

| System | Raw | Rollups | Model notes |
|---|---|---|---|
| Home Assistant | `states`, purged after 10 days | 5-min short-term (purged), hourly long-term (never purged): mean/min/max or last_reset/state/sum | state_class drives which columns; meter resets detected on decrease |
| Emoncms | PHPFina: 4 B per fixed interval, null = gap; PHPTimeSeries 9 B/value | downsample tool, daily kWh feeds | fixed-interval files, no row overhead |
| EnergyID | counter readings (`Counter`), gauges (`Gauge`), `PostmarkedInterval`; `interval` PT5M/PT15M/PT1H/P1D or manual | monthly forecasting | cumulative-first model, consumption derived from two readings ([EnergyID MQTT model](https://help.energyid.eu/en/developer/mqtt-export-data-model-and-payload-format/)) |
| OpenEMS | InfluxDB (FENECON, "merge points" worker) | InfluxDB RP | channel-per-component, Java ([InfluxData/FENECON](https://www.influxdata.com/customer/fenecon/)) |
| Octopus Kraken | Postgres/Aurora + S3 | Parquet/Delta, Athena/Databricks | public API exposes half-hourly consumption |
| InfluxDB 3 / VictoriaMetrics | Parquet on object storage / custom merge tree | query-time | 0.4–4 B per sample |

The Home Assistant "statistics" layer is the cheapest rollup design to copy: one table, one schema, two steps, measurements and meters distinguished by which columns are filled.

## 8. Recommended design for Nexgen OS

**Sizing at target.** 100,000 meters × 96 quarter-hours = 9.6 M rows/day per quantity; with ~5 quantities per meter (import, export, power, reactive, gas or heat) ≈ 48 M rows/day, plus 1-minute sensors (1,440/day each; 10,000 of them = 14.4 M/day). Call it **50 M rows/day, 18 G rows/year**.

| | per row | per year at 50 M/day | per year at 10 M/day |
|---|---|---|---|
| Heap, trimmed layout | 68 B | 1.24 TB | 250 GB |
| PK index | ~38 B | 0.69 TB | 140 GB |
| **Hot total, uncompressed** | **~105 B** | **~1.9 TB** | **~390 GB** |
| Hourly rollup (4.4 G rows/year, ~90 B with 6 aggregates) | | ~400 GB | ~80 GB |
| Daily rollup (183 M rows/year) | | ~17 GB | ~3.5 GB |
| **Cold Parquet** | **2–4 B** | **36–73 GB** | **7–15 GB** |

Today's 11.9 M rows are ~1.4 GB; the design below changes nothing visible for them.

### Stage 0.1 — one partitioned table (ship now)

```sql
create table series_values (
  series_id uuid        not null references series(id) on delete cascade,
  at        timestamptz not null,          -- interval start for interval series
  value     double precision not null,
  quality   smallint    not null default 0 references series_quality_codes(code),
  primary key (series_id, at)
) partition by range (at);

create index series_values_at_brin on series_values using brin (at) with (pages_per_range = 32);

create schema if not exists partman;
create extension if not exists pg_partman with schema partman;
select partman.create_parent(
  p_parent_table    := 'public.series_values',
  p_control         := 'at',
  p_type            := 'range',
  p_interval        := '7 days',
  p_premake         := 4,
  p_start_partition := (date_trunc('week', (select min(at) from series_values_old)))::text
);
create extension if not exists pg_cron;
select cron.schedule('partman-maintenance', '7 3 * * *', $$call partman.run_maintenance_proc()$$);

alter table series_values enable row level security;
create policy series_values_read on series_values for select to authenticated
  using (series_id in (select id from series where organisation_id in (select org_id from my_organisations())));
```

`resample()` becomes `security definer set search_path = ''`, checks the caller's access to the one `series` row, then reads `series_values` directly. Ingestion: `copy series_values_staging from stdin` (unlogged, same columns), then one `insert … select … order by series_id, at on conflict (series_id, at) do update set value = excluded.value, quality = excluded.quality where (series_values.value, series_values.quality) is distinct from (excluded.value, excluded.quality)` per week, then `truncate` the staging table. Migration from the current table: `insert … select` in weekly batches, swap names, as in the Supabase guide.

### Stage 1.0 — rollups, dirty tracking, retention

```sql
create table series_rollups (
  series_id   uuid        not null references series(id) on delete cascade,
  step        interval    not null,            -- '1 hour' or '1 day'
  bucket      timestamptz not null,            -- bucket start, UTC for 1h, site tz for 1d
  n_points    integer     not null,
  n_expected  integer     not null,
  v_sum       double precision, v_avg double precision,
  v_min       double precision, v_max double precision,
  v_first     double precision, v_last double precision,
  last_reset_at timestamptz,
  quality     smallint    not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (series_id, step, bucket)
) partition by list (step);   -- one partition per step, sub-partition 1h by year if needed

create table series_dirty_buckets (series_id uuid, step interval, bucket timestamptz, primary key (series_id, step, bucket));

-- ingestion appends to series_dirty_buckets; the job drains it
select cron.schedule('rollup-1h', '*/10 * * * *', $$call rollup_refresh('1 hour', now() - interval '3 hours')$$);
select cron.schedule('rollup-1d', '20 1 * * *',   $$call rollup_refresh('1 day',  now() - interval '2 days')$$);
```

`rollup_refresh(step, since)` recomputes `(series_id, bucket)` pairs that are either dirty or newer than `since`, from raw for `1 hour` and from the hourly rollup for `1 day` (with `date_trunc('day', bucket, site.tz)`), computing `v_last − v_first` and reset-aware deltas for cumulative quantities. `resample()` routes by step as in section 5 and falls back to raw when `updated_at < series.last_value_at` for the requested range. Retention: `update partman.part_config set retention = pack.raw_retention, retention_keep_table = true where parent_table = 'public.series_values'` with the value read from the country pack at install (no default), and a weekly job that exports each detached partition before dropping it.

### Cloud tier — columnar cold storage

Exported partition → `series_values_<yyyy>_w<ww>.parquet` on object storage (S3, Supabase Analytics Bucket, R2), one file per week sorted by `(series_id, at)`, zstd. Reader by platform: Iceberg wrapper on Supabase, `pg_parquet` or `pg_duckdb` foreign reads on Crunchy/self-hosted, DuckDB in a worker everywhere else. `resample()` gains a third branch for ranges older than the raw horizon (raw step only; rollups already cover coarser steps and never leave Postgres). Optional later accelerator for self-hosted installs: if `SHOW timescaledb.license = 'timescale'`, convert sealed partitions to Hypercore columnstore instead of exporting; keep that behind feature detection and never as a requirement.

**Decision summary.** Plain Postgres 17/18, weekly range partitions by `at` via pg_partman, PK `(series_id, at)` + BRIN on `at`, no `organisation_id` on the hot table, `quality smallint`, `float8` everywhere, RLS through `series` with a security-definer `resample()`, staging-table ingestion sorted per batch, hourly and daily rollups refreshed by pg_cron with dirty-bucket tracking, `resample()` as the only read API routing by step, retention and time zone from pack and site data, cold Parquet on object storage per week. Every piece is available on Supabase, RDS, Crunchy, Azure and bare Postgres today; TimescaleDB is an optional accelerator at most.

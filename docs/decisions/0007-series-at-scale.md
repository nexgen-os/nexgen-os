# 0007 — Series live in plain Postgres, on any host

> Status: accepted · 12/10/2026, rewritten 19/10/2026 · Research:
> [time-series-scale.md](../research/time-series-scale.md),
> [audit-series.md](../research/audit-series.md)

## Context

The product this core comes from holds 11.9 million quarter-hour rows for
about 1,200 meters, 1.4 GB. The core must hold a hundred thousand meters and
sensors at 15-minute to 1-minute resolution — tens of millions of rows a
day, about 1.9 TB a year uncompressed at fifty million rows a day — for
years, on Supabase, on AWS, on Azure or on a bare Postgres. TimescaleDB is
the easy answer and the wrong requirement: compression, continuous
aggregates and retention are under its own licence, and the managed hosts
install the Apache subset or nothing. An external time-series database would
be a second system, a second copy of the model, and row level security lost.

## Decision

**Series live in plain Postgres, with what every host offers.** The values
are range-partitioned by week on their instant; the core ships the
partitioned table and a default partition, so that it works anywhere, and
`pg_partman` and `pg_cron` keep the partitions and the derived aggregates
when the host has them. TimescaleDB and `pg_duckdb` are accelerators an
installation may add; nothing requires them.

**The hot table is narrow.** It carries the series, the instant, the value
and a quality code — no organisation, no unit, no text:

- row level security goes through the series a value belongs to, checked
  once per statement, never per row;
- the quality is a small integer against a code table (good, estimated,
  substituted, missing);
- the value is a double precision number: a register of 1,234,567.891 kWh
  does not survive a single-precision float, and exact decimals belong to
  invoicing;
- the instant is the start of the interval the value covers
  ([0029](0029-a-series-belongs-to-an-object.md)).

**Time zones are the site's, never a constant.** A step shorter than a day
is binned in UTC, safe across daylight-saving changes; a step of a day or
more is cut in the time zone of the object's site. A site without a time
zone has no daily figures: `time_zone_required`, named, rather than a
silent UTC.

**Retention is a default of the installation and its pack.** How long raw
values are kept differs by country and by region; no number lives in the
core, and aggregates outlive the raw values they summarise.

## What it forbids

- A required extension that one managed host does not offer.
- A copy of the series in another store as the truth.
- A time zone, a retention period or a country written in the core.
- A per-row organisation check on the values.

## What it replaced

Three series stores side by side in the product, a time zone written in
code, and readings kept in columns and JSON.

## See also

- Inherits Ekwo OS 0060 (*Under load, the plan is the assertion, not the
  clock*).
- [0029](0029-a-series-belongs-to-an-object.md) — what a series is.
- [0031](0031-one-way-to-write-a-series-one-way-to-read-it.md) — how series
  are written and read, and the aggregates.
- [0021](0021-one-cascade-of-defaults.md) — where retention is resolved.

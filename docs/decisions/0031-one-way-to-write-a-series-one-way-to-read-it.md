# 0031 — One way to write a series, one way to read it, and an aggregate is derived

> Status: accepted · 19/10/2026

## Context

Values entered the first core through a TypeScript helper, through the Home
Assistant import and through plain inserts, each checking quality and units
in its own way, or not at all. A page asking "how much this month" read a
cumulative register and received the last index of the month, so each
caller subtracted and handled resets on its own. A total kept as a stored
number beside the values it sums disagrees with them the day one value is
corrected.

## Decision

**One way to write.** The values of a series are written by one function of
the schema, which takes the unit they came in, converts them, checks their
quality, marks the hours they touch, and keeps the latest value of the
series. Direct inserts are not granted to the people and the agents who
write; every client — the command line, the Python client, a connector, a
module — calls the same function.

**One way to read.** `resample()` answers, for every series and every step,
the amount of each bucket: for a cumulative register, what was consumed or
produced in the bucket, resets handled. The index itself is read as a
window or as the latest value; the latest value of a series is read in one
row, kept by the write path.

**An aggregate is derived, never stored as truth.** Hourly and daily
aggregates are rebuilt from the values, kept fresh from the hours the write
path marked, and read by `resample()` when the step allows; a corrected
value makes its aggregates stale, never wrong.

**A gap is filled on read, and says so.** A filled value is flagged
estimated and written nowhere. A substitute written as a value is a figure:
a run of a module, with its method
([0004](0004-deterministic-runs.md)).

**Every client reads the same rows.** The clients return rows; a dataframe
or an Arrow table is an optional extra of the Python client, and a Parquet
file is written on the client from the same reads.

## What it forbids

- A second write path that checks less than the first.
- A client that subtracts register indexes to find a consumption.
- A stored total edited independently of its values.
- Gap filling written into the values by the core.
- A required heavy dependency to read a series.

## What it replaced

A TypeScript helper as the write path beside plain inserts; `resample()`
answering the last index of a register; aggregates planned as a later
stage.

## See also

- Inherits Ekwo OS 0010 (*Amounts are positive; totals are derived*) and
  0018 (*Reports read the ledger and know no country*).
- [0007](0007-series-at-scale.md) — where the values are stored.
- [0018](0018-one-function-per-gesture.md) — writing values is a gesture.
- [0030](0030-a-value-is-stored-in-the-unit-of-its-quantity.md) — the unit
  conversion on the way in.

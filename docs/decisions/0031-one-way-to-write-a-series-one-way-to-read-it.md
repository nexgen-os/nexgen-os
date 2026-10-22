# 0031 — One way to write a series, one way to read it, and an aggregate is derived

> Status: accepted

## Context

Values arrive through a connector, a file import, a module's run and a
person's hand. If each path checks quality and units in its own way, some
check nothing. A page asking "how much this month" of a cumulative register
wants a consumption, not the last index of the month; left to each caller,
every one subtracts and handles resets on its own. A total kept as a stored
number beside the values it sums disagrees with them the day one value is
corrected.

## Decision

**One way to write.** The values of a series are written by one function of
the schema, `store()`, which takes the unit they came in, converts them,
checks their quality and computes again the aggregates of the hours they
touch. Direct inserts are not granted to the people and the agents who
write; every client — the command line, the Python client, a connector, a
module — calls the same function.

**One way to read.** `resample()` answers, for every series and every step,
the amount of each bucket: for a cumulative register, what was consumed or
produced in the bucket, resets handled. The index itself is read as a
window or as the latest value; the latest value of a series is one row of
a view over the values.

**An aggregate is derived, never stored as truth.** Hourly and daily
aggregates are computed from the values by every statement that writes or
deletes them, with no queue to drain, and read by `resample()` when the
step allows; a corrected value corrects its aggregates in the same
statement.

**A gap is filled on read, and says so.** A filled value is flagged
estimated and written nowhere. A substitute written as a value is a figure:
a run of a module, with its method
([0004](0004-a-figure-is-a-run.md)).

**Every client reads the same rows.** The clients return rows; a dataframe
or an Arrow table is an optional extra of the Python client, and a Parquet
file is written on the client from the same reads.

## What it forbids

- A second write path that checks less than the first.
- A client that subtracts register indexes to find a consumption.
- A stored total edited independently of its values.
- Gap filling written into the values by the core.
- A required heavy dependency to read a series.

## See also

- Inherits Ekwo OS 0010 (*Amounts are positive; totals are derived*) and
  0018 (*Reports read the ledger and know no country*).
- [0007](0007-series-at-scale.md) — where the values are stored.
- [0018](0018-one-function-per-gesture.md) — writing values is a gesture.
- [0030](0030-a-value-is-stored-in-the-unit-of-its-quantity.md) — the unit
  conversion on the way in.

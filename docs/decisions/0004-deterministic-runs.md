# 0004 — A figure is a run, and a finished run never changes

> Status: accepted · 12/10/2026, rewritten 19/10/2026

## Context

A figure shown to an owner, a bank or an administration — a yield, a loss,
a settlement — has to be traceable to what produced it and reproducible
years later. A figure computed by a client and written as a plain number
carries neither: nobody can say which weather, which model or which version
gave it. And a figure overwritten by the next computation silently changes
under every document that quoted it.

## Decision

**A figure is the result of a run.** A module or an engine hands its
result back through one function, `record_run()`: the run records its
inputs, the module, the engine and its version, and its results. Its
identity is the hash of all of them; the same inputs give the same run, and
recording it again returns it.

**A run owns the series it writes.** The values a run produces are series of
that run, never written into a series another run or a measurement already
holds; two runs of the same study are two sets of series, side by side.

**A finished run never changes**, nor do the numbers of its series. A
corrected figure is a new run, which says the one it supersedes; the old
run stays readable, so that whatever quoted it can still be checked.

**Nothing in the core calls a model.** A module that uses one — a machine
learning model, an external service — records it in its engine version and
its inputs, like any other engine.

## What it forbids

- A figure computed by a client, an agent or a page and written as if a run
  had produced it.
- Editing a finished run, its results or the values of its series.
- A run writing into a series it does not own.
- A call to a model or to the network from inside the database.

## What it replaced

Simulated series identified by their object, quantity, kind, source and
scenario, overwritten by the latest run: a past run's figures could change
without anyone recording it.

## See also

- Inherits Ekwo OS 0014 (*A posted entry is immutable, in an open period
  too*), 0016 (*A correction is one gesture*) and 0056 (*The command line
  computes no amount*).
- [0013](0013-external-engines.md) — the engine a run records.
- [0018](0018-one-function-per-gesture.md) — recording a run is a gesture.
- [0029](0029-a-series-belongs-to-an-object.md) — the series a run writes.

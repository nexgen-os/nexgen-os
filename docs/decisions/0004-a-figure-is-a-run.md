# 0004 — A figure is a run of the module that computes it, and a finished run never changes

> Status: accepted

## Context

A figure shown to an owner, a bank or an administration — a yield, a loss,
a settlement — has to be traceable to what produced it and reproducible
years later. A figure computed by a client and written as a plain number
carries neither: nobody can say which weather, which model or which version
gave it. A figure overwritten by the next computation silently changes
under every document that quoted it.

Computing is also the business of a trade. Three modules compute — `solar`
(a yield, the indicators of IEC 61724-1, an exceedance), `consumption` (a
curve reconstructed from a bill) and `community` (the sharing of a
project) — and the platform this core was taken from keeps each
computation with the trade that makes it. A table of runs in the core
would be a trade's object in every installation, whether it computes or
not. Three modules computing the same way is, in turn, a reason not to
write the gesture three times: the identity of a result, its finality and
the finality of its series are one rule.

## Decision

**A figure is the result of a run, and a run is a row of the module that
computes it**: `solar.runs`, `consumption.runs`, `community.runs`. Each has
one shape: its subject as a foreign key to an object of the core named in
the module's words (`device_id` for a PV system, `participant_id`,
`project_id`), the engine version, the inputs, their hash, the results, a
status (`running`, `succeeded`) and its dates. A design variant is the
module's too: the `solar` module keeps the variants of a participant's PV
(`solar.scenarios`), and the core holds the world as it is.

**The core keeps the gesture, and no table.** `start_run()`,
`finish_run()` and `record_run()` take the module's runs table as their
first argument and the subject by its kind and id; `run_hash()` is the
identity of a result, the hash of the runs table, the engine version and
the inputs;
`run_is_final()` is the trigger every runs table puts on itself. The same
inputs to the same engine version find the same run, in whichever module,
and recording it again returns it.

**A run owns the series it writes.** A series a run wrote names it in its
source (`<module>.runs:<run id>`). Its values are written while the run
runs and never after (`run_is_final`, checked by `store()` and by the
trigger of the values), and two runs never share a series, the source
being part of a series' identity; two runs of the same study are two sets
of series, side by side.

**A finished run never changes**, nor do the numbers of its series. A
corrected figure is a new run; the old run stays readable, so that whatever
quoted it can still be checked.

**Another module names a run by its id.** A bill of the `billing` module
says which settlement run its amounts came from by the run's id, never by
a foreign key to another module's table
([0032](0032-a-module-has-its-own-schema.md)).

**Nothing in the core calls a model.** A module that uses one — a machine
learning model, an external service — records it in its engine version and
its inputs, like any other engine.

## What it forbids

- A figure computed by a client, an agent or a page and written as if a run
  had produced it.
- Editing a finished run, its results or the values of its series.
- A run writing into a series it does not own.
- A runs table, or a table of design variants, in the core.
- A module writing its runs another way than through the core's gesture,
  or a runs table of another shape.
- A module table with a foreign key to another module's runs.
- A call to a model or to the network from inside the database.

## See also

- Inherits Ekwo OS 0014 (*A posted entry is immutable, in an open period
  too*), 0016 (*A correction is one gesture*) and 0056 (*The command line
  computes no amount*).
- [0013](0013-a-program-connector-reads-one-request.md) — the engine a run
  records.
- [0018](0018-one-function-per-gesture.md) — recording a run is a gesture.
- [0029](0029-a-series-belongs-to-an-object.md) — the series a run writes.
- [0032](0032-a-module-has-its-own-schema.md) — a module has its own schema.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — a module
  starts from an object of the core.

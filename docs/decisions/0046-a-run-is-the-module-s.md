# 0046 — A run is the module's, and the core keeps the one gesture that writes it

> Status: accepted · 22/10/2026

## Context

A figure is a run ([0004](0004-deterministic-runs.md)), and three modules
compute one: `solar` (a yield, the indicators of IEC 61724-1, an
exceedance), `consumption` (a curve reconstructed from a bill) and
`community` (the sharing of a project). Until 0.3 the core held one `runs`
table for all of them, its subject named by a kind and an id like any
attachment, and `scenarios` beside it. The platform this core was taken
from holds neither: a computation is the business of the trade that
computes it. A `runs` table in the core is a trade's object in every
installation, whether it computes or not, and its subject of any kind kept
alive the table of kinds the six objects no longer need
([0006](0006-named-objects.md), [0044](0044-there-is-no-registry.md)).

Three modules computing the same way is also a reason not to write the
gesture three times: the identity of a result, its finality and the
finality of its series are one rule.

## Decision

**A run is a row of the module that computes it**: `solar.runs`,
`consumption.runs`, `community.runs`. Each has one shape: its subject as a
foreign key to an object of the core named in the module's words
(`device_id` for a PV system, `participant_id`, `project_id`), the engine
version, the inputs, their hash, the results, a status (`running`,
`succeeded`) and its dates. A design variant is the module's too: the
`solar` module keeps the variants of a participant's PV
(`solar.scenarios`), and the core holds the world as it is.

**The core keeps the gesture, and no table.** `start_run()`,
`finish_run()` and `record_run()` take the module's runs table as their
first argument and the subject by its kind and id; `run_hash()` is the
identity of a result; `run_is_final()` is the trigger every runs table
puts on itself. The same inputs to the same engine version find the same
run, in whichever module.

**A series a run wrote names it in its source**: `<module>.runs:<run
id>`. Its values are written while the run runs and never after
(`run_is_final`, checked by `store()` and by the trigger of the values),
and two runs never share a series, the source being part of a series'
identity.

**Another module names a run by its id.** A bill of the `billing` module
says which settlement run its amounts came from by the run's id, never by
a foreign key to another module's table
([0032](0032-a-module-has-its-own-schema.md)).

## What it forbids

- A runs table, or a scenarios table, in the core.
- A module writing its runs another way than through the core's gesture,
  or a runs table of another shape.
- A module table with a foreign key to another module's runs.

## What it replaced

`nexgen.runs` with its `subject_kind` / `subject_id`, `nexgen.scenarios`,
`series.run_id` and `series.scenario_id`, `discard_superseded_series()`
and the `superseded` status (0.1 to 0.3 before this record).

## See also

- [0004](0004-deterministic-runs.md) — a figure is a run.
- [0032](0032-a-module-has-its-own-schema.md) — a module has its own schema.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — a module
  starts from an object of the core.

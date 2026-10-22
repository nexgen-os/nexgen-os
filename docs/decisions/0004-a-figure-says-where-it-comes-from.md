# 0004 — A figure says where it comes from

> Status: accepted

## Context

A figure shown to an owner, a bank or an administration — a yield, a loss,
a settlement — has to say what produced it. A figure computed by a client
and written as a plain number says nothing: nobody can tell which weather,
which model or which version gave it, nor when.

Computing is also the business of a trade. Three modules compute — `solar`
(a yield, the indicators of IEC 61724-1, an exceedance), `consumption` (a
curve reconstructed from a bill) and `community` (the sharing of a
project) — and the platform this core was taken from keeps each
computation with the trade that makes it, named after what it produces: a
roof's estimates, a community's settlements. Its table of a roof's
estimates keeps the result, where it comes from (`provenance`) and when it
was made and last changed, in a plain table; who did what is followed by an
activity log beside it. A table of figures in the core would be a trade's
object in every installation, whether it computes or not.

## Decision

**A figure is a row of the module that computes it, in a plain table named
after what it is**: `solar.estimates` (a yield, a P50 and P90, the IEC
61724-1 indicators: what a PV system is estimated to give or gave),
`consumption.estimates` (a curve rebuilt from a bill or an annual
consumption), `community.settlements` (the sharing of a project over a
period, for all its participants). Each has one shape: its subject as a
foreign key to an object of the core named in the module's words
(`device_id` for a PV system, `participant_id`, `project_id`), its
`provenance` (the program and the version that computed it), its `inputs`,
its `results`, `created_at` and `updated_at`. A design variant is the
module's too: the `solar` module keeps the variants of a participant's PV
(`solar.variants`), and the core holds the world as it is.

**A figure says where it comes from.** The provenance names the program and
its version (`pvgis-5.3+solar-0.3.0`, `pvlib 0.16.1`); the inputs name
everything it read — the weather and its source, the period, the profile,
the parameters and the level each came from — so that anyone can read what
a figure rests on, and compute it again with the same program.

**Each module writes its figures with its own function**, one gesture per
function ([0018](0018-one-function-per-gesture.md)): `estimateYield()`,
`performanceIndicators()` and `exceedance()` write `solar.estimates`,
`reconstructConsumption()` writes `consumption.estimates`, `settleSharing()`
writes `community.settlements`. The core keeps no table and no gesture of
its own for them.

**A new computation adds a row, or replaces one.** Given the row it
replaces (`replaces`), it keeps the row's id and writes the new provenance,
inputs and results; `updated_at` says when.

**A figure's series name it.** A series it wrote names the row in its
source (`<module>.<table>:<id>`, `solar.estimates:<id>`), and two figures
never share a series, the source being part of a series' identity; two
estimates of the same study are two sets of series, side by side. When a
row is replaced, its series are written again.

**Another module names a figure by its id.** A bill of the `billing` module
says which settlement its amounts came from by the settlement's id
(`settlement_id`), never by a foreign key to another module's table
([0032](0032-a-module-has-its-own-schema.md)).

**Nothing in the core calls a model.** A module that uses one — a machine
learning model, an external service — names it in the provenance and the
inputs, like any other program.

## What it forbids

- A figure computed by a client, an agent or a page and written as if a
  module had computed it.
- A figure without its provenance or its inputs.
- A figure writing into a series it does not own.
- A table of figures, or a table of design variants, in the core.
- A table of figures of another shape, or named after a gesture rather than
  after what it holds.
- A module table with a foreign key to another module's figures.
- A call to a model or to the network from inside the database.

## See also

- Inherits Ekwo OS 0056 (*The command line computes no amount*).
- [0013](0013-a-program-connector-reads-one-request.md) — the program a
  figure names in its provenance.
- [0018](0018-one-function-per-gesture.md) — writing a figure is a
  gesture of its module.
- [0029](0029-a-series-belongs-to-an-object.md) — the series a figure
  writes.
- [0032](0032-a-module-has-its-own-schema.md) — a module has its own schema.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — a module
  starts from an object of the core.
- [road to 1.0](../road-to-1.0.md) — an activity log of who did what, when.

# 0004 — A figure names its inputs and never changes

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
computation with the trade that makes it, named after what it produces: a
roof's estimates, a community's settlements. A table of figures in the
core would be a trade's object in every installation, whether it computes
or not. Three modules computing the same way is, in turn, a reason not to
write the gesture three times: the identity of a result, its finality and
the finality of its series are one rule.

## Decision

**A figure is a row of the module that computes it, in a table named after
what it is**: `solar.estimates` (a yield, a P50 and P90, the IEC 61724-1
indicators: what a PV system is estimated to give or gave),
`consumption.estimates` (a curve rebuilt from a bill or an annual
consumption), `community.settlements` (the sharing of a project over a
period, for all its participants). Each has one shape: its subject as a
foreign key to an object of the core named in the module's words
(`device_id` for a PV system, `participant_id`, `project_id`), the engine
version, the inputs, their hash, the results, a status (`started`,
`finished`) and its dates. A design variant is the module's too: the
`solar` module keeps the variants of a participant's PV (`solar.variants`),
and the core holds the world as it is.

**The core keeps the gesture, and no table.** One word names it for every
module, a calculation: `start_calculation()`, `finish_calculation()` and
`record_calculation()` take the module's table as their first argument and
the subject by its kind and id; `calculation_hash()` is the identity of a
result, the hash of the table, the engine version and the inputs;
`calculation_is_final()` is the trigger every such table puts on itself,
and what marks it as one. The same inputs to the same engine version find
the same row, in whichever module, and recording it again returns it.

**A calculation owns the series it writes.** A series it wrote names it in
its source (`<module>.<table>:<id>`, `solar.estimates:<id>`). Its values
are written before the calculation finishes and never after
(`calculation_is_final`, checked by `store()` and by the trigger of the
values), and two calculations never share a series, the source being part
of a series' identity; two estimates of the same study are two sets of
series, side by side.

**A finished calculation never changes**, nor do the numbers of its series.
A corrected figure is a new row; the old one stays readable, so that
whatever quoted it can still be checked.

**Another module names a figure by its id.** A bill of the `billing` module
says which settlement its amounts came from by the settlement's id
(`settlement_id`), never by a foreign key to another module's table
([0032](0032-a-module-has-its-own-schema.md)).

**Nothing in the core calls a model.** A module that uses one — a machine
learning model, an external service — records it in its engine version and
its inputs, like any other engine.

## What it forbids

- A figure computed by a client, an agent or a page and written as if a
  module had computed it.
- Editing a finished calculation, its results or the values of its series.
- A calculation writing into a series it does not own.
- A table of figures, or a table of design variants, in the core.
- A module writing its figures another way than through the core's
  gesture, or a table of them of another shape.
- A table named after the gesture rather than after what it holds.
- A module table with a foreign key to another module's figures.
- A call to a model or to the network from inside the database.

## See also

- Inherits Ekwo OS 0014 (*A posted entry is immutable, in an open period
  too*), 0016 (*A correction is one gesture*) and 0056 (*The command line
  computes no amount*).
- [0013](0013-a-program-connector-reads-one-request.md) — the engine a
  calculation records.
- [0018](0018-one-function-per-gesture.md) — recording a calculation is a
  gesture.
- [0029](0029-a-series-belongs-to-an-object.md) — the series a calculation
  writes.
- [0032](0032-a-module-has-its-own-schema.md) — a module has its own schema.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — a module
  starts from an object of the core.

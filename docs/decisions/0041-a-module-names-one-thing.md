# 0041 — A module names one thing with its own physics, and there is no catch-all

> Status: accepted · 20/10/2026

## Context

The table of modules grew by naming what might be needed: a `generators`
module for wind, hydro, cogeneration and biomass; a `compliance` module for
what a country requires; a `nature` module for the ground around a site; a
`sharing` module beside `community`; a `portfolio` module for indicators;
a `publications` module for what an owner makes public. Each name was a
drawer, and a drawer holds things that are computed differently: a wind
turbine is a power curve at hub height, a hydro plant a head and a flow, a
cogeneration unit a fuel and a heat level. A reader of the table could not
tell what a module would hold, and a contributor could not tell where a new
thing went.

## Decision

**A module names one thing, and that thing has its own physics or its own
objects.** `solar` is the model: PV systems and arrays, their product
physics, a yield run that says what it was computed from
([0012](0012-solar-module.md)). `wind` will be the same for turbines;
`storage` for batteries; `charging` for chargers; `heating` for heat pumps
and boilers. A module exists when a trade has objects and a computation
that no other module holds.

**There is no catch-all.** No module named after a category (`generators`,
`renewables`, `other_sources`), after a quality (`compliance`,
`sustainability`) or after a view of the data (`portfolio`, `reporting`).
What a country requires is in its pack and in `tasks`, with its legal
reference and its condition ([0017](0017-tasks-as-data.md),
[0020](0020-a-pack-holds-what-a-function-reads.md)). The ground of a site
is attributes of the core until a computation needs more. Indicators are
data of a `kpis` module: a formula over series, a period, a unit, a target.

**Two modules about the same objects are one module.** Who takes part in a
project and who received how much are the same participants: the
allocation keys of a participant and the volumes allocated to it live in
`community`, beside the participant they describe, not in a `sharing`
module of their own.

**What every installation needs is the core's, not a module's.** A
publication is a frozen document and a schema of its own for the anonymous
role ([0015](0015-publications.md)); it needs no module schema and no
registry row.

**A site is not always built.** A ground-mounted PV plant, a field, a car
park or a pond is a site whose surfaces lie on the ground, with no building
at all ([0026](0026-a-device-is-placed-on-a-surface-or-in-a-space.md)); a
module's vocabulary and documentation never assume a roof.

## What it forbids

- A module whose name is a category, a quality or a view rather than a
  thing of a trade.
- A module listed in the table without the objects it adds and the
  computation it carries.
- Two modules whose tables describe the same objects.
- A "later" row that names a drawer: a module is listed when its one thing
  is known.

## What it replaced

The rows `generators`, `compliance`, `nature`, `sharing`, `portfolio` and
`publications` of the module table (20/10/2026): `generators` became
`wind`, `sharing` was merged into `community`, `portfolio` became `kpis`,
the three others left.

## See also

- [0032](0032-a-module-has-its-own-schema.md) — what a module is, in the
  database.
- [0006](0006-named-objects.md) — the core names a few objects.
- [0028](0028-two-objects-that-are-one-are-merged.md) — the same rule for
  objects.
- `modules/README.md` — the table, and the rules in practice.

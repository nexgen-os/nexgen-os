# 0041 — A module names one thing with its own physics, and there is no catch-all

> Status: accepted

## Context

A table of modules grows easily by naming what might be needed: a module
for every kind of generator, one for what a country requires, one for the
ground around a place, one for indicators. Each such name is a drawer, and
a drawer holds things that are computed differently: a wind turbine is a
power curve at hub height, a hydro plant a head and a flow, a cogeneration
unit a fuel and a heat level. A reader of the table cannot tell what a
drawer would hold, and a contributor cannot tell where a new thing goes.

## Decision

**A module names one thing, and that thing has its own physics or its own
objects.** `solar` is the model: PV systems and arrays, their product
physics, a yield run that says what it was computed from
([0012](0012-a-yield-says-what-it-was-computed-from.md)). A turbine, a
battery, a charger or a heat pump is the one thing of a module of its own,
with its own physics. A module exists when a trade has objects and a
computation that no other module holds.

**There is no catch-all.** No module is named after a category
(`renewables`, `other_sources`), after a quality (`sustainability`) or
after a view of the data (`reporting`). What a country requires is in its
pack and in `tasks`, with its reference and its condition
([0017](0017-tasks-as-data.md),
[0020](0020-a-pack-holds-what-a-function-reads.md)). What a place's ground
is beyond its outline and its use is an attribute until a computation needs
more. Indicators are data of a `kpis` module: a formula over series, a
period, a unit, a target.

**Two modules about the same objects are one module.** Who takes part in a
project and who received how much are the same participants: the
allocation keys of a participant and the volumes allocated to it live in
`community`, beside the participant they describe.

**What every installation needs is the core's, not a module's.** A
publication is a frozen document and a schema of its own for the anonymous
role ([0015](0015-publications.md)); it needs no module.

**A place is not always built.** A ground-mounted PV plant, a field, a car
park or a pond is a ground (`building.sites`) whose surfaces lie on it, with
no building at all ([0026](0026-a-device-belongs-to-its-participant.md)); a
module's vocabulary and documentation never assume a roof.

## What it forbids

- A module whose name is a category, a quality or a view rather than a
  thing of a trade.
- A module listed in the table without the objects it adds and the
  computation it carries.
- Two modules whose tables describe the same objects.
- A row of the table that names a drawer: a module is listed when its one
  thing is known.

## See also

- [0032](0032-a-module-has-its-own-schema.md) — what a module is, in the
  database.
- [0006](0006-the-core-names-six-objects.md) — the core names six objects.
- [0028](0028-two-objects-that-are-one-are-merged.md) — the same rule for
  objects.
- `modules/README.md` — the table, and the rules in practice.

# 0042 — A module starts from an object of the core and enriches it

> Status: accepted

## Context

A module that holds a notion of its own, with no path to the core, splits
the model in two: what one installation calls a project, another cannot
read. The objects every page walks — the project, its participants, their
meters — are read by every module and by the core's own exports, and a
person signed in works on a project before any trade is chosen. Were one
of them a module's, the core and the other modules would depend on that
module, which [0032](0032-a-module-has-its-own-schema.md) forbids, and a
module's absence would surface as `module_required` in places that have
nothing to do with its trade.

## Decision

**A module starts from an object of the core and enriches it**, in one of
three forms and no other:

- **a derived table**, with the same id as the core object it enriches:
  `solar.pv_systems` derives devices of type `solar` through
  `derive_devices()`, `grid.meters` adds the operator and the voltage
  level of a meter, `billing.companies` is keyed by the organisation's
  own id. A derived table that is the module's side of a core object carries
  that object's name in the module schema — `grid.meters` is the meter as the
  grid sees it, `billing.contacts` the contact as the invoicing side sees it: one
  word per thing across schemas — and a derived table that holds a subtype
  carries the subtype's name (`solar.pv_systems`);
- **a secondary table**, with a foreign key to a core object:
  `solar.pv_arrays` belongs to a PV system, `building.sites` and
  `building.buildings` belong to a participant, `solar.estimates` to the PV
  system it computed — objects of the module, described in their own
  columns — or, for a table about an object of the core of any kind, a kind
  column checked on the six words of the core beside the object's id:
  `tasks.tasks` is about a project, a participant, a meter or a device
  ([0001](0001-the-hierarchy-is-the-foreign-keys.md));
- **vocabulary rows** in the core's vocabularies, marked with the module in
  `published_by`: the `allocation_key` property of `community`, the
  quantities of `weather`, a module's device types.

**Every table of a module schema that carries `organisation_id` reaches a
table of the core other than `organisations` by a path of foreign keys.**
`organisation_id` is the tenancy every table carries, not an object it
enriches; a table keyed by the organisation's id itself derives the
organisation and keeps to the rule. `nexgen-os doctor` checks it on every
installation and names the table that does not (`module_table_detached`).

**The objects every installation walks are the core's**: organisation →
project → participant → meter and device → series
([0006](0006-the-core-names-six-objects.md)). A module enriches any of them; none of
them is a module's. **The participant is the node every module starts
from** ([0043](0043-the-participant-is-the-node.md)): the physical
description of its place — its ground, its buildings, spaces and surfaces
— is the `building` module's, the grid side of its meters `grid`'s, its
bills `billing`'s, its share of a community `community`'s, its tasks
`tasks`', its weather `weather`'s.

**The examples say which modules they need, and need no more.** Example
01 (a house) needs the core only; 04 (a farm) records its estimates as runs
of `solar`; 03 (an energy community) needs `community`, `grid` and
`billing`; 02 (a school), 05 (a district), 06 (a drone survey) and 07 (an
office) describe buildings and install `building` first.

## What it forbids

- A module table that carries `organisation_id` and reaches the core only
  through `organisations`.
- A notion of the core — a project, a participant, a connection point —
  held in a module schema, or a core function that raises `module_required`.
- A module that reads another module's tables to find a core object.
- A module's own copy of a core column (the identifier of a meter, the
  country of a project): it reads the core's.

## See also

- [0006](0006-the-core-names-six-objects.md) — the six objects of the core.
- [0043](0043-the-participant-is-the-node.md) — the participant is the node.
- [0032](0032-a-module-has-its-own-schema.md) — what a module is, in the
  database.
- [0041](0041-a-module-names-one-thing.md) — what a module names.
- [0001](0001-the-hierarchy-is-the-foreign-keys.md) — the hierarchy is the foreign keys.
- `modules/README.md` — the rules in practice.

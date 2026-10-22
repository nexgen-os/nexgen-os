# 0042 — A module starts from an object of the core and enriches it

> Status: accepted · 21/10/2026, completed the same day, rewritten 22/10/2026

## Context

Schema 0.2 left the project, the participant and the connection point to
two optional modules, `community` and `grid`. The rest of the repository
showed at once that they were not optional: the `tasks` module planned the
work of a `community.projects` row and refused to install without it, the
GeoJSON export of `@nexgen-os/core` read `community.participants`, and
`community.participant_meters()` raised `module_required` when `grid` was
absent. The core and one module depended on another module, which
[0032](0032-a-module-has-its-own-schema.md) forbids; and a person signed
in works on a project before any trade is chosen. A module that holds a
notion of its own, with no path to the core, splits the model in two: what
one installation calls a project, another cannot read.

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
  `building.buildings` belong to a participant, `solar.runs` to the PV
  system it computed — objects of the module, described in their own
  columns — or, for a table about an object of the core of any kind, a kind
  column checked on the six words of the core beside the object's id:
  `tasks.tasks` is about a project, a participant, a meter or a device
  ([0044](0044-there-is-no-registry.md));
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
([0006](0006-named-objects.md)). A module enriches any of them; none of
them is a module's. **The participant is the node every module starts
from** ([0045](0045-the-participant-is-the-node.md)): the physical
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

## What it replaced

Schema 0.2, where `community.projects` and `community.participants` held the
project and its participants and `grid.meters` held the connection point,
with its operator as a column (rewritten in place for 0.3.0, 21/10/2026).
The projects, the participants and the meters moved to the core; `grid`
kept the operators and now derives the core's meter in a `grid.meters` of its
own, the grid side of it; `community` kept energy
sharing; the `behind_meter` link became `devices.meter_id`, the link
keeping the history. The same release moved `buildings`, `spaces` and
`surfaces` and the placement of a device from the core to the `building` module,
and `solar.pv_arrays.surface_id` became a `placed_on` link; then `sites`
left the core, `devices.meter_id`, `building.devices` and the `placed_on`
link were withdrawn, and the participant became the node
([0045](0045-the-participant-is-the-node.md)).

## See also

- [0006](0006-named-objects.md) — the six objects of the core.
- [0045](0045-the-participant-is-the-node.md) — the participant is the node.
- [0032](0032-a-module-has-its-own-schema.md) — what a module is, in the
  database.
- [0041](0041-a-module-names-one-thing.md) — what a module names.
- [0044](0044-there-is-no-registry.md) — the hierarchy is the foreign keys.
- `modules/README.md` — the rules in practice.

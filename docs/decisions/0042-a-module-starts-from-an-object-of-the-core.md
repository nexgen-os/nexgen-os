# 0042 — A module starts from an object of the core and enriches it

> Status: accepted · 21/10/2026

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
  level of a meter, `building.devices` says where on its site a device is,
  `billing.companies` is keyed by the organisation's
  own id. A derived table that is the module's side of a core object carries
  that object's name in the module schema — `grid.meters` is the meter as the
  grid sees it, `billing.contacts` the contact as the invoicing side sees it: one
  word per thing across schemas — and a derived table that holds a subtype
  carries the subtype's name (`solar.pv_systems`);
- **a secondary table**, with a foreign key to a core object: `tasks.tasks`
  is about one object of the registry, `solar.pv_arrays` belongs to a PV
  system, `building.buildings` stands on a site — a kind of object of the
  module, declared with `declare_object()`, which `site_of()` reaches like
  any other;
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
project → participant → site → meter → device → series
([0006](0006-named-objects.md)). A module enriches any of them; none of
them is a module's. The physical description of a site — its buildings,
spaces and surfaces, where a device sits among them — is the `building`
module's.

**The examples say which modules they need, and need no more.** Examples
01 (a house) and 04 (a farm) need the core only; 03 (an energy community)
needs `community`, `grid` and `billing`; 02 (a school), 05 (a district),
06 (a drone survey) and 07 (an office) describe buildings and install `building`
first.

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
and `solar.pv_arrays.surface_id` became a `placed_on` link.

## See also

- [0006](0006-named-objects.md) — the seven objects of the core.
- [0032](0032-a-module-has-its-own-schema.md) — what a module is, in the
  database.
- [0041](0041-a-module-names-one-thing.md) — what a module names.
- `modules/README.md` — the rules in practice.

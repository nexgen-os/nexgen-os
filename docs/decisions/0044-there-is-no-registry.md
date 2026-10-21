# 0044 — There is no registry: the hierarchy is the foreign keys, and an attachment names its object's kind

> Status: accepted · 21/10/2026

## Context

Until 0.3 every named table of the core and of the modules mirrored its
rows into one table, `objects`: one row per organisation, project,
participant, site, meter, device, building, surface, PV array, task…, with
its kind, its organisation and its scenario, kept by a `register_object()`
trigger on every table. Around it grew `object_kinds` (the table of each
kind and the columns leading to its parents), `declare_object()` to put a
table under the triggers, then `object_parent_tables`, `declare_parents()`
and `ancestor_of()` so that a module could give an object of the core
parents of its own. The registry served one purpose: an attribute, an
identifier, a link, a document, a series or a run may hang on an object of
any kind, and a foreign key needs one table to point to.

Three rules govern the shape of this repository, and the registry failed
all three. **Keep it simple**: a second copy of every row, a procedure to
create triggers and a graph walk over column names, where the platform this
core comes from has none. **Few words**: an object had two homes, its table
and its registry row, and the hierarchy two descriptions, the foreign keys
and `object_kinds.parent_columns`. **Stay close to the platform**, which
proved itself in the field: there, a project belongs to an organisation, a
participant to a project, a meter to a participant, a device to a meter and
a site, through foreign keys, and nothing else.

## Decision

**The hierarchy is the foreign keys.** Each table keeps its own columns and
its own foreign keys; nothing mirrors them. `parent_check` is a plain
trigger per foreign key that reads the parent's row in the parent's table
(same organisation, compatible scenario).

**An attachment names its object by its kind and its id.** `attributes`,
`external_ids`, `documents`, `series` carry `object_kind` beside
`object_id`; `links` carry `subject_kind` / `subject_id` and `object_kind` /
`object_id`; `runs` carry `subject_kind` / `subject_id`. Every kind column
references `kinds`, a small vocabulary — the kind, the table holding it,
who published it — filled by plain inserts: the core's kinds in its seed,
a module's in its first migration. A module table that attaches to an
object of any kind (`tasks.tasks`, `solar.horizons`,
`consumption.activity_hours`) does the same.

**The gestures take the kind.** `set_attribute`, `add_identifier`,
`link_objects`, `attach_document`, `series_ensure`, `start_run`,
`record_run`, `split_object` and `merge_objects` name the object by its
kind and its id; the organisation an attachment is stored in is the
object's, read by `object_organisation(kind, id)` with one query on the
kind's table, which refuses `kind_unknown` and `object_not_found` by name
— an object of an organisation the caller does not read is not found — and
an attachment that says another organisation is refused as
`object_in_other_organisation`.

**What is attached goes with its object.** `drop_attachments()`, after
delete on the table of each kind (one `create trigger` line per table, in
the core and in the modules), deletes the rows of every table whose kind
column references `kinds` that name the deleted row. `nexgen-os doctor`
names, by kind, the attachments whose object no longer exists
(`attachments_orphaned`).

**Where an object is, through the foreign keys.** `site_of(kind, id)` is a
`case` over the core's kinds (a site, a participant, a meter, a device by
their `site_id`, a series or a run by its object); a module answers for its
own kinds with `<schema>.site_of(kind, id)` — `building.site_of`,
`solar.site_of` — and the core hands the question over without naming the
module. `parameter_of(kind, id, …)` cascades through `parents_of()`, the
core's foreign keys written out (a device's site, meter, participant and
project), then the organisation, the region and the country; a module that
places an object of the core among its own resolves through them first —
`building.parameter_of()` reads the space, surface and building of a
placed device before asking the core.

## What it forbids

- A registry under any name: a table with one row per object of every
  table.
- A trigger that mirrors every row of a table into another table.
- A core function that resolves a module's parents, or a procedure that
  creates the triggers of a module's table.
- An attachment without the kind of its object, or a foreign key from an
  attachment to one table of every object.

## What it replaced

`objects`, `object_kinds`, `register_object()`, `register_organisation()`,
`declare_object()`, `object_parent_tables`, `declare_parents()`,
`parents_of(uuid)`, `ancestor_of()` and `ancestors_of()` (0.1 to 0.3 before
this record); `site_of(uuid)`, `country_of(uuid)` and `parameter_of(uuid, …)`
and the gestures that took an object's id alone; the migration
`20261012200900_core_object_kinds_rls.sql`, now `20261012200900_core_rls.sql`.

## See also

- [0006](0006-named-objects.md) — the objects of the core, and what is
  attached to them.
- [0023](0023-an-organisation-is-an-object.md) — an organisation is an
  object.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — a module
  starts from an object of the core.
- [`docs/model.md`](../model.md) — the model on one page.

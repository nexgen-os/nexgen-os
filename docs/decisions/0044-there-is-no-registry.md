# 0044 — There is no registry: the hierarchy is the foreign keys, and an attachment names its object's kind

> Status: accepted · 21/10/2026, rewritten 22/10/2026

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
participant to a project, a meter and a device to a participant, through
foreign keys, and nothing else ([0045](0045-the-participant-is-the-node.md)).

The table of kinds that replaced the registry kept the same door open: a
module inserted kinds of its own, and any table of any module could carry
attributes, identifiers, links, documents, series and runs. Ekwo OS, built
on the same playbook, attaches its files with a plain kind column and a
check on the few words it knows.

## Decision

**The hierarchy is the foreign keys.** Each table keeps its own columns and
its own foreign keys; nothing mirrors them. `parent_check` is a plain
trigger per foreign key that reads the parent's row in the parent's table
and refuses a parent of another organisation.

**An attachment names its object by its kind and its id, and the kind is
one of the six objects of the core.** `attributes`, `external_ids`,
`documents` and `series` carry `object_kind` beside `object_id`, with
`check (object_kind in ('organisation', 'project', 'participant', 'meter',
'device', 'series'))`, as Ekwo OS attaches its files: no table of kinds, no
foreign key to one. A module table about an object of the core
(`tasks.tasks`, `solar.horizons`, `consumption.activity_hours`) does the
same with the same check. A module's own objects — a site, a building, a
space, a surface, a PV array, a weather point — are not kinds: what
describes them is their columns, and a relation is a column pointing to
an object of the core.

**The gestures take the kind.** `set_attribute`, `add_identifier`,
`attach_document` and `series_ensure` name the object by its kind and its
id; the organisation an attachment is stored in is the object's, read by
`object_organisation(kind, id)` in the table of the kind, which refuses
`kind_unknown` and `object_not_found` by name — an object of an
organisation the caller does not read is not found — and an attachment
that says another organisation is refused as `object_in_other_organisation`.

**What is attached goes with its object.** `drop_attachments()`, after
delete on the table of each of the six objects, deletes the rows that name
the deleted row in every table with an `object_kind` and an `object_id`
(or `subject_kind` and `subject_id`) column. `nexgen-os doctor` names, by
kind, the attachments whose object no longer exists
(`attachments_orphaned`).

**Whose an object is, through the foreign keys.** `participant_of(kind,
id)` is a `case` over the core's kinds (a participant itself, a meter and a
device by their `participant_id`, a series by its object). A module that
needs the same for its own objects follows its own foreign keys
(`building.participant_of`), and the core does not hand anything over.
`parameter_of(kind, id, …)` cascades through `parents_of()`, the core's
foreign keys written out (a device's participant, its group and its
project), then the organisation, and the region and the country of the
participant's place.

## What it forbids

- A registry under any name: a table with one row per object of every
  table.
- A trigger that mirrors every row of a table into another table.
- A core function that resolves a module's parents, or a procedure that
  creates the triggers of a module's table.
- An attachment without the kind of its object, or a foreign key from an
  attachment to one table of every object.
- A table of kinds, or a kind that is not one of the six objects of the
  core.

## What it replaced

`objects`, `object_kinds`, `register_object()`, `register_organisation()`,
`declare_object()`, `object_parent_tables`, `declare_parents()`,
`parents_of(uuid)`, `ancestor_of()` and `ancestors_of()` (0.1 to 0.3 before
this record); `site_of(uuid)`, `country_of(uuid)` and `parameter_of(uuid, …)`
and the gestures that took an object's id alone; then `site_of(kind, id)`,
which [0045](0045-the-participant-is-the-node.md) replaced by
`participant_of(kind, id)`; the migration
`20261012200900_core_object_kinds_rls.sql`, now `20261012200900_core_rls.sql`.
Then the table `kinds`, where modules inserted kinds of their own, the
`links` between objects of any kinds, and `participant_of()` handing a
module's kind to `<schema>.participant_of()` (22/10/2026).

## See also

- [0006](0006-named-objects.md) — the objects of the core, and what is
  attached to them.
- [0023](0023-an-organisation-is-an-object.md) — an organisation is an
  object.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — a module
  starts from an object of the core.
- [`docs/model.md`](../model.md) — the model on one page.

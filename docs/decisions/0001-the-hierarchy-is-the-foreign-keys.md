# 0001 — The hierarchy is the foreign keys, and an attachment names its object's kind

> Status: accepted

## Context

An attribute, an identifier, a document or a series may hang on an
organisation, a project, a participant, a meter, a device or another
series. A foreign key points to one table, so something has to say which
table an attachment's object lives in. The tempting answers are a registry
— one table mirroring every row of every table, kept by triggers — or a
table of kinds that any module may extend. Both give an object two homes
and the hierarchy two descriptions, its foreign keys and the registry's
copy of them; both open a door through which any table of any module
becomes something to attach to.

Three rules govern the shape of this repository. **Keep it simple**: no
second copy of a row, no procedure that creates triggers, no graph walk
over column names. **Few words**: one home per object, one description of
the hierarchy. **Stay close to the platform the core was taken from**,
which proved its structure in the field: a project belongs to an
organisation, a participant to a project, a meter and a device to a
participant, through foreign keys and nothing else
([0043](0043-the-participant-is-the-node.md)). Ekwo OS, built on the same
playbook, attaches its files with a plain kind column and a check on the
few words it knows.

## Decision

**The hierarchy is the foreign keys.** Each table keeps its own columns and
its own foreign keys; nothing mirrors them. `parent_check` is a plain
trigger per foreign key that reads the parent's row in the parent's table
and refuses a parent of another organisation.

**An attachment names its object by its kind and its id, and the kind is
one of the six objects of the core.** `attributes`, `identifiers`,
`documents` and `series` carry `object_kind` beside `object_id`, with
`check (object_kind in ('organisation', 'project', 'participant', 'meter',
'device', 'series'))`. A module table about an object of the core
(`planning.tasks`, `solar.horizons`, `consumption.activity_hours`) does the
same with the same check. A module's own objects — a ground, a building, a
space, a surface, a PV array, a weather point — are not kinds: what
describes them is their columns, and a relation is a column pointing to an
object of the core.

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
kind, the attachments whose object is gone
(`attachments_orphaned`).

**Whose an object is, through the foreign keys.** `participant_of(kind,
id)` is a `case` over the core's kinds: a participant itself, a meter and a
device by their `participant_id`, a series by its object. A module that
needs the same for its own objects follows its own foreign keys
(`building.participant_of`). `parameter_of(kind, id, …)` cascades through
`parents_of()`, the core's foreign keys written out (a device's
participant, its group and its project), then the organisation, and the
region and the country of the participant's place.

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

## See also

- [0006](0006-the-core-names-six-objects.md) — the objects of the core, and
  what is attached to them.
- [0023](0023-an-organisation-is-an-object.md) — an organisation is an
  object.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — a module
  starts from an object of the core.
- [`docs/model.md`](../model.md) — the model on one page.

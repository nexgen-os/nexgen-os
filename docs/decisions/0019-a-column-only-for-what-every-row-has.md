# 0019 — A column only for what every row has and every query filters on

> Status: accepted

## Context

A fact can easily live twice: the year a building was built as a column and
as an attribute, a device's installed power as a column and as a seeded
property, a commissioning date under two names, a municipality code on a
row and in its identifiers. Two places for one fact disagree one day, and
nobody can tell which one is right. The opposite extreme, everything in
attributes on one entity table, makes every ordinary query pay a join.

## Decision

**A column is for what every row of the table has and every query filters
on**: the identity of the row, its organisation, its parent,
its geometry, the few numbers that define the object (the azimuth and tilt
of a surface, the height of a building, the rated power of a device), its
status.

**Everything else is an attribute**, attached to the object with its
property, its period of validity and its source. A fact that changes over
time, that a register or a survey supplies, that only some rows have, or
that one trade cares about and another ignores, is an attribute.

**One fact lives in one place.** A property defined in the vocabulary never
repeats a column of the table it applies to, and a column is never copied
into an attribute "for convenience". Reading attributes goes through one
function, `attributes_of()`, so that the period and the source come with the
value.

**A new property is a vocabulary row, not a migration.** A trade that needs a
fact the core does not hold defines the property and attaches it; a module
that needs columns of its own derives a table with the same id
([0032](0032-a-module-has-its-own-schema.md)).

## What it forbids

- The same fact as a column and as an attribute.
- A column that most rows leave empty, or that one trade alone reads.
- A `jsonb` column as a bag of properties: a value without a unit, a period
  or a source cannot be checked, compared or cited.

## See also

- Inherits the "compact columns" principle of Ekwo OS: what every row has is
  a column; the rest is a line table, never JSON.
- [0006](0006-the-core-names-six-objects.md) — the objects and what is attached to them.
- [0021](0021-one-cascade-of-defaults.md) — a default is an attribute of a
  level.

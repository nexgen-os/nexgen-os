# 0028 — Two objects that are one are merged, and the absorbed one is retired

> Status: accepted · 19/10/2026

## Context

The same building arrives from a cadastre, from an IFC file and from a
survey; the same meter is typed by hand and then imported from the grid
operator. A building is split into two lots, two sites are joined into one,
an inverter is replaced by another. Deleting the old object loses
everything that pointed to it — its series, its documents, the runs that
read it — and editing it in place hides that it ever existed. The first
core kept splits, merges and replacements in a table of their own beside
the links that already hold every other dated relation between two objects.

## Decision

**A split, a merge and a replacement are dated links between two objects**,
of three link types: one object is split into others, merged into another,
or replaced by another, from a date.

**Merging two objects that are one is one gesture.** It moves what was
attached to the absorbed object — attributes, identifiers, links, documents,
series — to the one that stays, records the merge link, and retires the
absorbed object. A retired object is kept and stays readable; what quoted
it can follow the link.

**Identification applies, resemblance proposes.** Two objects that share an
identifier of the same scheme are the same object. Two objects that only
look alike — the same address, an overlapping footprint, a similar name —
are proposed as probable duplicates, with the reason; a person or an agent
acting for one decides.

## What it forbids

- Deleting an object that something points to in order to merge it.
- Merging on resemblance without someone's decision.
- A table of its own for one kind of relation between two objects.

## What it replaced

The `successors` table of the 0.1 core, beside `links`.

## See also

- Inherits Ekwo OS 0046 (*Settling applies identification, offers
  resemblance*), 0074 (*Two contacts of one company are merged, and the
  absorbed one is retired*) and 0075 (*The contacts that are probably one
  party are proposed*).
- [0006](0006-named-objects.md) — what is attached to an object.
- [0018](0018-one-function-per-gesture.md) — merging is a gesture.

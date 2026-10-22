# 0028 — Two objects that are one are merged, and the absorbed one is retired

> Status: accepted · 19/10/2026, rewritten 22/10/2026

## Context

The same building arrives from a cadastre, from an IFC file and from a
survey; the same meter is typed by hand and then imported from the grid
operator. A building is split into two lots, two sites are joined into one,
an inverter is replaced by another. Deleting the old object loses
everything that pointed to it — its series, its documents, the runs that
read it — and editing it in place hides that it ever existed. The first
core kept splits, merges and replacements in a table of their own, then as
dated links between objects of any kind, a table nobody else read.

## Decision

**A replacement is dated by its two objects.** A meter swapped or an
inverter changed is a new device of the same participant, installed the
day the old one is retired (`replace_device()`): both stay readable, with
their dates and their series. What a register says of where a parcel comes
from is what that register says, kept with the parcel by the module that
describes it.

**Merging two objects that are one is one gesture.** It moves what was
attached to the absorbed object — attributes, identifiers, documents,
series — to the one that stays, and retires the absorbed object. A retired
object is kept and stays readable.

**Identification applies, resemblance proposes.** Two objects that share an
identifier of the same scheme are the same object. Two objects that only
look alike — the same address, an overlapping footprint, a similar name —
are proposed as probable duplicates, with the reason; a person or an agent
acting for one decides.

## What it forbids

- Deleting an object that something points to in order to merge it.
- Merging on resemblance without someone's decision.
- A table of its own for one kind of relation between two objects, or a
  table of links between objects of any kind.

## What it replaced

The `successors` table of the 0.1 core, then the `split_into`,
`merged_into` and `replaces` links of `links`, with `split_object()` and
`merge_objects()` (until 22/10/2026).

## See also

- Inherits Ekwo OS 0046 (*Settling applies identification, offers
  resemblance*), 0074 (*Two contacts of one company are merged, and the
  absorbed one is retired*) and 0075 (*The contacts that are probably one
  party are proposed*).
- [0006](0006-named-objects.md) — what is attached to an object.
- [0018](0018-one-function-per-gesture.md) — merging is a gesture.

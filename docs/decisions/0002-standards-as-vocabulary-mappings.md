# 0002 — A standard enters as a mapping of a vocabulary row

> Status: accepted

## Context

The trades already speak their standards: IFC and CityGML for what is
built, Brick and Haystack for equipment and points, QUDT for units, bSDD
for properties, SensorThings for observations. A core with a private
language of its own would need a translation for every one of them, and
each format library would guess that translation again in its own way.

## Decision

**Every vocabulary row names the term it corresponds to in the standards
that have one**: Brick and IFC classes for device types, CityGML classes for
places, IFC property sets and bSDD URIs for properties, QUDT units for
quantities and units. The mapping is data of the row, read by the format libraries, so
that a model is read and written without guessing.

**The identifier of a row is English and permanent; its labels are data.**
A label in another language is a translation the vocabulary or a pack
carries, never a second code.

**A term no standard has keeps a name of its own.** The row stays unmapped
rather than mapped to the nearest term; a wrong mapping is worse than none,
because a reader trusts it.

## What it forbids

- A table of correspondences kept inside a format library instead of on the
  vocabulary row.
- A code in another language, or a code that changes when a label does.
- A mapping to the nearest term of a standard when the standard has no term
  for the thing.

## See also

- Inherits Ekwo OS 0034 (*A label is data, and a declared language is a
  promise*).
- [0006](0006-the-core-names-six-objects.md) — the vocabularies the core names.
- [0030](0030-a-value-is-stored-in-the-unit-of-its-quantity.md) — units
  mapped to QUDT.
- [0035](0035-a-format-library-touches-no-database.md) — the libraries that
  read the mappings.

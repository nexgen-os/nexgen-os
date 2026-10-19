# 0009 — What applies to a place follows its region, its municipality or its area

> Status: accepted · 13/10/2026, rewritten 19/10/2026

## Context

A country is not always the level at which things are decided. Belgium keeps
one address register, one set of grid rules and one energy policy per
region; France has local distribution operators on some four hundred
municipalities beside the national one; the Netherlands decides much per
municipality. A grid operator's concession may follow no administrative
line at all. A model that knew only the country of a site would pick the
wrong register, the wrong operator or the wrong default for a site in the
wrong part of it.

## Decision

**A place knows three levels below its country, all of them data:**

- **the region**: the subdivision in ISO 3166-2 (`BE-VLG`, `FR-75`), part of
  the shape of every place ([0025](0025-a-place-has-one-shape.md)); the
  pack lists the regions at the level it decides things
  ([0020](0020-a-pack-holds-what-a-function-reads.md));
- **the municipality**: the country's own code for it, an identifier of the
  place under a scheme of the pack;
- **the area**: when neither code says it (an operator's concession drawn
  on a map), a geometry on the row that applies, and the place's point
  inside it.

**A row that applies to part of a country says which part**: its regions,
its municipalities or its area. A source, an operator, a default of the
pack carry the same three, and nothing else decides where they apply.

**What applies to a place is resolved from the most precise level up**:
what the object says itself (the operator named on its connection point),
then the area, then the municipality, then the region, then the country.
The first level that answers is the answer; none answers is a named gap
([0038](0038-everything-raises-by-name.md)). Defaults follow the same
geography inside their own cascade
([0021](0021-one-cascade-of-defaults.md)).

**Geocoders fill the first two levels.** A register answers with the
region and the municipality code; where a country keeps one register per
region, the region chooses which one is asked.

## What it forbids

- A rule, an operator or a register chosen by the country alone when the
  country decides it per region or per municipality.
- A region written in another code than ISO 3166-2.
- A list of the municipalities of a country in code.

## What it replaced

The record "Addresses, positions and geocoding" of 13/10/2026, whose shape of
address and whose geocoders now have their own rule
([0025](0025-a-place-has-one-shape.md)), and whose regional level, added the
same day, is this rule.

## See also

- Inherits Ekwo OS 0024 (*A tax follows the territory of the parties*),
  translated: a rule follows the region of the place.
- [0011](0011-external-data.md) — sources and their coverage.
- [`docs/research/geocoders-compared.md`](../research/geocoders-compared.md).

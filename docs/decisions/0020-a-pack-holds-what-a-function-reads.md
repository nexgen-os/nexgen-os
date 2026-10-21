# 0020 — A pack holds what a function reads, and data cannot execute

> Status: accepted · 19/10/2026

## Context

A country decides many things a description of a place depends on: how its
regions are named, which identifiers a participant or a connection point carries,
which registers and operators exist, which default values a study starts
from. The first packs held all of that and more: legal texts and rules that
no function read, task templates repeated per country for steps that are the
same everywhere, hand-written SQL seeds loaded once and never again. A pack
that holds what nobody reads is a library of law, maintained in an open
repository that computes nothing from it; and a rule nobody reads is never
tested.

## Decision

**A country is a pack of data, and a pack holds what a function of the core
or of a module reads.** Five sections, each read by something that exists:

- **identity** — the country, its regions at the level the pack decides
  things, its languages and currency as data, the time zones of its places;
- **identifiers** — the schemes a participant, a building or a connection point is
  known by in that country, with their patterns;
- **sources** — the registers, geocoders, operators' hubs and datasets of
  the country, as `sources` rows with their licence;
- **grid** — the operators and what the `grid` module reads about them;
- **defaults** — the values a computation starts from in that country or
  one of its regions, read through the cascade of
  [0021](0021-one-cascade-of-defaults.md).

**Every value cites where it comes from**: one source and one reference
(article, table, page) per value, so that a reviewer checks the pack from
the pack.

**Data cannot execute.** A pack holds rows of closed vocabularies: no
expression language, no SQL fragment, no hook, no code. What a pack cannot
express without code is a module's function that reads the pack's rows.
The adapter of a national register is code, so it is a connector, and the
pack names its register as a source.

**A pack is written as JSON against a published schema, and compiled into
SQL.** The compiled seed is committed beside it, so that what an
installation applies is what a reviewer read.

**No country in code.** Neither the core, a module, a format library nor a
connector names a country, a currency or a language as a literal; a check
in the repository refuses one.

## What it forbids

- A legal text, a rule or a task template in a pack that no function reads.
- An expression, a condition language or a script in a pack.
- A `case` on a country in a function, and a country literal in code.
- A pack value without its source and reference.

## What it replaced

Packs as hand-written SQL seeds with legal sources, rules and per-country
task templates beside the data functions read; national geocoder adapters
shipped inside a pack.

## See also

- Inherits Ekwo OS 0023 (*Declaration boxes are data, with no expression
  language*), 0025 (*A country is a pack of data, compiled into SQL*), 0027
  (*The sources of a pack are a register, not a bibliography*) and 0033
  (*What a country requires on a document is data*).
- [0021](0021-one-cascade-of-defaults.md) — how a default is resolved.
- [0034](0034-a-pack-upgrade-is-never-silent.md) — how a pack is upgraded and
  proved.
- [0017](0017-tasks-as-data.md) — tasks are generic, never per country in a
  pack.
- `packs/README.md`, `scripts/hygiene.mjs`.

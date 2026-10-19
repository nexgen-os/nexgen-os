# 0006 — The core names a few objects, and everything else is attached to them

> Status: accepted · 12/10/2026, rewritten 19/10/2026

## Context

The first core described everything as an entity of a class held in a
vocabulary ([0001](0001-one-entity-table-attached-values.md)). It was clean
and it was abstract: nobody could tell what the model held without reading
the vocabulary, and every query started with "which class is this". It was
withdrawn the day it was written, for named objects in the words of the
trades.

The named core that followed went the other way too far: forty tables,
among them the grid operator, the meter, the community project and its
participants, the law and its rules, and sensors beside devices. Ekwo OS,
built on the same playbook, is compact because it names few objects and
gives each many functions, not because its tables are narrow. A trade the
core describes in full (the grid, the energy community) is a trade every
installation carries, whether it practises it or not.

## Decision

**The core names three notions, in the words of the trades:**

- **the place**: the site, the building on it, the surfaces of the building
  or the ground (a roof face, a facade, a carport), and the spaces inside it
  (floors, rooms, zones, units) ([0026](0026-a-device-is-placed-on-a-surface-or-in-a-space.md));
- **the device**: anything installed on the place, from a PV system to a
  meter or a probe, an instance of a product of the catalogue
  ([0022](0022-the-instrument-is-a-device-the-point-is-the-series.md),
  [0027](0027-a-product-is-a-catalogue-entry.md));
- **the series**: a quantity over time, measured, simulated or forecast,
  belonging to one object ([0029](0029-a-series-belongs-to-an-object.md)).

Around them, what every installation needs and no trade owns: the
organisation and its members ([0023](0023-an-organisation-is-an-object.md)),
the contacts it deals with, the scenarios of a study, the runs that compute
([0004](0004-deterministic-runs.md)), the sources and connections of
external data ([0011](0011-external-data.md)).

**Every object is a table with the columns that object always has**
([0019](0019-a-column-only-for-what-every-row-has.md)). Queries read
`from buildings`, never `from entities where class = 'building'`.

**Everything else is attached, through one registry.** What every object
shares (an id, an organisation, a scenario, a kind) is kept once in
`objects`, maintained by the tables that name it. Attributes with their
period and source, external identifiers, dated links, documents and tags
attach to any object through it, whatever table or module the object lives
in.

**Genericity lives in three places only**: the vocabularies (a new property,
a new device type, a new kind of link is a row), the modules (a new kind of
object, or what a trade adds to one, is a module table with the same id,
[0032](0032-a-module-has-its-own-schema.md)), and the packs (what a country
decides, [0020](0020-a-pack-holds-what-a-function-reads.md)).

**A trade of its own is a module.** The grid (operators, connection points,
mandates, tariffs) and the energy community (projects, participants,
allocation) are modules beside `solar` and `architecture`; the law is not
held in the open repository.

## What it forbids

- A generic entity table, or a class column standing in for a table.
- A table per kind of thing in the core: a new kind is a module table or a
  vocabulary row.
- A trade's own objects in the core because one installation needs them.
- An attachment table per object (`building_documents`,
  `device_identifiers`): attachments go through the registry.

## What it replaced

The entity table of [0001](0001-one-entity-table-attached-values.md), then
the 0.1 core of forty tables, with the grid, the community, the law and the
sensors in it.

## See also

- Inherits Ekwo OS 0008 (*Documents and entries are two joined layers*),
  translated: a description (objects) and a computation (runs, series) are
  two layers; and 0044 (*A product is a catalogue entry in the core*).
- [`docs/model.md`](../model.md) — the tables of the model.
- [`modules/README.md`](../../modules/README.md) — the modules.

# 0006 — The core names a few objects, and everything else is attached to them

> Status: accepted · 12/10/2026, rewritten 19/10/2026 and 21/10/2026

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

The 0.2 core then named too few: the place, the device and the series, with
the project, the participant and the connection point left to the
`community` and `grid` modules. A module and the core's own GeoJSON export
read them anyway, and a person signed in works on a project before any
trade is chosen ([0042](0042-a-module-starts-from-an-object-of-the-core.md)).

## Decision

**The core names seven objects, in the words of the trades**, in the order a
page walks them:

- **the organisation**: who owns the data, with its members
  ([0023](0023-an-organisation-is-an-object.md));
- **the project**: what a person works on — an energy community, a
  portfolio, a study, a construction site, a district plan — with its
  country and its lifecycle;
- **the participant**: an actor of a project on a site (producer,
  consumer, prosumer) — the whole site or one occupant of it, a building, a
  floor, a flat — with the contact who answers for it and its period; it
  carries its meters and groups the devices behind them, several
  participants share a site, and a participant without a site groups
  others;
- **the place**: the site, with its address, its point or parcel and its
  time zone ([0025](0025-a-place-has-one-shape.md)), geolocated but not
  described. What it physically is — its buildings, their floors, rooms
  and units, their roof faces and facades, where a device sits among them —
  is the description of a building, the `3d` module's
  ([0008](0008-3d-module.md), [0026](0026-a-device-is-placed-on-a-surface-or-in-a-space.md));
- **the meter**: the connection point of a site to a network, under the
  identifier its operator knows (an EAN, a PRM, a GSRN), carried by a
  participant of the site, the frontier between the grid and the place;
- **the device**: anything installed on the place, from a PV system to a
  physical meter or a probe, an instance of a product of the catalogue,
  behind a meter when it is on the grid side
  ([0022](0022-the-instrument-is-a-device-the-point-is-the-series.md),
  [0027](0027-a-product-is-a-catalogue-entry.md));
- **the series**: a quantity over time, measured, simulated or forecast,
  belonging to one object ([0029](0029-a-series-belongs-to-an-object.md)).

Around them, what every installation needs and no trade owns: the contacts
an organisation deals with, the scenarios of a study, the runs that compute
([0004](0004-deterministic-runs.md)), the sources and connectors of
external data ([0011](0011-external-data.md)).

**Every object is a table with the columns that object always has**
([0019](0019-a-column-only-for-what-every-row-has.md)). Queries read
`from sites`, never `from entities where class = 'site'`.

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

**A trade of its own is a module.** The grid side of a connection point
(who operates it, how it is connected, mandates, tariffs) and the sharing
of an energy community (allocation keys, the shares an engine computes) are
modules beside `solar` and `3d`; the objects themselves — the meter, the
project, the participant — are the core's, and a module starts from them
([0042](0042-a-module-starts-from-an-object-of-the-core.md)). The physical
description of a place is a trade too, the territory of BIM and CityGML:
the `3d` module holds the buildings, spaces and surfaces and declares them
as kinds of object of its own.
The law is not held in the open repository.

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
sensors in it (19/10/2026), then the 0.2 core, which named three notions —
the place, the device, the series — and held the project, the participant
and the connection point in the `community` and `grid` modules (21/10/2026);
the same day, the buildings, spaces and surfaces of the 0.2 core left it
for the `3d` module, and the participant became an actor at any level of a
building, carrying its meters.

## See also

- Inherits Ekwo OS 0008 (*Documents and entries are two joined layers*),
  translated: a description (objects) and a computation (runs, series) are
  two layers; and 0044 (*A product is a catalogue entry in the core*).
- [`docs/model.md`](../model.md) — the tables of the model.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — how a module
  starts from these objects.
- [`modules/README.md`](../../modules/README.md) — the modules.

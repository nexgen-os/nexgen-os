# 0006 — The core names a few objects, and everything else is attached to them

> Status: accepted · 12/10/2026, rewritten 19/10/2026, twice on 21/10/2026 and on 22/10/2026

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

**The core names six objects, in the words of the trades**, in the order a
page walks them ([0045](0045-the-participant-is-the-node.md)):

- **the organisation**: who owns the data, with its members
  ([0023](0023-an-organisation-is-an-object.md));
- **the project**: what a person works on — an energy community, a
  portfolio, a study, a construction site, a district plan — with its
  country and its lifecycle;
- **the participant**: the node of a project — an actor, a household, a
  company, a tenant, a PV plant — as producer, consumer or prosumer, with
  the contact who answers for it and its period. It carries the place: its
  address, its point on the map and its time zone
  ([0025](0025-a-place-has-one-shape.md)), geolocated but not described;
  what the place physically is — its ground, its buildings, their floors,
  rooms and units, their roof faces and facades — is the `building`
  module's ([0008](0008-3d-module.md)). It carries its meters and groups
  the devices behind them; a participant without a place groups others;
- **the meter**: the connection point of a participant to a network, under
  the identifier its operator knows (an EAN, a PRM, a GSRN), the frontier
  between the grid and the place; one per participant, exceptionally
  several;
- **the device**: anything a participant has behind its meters, from a PV
  system to a physical meter or a probe, an instance of a product of the
  catalogue; it is not placed for now
  ([0022](0022-the-instrument-is-a-device-the-point-is-the-series.md),
  [0026](0026-a-device-is-not-placed-for-now.md),
  [0027](0027-a-product-is-a-catalogue-entry.md));
- **the series**: a quantity over time, measured, simulated or forecast,
  belonging to one object ([0029](0029-a-series-belongs-to-an-object.md)).

Around them, what every installation needs and no trade owns: the members
of an organisation and the contacts it deals with; the vocabularies
(device types and the product catalogue, quantities and units, the
properties an attribute may hold, identifier schemes, sources); the
countries, their regions and the defaults the packs decide; the modules
installed and an organisation's connectors to external data
([0011](0011-external-data.md)). The core is twenty-seven tables and one
view, the last value of each series. A run, a design variant, the use of a
building, a link between two things of a trade are a module's
([0046](0046-a-run-is-the-module-s.md)).

**Every object is a table with the columns that object always has**
([0019](0019-a-column-only-for-what-every-row-has.md)). Queries read
`from participants`, never `from entities where class = 'participant'`.

**Everything else is attached to the six, by kind and id.** Attributes
with their period and source, external identifiers, documents and series
attach to an object of the core by naming its kind — one of the six words,
checked by a plain constraint — and its id. A module's own object (a
building, a PV array, a task) says what describes it in its own columns;
a relation a module needs is a column of its table pointing to an object
of the core. The hierarchy between objects is their foreign keys, and
nothing mirrors it ([0044](0044-there-is-no-registry.md)).

**Genericity lives in three places only**: the vocabularies (a new property,
a new device type, a new quantity is a row), the modules (a new kind of
object, or what a trade adds to one, is a module table with the same id,
[0032](0032-a-module-has-its-own-schema.md)), and the packs (what a country
decides, [0020](0020-a-pack-holds-what-a-function-reads.md)).

**A trade of its own is a module.** The grid side of a connection point
(who operates it, how it is connected, mandates, tariffs) and the sharing
of an energy community (allocation keys, the shares an engine computes) are
modules beside `solar` and `building`; the objects themselves — the meter, the
project, the participant — are the core's, and a module starts from them
([0042](0042-a-module-starts-from-an-object-of-the-core.md)). The physical
description of a place is a trade too, the territory of BIM and CityGML:
the `building` module holds the ground, the buildings, spaces and surfaces
of a participant, each described in its own columns.
The law is not held in the open repository.

## What it forbids

- A generic entity table, or a class column standing in for a table.
- A table per kind of thing in the core: a new kind is a module table or a
  vocabulary row.
- A trade's own objects in the core because one installation needs them.
- An attachment table per object (`building_documents`,
  `device_identifiers`): an attachment names the kind and the id of its
  object.
- A table of the core for what one trade needs: runs, scenarios, links,
  tags, the uses of a building.

## What it replaced

The entity table of [0001](0001-one-entity-table-attached-values.md), then
the 0.1 core of forty tables, with the grid, the community, the law and the
sensors in it (19/10/2026), then the 0.2 core, which named three notions —
the place, the device, the series — and held the project, the participant
and the connection point in the `community` and `grid` modules (21/10/2026);
the same day, the buildings, spaces and surfaces of the 0.2 core left it
for the `building` module; then `sites` left the core too, its place for the
participant and its ground for the `building` module, and the participant
became the node that carries the place, the meters and the devices
([0045](0045-the-participant-is-the-node.md)). Until 0.3 the attachments went through a
registry of every object, `objects`, which 0.3 removed
([0044](0044-there-is-no-registry.md)); then the core of thirty-seven
tables kept a table of kinds, runs, scenarios, links and their types, tags,
profiles, a queue of dirty hours, the last value of each series and the
quality codes as tables, all gone on 22/10/2026.

## See also

- Inherits Ekwo OS 0008 (*Documents and entries are two joined layers*),
  translated: a description (objects) and a computation (runs, series) are
  two layers; and 0044 (*A product is a catalogue entry in the core*).
- [`docs/model.md`](../model.md) — the tables of the model.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — how a module
  starts from these objects.
- [`modules/README.md`](../../modules/README.md) — the modules.

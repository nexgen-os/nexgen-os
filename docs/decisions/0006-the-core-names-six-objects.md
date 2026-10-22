# 0006 — The core names six objects, and everything else is attached to them

> Status: accepted

## Context

A model of places can be described two ways. One is abstract: every thing
is an entity of a class held in a vocabulary. It is clean, and nobody can
tell what the model holds without reading the vocabulary; every query
starts with "which class is this". The other names the things of the
trades as tables. Named too generously, it becomes the sum of every trade:
the grid operator, the community's allocation, the law and its rules, the
buildings and their rooms, all carried by every installation whether it
practises them or not. Named too sparingly, it leaves out what every page
reads anyway: a person signed in works on a project, with its participants
and their meters, before any trade is chosen.

Ekwo OS, built on the same playbook, is compact because it names few
objects and gives each many functions, not because its tables are narrow.
The platform this core was taken from names the objects that earned their
place in the field: the organisation, the project, the participant, its
meter, its devices and their series.

## Decision

**The core names six objects, in the words of the trades**, in the order a
page walks them ([0043](0043-the-participant-is-the-node.md)):

- **the organisation**: who owns the data, with its members
  ([0023](0023-an-organisation-is-an-object.md));
- **the project**: what a person works on — an energy community, a set of
  buildings, a study, a construction site, a district plan — with its
  country and its lifecycle;
- **the participant**: the node of a project — an actor, a household, a
  company, a tenant, a PV plant — as producer, consumer or prosumer, with
  the contact who answers for it and its period. It carries the place: its
  address, its point on the map and its time zone
  ([0025](0025-a-place-has-one-shape.md)), geolocated but not described;
  what the place physically is — its ground, its buildings, their floors,
  rooms and units, their roof faces and facades — is the `building`
  module's ([0008](0008-the-building-module-describes-what-is-built.md)).
  It carries its meters and groups the devices behind them; a participant
  without a place groups others;
- **the meter**: the connection point of a participant to a network, under
  the identifier its operator knows (an EAN, a PRM, a GSRN), the frontier
  between the grid and the place; one per participant, exceptionally
  several;
- **the device**: anything a participant has behind its meters, from a PV
  system to a physical meter or a probe, an instance of a product of the
  catalogue; it belongs to its participant, and nothing places it in a
  building ([0022](0022-the-instrument-is-a-device-the-point-is-the-series.md),
  [0026](0026-a-device-belongs-to-its-participant.md),
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
view, the last value of each series. A calculation, a design variant, the use of a
building, a relation between two things of a trade are a module's
([0004](0004-a-figure-names-its-inputs-and-never-changes.md)).

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
nothing mirrors it ([0001](0001-the-hierarchy-is-the-foreign-keys.md)).

**Genericity lives in three places only**: the vocabularies (a new property,
a new device type, a new quantity is a row), the modules (a new kind of
object, or what a trade adds to one, is a module table with the same id,
[0032](0032-a-module-has-its-own-schema.md)), and the packs (what a country
decides, [0020](0020-a-pack-holds-what-a-function-reads.md)).

**A trade of its own is a module.** The grid side of a connection point
(who operates it, how it is connected) and the sharing of an energy
community (allocation keys, the shares an engine computes) are modules
beside `solar` and `building`; the objects themselves — the meter, the
project, the participant — are the core's, and a module starts from them
([0042](0042-a-module-starts-from-an-object-of-the-core.md)). The physical
description of a place is a trade too, the territory of BIM and CityGML:
the `building` module holds the ground, the buildings, spaces and surfaces
of a participant, each described in its own columns. The law is not held
in the open repository.

## What it forbids

- A generic entity table, or a class column standing in for a table.
- A table per kind of thing in the core: a new kind is a module table or a
  vocabulary row.
- A trade's own objects in the core because one installation needs them.
- An attachment table per object (`building_documents`,
  `device_identifiers`): an attachment names the kind and the id of its
  object.
- A table of the core for what one trade needs: estimates, settlements, design variants,
  relations between the things of a trade, the uses of a building.

## See also

- Inherits Ekwo OS 0008 (*Documents and entries are two joined layers*),
  translated: a description (objects) and a computation (estimates, settlements, series) are
  two layers; and 0044 (*A product is a catalogue entry in the core*).
- [`docs/model.md`](../model.md) — the tables of the model.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — how a module
  starts from these objects.
- [`modules/README.md`](../../modules/README.md) — the modules.

# The core

The schema `nexgen` and the vocabularies it starts with, in plain SQL for
Postgres with PostGIS. There is no Supabase configuration file here: the
installer is the project's own (`npx nexgen-os init`, see
[`packages/cli`](../packages/cli/README.md)) and records each file by its path.

```
core/migrations/   the schema, one file per family of tables, the version last
core/seed/         the vocabularies, and the seeds compiled from the packs (packs/<cc>)
```

## The model in one screen

The core names six objects, in the order a page walks them — the
organisation, the project it works on, the participants taking part in it,
the meters they carry, the devices behind those meters, the series they
produce — and everything else is attached to any of them by kind and id:
an attribute, an identifier, a link, a document, a series or a run names
its object as `('participant', id)`, `('device', id)`, and the hierarchy is
the foreign keys ([0044](../docs/decisions/0044-there-is-no-registry.md)).
The participant carries the place, geolocated but not described: its
ground, its buildings, floors, rooms and roof faces are the `building`
module's ([`modules/building`](../modules/building/README.md)), and a device
is not placed. Each named object is a table with the columns every row
has; what a trade knows beyond them is an attribute with its period and its
source.

Why this hierarchy: it is the one the commercial platform this core comes
from has run for years, and it reads the way the trades speak
([0045](../docs/decisions/0045-the-participant-is-the-node.md)). A
**participant** is the envelope facing the grid: an actor of the project —
a household, a company, a tenant, a PV plant — with its address and its
point on the map, that carries the meter and groups the devices behind it;
seen from the grid, everything *behind the meter* is the participant's,
everything in front of it is the grid's, the market's or the community's.
It is the node every module links to: the description of its buildings,
the grid side of its meters, its bills, its share of a community, its
tasks, its weather. A **meter** is that frontier, one per participant and
exceptionally several; a **device** belongs to a participant and has as
many series as it measures. Three rules settle every question about the
structure: keep it simple, one word per thing across schemas, folders and
documents, and stay close to the platform that proved it
([docs/doctrine.md](../docs/doctrine.md), the spirit).

| Table | Holds | Standard it follows |
|---|---|---|
| `organisations`, `organisation_members`, `contacts` | who owns the descriptions and who they deal with; an organisation is an object like the others | Ekwo companies and contacts |
| `projects`, `participants` | what a person works on (an energy community, a portfolio, a study, a construction site, a district plan) with its country and lifecycle, and its actors as producer, consumer or prosumer, each carrying its place in one standard shape (address, WGS 84 point, precision, source, time zone, profile), grouped when they answer together | schema.org `PostalAddress` |
| `meters` | the connection points of a participant to a network, under the identifier its operator knows, with their direction and the period that identifier names them | IEC CIM `UsagePoint`, GS1 GSRN |
| `devices`, `device_directory` | what a participant has behind its meters, instruments included; the products it is an instance of | Brick equipment, Home Assistant devices |
| `series`, `series_values`, `forecast_values`, `series_rollups`, `series_latest` | one quantity of an object over time, by the device that measures or is set when there is one: measured, simulated, forecast, setpoint, command; its hourly and daily aggregates and its latest value, derived | OGC SensorThings datastream, Brick and Haystack points |
| `attributes`, `external_ids`, `links`, `documents` | what attaches to any object, named by its kind and its id: typed values with validity and source, identifiers, typed links (splits, merges and replacements included), files | IFC property sets, bSDD, Overture GERS |
| `kinds` | the kinds of object an attachment may name — the core's and those modules publish — with the table holding each | — |
| `scenarios`, `runs`, `modules`, `connectors` | design variants, immutable computations and the series they own, the modules installed, an organisation's use of a source through a connector | — |
| `countries`, `regions`, `defaults` | what a country pack publishes: the country, its regions, the values it decides; `parameter_of()` resolves a parameter from the object up to the country along the foreign keys and a region's parents, with no global fallback | ISO 3166, ISO 4217 |
| `device_types`, `profiles`, `link_types`, `quantities`, `units`, `property_defs`, `tags`, `id_schemes`, `sources` | the vocabularies, as data, including the external APIs, datasets and published texts | Brick, IFC, CityGML, QUDT, Haystack |

Every act that writes several rows or carries a rule is one function named
after the gesture — `join_project`, `locate_participant`, `declare_meter`,
`assign_meter`, `install_device`, `series_ensure`, `store`, `record_run`,
`merge_objects`… — that refuses by name. The grid side of a connection
point (`grid`), the physical description of a participant's place
(`building`: its ground, buildings, spaces, surfaces), the energy sharing
of a community (`community`) and the billing bridge (`billing`) are
modules with their own schema, each starting from an object of the core
([0042](../docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)). Details, diagram and rules: [docs/model.md](../docs/model.md); the
rules and why: [docs/doctrine.md](../docs/doctrine.md).

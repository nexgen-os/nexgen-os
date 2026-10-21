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

The core names seven objects, in the order a page walks them — the
organisation, the project it works on, the participants taking part in it,
their sites, the meters that connect those sites to a network, the
devices installed on them, the series they produce — and attaches
everything else to any of them. A site is geolocated, not described: its
buildings, floors, rooms and roof faces, and where a device sits among
them, are the `3d` module's ([`modules/3d`](../modules/3d/README.md)). Each
named object is a table with the columns every row has; what a trade knows
beyond them is an attribute with its period and its source.

Why this hierarchy: it is the one the commercial platform this core comes
from has run for years, and it reads the way the trades speak. A
**participant** is an actor of the project that groups the devices behind
the same meter — seen from the grid, everything *behind the meter* is the
participant's, everything in front of it is the grid's, the market's or the
community's; a **meter** is that frontier; a **site** is only where things
are, geolocated but not described. Three rules settle every question about
the structure: keep it simple, one word per thing across schemas, folders
and documents, and stay close to the platform that proved it
([docs/doctrine.md](../docs/doctrine.md), the spirit).

| Table | Holds | Standard it follows |
|---|---|---|
| `organisations`, `organisation_members`, `contacts` | who owns the descriptions and who they deal with; an organisation is an object like the others | Ekwo companies and contacts |
| `projects`, `participants` | what a person works on (an energy community, a portfolio, a study, a construction site, a district plan) with its country and lifecycle, and its actors as producer, consumer or prosumer — a whole site or one occupant of it, several per site — grouped when they answer together | — |
| `meters` | the connection points of a site to a network, under the identifier its operator knows, with their direction, the period that identifier names them and the participant that carries them | IEC CIM `UsagePoint`, GS1 GSRN |
| `sites` | the place, in one standard shape: address, WGS 84 point or parcel, precision, source, time zone, profile | schema.org `PostalAddress` |
| `devices`, `device_directory` | what is installed, instruments included, on its site and behind a meter of it; the products it is an instance of | Brick equipment, Home Assistant devices |
| `series`, `series_values`, `forecast_values`, `series_rollups`, `series_latest` | one quantity of an object over time, by the device that measures or is set when there is one: measured, simulated, forecast, setpoint, command; its hourly and daily aggregates and its latest value, derived | OGC SensorThings datastream, Brick and Haystack points |
| `attributes`, `external_ids`, `links`, `documents` | what attaches to any object: typed values with validity and source, identifiers, typed links (splits, merges and replacements included), files | IFC property sets, bSDD, Overture GERS |
| `scenarios`, `runs`, `modules`, `connectors` | design variants, immutable computations and the series they own, the module registry and the kinds of object modules declare (`object_kinds`, `object_parent_tables`), an organisation's use of a source through a connector | — |
| `countries`, `regions`, `defaults` | what a country pack publishes: the country, its regions, the values it decides; `parameter_of()` resolves a parameter from the object up to the country, with no global fallback | ISO 3166, ISO 4217 |
| `device_types`, `profiles`, `link_types`, `quantities`, `units`, `property_defs`, `tags`, `id_schemes`, `sources` | the vocabularies, as data, including the external APIs, datasets and published texts | Brick, IFC, CityGML, QUDT, Haystack |

Every act that writes several rows or carries a rule is one function named
after the gesture — `create_site`, `install_device`,
`series_ensure`, `store`, `record_run`, `merge_objects`, `join_project`,
`declare_meter`, `assign_meter`, `connect_device`… — that refuses by name. The grid side of
a connection point (`grid`), the physical description of a site (`3d`:
buildings, spaces, surfaces, the placement of a device), the energy sharing
of a community (`community`) and the billing bridge (`billing`) are
modules with their own schema, each starting from an object of the core
([0042](../docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)). Details, diagram and rules: [docs/model.md](../docs/model.md); the
rules and why: [docs/doctrine.md](../docs/doctrine.md).

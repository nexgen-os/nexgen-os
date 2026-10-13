# Nexgen OS

An open foundation for describing the built world — sites, buildings, roofs,
meters, participants, devices, sensors — in 3D and over time, so that
architecture, energy, operations and compliance tools share one model.

Nexgen OS is the open foundation and the reference language. **Nexgen**, the
commercial platform of **WeSmart** (Newide, Belgium; AI4Energy, France), is
built on it and remains WeSmart's product: this repository describes the
foundation, not the product. Why the foundation exists and what it promises:
[MANIFESTO.md](MANIFESTO.md). Where the open foundation stops and the product
begins: [docs/nexgen-os-and-nexgen.md](docs/nexgen-os-and-nexgen.md). What the
figures are and are not: [DISCLAIMER.md](DISCLAIMER.md).

> Status: **0.0 — the core schema, the `architecture` module, the `solar` module schema, the Home
> Assistant and geocoding libraries, the Open-Meteo connector and seven example
> datasets, and a first country pack**. The core is tested; nothing here is stable until 0.1.

## The model in one screen

The core names its objects after what the trades call them. Each is a table;
what a trade knows beyond its columns is attached to it.

| Table | Holds | Standard it follows |
|---|---|---|
| `organisations`, `organisation_members`, `contacts` | who owns the descriptions and who they deal with; legal identity and invoicing are referenced from Ekwo OS ([0010](docs/decisions/0010-ekwo-link.md)) | Ekwo companies and contacts |
| `projects` | a working perimeter: energy community, portfolio, study, district plan | Nexgen projects |
| `sites`, `buildings`, `surfaces` | places: an address in the fields every country has, a point or a parcel with its precision and its source, a building with its footprint and height, a roof face or a ground area with its orientation | CityGML, IFC spatial structure |
| `meters`, `participants` | connection points, and a site's role in a project behind them | IEC CIM UsagePoint, Nexgen participants |
| `devices`, `device_directory`, `sensors` | what is installed, the products it is an instance of, and its measurable points; a module derives each device type into its own table | Nexgen devices, Brick, Home Assistant |
| `series`, `series_values`, `forecast_values` | measured, simulated and setpoint series in one store, forecasts with every issue in another | OGC SensorThings |
| `attributes`, `external_ids`, `links`, `successors`, `documents` | what is attached to any object: typed values with validity, identifiers, typed links, splits and merges, files | IFC property sets, bSDD, Overture GERS |
| `scenarios`, `runs`, `modules`, `connections` | design variants, immutable computations, the module registry, an organisation's use of a source | — |
| `device_types`, `profiles`, `link_types`, `quantities`, `property_defs`, `tags`, `id_schemes`, `sources` | the vocabularies, as data, including the external APIs and datasets | Brick, IFC, CityGML, QUDT, Haystack |

Details, diagram and rules: [docs/model.md](docs/model.md). Why named
objects: [docs/decisions/0006](docs/decisions/0006-named-objects.md).

## Principles

1. **Concrete objects, generic attachments.** A building is a row of
   `buildings`. A new kind of thing is a module table with the same id; a new
   property is a vocabulary row; a new API is a source row.
2. **3D WGS 84 everywhere.** Any CRS is accepted on the way in; geometry is
   stored in EPSG:4326 with heights in metres, and measured in the UTM zone it
   falls in, anywhere on earth.
3. **One way to read.** `attributes_of()` for attributes, `resample()` for
   series, `site_of()` and `country_of()` for where, `building_volume()` for a
   derived 3D block.
4. **Deterministic core, operable by an agent.** Nothing in the core calls a
   model; modules hand results back through `record_run()`: same inputs,
   same engine, same run. On top of it, an AI agent works as a user of the
   model — the same tables, the same rights, the same refusals by name — so
   that describing and studying a place can be delegated without the data
   leaving its owner ([AGENTS.md](AGENTS.md)).
5. **Modules in their own schema, countries as data, formats by format,
   invoices in Ekwo.**

## Install

On an empty Supabase project with PostGIS enabled
(`create extension if not exists postgis with schema extensions;`):

```bash
export NEXGEN_DB_URL='postgresql://…'   # the project's connection string
npx nexgen-os init --dry-run            # what would be applied
npx nexgen-os init                      # the core and every module; --packs <cc> for a country
npx nexgen-os doctor                    # what is wrong, by name
```

Engines are optional: a yield computed by pvlib needs Python and
`engines/pvlib` installed, as [`engines/README.md`](engines/README.md) says.

The installer and its commands: [`packages/cli/README.md`](packages/cli/README.md).
How a release is cut: [`docs/releasing.md`](docs/releasing.md).

## Run the tests

```bash
npm install
npm test        # PGlite + PostGIS in WebAssembly, no server needed
npm run typecheck
```

The tests describe five cases end to end: a house (site, building, roof
face, PV system derived by a module, attributes over time, documents,
scenario), a school with the `architecture` module (floors, rooms, sensors
for several quantities, setpoints, a heat pump serving the building), an
energy community (project, participants behind their meters, contacts,
groups, meter swap, cumulative register, a site in two projects), a district
from open data (projected CRS, OSM identifiers, spatial queries, shading,
plot split) and security (row level security, viewers, run immutability,
vocabulary hygiene). Every example in `examples/` loads and is checked, and
the Home Assistant library goes in and out without losing a field.

## Layout

```
supabase/migrations/   the core, in the schema `nexgen` (`public` stays the installation's)
supabase/seed/         the core vocabularies
modules/               one Postgres schema per module (architecture and solar shipped)
packs/                 one folder per country (fr: identifiers, sources, the BAN geocoder)
formats/               one MIT library per format or geocoder (homeassistant, geocoding, cityjson)
connectors/            the interfaces to the outside world and the open connectors (open-meteo)
engines/               external computations in any language, JSON in and out (pvlib, optional)
examples/              one loadable dataset per domain (house, school, community, farm, district, drone survey, office)
docs/                  model, decisions, research
packages/cli/          the installer, `nexgen-os`: init, migrate, doctor, status
tests/                 the core's tests, the examples, the format round trips
```

## Licence

The core is AGPL-3.0 ([LICENSE](LICENSE)). Format libraries will be MIT.

# Nexgen OS

An open foundation for describing the built world — sites, buildings, roofs,
meters, participants, devices, sensors — in 3D and over time, so that
architecture, energy, operations and compliance tools share one model.

Why it exists and what it promises: [MANIFESTO.md](MANIFESTO.md).

> Status: **0.0 — the core schema, the `architecture` module, the Home
> Assistant and geocoding libraries, the Open-Meteo connector and seven example
> datasets**. No pack is published yet. The core is tested; nothing here is stable until 0.1.

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
4. **Deterministic core.** Nothing in the core calls a model. Modules hand
   results back through `record_run()`: same inputs, same engine, same run.
5. **Modules in their own schema, countries as data, formats by format,
   invoices in Ekwo.**

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
modules/               one Postgres schema per module (architecture shipped)
packs/                 one folder per country (none yet)
formats/               one MIT library per format or geocoder (homeassistant, geocoding)
connectors/            the interfaces to the outside world and the open connectors (open-meteo)
examples/              one loadable dataset per domain (house, school, community, farm, district, drone survey, office)
docs/                  model, decisions, research
tests/                 the core's tests, the examples, the format round trips
```

## Licence

The core is AGPL-3.0 ([LICENSE](LICENSE)). Format libraries will be MIT.

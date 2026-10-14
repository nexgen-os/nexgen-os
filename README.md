# Nexgen OS

An open foundation for describing the world — sites, buildings, roofs,
meters, participants, devices, sensors — in 3D and over time, so that
architecture, energy, operations and compliance tools share one model.

Nexgen OS is the open foundation and the reference language. **Nexgen**, the
commercial platform of **WeSmart** (Newide, Belgium; AI4Energy, France), is
built on it and remains WeSmart's product: this repository describes the
foundation, not the product. Why the foundation exists and what it promises:
[MANIFESTO.md](MANIFESTO.md). Where the open foundation stops and the product
begins: [docs/nexgen-os-and-nexgen.md](docs/nexgen-os-and-nexgen.md). What the
figures are and are not: [DISCLAIMER.md](DISCLAIMER.md).

> Status: **0.1 in preparation — the core schema, the `architecture`, `weather` and `solar` modules, the Home
> Assistant, geocoding, CityJSON and IFC libraries, the Open-Meteo and PVGIS connectors,
> external engines in any language with pvlib (Python) as the first, the `nexgen-os`
> installer, the `fr` and `be` country packs and seven example datasets**. Tested; nothing
> here is stable until 0.1.

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

The tests describe real cases end to end: a house (site, building, roof
face, PV system derived by a module, attributes over time, documents,
scenario), a school with the `architecture` module (floors, rooms, sensors
for several quantities, setpoints, a heat pump serving the building), an
energy community (project, participants behind their meters, contacts,
groups, meter swap, cumulative register, a site in two projects), a district
from open data (projected CRS, OSM identifiers, spatial queries, shading,
plot split), security (row level security, viewers, run immutability,
vocabulary hygiene), the series store across a clock change, the weather
and solar modules with a yield run on PVGIS, on `pvwatts.ts` and on the
pvlib engine, the format libraries in and out without losing a field, the
two country packs and the installer. Every example in `examples/` loads and
is checked.

## Five minutes, from an empty project to a building

1. On an empty [Supabase](https://supabase.com) project, enable PostGIS in
   the SQL editor: `create extension if not exists postgis with schema extensions;`
2. Keep the connection string in the environment, never in a file:
   `export NEXGEN_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'`
3. Install the core, every module and the pack of the country you work in:
   `npx nexgen-os init --packs <country code>` (`--dry-run` first shows what
   would be applied and rolls it back).
4. Check it: `npx nexgen-os doctor` names every problem, or none.
5. Load a dataset: `psql "$NEXGEN_DB_URL" -c 'set search_path = nexgen' -f examples/01-house-pv-battery.sql`,
   then ask it something:

   ```sql
   set search_path = nexgen;
   select b.name, s.name, s.azimuth_deg, s.tilt_deg, s.material
   from surfaces s join buildings b on b.id = s.building_id
   where s.kind = 'roof';
   ```

The installer's page ([packages/cli/README.md](packages/cli/README.md))
says what each command does and how to reach a remote host over TLS. Every
example in `examples/` is a complete, loadable dataset.

## Layout

```
supabase/migrations/   the core, in the schema `nexgen` (`public` stays the installation's)
supabase/seed/         the core vocabularies
modules/               one Postgres schema per module (architecture, weather and solar shipped)
packs/                 one folder per country (fr, be: identifiers, sources, the address register as a geocoder)
formats/               one MIT library per format or geocoder (homeassistant, geocoding, cityjson, geojson, ifc, panond, weather-files)
connectors/            the interfaces to the outside world and the open connectors (open-meteo, pvgis), MIT
engines/               external computations in any language, JSON in and out (pvlib, optional), MIT
examples/              one loadable dataset per domain (house, school, community, farm, district, drone survey, office)
docs/                  model, decisions, research, how a release is cut
packages/cli/          the installer, `nexgen-os`: init, migrate, doctor, status
scripts/               hygiene, and what a release publishes
tests/                 the core's tests, the examples, the modules, the formats, the packs, the engines
```

## Licence

The core, the modules, the packs and the installer are AGPL-3.0
([LICENSE](LICENSE)). The format libraries, the connectors and the engines
are MIT, each folder with its own `LICENSE`, so that a reader or a connector
can live inside any product.

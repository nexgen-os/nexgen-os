# Road to 0.1 — the first public release

How Nexgen OS goes live, on the model of Ekwo OS, with the differences the
domain imposes. Each step is a checkbox because a release half done is
worse than none.

## What 0.1 is

The first version other people can install, read and build on: the core
schema in the `nexgen` schema, the `architecture`, `weather`, `solar` and
`tasks` modules, the format libraries (Home Assistant, geocoding, CityJSON,
GeoJSON, IFC, EPW and TMY3, PAN and OND), the connectors (Open-Meteo, PVGIS),
the pvlib engine, two country packs (`fr`, `be`), seven example datasets,
and the decisions that explain them. What each brings is in the
[changelog](../CHANGELOG.md). Not stable: names may still change until 1.0,
and every change is written down.

Two steps planned for 0.1 move to 0.2, so that 0.1 ships what is ready:
the MCP server and the Nexgen application reading a Nexgen OS database
(see *After 0.1* below).

## The steps

### Identity and ground rules

- [x] A GitHub organisation of its own, `nexgen-os`, and the repository in it.
- [x] Licences: AGPL-3.0 for the core and the modules, MIT for the format
  libraries and the connectors; DCO sign-off, no contributor agreement.
- [x] The manifesto says who builds it (WeSmart: Newide, AI4Energy), that
  Nexgen is WeSmart's commercial product built on the foundation, and that
  the foundation is also for research.
- [x] Where the open foundation stops and the product begins:
  `docs/nexgen-os-and-nexgen.md`; what the figures are: `DISCLAIMER.md`;
  how to report a flaw: `SECURITY.md`.
- [x] `AGENTS.md`: what an AI agent may do here, how, and what it never does.
- [x] **Commits and releases in the project's name.** A GitHub App of the
  organisation (as Ekwo does with its own app) signs and pushes every
  commit, tag and release; the history is rewritten once, before the
  repository goes public, so that no personal account and no assistant
  appears as an author. A ruleset on `main`: linear history, pull request
  and green checks for everyone, the app alone merging fast-forward.
- [x] A domain for the project's pages and schema identifiers: `nexgen-os.org`
  (decided 13/10/2026; `.io`, `.dev` and `.eu` held in defence), and the
  `@nexgen-os` scope on npm. The product keeps its own names (`nexgen.now`).
- [x] `nexgen-os.org` registered (13/10/2026, Gandi); `nexgen.now` registered the
  same day for the product. Still to do: point `nexgen-os.org` at the
  project pages, hold `.io`, `.dev` and `.eu`.

### What a release needs

- [x] **A schema version function**, `nexgen_schema_version()`, bumped by a
  migration of its own when a release adds anything a package reads.
- [x] **One installer**: `npx nexgen-os init` applies the core, the modules
  and the packs asked for on an empty Supabase project (PostGIS enabled),
  `nexgen-os migrate` brings an installation up to date, `nexgen-os doctor`
  says what is wrong. Ported from Ekwo's command line, which already does
  this for a schema, modules and packs.
- [ ] **The packages** on npm under `@nexgen-os`: the format libraries and
  the connectors, each usable without Nexgen OS; the installer; the core
  client.
- [x] **A changelog** per release, and a `docs/releasing.md` that lists what
  has to move, as Ekwo's does.
- [x] Continuous integration: the test suite on three Node versions, a
  hygiene check (no country literal in code, no secret, English only), the
  DCO check, and `engine-pvlib` (the pvlib engine on Python 3.12, compared
  with `modules/solar/src/pvwatts.ts`).

### Before the first users

- [x] A README that a stranger can follow from an empty Supabase project to
  a building, in five minutes (the installer, then an example dataset).
- [x] The same, to a building with a yield, in twenty minutes
  (`examples/yield.ts`, kept true by `tests/yield-example.test.ts`).
- [ ] The recording that proves it.
- [x] The IFC reader (`IfcMapConversion`, floors and spaces), the first of
  the three format readers that make the model worth filling.
- [x] The EPW and TMY3 weather file reader, and the EPW writer
  (`packages/formats/weather-files`).
- [x] The PAN/OND product file reader (`packages/formats/panond`).
- [x] A second country pack, so that the pack mechanics are proven twice
  (`be`, with its three regional registers).
- [x] The installer run against a real Supabase project, as a user runs it
  (`docs/releasing.md`, *The last run*).

## After 0.1

Planned for 0.2:

- [ ] **An MCP server**, `@nexgen-os/mcp`, hosted and local, on the model
  of Ekwo's: an agent describes a site, imports a file, runs a yield and
  reads it back, as the user, under row level security. Agents are a first
  audience of this project, not an afterthought: `AGENTS.md` is written
  for them from 0.1.
- [ ] The Nexgen application reads a Nexgen OS database for one real site,
  end to end.

## Where it differs from Ekwo OS

| | Ekwo OS | Nexgen OS |
|---|---|---|
| what is installed | a schema in `public` | a schema `nexgen`, PostGIS required |
| the unit of rules | a country pack | a country pack, with regions and municipalities inside it |
| what the libraries read | invoices, statements, filings | 3D models, weather, product files, device registries |
| what runs outside the database | nothing but the clients | the engines: yield, geocoding, format readers, connectors |
| the hosted operator | Ekwo OÜ (Estonia) | WeSmart (Newide, Belgium; AI4Energy, France) |
| the first audience | businesses and accountants | project holders, installers, cities, research partners |

The release mechanics are the same on purpose: one installer, versioned
packages, a schema floor the packages refuse to run below, a changelog,
releases cut by the project's own identity.

## Plans moved out of the decision records

A decision record states a rule that holds
([`docs/decisions/README.md`](decisions/README.md)); the plans the records
used to carry are kept here, each under the record that holds its rule.

- **Vocabularies** ([0002](decisions/0002-standards-as-vocabulary-mappings.md)):
  versioned, namespaced identifiers for every vocabulary row
  (`publisher/dictionary/version/code`, as bSDD does), with the first pack
  that publishes vocabulary.
- **Licence and home** ([0005](decisions/0005-open-questions.md)): CC BY 4.0
  proposed for the specification and the vocabularies, so that
  translations and forks are allowed (buildingSMART's CC BY-ND is the
  example to avoid); a neutral foundation or association for the project
  once there is traction (the Open Home Foundation and LF Energy are the
  models).
- **Series at scale** ([0007](decisions/0007-series-at-scale.md)): hourly
  and daily rollups refreshed from dirty buckets, `resample()` routed by
  step to raw values or a rollup with the signature unchanged; a cold tier
  where a detached weekly partition becomes one Parquet file on object
  storage (sorted, zstd), read back through the host's reader (an Iceberg
  wrapper, `pg_parquet`, `pg_duckdb`, DuckDB in a worker); TimescaleDB's
  columnstore as an accelerator when a self-hosted installation has it.
- **The `3d` module** ([0008](decisions/0008-3d-module.md)): schema
  `three_d` with `models` (one georeferenced model of a building, a site or
  a device: format, file address and checksum, CRS, origin on the globe and
  in the native CRS, rotation, scale, up axis, units, vertical datum,
  bounding box, level of detail, the source's georeferencing block),
  `drawings` (plans, sections, elevations with an optional georeference)
  and `tilesets` (3D Tiles 1.1 built by a run), and one function placing a
  model in the world. The parametric roof model and the module layouts of
  the platform move in as functions of `3d` and `solar`, their result
  persisted as a model produced by a run. Serving in three tiers: vector
  tiles and extrusions for every building in view, 3D Tiles for real
  geometry, one glTF for the object of the page, on MapLibre GL JS. Drone
  flights, images, point clouds, scenes and videos stay in the commercial
  platform. The acceptance test: an IFC and a CityJSON of one building land
  as two models placed on the same footprint.
- **Modules to come** ([0012](decisions/0012-solar-module.md)): `storage`,
  `charging`, `consumption`, `sharing`, and later `flexibility` and
  `generators` (wind, hydro, cogeneration, biomass), each taking the device
  types of its trade; which of the four yield profiles ships first
  (`pvgis_like` is the cheapest to verify); a PV\*SOL study imported as a
  run and compared with the `pvsol_like` profile within a stated tolerance.
- **Engines** ([0013](decisions/0013-external-engines.md)): a long-running
  engine served over HTTP with the same contract, when a computation
  outgrows one process; an engine's own cache of downloaded data in its
  temporary directory; pandapower for the `grid` module as the next engine
  (`power_flow`).
- **Integrations** ([0014](decisions/0014-integrations-dashboards-warehouses-streams.md)),
  in the order the first sites ask for them: daily and monthly views of
  series for business intelligence tools, with the rollups; `packages/formats/parquet`,
  with the cold tier; `formats/influx-line-protocol`, for the first site
  with an InfluxDB history; `connectors/mqtt`, for the first site with a
  gateway; `formats/grafana` (a dashboard written from the objects of a
  site), for the first community screen; `connectors/kafka` and the change
  data capture publication, for the first utility integration; a guide for
  Power BI.
- **Publications** ([0015](decisions/0015-publications.md)): a
  `publications` module whose table holds one document per row (an open
  GeoJSON export of a site or a project, with title, SPDX licence,
  publisher, date and sha256 written by the database), published, withdrawn
  and deleted by owners, read by the public through one view in a schema of
  its own, the only one the anonymous role is given; then series,
  documents, an embeddable map, and a check of the publication's licence
  against its sources'.
- **Tasks** ([0017](decisions/0017-tasks-as-data.md)): a vocabulary of
  kinds of project in place of free text.

## Where the code does not yet follow the doctrine

The doctrine of 19 October 2026 ([`docs/doctrine.md`](doctrine.md)) is
written before the moves that bring the code to it. Each move is a pull
request of its own, the suite green at every step; the numbers are the
decisions of the audit of 19 October 2026.

- [ ] **The core of three notions** (1–8, 18, 30, 31, 36): the grid and the
  community as modules, the law out of the repository, sensors folded into
  devices and series, one notion of space, devices placed by columns,
  splits and merges as links, columns that repeated a property removed,
  the bridge columns to the `accounting` module, a run's own series, the
  defaults and their one resolution, organisations in the registry of
  objects. Records 0006, 0018, 0019, 0021, 0022, 0023, 0026, 0028.
- [ ] **The packs** (27–35): five sections in JSON against a published
  schema, compiled and checked by the command line, versioned and
  upserted, `fr` and `be` redone, task templates generic. Records 0017,
  0020, 0034.
- [ ] **The root** (9, 10, 12, 13, 16): `core/`, TypeScript under
  `packages/*`, geocoders as connectors, the Python client under
  `packages/python`, the landing page out. Records 0024, 0025.
- [ ] **Format libraries that touch nothing** (11): the importers of
  `cityjson`, `homeassistant`, `ifc` and `geojson` moved out of their
  libraries. Record 0035.
- [ ] **The series API** (17, 19–26): one write path in SQL, the units
  vocabulary, rollups, the latest value, gap filling on read, Parquet, the
  dataframe readers. Records 0007, 0029, 0030, 0031.

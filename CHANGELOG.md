# Changelog

Every change that a user of Nexgen OS can see, by release, under
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project
follows [Semantic Versioning](https://semver.org/); before 1.0 a minor
release may break, and says how. How a release is cut:
[`docs/releasing.md`](docs/releasing.md).

## [Unreleased]

### Moved

The repository reads like the model; behaviour does not change. Old path →
new path:

- `supabase/migrations` → `core/migrations`, `supabase/seed` → `core/seed`;
  "The model in one screen" moves from the README to `core/README.md`. The
  installer reads the new paths and reads the names a 0.1 installation
  recorded under `supabase/` as their `core/` names, so `doctor` and
  `migrate` see nothing pending.
- `formats/<f>` → `packages/formats/<f>` for `cityjson`, `geojson`,
  `homeassistant`, `ifc`, `panond`, `parquet` and `weather-files`; each is an
  npm package `@nexgen-os/<f>` (MIT) with its own `package.json`, `README`
  and `LICENSE`.
- `connectors/open-meteo`, `connectors/pvgis` → `packages/connectors/open-meteo`,
  `packages/connectors/pvgis`.
- `formats/geocoding` → one connector per service: `packages/connectors/nominatim`,
  `photon`, `ban`, `geopunt`, `urbis`, `icar` (the former `walloon()`);
  `belgium()` is gone, the caller keys the three by region.
- `formats/db.ts`, `formats/geometry.ts`, `connectors/index.ts`,
  `connectors/series.ts`, the address shape and `geocoderFor()` of
  `formats/geocoding/index.ts`, `engines/runner.ts`, `engines/settlement.ts`,
  `engines/pvlib/index.ts` → the new package `@nexgen-os/core`
  (`packages/core`). `engines/` keeps the programs in other languages.
- `sdk/python` → `packages/python`.
- `modules/solar/*.ts` → `modules/solar/src/*.ts`.
- `modules/ekwo` → `modules/accounting`: schema `accounting`, tables
  `accounting.companies` and `accounting.contacts`, module code
  `accounting`.
- `site/` leaves the repository; `site/README.md` points to the new home.

### Changed

- A format library touches no database
  ([0035](docs/decisions/0035-a-format-library-touches-no-database.md)).
  Each library of `packages/formats/` reads a file into plain shapes
  declared in its own types and writes such shapes back; it imports nothing
  of Nexgen OS, opens no connection and calls no network, and the hygiene
  script checks it. What wrote the model moves to an importer of
  `@nexgen-os/core` (`src/files/`), which writes through the gestures of the
  schema, or of the module that owns the rows. A file is now read, then
  imported:
  - Home Assistant: `readHomeAssistant(snapshot)` → spaces, devices, points
    and readings; `writeHomeAssistant(shapes)` → the snapshot.
    `importHomeAssistant(db, { siteId, buildingId }, shapes)` and
    `exportHomeAssistant(db, buildingId)` move to the core; the round trip
    stays lossless through both layers.
  - CityJSON: `readCityJson(doc, { srid })` and `writeCityJson(model)`;
    `importCityJson(db, { siteId }, model, options)` and
    `exportCityJson(db, { siteId })`, which returns the model, move to the
    core. `sridOf()` is the library's; `orientation()` stays the core's.
  - IFC: `readIfc(bytes, { origin })` returns the buildings, floors, rooms,
    roof faces and products in the reference system the model is placed in;
    `importIfc(db, { siteId }, model, options)` moves to the core and places
    the site through `locate_site()`.
  - GeoJSON: the library declares RFC 7946 and adds `writeGeoJson()` and
    `readGeoJson()`; `exportGeoJson()` moves to the core, its collection
    typed `GeoJsonExport`.
  - Weather files: the library returns its own `WeatherSeries`;
    `importWeatherFile()` moves to the core, `exportEpw()` becomes
    `exportWeatherYear()` of the core, whose result `writeEpw()` writes.
  - Parquet: `exportSeriesParquet()` and `serverParquetWriter()` move to the
    core; the caller gives the writer (`write: writeSeriesParquet`).
  - PAN and OND: `importProduct()` moves to `modules/solar/src/products.ts`.
  The target of an importer is the site (its organisation is the site's);
  a file whose buildings are known to the organisation is refused
  (`already_imported`) before anything is written.
- `add_building()` takes the metadata of the file a building was read from
  and a scenario; `add_space()` its source and metadata; `add_surface()`
  its metadata; `install_device()` a nameplate (manufacturer, model, serial
  number) for a device of no catalogue product, its metadata and a status.
  The parameters are added at the end, with defaults: existing calls keep
  their meaning.
- No format library depends on `@nexgen-os/core`; the core depends on
  `cityjson`, `geojson`, `homeassistant` and `weather-files`, and on `ifc`
  as an optional peer. The workspaces build formats first.
- The fixtures of the format libraries move to
  `packages/formats/<f>/tests/fixtures/`, with the tests that need no
  database.
- The BAN geocoder returns `FR-75C`, the ISO 3166-2 code, for Paris.
- An engine's series name their unit in the `units` vocabulary (`W/m²`,
  `°C`); the solar module stores them through `store()`, which converts. The
  settlement types no longer carry their own list of price units.
- `doctor` names `series_partitions_missing`: weeks of `series_values` that
  hold values with no weekly partition.
- The README says where the line between Nexgen OS and invoicing is, and why
  Ekwo OS is the accounting application it is built for.

### Added

- Nexgen OS and Ekwo OS on one database: `docs/with-ekwo-os.md` says how
  both are installed on one project, what each installer owns, what the
  `accounting` module holds, and that the schema name `ekwo` is Ekwo's.
  `tests/cross-install.test.ts` installs the Ekwo OS core from its published
  package and the Nexgen OS core with `accounting`, in both orders, and finds
  no collision, each side's grants intact and one member reading both.
- The `settlement` request kind of the engines (`packages/core/src/engines/settlement.ts`):
  contracts with their price signals and the series their volume is read
  from in, settlement lines out — energy, price and amount over each
  interval a price holds, who pays whom, in the contract's currency. How
  energy is matched with contracts stays the engine's own.
  `engines/settlement-example`, pure Python, settles at a fixed price and
  is meant to be copied; it refuses by name a price it cannot read
  (`price_missing`, `price_kind_unsupported`, `signal_misaligned`,
  `signals_overlap`, `currency_mixed`) and a volume counted twice
  (`volume_counted_twice`).
- The pack toolchain. A country pack is JSON described by the published
  schema `packs/schema/pack.1.json` in five sections — identity,
  identifiers, sources, grid, defaults — with its version, certification
  and checksum. `nexgen-os pack build <cc>` compiles it into
  `core/seed/<n>_pack_<cc>.sql`, which upserts every row by its natural
  key, records the version and checksum in `countries`, and refuses by name
  a value edited in place (`value_edited`). `nexgen-os pack check --all`,
  run by the new `packs` job of the CI, refuses a pack that fails the
  schema, holds executable content, names an undeclared region, carries a
  default without a unit or a reference, or whose committed seed is not its
  exact output. The installer applies a compiled seed as its pack, never as
  the core.
- Fifteen generic task templates in the `tasks` module, for every country
  (`published_by = 'tasks'`, `country` null): nine steps of a roof
  installation, six of an energy community. A country pack holds no task.

### Changed — the `fr` pack on the five sections

`packs/fr` is a JSON pack compiled into `core/seed/10_pack_fr.sql`
(version 0.2.0, `community`): France with its 13 regions and the 103
departments and collectivities below them (ISO 3166-2, the department as region level, six time zones),
seven identifier schemes, ten registers and the ten published texts its
values cite, nine grid operators and the voltage domains, and twenty-one
dated values of ten properties (metering step, bidding zone, emission factor, yearly
energy prices and grid fees, reference injection price, VAT, off-peak
hours), each with its source and reference. Its legal texts, rules and
task templates are no longer in the open repository; installing it needs
the `grid` module.

### Changed — the `be` pack on the five sections

`packs/be` is a JSON pack compiled into `core/seed/11_pack_be.sql`
(version 0.2.0, `community`): Belgium with its three regions (ISO 3166-2,
the region as region level), six identifier schemes, nine registers and the
seven published texts its values cite, eight grid operators by region, and
thirteen dated values of six properties (the metering step of each region,
bidding zone, yearly energy prices and grid fees, VAT), each with its source
and reference. Its legal texts and its twenty-three task templates are no
longer in the open repository; a Belgian project is planned from the generic
templates of the `tasks` module.

### Changed — schema 0.2.0: the core of three notions

The core migrations are rewritten in place, since nothing was installed
from them yet: the schema `nexgen` now reads as places, the devices on
them, the series they produce, and the attachments around them.
`nexgen_schema_version()` answers `0.2.0` and the command line's schema
floor is 0.2.0. Table by table:

- `organisations` is an object of the registry (decision 0023): its
  attributes, identifiers, links and documents attach to it.
  `ekwo_company_id` leaves it for `accounting.companies`.
- `contacts` keeps a name and a kind; `email`, `phone` and
  `ekwo_contact_id` move to `accounting.contacts` (new module `accounting`).
- `projects` and `participants` move to the new module `community`
  (`community.projects`, `community.participants`, with `join_project()`,
  `leave_project()`, `participant_meters()`); `country_of()` no longer
  reads a project. The `tasks` module depends on `community`.
- `meters` and `grid_operators` move to the new module `grid`
  (`grid.meters` with `declare_meter()` and `close_meter()`,
  `grid.operators` with a `published_by` column).
- `legal_sources`, `rules` and `rules_on()` leave the public repository;
  the `fr` and `be` seeds no longer write them.
- `sites` stores the one standard shape of a place — street,
  `address_extra`, postal code, city, region (ISO 3166-2, checked against
  the pack's regions), country, point, `location_precision`,
  `location_source_code` — taken by `create_site()` and `locate_site()` and
  given back by `place_of()`; `municipality_code` becomes an identifier of
  the site.
- `buildings` loses `year_built`, `material` and the floor counts, now
  attributes with their period and source (decision 0019).
- `spaces` is new in the core: floors, rooms, zones and units of a
  building in one tree, with `add_space()`. The `architecture` module, whose
  `floors` and `spaces` it replaces, is removed.
- `devices` is placed by `site_id`, `building_id`, `space_id` and
  `surface_id`, checked together; `meter_id` leaves it for a `behind_meter`
  link of the `grid` module. `install_device()`, `move_device()`,
  `retire_device()`, `replace_device()`.
- `sensors` is removed (decision 0022): the instrument is a device, the
  point is the series. `series` gains `device_id`, `external_ref`,
  `metadata`, the kind `command`, and `run_id`; `sensor_id` is removed.
  `series_ensure()` and `store()` (below).
- `runs` own their series (`series.run_id`, unique per identity): a
  finished run's series never change; `start_run()`, `finish_run()`,
  `record_run()` and `discard_superseded_series()`.
- `successors` and `successors_attach()` are removed: a split, a merge or a
  replacement is a link (`split_into`, `merged_into`, `replaces`) written by
  `split_object()` and `merge_objects()`.
- `attributes`, `external_ids`, `links`, `documents` are written through
  `set_attribute()`, `add_identifier()`, `link_objects()`, `end_link()`,
  `attach_document()`; a plain insert stays allowed under the triggers.
- `countries`, `regions` and `defaults` are new, in the shapes the pack
  compiler writes; `parameter_of(object, property, at, scenario)` resolves a
  parameter from the object through its parents and its organisation to its
  region and country, and refuses `parameter_missing` or
  `parameter_not_decided` by name, with no global fallback.
- `sources.kind` takes `text`, a published text a value is read from.
- `property_defs` gains the values a pack publishes (metering step,
  bidding zone, grid emission factor, fallback specific yield, tax rate,
  energy prices, off-peak hours, energy sharing limits, voltage levels,
  connection thresholds) and stops repeating a column (`usage`,
  `commissioning_date`; `installed_power` applies to a site or a project
  only).
- The organisation functions `create_organisation()`, `add_member()`,
  `set_member_role()`, `remove_member()` and `create_scenario()`,
  `add_building()`, `add_surface()` complete the gestures; every one is
  `security invoker` and refuses by name.
- `formats/homeassistant`, `formats/ifc`, `formats/cityjson` and
  `formats/geojson` write `spaces` and series of devices; the Home Assistant
  round trip stays lossless. The seven examples load the modules they use.

### Changed — the series package

Decisions 17 and 19–26 of the audit of 19 October 2026, in the core's
series migration (rewritten in place, schema 0.2.0):

- **One write path.** `store(series, at[], value[], quality[]?, unit?,
  issued_at?, identity?)` writes every value, by series id or by identity
  (`series_ensure()`, which replaces `open_series()`; `store_values()`
  and `store_forecast()` are gone). It converts from the unit given,
  stores a null as missing, keeps the quality given (D5), refuses an
  instant off the series' step and another value kind or step for an
  identity (D6), leaves an equal value untouched, and keeps the latest
  value. `insert`, `update` and `delete` on `series_values` and
  `forecast_values` are revoked from `authenticated` (D4). New named
  refusals: `series_unit_mismatch`, `series_step_mismatch`,
  `series_value_kind_mismatch`, `series_run_required` (a simulated series
  names its run or its source), `series_read_only`, `series_required`,
  `values_duplicated`, `quality_unknown`, `value_required`,
  `instant_required`, `issued_at_required`. `storeSeries()`, the Home
  Assistant import, `modules/solar/yield.ts`, `record_run()`, the
  examples and the Python client call it.
- **Units.** A core vocabulary `units` (QUDT code, symbol, quantity kind,
  factor and offset to SI; 48 rows in the core seed) and
  `convert_unit(value, from, to)` (`unit_unknown`, `unit_incompatible`).
  `formats/homeassistant` loses its 14 factors (D14) and
  `formats/weather-files` states the unit of each quantity it reads.
- **`resample()` answers the amount of each bucket.** A cumulative
  register gives its consumption per bucket, resets handled (D3; it gave
  its last index); the index is read through `nexgen.window()` and
  `latest()`. Sub-day steps bin from local midnight, so half-hour time
  zones fall on local hours (D7); a number of days or months is honoured,
  and a step mixing calendar units is refused as `step_unsupported` (D8).
  Each bucket says `expected` and its worst `quality` (D10). A role
  without a signed-in user reads no series unless it bypasses row level
  security (D9).
- **Rollups and latest value.** `series_rollups` (hour in UTC, day in the
  site's time zone), `series_dirty` marked by every statement on the
  values, `series_rollup()` scheduled every minute by pg_cron where it is
  installed; `resample()` reads the rollups when they cover the buckets
  and none is dirty. `series_latest` is kept by `store()`.
- **Reads.** `fill()` (gaps filled on read, flagged estimated, nothing
  written), `coverage()` (the gaps of a regular series), `forecast_at()`
  (a forecast as known at a time or at a horizon), `export_rows()` (the
  rows of the files door).
- `series_values_partition()` writes its bounds in UTC whatever the
  session's time zone. Quality code 0 is "measured" everywhere (D13).
- `formats/parquet` (new, MIT): series as Parquet files written on the
  client from `export_rows()` with Hyparquet Writer, or by `pg_parquet` /
  `pg_duckdb` when the server has one and the caller names a path.
- `connectors/series.ts` types the calls for TypeScript. The Python client
  gains `store()`, `window()`, `latest()`, `fill()`, `coverage()`,
  `forecast_at()`, `export_rows()`, `convert_unit()`; its reads return
  `Rows` with `to_arrow()`, `to_pandas()`, `to_polars()` through the
  optional extras `arrow`, `pandas`, `polars`.

## [0.1.0] — 2026-10-17

The first release: what other people can install, read and build on.
Names may still change until 1.0, and every change is written down here.
What 0.1 holds and what moves to 0.2: [`docs/road-to-0.1.md`](docs/road-to-0.1.md).

### Added

- The core in the schema `nexgen`, the `architecture`, `weather`, `solar`
  and `tasks` modules, the `fr` and `be` packs, the format libraries
  (Home Assistant, geocoding, CityJSON, GeoJSON, IFC, EPW and TMY3, PAN and
  OND), the Open-Meteo and PVGIS connectors, the pvlib engine and seven
  example datasets. The entries below say what each brings.
- `sdk/python`, the Python client `nexgen-os` (MIT): the readers of the
  model (`attributes_of`, `resample`, `site_of`, `country_of`), the
  organisations and sites a connection may read, and `attach()` for an
  attribute with its period and its source. Every refusal comes back as a
  `NexgenError` with its name; statements are simple queries, served by a
  pooler in transaction mode. Tested against a fresh installation in the
  `sdk-python` job of CI.
||||||| parent of 8b5b200 (feat(ifc): the equipment of a model becomes devices, typed by the vocabulary)
- `formats/ifc` reads the equipment of a model: each product whose IFC
  class a device type names (`device_types.ifc_class`) becomes a device on
  the site, in the building that contains it, with its maker, model and
  serial number from the manufacturer property sets and a point from its
  placement. A class several device types share is told apart by its
  predefined type, else by the type they all refine, else skipped with its
  reason. `counts.devices` in the result.
||||||| parent of 40a2b2f (docs(packs): the grid section of the be pack, and what it does not cover yet)
||||||| parent of 968669a (docs(packs): the grid section of the be pack, and what it does not cover yet)
- The `be` pack names who runs the grid: Elia for the transmission of the
  whole country, Fluvius in Flanders, Sibelga in Brussels, and ORES, RESA,
  AIEG, AIESH and REW in Wallonia, each with its region and the GSRN
  metering points it issues (`grid_operators`, section `grid`).
- Where to get help, said in one place of each door: the README, the site,
  `AGENTS.md`, `docs/nexgen-os-and-nexgen.md` and the last line of a real
  `nexgen-os init`. Nexgen OS is the common base of Nexgen, WeSmart's
  platform; an account on Nexgen gives the platform, WeSmart's services
  cover the foundation itself.
- Decision [0016](docs/decisions/0016-naming-third-party-methods.md): where a
  third party's name goes (connectors, engines, formats), which methods are
  rewritten (published ones, under the name the literature cites) and the
  rule for every function of ours: generic name, model as data, source
  cited. Restated for code agents in `AGENTS.md`.
- `formats/geojson`, the GeoJSON export: a site, or every site of a
  project with its perimeter, as one RFC 7946 FeatureCollection with the
  attributes, identifiers and runs of each object and the sources it owes;
  `open: true` leaves out street lines, serial numbers, metadata and
  whatever came from a source that may not be passed on.
- The law of a country as data: `legal_sources` (the texts, with their
  official reference and the consolidated text online), `rules` (what a
  text sets, in plain words and in numbers, by section, country and
  regions, with the dates it holds between; `rules_on()` gives those of a
  day) and `grid_operators`. The `fr` pack fills them: 15 texts, 36 rules
  on the grid, self-consumption, planning, environmental assessment, solar
  obligations, tertiary energy, energy labels, support schemes and meter
  data, 8 grid operators, and 21 task templates for a roof installation
  and an energy community. The address-register adapters (`ban()`, the
  Belgian registers) moved from the packs to `formats/geocoding`: a pack
  holds rows, never code (decision 0009, amended).
- The `be` pack says what has to be done in Belgium, region by region: 11
  texts (the federal electrical regulation and the grid operators'
  prescription for production, the energy-sharing and planning texts of
  Flanders, Brussels and Wallonia) and 23 task templates for a roof
  installation and an energy community. A task template carries its
  regions (ISO 3166-2), as a rule does; `tasks.plan()` keeps those of the
  regions of the sites taking part in the project and says which regional
  templates it skipped for want of a region (`region_missing`).
- The `tasks` module (decision 0017): what has to be done on a project
  and where it stands. Phases from study to decommissioning and the roles
  that carry a task, as vocabularies; task templates per country and kind
  of project, with their legal reference, expected documents and
  condition, published by the packs and the installation; `tasks.plan()`
  creates a project's tasks from them, once, and says what it could not
  decide; tasks on a project, a site, a building, a surface or a device
  with planned and actual dates, a status kept consistent with them, a
  role, a contact, a dependency and a source; each task is an object, so
  photos, reports and certificates attach to it. `tasks.progress()` says
  where a site or a project stands on a given day.
- `exceedance()` in the `solar` module: P50, P75, P90 and P99 of a yield run
  on real years, from its yearly totals, their interannual spread over the
  horizon asked and the uncertainty components the caller names, recorded
  as a run.
- The installer, `npx nexgen-os`: `init` installs the core, the modules and
  the packs asked for on an empty Supabase project with PostGIS, `migrate`
  applies what is missing, `doctor` names every problem, `status` sums an
  installation up. Every file applied is recorded, a second run applies only
  what is missing, and `--dry-run` rolls everything back.
- `nexgen.nexgen_schema_version()`, answering `0.1.0`, and
  `nexgen.schema_migrations`, the record of every file applied with its
  scope (`core`, `module:<code>`, `pack:<cc>`).
- `docs/releasing.md` and this changelog.
- `performanceIndicators()` in the `solar` module: the IEC 61724-1 final
  and reference yields, performance ratio and energy performance index of a
  PV system against a sensor or a yield run, by month in the site's time
  zone, on the hours every series has, recorded as a run.
- The Release workflow: a `v*` tag publishes every public package to npm
  through trusted publishing (GitHub OIDC, no token) with provenance, after
  `npm run release:check` has confirmed each package can be published that
  way; `npm run release:publish` shows the plan as a dry run.
- `formats/ifc`, the IFC reader: buildings, storeys, spaces and roof faces
  of an IFC4 model land as buildings, floors, spaces and roof surfaces,
  placed on the globe by `IfcMapConversion` or the site's coordinates, with
  GlobalIds in `external_ids` and property sets in `metadata.ifc`. Parsed by
  web-ifc (MPL-2.0), now a dependency.
- `formats/panond`, the PAN and OND reader: a PVsyst module or inverter file
  becomes a product of the directory with its physics — the `pvsyst`
  one-diode model in pvlib's keys, its light and saturation currents solved
  from the file's Isc and Voc, or the inverter's keys and efficiency curves.
  Prices in a file are left out; a product already imported is refused
  (`already_imported`).
- External engines (decision 0013): a program in any language that reads
  one JSON request on stdin and answers one JSON result on stdout. The
  runner (`engines/runner.ts`) starts it from the caller's command or
  `NEXGEN_ENGINE_<NAME>`, checks the contract and names every failure
  (`engine_not_found`, `engine_failed`, `engine_contract_mismatch`,
  `engine_timeout`). The first engine, `engines/pvlib`, answers `pv_yield`
  with pvlib's `ModelChain`; `runYield` runs any yield profile through it
  with `engine: { name: 'pvlib' }`.
- `formats/weather-files`: EPW and TMY3 files read into `ghi`, `dni`, `dhi`,
  `temperature` and `wind_speed` series dated at their start in UTC, a
  typical year laid on one calendar year as a `simulated` series named after
  its years; a file whose hours are off from its longitude's solar noon is
  reported as `time_offset_suspect`; a place's weather written back as EPW.
- A yield run through an engine runs an inverter of model `ond` as the
  Sandia model, fitted on the OND file's efficiency curves at their three
  voltages exactly as pvlib's `inverter.fit_sandia` fits a test report
  (`modules/solar/inverter.ts`), and records the inverter it sent in the
  run's inputs. A Sandia, ADR or OND inverter on arrays without a module
  model that gives the DC voltage is refused (`inverter_needs_voltage`).
- The Open-Meteo connector reads the horizontal components `ghi`, `dni` and
  `dhi` from the ERA5 archive.

### Fixed

- The README's five-minute path loads its dataset on a Supabase project,
  where PostGIS lives in the schema `extensions`, and stops at the first
  error.
- `nexgen.object_kinds` has row level security, read by everyone signed in,
  like the other vocabularies.

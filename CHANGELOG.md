# Changelog

Every change that a user of Nexgen OS can see, by release, under
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project
follows [Semantic Versioning](https://semver.org/); before 1.0 a minor
release may break, and says how. How a release is cut:
[`docs/releasing.md`](docs/releasing.md).

## [Unreleased]

### Added

- The `settlement` request kind of the engines (`engines/settlement.ts`):
  contracts with their price signals and the series their volume is read
  from in, settlement lines out — energy, price and amount over each
  interval a price holds, who pays whom, in the contract's currency. How
  energy is matched with contracts stays the engine's own.
  `engines/settlement-example`, pure Python, settles at a fixed price and
  is meant to be copied; it refuses by name a price it cannot read
  (`price_missing`, `price_kind_unsupported`, `signal_misaligned`,
  `signals_overlap`, `currency_mixed`) and a volume counted twice
  (`volume_counted_twice`).

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

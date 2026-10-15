# Changelog

Every change that a user of Nexgen OS can see, by release, under
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project
follows [Semantic Versioning](https://semver.org/); before 1.0 a minor
release may break, and says how. How a release is cut:
[`docs/releasing.md`](docs/releasing.md).

## [Unreleased]

### Added

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
- The `participation` module and its publications: an open GeoJSON export
  of a site or a project, published by an owner with its licence, kept as
  published with its sha256, withdrawn but never changed; anyone reads the
  ones not withdrawn through `participation_public.publications`, the only
  schema the anonymous role is given (decision 0015).
- The `construction` module: milestones of works on a project, a site, a
  building, a surface or a device, in phases read from a vocabulary
  (design to handover), with planned and actual dates, a status kept
  consistent with them and the contact who answers for each; each
  milestone is an object, so photos and reports attach to it.
  `construction.progress()` says where the works of a site or a project
  stand on a given day.
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
- The core, the `architecture`, `weather` and `solar` modules, the `fr` and
  `be` packs, the format libraries, the connectors and the pvlib engine of
  the first release (see
  `docs/road-to-0.1.md`).

### Fixed

- `nexgen.object_kinds` has row level security, read by everyone signed in,
  like the other vocabularies.

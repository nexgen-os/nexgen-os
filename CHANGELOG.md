# Changelog

Every change that a user of Nexgen OS can see, by release, under
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project
follows [Semantic Versioning](https://semver.org/); before 1.0 a minor
release may break, and says how. How a release is cut:
[`docs/releasing.md`](docs/releasing.md).

## [Unreleased]

### Added

- The installer, `npx nexgen-os`: `init` installs the core, the modules and
  the packs asked for on an empty Supabase project with PostGIS, `migrate`
  applies what is missing, `doctor` names every problem, `status` sums an
  installation up. Every file applied is recorded, a second run applies only
  what is missing, and `--dry-run` rolls everything back.
- `nexgen.nexgen_schema_version()`, answering `0.1.0`, and
  `nexgen.schema_migrations`, the record of every file applied with its
  scope (`core`, `module:<code>`, `pack:<cc>`).
- `docs/releasing.md` and this changelog.
- The Release workflow: a `v*` tag publishes every public package to npm
  through trusted publishing (GitHub OIDC, no token) with provenance, after
  `npm run release:check` has confirmed each package can be published that
  way; `npm run release:publish` shows the plan as a dry run.
- `formats/ifc`, the IFC reader: buildings, storeys, spaces and roof faces
  of an IFC4 model land as buildings, floors, spaces and roof surfaces,
  placed on the globe by `IfcMapConversion` or the site's coordinates, with
  GlobalIds in `external_ids` and property sets in `metadata.ifc`. Parsed by
  web-ifc (MPL-2.0), now a dependency.
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
- The Open-Meteo connector reads the horizontal components `ghi`, `dni` and
  `dhi` from the ERA5 archive.
- The core, the `architecture`, `weather` and `solar` modules, the `fr` and
  `be` packs, the format libraries, the connectors and the pvlib engine of
  the first release (see
  `docs/road-to-0.1.md`).

### Fixed

- `nexgen.object_kinds` has row level security, read by everyone signed in,
  like the other vocabularies.

# Changelog

Every change that a user of Nexgen OS can see, by release, under
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project
follows [Semantic Versioning](https://semver.org/); before 1.0 a minor
release may break, and says how. How a release is cut:
[`docs/releasing.md`](docs/releasing.md).

## [Unreleased]

## [0.3.0] — 2026-10-22

The first release of Nexgen OS: an open digital twin of energy places —
organisations, projects, participants, their meters, devices and series —
driven by AI agents that work as users of the model, in a Postgres
database with PostGIS that its owner keeps
([0039](docs/decisions/0039-an-agent-is-a-user-of-the-model.md)). Schema
version `0.3.0`, schema floor `0.3.0`.

### Added

**The core**, in the schema `nexgen`: twenty-seven tables and one view
([docs/model.md](docs/model.md)), its migrations and seed in `supabase/`
([supabase/README.md](supabase/README.md)).

- Six objects, in the order a page walks them: the organisation and its
  members, the project, the participant — the node that carries the place,
  the meters and the devices — the meter, the device and the series
  ([0006](docs/decisions/0006-the-core-names-six-objects.md),
  [0043](docs/decisions/0043-the-participant-is-the-node.md)). The
  hierarchy is the foreign keys
  ([0001](docs/decisions/0001-the-hierarchy-is-the-foreign-keys.md)).
- The place in one shape on the participant: address, point in WGS 84 with
  its height, precision, source, time zone; `join_project()`,
  `locate_participant()`, `place_of()`
  ([0025](docs/decisions/0025-a-place-has-one-shape.md)). Geometry stored
  in EPSG:4326 in 3D and measured in its UTM zone
  ([0003](docs/decisions/0003-geometry-wgs84-3d-utm.md)).
- Attributes with their period and source, external identifiers checked
  against their scheme, documents, each naming its object by kind and id;
  `set_attribute()`, `attributes_of()`, `add_identifier()`,
  `attach_document()`
  ([0019](docs/decisions/0019-a-column-only-for-what-every-row-has.md)).
- Meters under the identifier their operator knows (`declare_meter()`,
  `assign_meter()`, `close_meter()`); devices as instances of a product
  catalogue (`install_device()`, `retire_device()`, `replace_device()`,
  `derive_devices()`)
  ([0022](docs/decisions/0022-the-instrument-is-a-device-the-point-is-the-series.md),
  [0027](docs/decisions/0027-a-product-is-a-catalogue-entry.md)).
- Series in plain Postgres, partitioned by week, values dated at the start
  of their interval in the unit of their quantity: one way to write,
  `store()`, and one family of reads, `resample()`, `window()`,
  `latest()`, `fill()`, `coverage()`, `forecast_at()`, `export_rows()`,
  with hourly and daily aggregates kept by every write
  ([0007](docs/decisions/0007-series-at-scale.md),
  [0029](docs/decisions/0029-a-series-belongs-to-an-object.md),
  [0030](docs/decisions/0030-a-value-is-stored-in-the-unit-of-its-quantity.md),
  [0031](docs/decisions/0031-one-way-to-write-a-series-one-way-to-read-it.md)).
- The vocabularies mapped to the standards (Brick, IFC, QUDT, bSDD), the
  countries, their regions and the defaults of the packs, resolved by one
  cascade, `parameter_of()`
  ([0002](docs/decisions/0002-standards-as-vocabulary-mappings.md),
  [0021](docs/decisions/0021-one-cascade-of-defaults.md)).
- A figure says where it comes from: each module keeps what it computes in
  a plain table of its own (`solar.estimates`, `consumption.estimates`,
  `community.settlements`), each row with its subject, its provenance, its
  inputs and its results, written by the module's function that computes
  it, and replaced by a new computation that names it
  ([0004](docs/decisions/0004-a-figure-says-where-it-comes-from.md)).
- Sources and an organisation's connectors, naming their secret
  ([0011](docs/decisions/0011-external-data.md)); row level security on
  every table, rights granted by name, refusals by name
  ([0037](docs/decisions/0037-the-schema-grants-its-own-rights.md),
  [0038](docs/decisions/0038-everything-raises-by-name.md));
  `nexgen_schema_version()`.

**The modules**, each in its own schema, each starting from an object of
the core and each a folder with its manifest `module.json`
(`modules/schema/module.1.json`), its migrations, its code and its tests
([modules/README.md](modules/README.md),
[0042](docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)).

- `building`: the ground of a participant, its buildings, their spaces
  (floors, rooms, zones, units) and surfaces (roof faces, facades, ground
  areas), the uses of a building, and the importers of CityJSON, IFC and
  Home Assistant homes
  ([0008](docs/decisions/0008-the-building-module-describes-what-is-built.md)).
- `grid`: the operators of a country and the grid side of each meter.
- `community`: energy sharing among the participants of a project, as
  settlements of a sharing program.
- `billing`: the bridge to Ekwo OS — the participant is billed, Ekwo OS
  keeps the invoice
  ([0010](docs/decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md),
  [docs/with-ekwo-os.md](docs/with-ekwo-os.md)).
- `consumption`: load profiles, activity hours and a participant's curve,
  measured, reconstructed from a bill or typical, as an estimate.
- `weather`: weather models with their coverage, the points participants
  read, and the model each participant reads for each purpose.
- `solar`: PV systems and arrays, product physics, horizons, named yield
  profiles, design variants, and yields computed by PVGIS, by
  `pvwatts.ts` or by pvlib, with the IEC 61724-1 indicators and the P50 and
  P90 of a yield ([0012](docs/decisions/0012-a-yield-says-what-it-was-computed-from.md)).
- `planning`: the phases and roles of a project, generic task templates and
  the planning of a project from them
  ([0017](docs/decisions/0017-planning-as-data.md)).

**The packs**: `fr` and `be`, version `0.3.0`, certification `community`,
written as JSON against `packs/schema/pack.1.json` and compiled into
`supabase/seed/` — identity and regions, identifiers, sources, grid operators
and defaults, each value with its source and reference
([packs/README.md](packs/README.md),
[0020](docs/decisions/0020-a-pack-holds-what-a-function-reads.md),
[0034](docs/decisions/0034-a-pack-upgrade-is-never-silent.md)).

**The packages**, version `0.3.0`.

- `nexgen-os`, the installer: `init`, `migrate`, `doctor`, `status`,
  `pack build` and `pack check`
  ([packages/cli/README.md](packages/cli/README.md),
  [0040](docs/decisions/0040-a-release-has-a-tag-a-schema-version-and-a-floor.md)).
- `@nexgen-os/core`: the database seam, the standard place and the geocoder
  chain, the series API, the importers and exporters of the core, the
  connector interfaces and the runner of the program connectors.
- The format libraries, MIT, one per format: `@nexgen-os/cityjson`,
  `geojson`, `homeassistant`, `ifc`, `panond`, `parquet`, `weather-files`
  (EPW and TMY3) ([0035](docs/decisions/0035-a-format-library-touches-no-database.md),
  [0036](docs/decisions/0036-a-file-is-imported-once.md)).
- The Python client, `nexgen_os`: the reads of the model and attributes
  attached with their source, with dataframes as optional extras
  ([0024](docs/decisions/0024-one-language-per-layer.md)).

**The connectors**, MIT ([packages/connectors/README.md](packages/connectors/README.md)).

- Weather and yield: `@nexgen-os/open-meteo` (forecast and ERA5 history),
  `@nexgen-os/pvgis`.
- Geocoders: `@nexgen-os/nominatim`, `@nexgen-os/photon`, and the national
  registers `@nexgen-os/ban`, `@nexgen-os/geopunt`, `@nexgen-os/urbis`,
  `@nexgen-os/icar`.
- Program connectors in any language, one JSON request in and one JSON
  result out: `pvlib` (Python), and the `sharing-example` and
  `settlement-example` programs, meant to be copied and replaced
  ([0013](docs/decisions/0013-a-program-connector-reads-one-request.md)).

**The demo**: seven loadable datasets — a house, a school, an energy
community, a farm, a district from open data, a drone survey, an office —
and the twenty-minute yield of the README
([docs/demo/README.md](docs/demo/README.md)).

**The doctrine**: the rules on one screen and forty-three decision records
([docs/doctrine.md](docs/doctrine.md),
[docs/decisions/](docs/decisions/README.md)), and the road to 1.0
([docs/road-to-1.0.md](docs/road-to-1.0.md)).

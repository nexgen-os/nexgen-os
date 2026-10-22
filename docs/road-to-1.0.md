# The road to Nexgen OS 1.0

Nexgen OS is released as minors before 1.0, and a minor may still break
([0040](decisions/0040-a-release-has-a-tag-a-schema-version-and-a-floor.md)).
Version `1.0.0` is a promise of stability, made only when it can be kept.
This page says what that promise covers, what is planned before it, and
where the code does not yet follow a decision already written. It is the
one place of the repository that carries plans: a decision record states a
rule that holds ([`decisions/`](decisions/README.md)).

There is no date on this page. The tag is cut when every item is in.

## What 1.0 promises for the whole 1.x line

From `1.0.0` to the last `1.x`, an installation, a script, an agent or an
integration written against one release keeps working against every later
1.x release. A change that would break one of these promises is a `2.0.0`.

1. **The schema is additive.** A migration adds tables, columns, functions
   and policies, and never drops or renames a public object, nor narrows a
   column's type. A function gains a parameter only with a default.
2. **Functions keep their names and their named refusals**
   ([0038](decisions/0038-everything-raises-by-name.md)): a caller that
   reads `time_zone_required` today reads it throughout 1.x.
3. **`nexgen-os migrate` upgrades from any published version**, forward
   only.
4. **An upgrade leaves a module's figures as they are**: an estimate or a
   settlement keeps its provenance, its inputs and its results
   ([0004](decisions/0004-a-figure-says-where-it-comes-from.md)), and a newer pack reaches
   an installation only through its own upgrade
   ([0034](decisions/0034-a-pack-upgrade-is-never-silent.md)).
5. **The pack format is `pack.1.json`.** A pack valid against
   [`packs/schema/pack.1.json`](../packs/schema/pack.1.json) installs on
   every 1.x release.
6. **The program connector contract is `contract: 1`**
   ([0013](decisions/0013-a-program-connector-reads-one-request.md)).

## Planned before 1.0

- **The packages on npm** under `@nexgen-os`: the format libraries and the
  connectors, each usable without Nexgen OS; the installer, `nexgen-os`;
  the core client ([`releasing.md`](releasing.md)).
- **An MCP server**, `@nexgen-os/mcp`, local and hosted, on the model of
  Ekwo OS's: an agent describes a participant, imports a file, computes a yield
  and reads it back, as the user, under row level security
  ([0039](decisions/0039-an-agent-is-a-user-of-the-model.md)).
- **Versioned vocabulary identifiers** for every vocabulary row
  (`publisher/dictionary/version/code`, as bSDD does), with the first pack
  that publishes vocabulary
  ([0002](decisions/0002-standards-as-vocabulary-mappings.md)).
- **Licence of the specification and home of the project**: CC BY 4.0
  proposed for the specification and the vocabularies, so that translations
  and forks are allowed; a neutral foundation or association for the
  project once there is traction
  ([0005](decisions/0005-agpl-core-mit-libraries-sign-off.md)).
- **Series at scale** ([0007](decisions/0007-series-at-scale.md)): a cold
  tier where a detached weekly partition becomes one Parquet file on object
  storage, read back through the host's reader; TimescaleDB's columnstore
  as an accelerator when a self-hosted installation has it.
- **Models in the `building` module**
  ([0008](decisions/0008-the-building-module-describes-what-is-built.md)):
  `models` (one georeferenced model of a building or a ground: format, file
  address and checksum, reference system, origin on the globe, rotation,
  scale, up axis, units, vertical datum, bounding box, level of detail, the
  source's georeferencing block), `drawings` and `tilesets` (3D Tiles built
  by a calculation), and one function placing a model in the world. The acceptance
  test: an IFC and a CityJSON of one building land as two models placed on
  the same footprint.
- **Modules** ([`modules/README.md`](../modules/README.md)): `storage`,
  `charging`, `heating`, `thermal`, `kpis`, `monitoring`, `sensors`,
  `wind`, each starting from the participant and its devices
  ([0041](decisions/0041-a-module-names-one-thing.md)); a PV\*SOL study
  imported as an estimate of `solar` and compared with the `pvsol_like` profile
  within a stated tolerance ([0012](decisions/0012-a-yield-says-what-it-was-computed-from.md)).
- **Program connectors** ([0013](decisions/0013-a-program-connector-reads-one-request.md)):
  a long-running program served over HTTP with the same contract, when a
  computation outgrows one process; pandapower for the `grid` module
  (`power_flow`).
- **Integrations** ([0014](decisions/0014-integrations-dashboards-warehouses-streams.md)),
  in the order installations ask for them: daily and monthly views of series
  for business intelligence tools; a reader of the InfluxDB line protocol;
  an MQTT connector; a dashboard written from the objects of a project; a
  Kafka connector and the change data capture publication; a guide for
  Power BI.
- **Publications** ([0015](decisions/0015-publications.md)): the public
  schema, one document per row (an open GeoJSON export of a project, with
  title, SPDX licence, publisher, date and sha256 written by the database),
  published and withdrawn by owners, read by the anonymous role through one
  view; then series, documents, an embeddable map, and a check of a
  publication's licence against its sources'.
- **Planning** ([0017](decisions/0017-planning-as-data.md)): a vocabulary of kinds
  of project in place of free text.
- **An activity log**: who did what, and when, on the six objects of the
  core ([0006](decisions/0006-the-core-names-six-objects.md)) and on the
  figures the modules write about them — the person or the agent acting
  for them, the gesture, the object by its kind and id, the moment — as the
  platform this core was taken from keeps it in its action events and
  audit log. A figure says where it comes from; the log says who asked for it.
- **A recording** of the twenty-minute path of the README, from an empty
  Supabase project to a building with a yield.

## Where the code does not yet follow a decision

- **Merging two objects** ([0028](decisions/0028-two-objects-that-are-one-are-merged.md)):
  `replace_device()` dates a replacement by its two devices; the gesture
  that merges two objects that are one, and the proposal of probable
  duplicates, are still to write.
- **Golden cases** ([0034](decisions/0034-a-pack-upgrade-is-never-silent.md)):
  the packs `fr` and `be` carry their checks and their certification; the
  reference case each replays through the modules, and the runner that compares
  its figures, are still to write.

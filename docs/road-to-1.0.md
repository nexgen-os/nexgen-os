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
- **Modules** ([`modules/README.md`](../modules/README.md)):
  `heating`, `thermal`, `monitoring`, `sensors`,
  `wind`, each starting from the participant and its devices
  ([0041](decisions/0041-a-module-names-one-thing.md)); a PV\*SOL study
  imported as an estimate of `solar` and compared with the `pvsol_like` profile
  within a stated tolerance ([0012](decisions/0012-a-yield-says-what-it-was-computed-from.md)).
- **`charging`, next**: OCPP 2.1 (bidirectional charging); OCPI, the
  roaming of sessions and tariffs; OSCP and OpenADR, the flexibility
  signals of a grid operator as profiles of purpose `external_constraints`;
  ISO 15118 (what the vehicle tells the charger, Plug & Charge); smart
  charging engines as program connectors proposing profiles through
  `charging.limit()`. The central system that holds the WebSocket of each
  station stays an operated service ([services.md](services.md)).
- **`battery`, next**: the ageing of a battery over its cycles and the
  power price of a peak avoided, in the dispatch; hydrogen.
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
- **An activity log**: who did what, and when, on the six objects of the
  core ([0006](decisions/0006-the-core-names-six-objects.md)) and on the
  figures the modules write about them — the person or the agent acting
  for them, the gesture, the object by its kind and id, the moment — as the
  platform this core was taken from keeps it in its action events and
  audit log. A figure says where it comes from; the log says who asked for it.
- **Exchange rates** (`currency_rates`, as Ekwo OS holds them: a currency,
  a day, a rate to the installation's reference currency, its source), when
  a portfolio sums projects kept in two currencies; until then a figure is
  in the currency of its place and is never converted.
- **A recording** of the twenty-minute path of the README, from an empty
  Supabase project to a building with a yield.

### What the reference platforms of the trades hold

Each where it will live; the market, the support schemes, the status of a
value, the hourly emission factors, the loss chain and the exceedance levels
are in 0.3 ([0048](decisions/0048-a-value-says-what-kind-of-value-it-is.md),
[0049](decisions/0049-the-market-follows-the-place-a-scheme-is-the-countrys-its-contract-the-devices.md)).

- **Guarantees of origin and hourly matching (24/7)** — `community`, with
  registry connectors: the certificates issued, transferred and cancelled for
  a participant's production or consumption, read from the issuing body's
  register, and the hour-by-hour matching of consumption with cancelled
  certificates; the market-based scope 2 reading them before the residual mix.
- **The itemised cost of a connection, and the queue and capacity by
  substation** — `grid`: the lines of an operator's connection offer
  (works, share of the reinforcement, fees) as an estimate of the module, and
  the projection of hosting capacity and of the requests ahead in the queue
  of a substation, from `grid.substations` and the operators' registers.
- **Parcels and buildable area** — `building`, with map layers: the land
  parcel of a site from the cadastre, the area a plan allows to build or to
  cover with panels once setbacks and protected zones are taken out.
- **Near-shading obstacles** — `building` and `solar`: the trees, chimneys,
  parapets and neighbouring buildings around a roof face as objects with a
  height and a footprint, and the shading loss of each array computed from
  them, a row of its loss chain.
- **Ground-mounted PV** — `solar`: the vocabulary of a field system (fixed or
  tracker, single or dual axis, ground coverage ratio, pitch between rows,
  height), and the clipping of the inverter in `solar.size()`, the DC/AC
  ratio a criterion chooses.
- **PAN and OND in, DXF, KML and a bill of materials out** — connectors and
  format libraries: the products of a study imported from their PAN and OND
  files ([`panond`](../packages/formats/panond/README.md) reads them today),
  a layout exported as DXF and KML, and its bill of materials.
- **Invoice verification** — `billing` and a `contracts` module: an energy
  invoice checked line by line against the readings of its meter and the
  prices of its contract, the gaps named.
- **Flexibility** — the activation of a flexible device (a battery, a
  charger, a heat pump) by an operator or an aggregator, its ramp, the
  deviation of what was delivered from what was asked, and the pooling of
  devices into one offer; through the `actions` commands and the market roles
  of `grid`.

### 0.4: taken from Ekwo OS

What Ekwo OS already settled, taken in its shape so that a database holding
both cores reads one way:

- **The activity log in the shape of Ekwo OS's audit log** (its decision
  0017, an append-only audit trail): one row per change — `occurred_at`,
  the actor (`actor_id`, the person, the issuer of a key included;
  `api_key_id`, the key a change came through), the organisation where Ekwo has the company, the table and the
  record (`record_id`, `record_key`), the operation, the business act when
  the change is one (`action`: `plan_applied`, `command_reported`,
  `pack_upgraded`), and the old and new values; append only, written by
  triggers, never by the application.
- **The MCP server reached through PostgREST**, as Ekwo OS's recommended
  route, once the gestures that are a module's code today (sizing, a yield,
  a settlement) are reachable as functions of the schema; and **numbers as
  decimal strings** where a figure is money.

## Done

- **The MCP server**, `@nexgen-os/mcp`, on the model of Ekwo OS's: over
  stdio and over Streamable HTTP with the OAuth discovery a remote client
  follows (RFC 9728, RFC 8414, RFC 7591); acting as the person, read only
  unless they allow writing, a `service_role` key refused; the tools of the
  core and of the modules installed, the same gestures as the command line
  ([packages/mcp/README.md](../packages/mcp/README.md),
  [0046](decisions/0046-a-key-acts-as-its-issuer-an-agent-reaches-the-database-as-the-person.md)).
  The hosted server is an operated service, its operator's; the README says
  how anyone hosts one.
- **API keys** in the shape of Ekwo OS's (`api_keys`): per organisation, the
  visible `prefix` and the `key_hash` only, `capabilities`, `created_by`,
  `expires_at`, `last_used_at`, `revoked_at`; the secret shown once; a key
  acts as its issuer, within its organisation, which the activity log will
  say.

## Where the code does not yet follow a decision

- **Merging two objects** ([0028](decisions/0028-two-objects-that-are-one-are-merged.md)):
  `replace_device()` dates a replacement by its two devices; the gesture
  that merges two objects that are one, and the proposal of probable
  duplicates, are still to write.
- **Golden cases** ([0034](decisions/0034-a-pack-upgrade-is-never-silent.md)):
  `fr` and `be` carry five cases each and `es` four, replayed by
  `tests/golden.test.ts`; what their figures cannot reach yet is said by
  name in them: `enedis` lists no region and no identifier prefix, so a
  French meter not connected to its operator is not resolved; `be` decides
  no location-based emission factor (`grid_co2_factor`), and `es` neither
  that factor nor a reference price of injection.
- **A project shared with a person, in every module**: the core, `grid`,
  `community` and `actions` let a member of a project read and write under
  it (`secure_table()` given the expression of a row's project), and so do
  the estimates of `solar` and their rows; the other tables of `building`,
  `solar`, `consumption`, `weather`, `billing`, `charging`, `kpis` and
  `battery` still read the organisation alone (or the participant's
  account), and gain the expression of their project one by one.
- **The perimeter beyond a municipality**: the limits of municipalities are
  not in the model, so the Walloon extension around a wind turbine
  (`sharing_municipality_extension_m`) is reported, not decided; and the
  rules of Brussels and Flanders wait for their texts in the `be` pack.
- **Meter data connectors after homologation**: every connector of a grid
  operator's hub reads through `collectMeterReadings()`, which asks
  `grid.authorise_reading()` first. Switchgrid runs now (answers to record in
  its test world); the operator's own web services (`enedis-sge`) wait for
  the third-party contract and the homologation named in their README; the
  R64 index, daily energy and technical data are ordered but not yet mapped
  to series, and other countries' hubs are not described yet.

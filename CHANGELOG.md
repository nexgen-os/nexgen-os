# Changelog

Every change that a user of Nexgen OS can see, by release, under
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project
follows [Semantic Versioning](https://semver.org/); before 1.0 a minor
release may break, and says how. How a release is cut:
[`docs/releasing.md`](docs/releasing.md).

## [Unreleased]

### Added

- `system_loss`, the aggregate loss of a PV system, a parameter of the `solar` module resolved by `parameter_of()` from the system up to the organisation and the country, with PVGIS PVcalc's 14 % at the generic level ([0055](docs/decisions/0055-a-parameter-is-resolved-once-from-the-country-down-to-the-device.md)); an estimate records it in `inputs.system_loss` and in its loss chain.
- A `pvgis_like` yield estimate without years reads every year PVGIS covers and gives their mean annual.
- `nexgen-os solar estimate`: a PV system at a point and its yield by month, in one command, as a person — the mean of every year PVGIS covers unless `--year` names one, the system loss given by `--loss` set on the participant; `describePvSystem()` in the core and the MCP tool `solar_describe_system` describe a system and its arrays as the `solar` module reads them.
- `importGeoJsonParticipants()` of `@nexgen-os/core`: the participants of a GeoJSON FeatureCollection — the export's, or any file whose features carry its properties — join a project at their place, with their category, address, time zone and identifiers. The file is attached to the project with its checksum and imported once (`already_imported`), whole or not at all; a feature without a name or a country refuses it by its index (`name_required`, `country_required`).
- After `init`, an organisation and the people in it are commands, run as a person under row level security: `nexgen-os organisation create` (the person becomes its owner), `member add`, `member list`, `member role` and `member remove`, through `create_organisation()`, `add_member()`, `set_member_role()` and `remove_member()`, and as `createOrganisation()`, `listMembers()`, `addMember()`, `setMemberRole()` and `removeMember()` of `@nexgen-os/core`. `init` names them in what to do next, and the installer's README follows an installation with them.
- `aggregate(series[], from, to, step, time_zone?)`, a read of the core: several series of one quantity that adds up — the meters of a community, the registers of one participant — summed bucket by bucket, each read as `resample()` reads it (a register by its consumption), with the count of series that held a value in each bucket so that a missing one shows instead of a smaller total. Days are cut in the time zone the series share, or the one given; it refuses `quantities_differ`, `quantity_not_summable` (a power, a temperature, a state) and `time_zone_required` (series in several time zones). `aggregate()` of `@nexgen-os/core` calls it. `nexgen-os migrate` applies `supabase/migrations/20261028000000_core_series_aggregate.sql`.
- `@nexgen-os/utilityrate5`, a format library for the electricity rates of SAM (NREL): the `ur_` inputs of its `utilityrate5` module read into plain rates — energy charges by period and tier, the 12 × 24 weekday and weekend schedules, time-series buy and sell rates, every other input as read — and written back to the same inputs; `hourlyRates()` gives the rate of each hour of SAM's year, and `rateFromHourly()` folds an hourly year back into its schedules, or keeps it as time-series rates when no schedule holds it. No database, no currency named.
- `docs/demo/compared.ts`: the yield of one PV system by several methods of the `solar` module (PVGIS, PVWatts, PVWatts computed by an engine such as pvlib), month by month in the participant's local year, and the gap of each month and of the year against the first method or against another tool's report (PVsyst, PV*SOL) given with its source. The case of a roof in Brussels in 2023 is published in `docs/demo/README.md` and held by a test on recorded answers.
- `@nexgen-os/dsmr`: what the P1 port of a smart meter says, read into plain values — the DSMR telegram (2.2 to 5.0.2, and the Belgian e-MUCS variant) and the JSON message of the open P1M5 dongle. Each value says what it measures from its OBIS code (energy, power, voltage, current, volume), in which direction (offtake or injection), on which phase and in which tariff register, in the unit the meter writes; the reading is dated by the meter's clock, local time with its season letter, in UTC with the zone the caller gives, never by the time it was received. The CRC16 of DSMR 4 and 5 is checked; every object is kept as written; problems by name (`crc_mismatch`, `time_missing`, `season_mismatch`…). MIT, no database, no network.
- `meterSeriesOfDsmr()` in `@nexgen-os/core`: the readings of a P1 port as the series of a meter, ready for `storeSeries()` — the energy registers as cumulative `offtake_energy` / `injection_energy` series named by tariff, the power and the voltage as instants by phase, and with `channel` the volume of a gas, water or heat meter of the bus at the stamp it sent. A reading that cannot be dated or whose checksum does not match is left out and said in `skipped`; a stream is never refused for one bad telegram.
- Georeferenced models in the `building` module, 0.4.0 ([0008](docs/decisions/0008-the-building-module-describes-what-is-built.md)): `building.models` holds a model of a building or a ground — an IFC, a CityJSON, a glTF, a point cloud — by the address, format, size and checksum of its file, never its bytes, and places it by data: its frame (an EPSG code, or a local frame at its origin with true north up), its origin in WGS 84, the heading of its +Y axis, its scale, the length of a model unit, its up axis, its vertical datum, its bounds and the source's georeferencing block as it came. `building.model_to_world()` places any geometry of a model in WGS 84 and `building.model_footprint()` gives the plan of its bounds; `building.add_model()` refuses `model_host_kind`, `model_origin_required`, `crs_unknown` and `already_imported` (one checksum, one model of an organisation). `addModel()` writes one from `placementOfIfc()` or `placementOfCityJson()`, and `@nexgen-os/ifc` gives its placement as values (`georeference.placement`). An IFC and a CityJSON of one house land as two models of its building, on its footprint to the centimetre.
- Georeferenced models in the `building` module, 0.4.0 ([0008](docs/decisions/0008-the-building-module-describes-what-is-built.md)): `building.models` holds a model of a building or a ground — an IFC, a CityJSON, a glTF, a point cloud — by the address, format, size and checksum of its file, never its bytes, and places it by data: its frame (an EPSG code, or a local frame at its origin with true north up), its origin in WGS 84, the heading of its +Y axis, its scale, the length of a model unit, its up axis, its vertical datum, its bounds and the source's georeferencing block as it came. `building.model_to_world()` places any geometry of a model in WGS 84 and `building.model_footprint()` gives the plan of its bounds; `building.add_model()` refuses `model_host_kind`, `model_origin_required`, `crs_unknown` and `already_imported` (one checksum, one model of an organisation). `addModel()` writes one from `placementOfIfc()` or `placementOfCityJson()`, and `@nexgen-os/ifc` gives its placement as values (`georeference.placement`) and the box its meshes fit in (`bounds`). An IFC and a CityJSON of one house land as two models of its building, on its footprint to the centimetre.
  **From 0.4.0.** `nexgen-os migrate` applies `modules/building/supabase/migrations/0002_models.sql` where `building` is installed; nothing that exists changes.
- The `forecast` module: a series of the core forecast by a method of `forecast.methods`, over a horizon, from a history (`forecast.forecasts`). `forecast.issue()` writes the forecast as known at a time into a forecast series of the same object, through `store()` with its issue time: every step after the last value observed, up to the horizon; an issue in the past is a backtest. `forecast.accuracy()` gives the mean absolute error, root mean square error and bias of a forecast against its series, at a horizon. The module ships the two benchmarks every forecast is measured against, `naive` and `seasonal_naive` ([README](modules/forecast/README.md)).
- An account opened by an invitation: `before_user_created(event)`, the
  Before User Created hook of Supabase Auth, lets in the email address an
  open invitation was sent to, and the installation's first person while
  no organisation has a member, and refuses every other sign-up as
  `invitation_required`. It does nothing until the installation enables it
  (docs/access.md).
- A weather point keeps a time zone, and `weather.time_zone_of(series)` gives it to the series of the point: `resample(s, from, to, '1 day', weather.time_zone_of(s))` cuts the days and the months of a point's temperatures or irradiance where its participants live. Until now no participant owned these series, and their days were refused as `time_zone_required`. `weather.point_for()` gives a new point the participant's time zone, and a point without one the first a participant brings; migration `0002_point_time_zone` fills the points already there from the participants that read them, and `nexgen-os migrate` applies it.
- Raw values are kept as long as the place decides (decision 0007): the attribute type `series_retention`, an ISO 8601 duration (P3Y) set on a series, an object above it, the organisation or as a pack's default, and `series_retain()`, which removes the values older than it, cut at the hour in UTC, and keeps the hourly and daily rollups, so that `resample()` reads the same days afterwards. A series without a retention keeps every value; forecast issues are not touched; a duration that is not ISO 8601 is refused as `retention_invalid`. For the installation's service role or a pg_cron job, not the API roles (migration `20261103100000_core_series_retain`).
- A document an owner publishes is kept as it was published ([0015](docs/decisions/0015-publications.md)): `nexgen.document_publications`, one row per version published, with a copy of the document, its licence, the sources it draws on with their licences, its date, its publisher and the sha256 the database writes (`publication_digest()`). `publish(document, licence, sources)` and `withdraw(publication)` are its gestures, held by the new capability `publications.manage` of the owner preset; `publish()` refuses `license_required`, `checksum_required`, `source_unknown` and `source_not_redistributable`, and the withdrawal is the only change a publication takes. The anonymous role reaches none of it; the schema the public reads comes next.
- A project described as data — its participants with their place, the meters they carry, the devices behind them and the identifiers each is known by elsewhere — is written into an organisation through the gestures of the schema (`importProject()` in `@nexgen-os/core`, `nexgen-os project import --file <description.json> [--dry-run]`, the MCP tool `import_project`). Each object is looked for first, by an identifier it carries, then by what names it in its parent; the same description written again creates nothing and adds only what is new, so the import of another system is replayed as often as that system changes. A dry run writes nothing and lists what would be created. Refusals by name: `name_required`, `country_required`, `scheme_required`, `identifier_required`, `device_type_required`, `identifiers_disagree`, `meter_carried_elsewhere`.
- A project as one table a spreadsheet saves: `@nexgen-os/project-sheet` (MIT) reads a project sheet — one row per meter or device of a participant, columns from its published `template.csv`, the separator taken from the header so a comma, a semicolon or a tab all read — names with its line every cell it cannot read and writes projects back as a sheet that reads the same. `importProjectSheet()` in `@nexgen-os/core` gives each project of it to `importProject()`, `nexgen-os project import --file <sheet.csv>` and the MCP tool `import_project_sheet` call it. A sheet with a cell it cannot read is refused before anything is written: `sheet_unreadable` with each problem and its line, `sheet_empty`.
- The project sheet read straight from the `.xlsx` workbook a spreadsheet keeps (`readProjectWorkbook()`, `nexgen-os project import --file <sheet.xlsx>`): the first worksheet or the one named, dates from their serial numbers, and an identifier the spreadsheet stored as a number and rounded reported as `number_rounded`, never given.
- `nexgen-os doctor` names `billing_keys_missing` when Ekwo OS shares the database and the `billing` module holds no foreign key to it yet, as after installing Ekwo OS second; `nexgen-os migrate` (or `billing.reference_ekwo()`) adds them. Until now the doctor said nothing, and the keys stayed missing until someone remembered the statement.
- `@nexgen-os/fluvius`: the Flemish operator's API for service providers as a meter data connector. `consentLink()` gives the page where the customer signs, `mandates()` and `mandateStatusOf()` follow the mandates, and `readings()` gives the quarter-hour `offtake_energy` and `injection_energy` of a meter by its EAN, under the mandate `grid.authorise_reading()` returns. Sandbox secret or live certificate (`clientAssertion()`), secrets given by the caller from the vault.
- Pack be 0.4.1: the source `fluvius_service_provider_api` and the conventions of the Fluvius hub (`meter_data`: zone, quarter hours, quality table), with the guide it cites.
- The Python client attaches a value with its quality: `attach(..., quality="measured")` writes `published`, `measured`, `estimated` or `assumed`, and without one the database's default, `estimated`, as before. Another word is refused as `quality_unknown`, the name the domain `value_quality` gets on the client.
- The Python client reads a parameter through the one cascade of defaults, `parameter_of(kind, object_id, attribute_type, at=None)`: the value with the level it was found at, its source and its quality, or `parameter_missing`; and lists the projects the connection may read, `projects(organisation_id=None)`.
- `actions.progress()` says where the devices of a participant or a project stand, beside its actions: how many in each status of the core, the share in service among those not removed, and the ones not yet in service, by name — what a site board shows (migration `0003_progress_devices` of `actions`). The status is the device's own; the module reads it and never writes it.
- `docs/demo/ifc.ts`, an IFC model to the places of a participant and back out as GeoJSON: `ifcToGeoJson()` reads the file with `@nexgen-os/ifc`, writes it through `importIfc()` of the `building` module and exports the participant with `exportGeoJson()`, and its command runs it in one transaction acting as the person (`NEXGEN_API_KEY`, `NEXGEN_ACCESS_TOKEN` or `NEXGEN_ACT_AS_USER_ID`), the open export (`--open`) leaving out what a source's licence does not let pass on.
- `@nexgen-os/grb`: the buildings of a place in Flanders from open data. The footprints of GRB (the Large-scale Reference Database of Digitaal Vlaanderen) around a point, each by its persistent object id, and the surface and terrain models of DHM Vlaanderen II at 1 m over their box; `heightsInFootprint()` gives the ground (median of the terrain), the eave and the ridge (two percentiles of the surface, given as data) of each footprint, and `siteModel()` returns the whole as a CityJSON model in Lambert 72 that `importCityJson()` of the `building` module writes: footprint, elevation, height, `global_id`, and the GRB version and dates in its metadata. Sources `grb` and `dhmv` ship with the package. MIT; open, no key.
- A device connector, in `@nexgen-os/core`: `DeviceReadingsProvider` reads series of a charger, a heat pump, an inverter or a battery from its maker's platform, and `collectDeviceReadings()` keeps them as measured series of the device, found by its identifier in the platform's scheme; `CommandCarrier` carries out a command of the `actions` module, and `carryCommands()` sends the validated commands of a connector that are due and reports each answer through `actions.report()`, or the report a module passes. Refusals `identifier_missing`, `device_in_other_organisation`, `connector_source_mismatch`, `module_not_installed`. Decision [0061](docs/decisions/0061-a-device-connector-reads-series-and-carries-commands.md).
- The code of the `solar` module as a package, `@nexgen-os/solar` (AGPL-3.0): the yield by PVGIS or PVWatts, sizing, exceedance levels, performance indicators and product files, each writing its estimate with its provenance, and the models under them (PVWatts, Faiman, the Finkelstein-Schafer typical year, the Sandia inverter from an OND file), for an application that computes against an installation. The package carries the module's manifest; it is published with the next release, like every workspace of the repository.
- `@nexgen-os/sunspec`, a format library for SunSpec Modbus: the map of a device (`SunS`, then its models until `0xFFFF`), each information model read from its registers with the definitions the SunSpec Alliance publishes (all 112 included, Apache-2.0), every point scaled by its scale factor with its units, enum symbol and bitfield flags, and `writePoint()`, the registers that set a writable point. Tested against the values pysunspec2, the SunSpec Alliance's reader, computes from the same registers.
- `@nexgen-os/evcc` (MIT): the device templates of [evcc](https://evcc.io) read into plain shapes — the products a template drives, its class and group, capabilities, the uses of a meter template, how the device is found on a local network (DNS-SD, host name, MAC prefix) and whether evcc asks for a sponsorship; `connectorsByBrand()` gives the templates each brand can be reached through.
- `importEvccCatalogue()` in `@nexgen-os/core`: the products of evcc's open templates in the catalogue, one entry per model, its device type read through `EVCC_DEVICE_TYPES` (data, replaceable), the templates a device of the model can be driven through under `metadata.evcc` with the commit read and evcc's licence. Sponsored templates and brands without a model are left out, each with its reason; an entry already known keeps its values; replayed, the import changes nothing.
- `@nexgen-os/homeassistant-api`, a live Home Assistant read over its WebSocket API: `homeAssistantSnapshot({ url, token }, { from, to, entities })` gives the floors, areas, devices and entities of an installation and the states its recorder kept over the period (or the current ones) as the snapshot `@nexgen-os/homeassistant` reads, so that `readHomeAssistant()` and `importHomeAssistant()` of the `building` module take it as they take a file. The token is the caller's, from the secret its `connectors` row names; refusals are named (`source_unauthorised`, `source_refused`, `source_timeout`, `entity_not_found`).
- `@nexgen-os/ocpp` starts and stops a session from afar: `writeRemoteStart()` and `readRemoteStart()` (an EVSE, an id token, the remote start id 2.0.1 requires, a profile for the session alone), `writeRemoteStop()` and `readRemoteStop()`, under the action of each version (`RemoteStartTransaction` in 1.6, `RequestStartTransaction` from 2.0.1, `COMMAND_ACTIONS`). `readStationLog()` gives the `commands` of a log with their answers and, from 2.0.1, the transaction a start opened. `readAnswer()` reads the answer to any command; `readProfileAnswer()` stays as the same function.
- `@nexgen-os/ocpp` reads OCPP 2.1 as 2.0.1 where the two agree, and refuses by name what only 2.1 says (`purpose_unsupported` for `PriorityCharging` and `LocalGeneration`, `limit_required` for a period without a limit); `SUBPROTOCOLS` and `versionOfSubprotocol()` give the version a station asks for. The `charging` module already accepts `2.1` as the version of a charger.
- `@nexgen-os/homewizard`, the HomeWizard P1 meter read on the participant's own network (local API v1, no key, no mandate): `homewizard({ host, timeZone })` with `identify()` and `read()`, and `readingOfHomeWizard()` for an answer already fetched. A reading gives the offtake and injection registers by tariff, the power of the connection and of each phase split by direction, the voltage of each phase, all dated when read, and the gas and water meters of the bus at their own stamp in the participant's time zone, each to be stored on its own meter. What it cannot date or read is skipped by name (`time_zone_required`, `stamp_ambiguous`, `unit_unsupported`, `value_invalid`). The package ships its `homewizard` source.

### Changed

- The `pvgis_like` and `pvwatts` yield profiles no longer carry 14 %: their `system` loss is the place's `system_loss`. Where nobody sets it, the generic level gives the same 14 %, so an estimate moves only where an organisation, a project, a participant or a system says its own. `nexgen-os migrate` applies `modules/solar/supabase/migrations/0005_system_loss.sql` where `solar` is installed.
- **Breaking:** `@nexgen-os/panond` computes no figure ([0035](docs/decisions/0035-a-format-library-touches-no-database.md)): `readPan()` gives the file's one-diode model without the light current and the saturation current PVsyst does not store (`PvsystFileParameters`), and the point the file states them by, `reference` (`isc`, `voc`, `t_ref`); `diodeCurrents()` leaves the library. The `solar` module solves them: `pvsystModel()` of `modules/solar/src/products.ts`, which `importProduct()` calls, gives the same `I_L_ref` and `I_o_ref` as 0.4.0, and `pan_inconsistent` is now its refusal. A caller that read `readPan(…).parameters.I_L_ref` reads `pvsystModel(readPan(…)).I_L_ref`.
- `settleSharing()` of the `community` module adds up the meters of a participant with `aggregate()`, where it summed their `resample()` itself: the same figures, from the one sum of the core.

### Fixed

- `importEnergyBill()` and `importWeatherFile()` write a file whole or not at all: one transaction, or a savepoint when the caller already holds one, through `atomically()` of `@nexgen-os/core`. A bill refused after its document was attached left the document behind, and the same bill was then refused as `already_imported`; a weather file refused at one quantity kept the series stored before it.
- `building`: `importCityJson()` writes a building whose ground is not a whole number of metres. The elevation was read as an integer by the query that places the footprint, and an elevation of 7.84 m was refused with `invalid input syntax for type integer`.

## [0.4.2] — 2026-11-02

The `billing` module finds Ekwo OS in the schema it lives in.

### Fixed

- On a database where Ekwo OS 0.23 or later keeps its core in `ekwo`, `billing` saw no Ekwo OS: no foreign key, no legal number, no tax read from it. Migration `0002_ekwo_schema` finds Ekwo OS by its own marker, in `ekwo` then `public`. Installations with Ekwo OS in `public` keep working, and `nexgen-os migrate` adds the missing foreign keys.

### Added

- 32 currencies in the core seed, following Ekwo OS 0.24.

### Fixed

- `billing` finds Ekwo OS in the schema it lives in: `ekwo` since Ekwo OS 0.23, `public` from 0.17 to 0.22, by Ekwo's own marker (`ekwo_schema_version()` beside its `instance` table), looked for in `ekwo` then `public` and never assumed (`billing.ekwo_schema()`, `billing.ekwo_table()`, migration `0002_ekwo_schema`). Before it, the module looked in `public` only, and beside Ekwo OS 0.23 or later it added no foreign key and read no legal number, reach or tax from Ekwo OS. The foreign keys added beside an Ekwo OS in `public` follow its tables when it moves. Run `nexgen-os migrate` before or with the `ekwo migrate` that moves Ekwo OS ([docs/with-ekwo-os.md](docs/with-ekwo-os.md)).
- The core's currencies hold, row for row, the ISO 4217 currencies Ekwo OS 0.24 seeds (32 more, from the same ISO 4217 list one), so that a database holding both cores keeps one list.

## [0.4.1] — 2026-10-27

The same code as 0.4.0, published by the release workflow of this repository through npm trusted publishing, with provenance: every package of `@nexgen-os/*` and `nexgen-os` now comes from a tag of `nexgen-os/nexgen-os`, built and published by GitHub Actions. Nothing changes for a database: the schema stays at 0.4.0, and `nexgen-os migrate` has nothing to apply.

## [0.4.0] — 2026-10-26

The first version published to npm: `npx nexgen-os init` installs it, and the libraries are published under `@nexgen-os/*`. Release 0.3.0 was cut in the repository and never published.

### Added

- The command is also `nexgen`: once installed (`npm install -g nexgen-os`), `nexgen init`, `nexgen doctor` and every other command of `nexgen-os` answer under the shorter name.
- `battery.size()` says in `warnings` when its period is under a year (`period_under_a_year`, with the number of days): the savings of the period are scaled to a year, so the season it covers weighs on the savings, the payback, the net present value and the rates. On one site, a 5 kWh battery saved 318 a year sized on a whole year, 374 on June alone and 94 on December alone.
- `battery_opex`, the yearly operating cost of one MWh of usable storage capacity, an attribute type of the `battery` module: `battery.size()` takes it off the savings of a year for the payback and the net present value, gives `opex_per_year` on each point of its curve, and records it in its inputs, null when nobody says it and none is counted.
- `--project-ref <ref> --db-region <region>`, with the database password in `NEXGEN_DB_PASSWORD` (or `--db-password`): every command that reaches a database finds the session pooler of a Supabase project itself, trying both generations of its host (`aws-0-`, `aws-1-`) and keeping the one that holds the project — the flags Ekwo OS takes for the same thing. A missing or malformed piece is refused by name (`invalid_project_ref`, `db_region_required`, `invalid_region`, `db_password_required`), and `pooler_not_found` names the hosts tried, never the password.
- `nexgen-os try`: the core and the `solar` module in a Postgres in memory, the house of example 01 and its yield for a year, by month, with its provenance — no database, no account.
- `nexgen-os init` reads, before applying anything, the schema each module it installs would create, and refuses one the database already holds by name: `schema_taken`, naming the schema, the module and the objects already in it. `nexgen-os doctor` names the same schemas for the modules not installed yet.
- A module manifest may list the codes the module carried in an earlier release, `formerly` ([0054](docs/decisions/0054-a-module-that-cannot-install-changes-its-code.md)); `migrate` and `doctor` refuse an installation that holds one as `module_renamed`, naming the new code.

### Changed

- **Breaking:** what kind of value a value is has one word, `quality` ([0057](docs/decisions/0057-one-word-per-thing-in-the-lists-of-the-core.md), superseding 0048). The table `value_statuses` is now the domain `nexgen.value_quality`, carried by `attributes.quality`, `defaults.quality` and `solar.estimate_losses.quality` (formerly `status`); the conventional value a study starts from is `assumed` (formerly `default`); `set_attribute()` takes `p_quality`, `parameter_of()`, `grid.market_of()` and `solar.soiling_of()` return the key `quality`; a pack writes `quality` on a value of `defaults.json` (`packs/schema/pack.1.json`), and the packs `fr`, `be` and `es` move to 0.4.0, their values unchanged. `status` names a lifecycle only.

  **From 0.3.0.** `nexgen-os migrate` applies `supabase/migrations/20261025000000_core_value_quality.sql` and, where `solar` is installed, `modules/solar/supabase/migrations/0004_estimate_losses_quality.sql`; every row keeps its word, `default` becoming `assumed`. A database that added its own rows to `value_statuses` maps them to the four words first, then migrates:

  ```sql
  update nexgen.attributes set status = 'estimated' where status not in ('published', 'measured', 'estimated', 'default');
  update nexgen.defaults   set status = 'estimated' where status not in ('published', 'measured', 'estimated', 'default');
  ```

  A caller that names the old words changes them: `set_attribute(…, p_quality => 'assumed')` where it passed `p_status => 'default'`, `parameter_of(…)->>'quality'` where it read `->>'status'`, `where quality = 'assumed'` where it filtered `status = 'default'`.
- **Breaking:** a project's kind is the frame it is carried out in, or none ([0057](docs/decisions/0057-one-word-per-thing-in-the-lists-of-the-core.md)). `projects.kind` is nullable, without a default, and `create_project()` takes no kind unless given one; the generic kinds nothing reads are gone — `study` (a project being studied is in `simulation`), `other`, `buildings`, `construction` and `district_plan`. `pv_roof`, `self_consumption`, `individual_self_consumption`, `collective_self_consumption`, `energy_community` and the frames of the packs stay. The golden case `pv_farm_injection` of the pack `fr` has no kind.
- **Breaking:** what a participant does with energy is its `category`, `producer`, `consumer` or `prosumer` (formerly `participants.role`): `join_project()` takes `p_category`, `add_participant` of the MCP server and `participant add --category` of the command line take `category`, the request of a sharing engine (`energy_sharing`) and `community.check_perimeter()` give `category`, a golden case of a pack writes `category` for each participant, and the GeoJSON of a participant carries it. `role` names an access preset only.
- **Breaking:** the region a region is part of is `regions.parent_code` (formerly `parent`), as the parent row of every tree of the core; `grid.operator_of()` and the cascade of `parameter_of()` climb by it.

  **From 0.3.0.** `nexgen-os migrate` applies `supabase/migrations/20261025100000_core_what_a_project_is.sql`, then `modules/community/supabase/migrations/0003_participant_category.sql` and `modules/grid/supabase/migrations/0002_region_parent_code.sql` where those modules are installed. A project of a removed kind keeps everything else and has no kind; a kind an installation added under one of them loses its parent. The migration refuses a database where a default holds for a removed kind (`project_kind_in_use`); close those rows or move them first:

  ```sql
  select id, attribute_type, country, condition from nexgen.defaults
   where condition->>'project_kind' in ('study', 'other', 'buildings', 'construction', 'district_plan');
  ```

  A caller changes `participants.role` to `participants.category`, `regions.parent` to `regions.parent_code`, `join_project(…, p_role => …)` to `p_category`, and reads a project's `kind` as possibly null; an action template of an installation whose condition names a removed kind no longer applies.
- A value `store()` writes in a simulated series without a quality is estimated (1), no longer measured (0): a computation measures nothing. A measured series, a setpoint and a command keep 0 for a value as its source delivered it; a forecast's values carry no quality. Every estimate a module writes from now on stores its series in quality 1, and the worst quality of a bucket of `resample()` says so.
- The schema is 0.4.0 (`supabase/migrations/20261026000000_schema_version_0_4_0.sql`): `nexgen_schema_version()` answers it once the migrations of this release are applied. `nexgen-os` brings a database of 0.3.0 forward, its floor staying 0.3.0; `@nexgen-os/mcp` reads a participant's `category`, which a database of 0.3.0 does not have, and its floor rises to 0.4.0 — run `nexgen-os migrate` first. The modules `battery`, `community`, `grid` and `solar` move to 0.4.0.
- `role_capabilities.role` is one of the four presets, `owner`, `editor`, `viewer` and `participant` (`role_capabilities_role`), where it took any word of a given shape.
- Nexgen OS describes itself as a world model for energy assets and the open source operating system built on it, in the READMEs, the package descriptions and the instructions of the MCP server; the model and its names are unchanged.
- The battery dispatch splits the round-trip efficiency η between the two ways, √η on charge and √η on discharge, as the hourly engine of the platform it was taken from does: a full battery takes `capacity / √η` of the surplus and serves `capacity × √η`, where it took `capacity` and served `capacity × η`. At η = 0.85 a 10 kWh battery serves 9.22 kWh a full cycle, no longer 8.5. Every dispatch and sizing with an efficiency below 1 moves; the provenance is `battery-dispatch-0.3.1`.
- **Breaking:** the batteries module `storage` is now `battery` — its folder, its code, its schema and every name in it: `battery.devices`, `battery.products` (formerly `storage.battery_products`), `battery.objectives`, `battery.estimates`, `battery.battery_of()`, the computation `battery.size`, the MCP tools `battery_estimates` and `battery_size`, `size --module battery`, the `battery` section of a golden scenario's device, the provenance `battery-dispatch-0.3.0` and the rows it publishes (`published_by = 'battery'`). Every Supabase project already holds a schema `storage`, the one of Supabase Storage, so the module installed on none of them ([0054](docs/decisions/0054-a-module-that-cannot-install-changes-its-code.md)). The modules are applied in the order of their folders, `battery` now second.

  **From `storage` to `battery`.** Only a plain Postgres can hold the module of 0.3.0, since a Supabase project could not install it. `nexgen-os migrate` refuses such a database as `module_renamed`. Export what `storage.devices` and `storage.battery_products` hold, and the attributes set on `battery_cost`, `battery_lifetime` and `discount_rate`, then, in one transaction:

  ```sql
  drop schema storage cascade;
  delete from nexgen.defaults where published_by = 'storage';
  delete from nexgen.sources where published_by = 'storage';
  delete from nexgen.attribute_types where published_by = 'storage';
  delete from nexgen.modules where code = 'storage';
  delete from nexgen.schema_migrations where scope = 'module:storage';
  ```

  then `nexgen-os migrate`, `nexgen-os init --modules battery` with the modules and packs already installed, and load the export into `battery.devices` and `battery.products`. The series the estimates of `storage` wrote keep their source, `storage.estimates:<id>`.

### Fixed

- `nexgen-os doctor` counts the vocabularies `project_kinds`, `segments` and `capabilities`, which it left out, and no longer `value_statuses`.
- Text files are checked out with LF on every platform (`.gitattributes`): on Windows, Git's line-ending conversion changed the bytes of the pack seeds and `nexgen-os pack check` refused them.
- Pack `be` 0.3.1: VAT on electricity for a professional customer, 21 % and the Ekwo OS tax `BE-S-21` (circular 2023/C/64 of FPS Finance). The 6 % row held for every segment, so `billing.tax_of()` gave a business participant `BE-S-06`.

## [0.3.0] — 2026-10-22

The first release of Nexgen OS: an open digital twin of energy places —
organisations, projects, participants, their meters, devices and series —
driven by AI agents that work as users of the model, in a Postgres
database with PostGIS that its owner keeps
([0039](docs/decisions/0039-an-agent-is-a-user-of-the-model.md)). Schema
version `0.3.0`, schema floor `0.3.0`.

### Added

**The core**, in the schema `nexgen`: thirty-seven tables and one view
([docs/model.md](docs/model.md)), its migrations and seed in `supabase/`
([supabase/README.md](supabase/README.md)).

- Six objects, in the order a page walks them: the organisation and its
  members, the project, the participant — the node that carries the place,
  the meters and the devices — the meter, the device and the series
  ([0006](docs/decisions/0006-the-core-names-six-objects.md),
  [0043](docs/decisions/0043-the-participant-is-the-node.md)). The
  hierarchy is the foreign keys
  ([0001](docs/decisions/0001-the-hierarchy-is-the-foreign-keys.md)).
- The place in one shape on the participant: address (`address_line1`,
  `address_line2`, named as Ekwo OS names them), point in WGS 84 with
  its height, precision, source, time zone; `join_project()`,
  `locate_participant()`, `place_of()`
  ([0025](docs/decisions/0025-a-place-has-one-shape.md)). Geometry stored
  in EPSG:4326 in 3D and measured in its UTM zone
  ([0003](docs/decisions/0003-geometry-wgs84-3d-utm.md)).
- Attributes with their period and source, external identifiers checked
  against their scheme (with the ISO 6523 code of a register of companies,
  `icd`), documents with their size, checksum and uploader as Ekwo OS
  describes an attachment, each naming its object by kind and id;
  `set_attribute()`, `attributes_of()`, `add_identifier()`,
  `attach_document()`; every attribute and every default of a pack says
  what kind of value it is — published, measured, estimated or default, in
  the words of the series quality (`value_statuses`) — and `parameter_of()`
  returns it with the value
  ([0048](docs/decisions/0048-a-value-says-what-kind-of-value-it-is.md))
  ([0019](docs/decisions/0019-a-column-only-for-what-every-row-has.md)).
- Meters under the identifier their operator knows, one open participant
  per meter within a project, the same meter described again in a study or
  a scenario of another project, never carrying production
  (`declare_meter()`, `assign_meter()`, `close_meter()`;
  `production_on_meter`); devices as instances of a product
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
  cascade, `parameter_of()`, which reads a project's own country for the
  project itself
  ([0002](docs/decisions/0002-standards-as-vocabulary-mappings.md),
  [0021](docs/decisions/0021-one-cascade-of-defaults.md)).
- What a project is and who a participant is, as vocabularies:
  `project_kinds` (generic kinds in the core, the legal frames of a country
  in its pack, each refining one; `projects.kind` checked by a foreign key)
  and `segments` (`participants.segment`, residential or professional and
  their refinements), refused by name outside them
  ([0019](docs/decisions/0019-a-column-only-for-what-every-row-has.md)).
- Defaults that hold for a condition — a kind of project, a segment, a
  device type, a density class, an attribute — in the one shape of a
  condition, checked by `condition_check()` and matched by
  `condition_matches()` for `parameter_of()` and `actions.plan()` alike
  ([0044](docs/decisions/0044-a-condition-has-one-shape.md)); and
  municipalities as `regions` rows of
  their country, with their density class: `parameter_of()` takes, from the
  municipality up to the country, the most specific row the object meets
  and names it ([0009](docs/decisions/0009-what-applies-follows-the-region.md),
  [0021](docs/decisions/0021-one-cascade-of-defaults.md)). The municipality
  is a key of the shape of a place.
- Currencies as Ekwo OS holds them (`currencies`, ISO 4217, seeded from
  the same list), named by countries, products, series and units; prices
  as quantities (`energy_price`, `power_price`, `fixed_price`) and an
  amount of money (`amount`), their units
  copied for every currency a country declares, a price
  series keeping its currency; the energy self-consumed, charged into and
  discharged from a battery
  ([0030](docs/decisions/0030-a-value-is-stored-in-the-unit-of-its-quantity.md)).
- A figure says where it comes from: each module keeps what it computes in
  a plain table of its own (`solar.estimates`, `consumption.estimates`,
  `community.settlements`), each row with its subject, its provenance, its
  inputs and its results, written by the module's function that computes
  it, and replaced by a new computation that names it
  ([0004](docs/decisions/0004-a-figure-says-where-it-comes-from.md)).
- A project shared with a person beside the members of its organisation
  (`project_shares`, viewer or editor, read by the policies of everything
  under the project), and invitations by email to an organisation or a
  project, in the columns and the gestures of Ekwo OS's invitations: the
  token returned once and kept as its sha256 (`token_hash`), revoked by hand
  or by inviting the same address again (`invite_member()`,
  `accept_invitation()`, `accept_invitations()`, `revoke_invitation()`).
- Access by capability, in the shape and the words of Ekwo OS
  ([0051](docs/decisions/0051-roles-resolve-into-capabilities.md),
  [docs/access.md](docs/access.md)): `capabilities` and
  `role_capabilities`, a role being a preset (`owner`, `editor`, `viewer`,
  `participant`); every policy and every gesture of the core and of the
  modules asks `has_capability(object_kind, object_id, capability)` or
  `row_has_capability()`, and the hygiene script refuses a policy that
  compares a role; `my_capabilities()` lists what a person holds.
- The end customer is a participant
  ([0052](docs/decisions/0052-the-end-customer-is-a-participant.md)): one
  account on `participants.user_id`, which reads its participant, the
  participants it groups and everything under them, writes its contact
  details and notification settings (`attribute_types.written_with`), its
  consents and its answer to a recommendation (`actions.decide()`), and reads
  its share of a settlement (`community.settlement_share()`); opened by
  `invite_participant()`.
- The vocabulary of what a sizing aims at, `sizing_criteria`, read by every
  module that sizes ([0045](docs/decisions/0045-to-size-is-one-gesture.md)).
- Sources and an organisation's connectors, naming their secret
  ([0011](docs/decisions/0011-external-data.md)); row level security on
  every table, no function resolving `public`, which stays the
  installation's; rights granted by name, refusals by name
  ([0037](docs/decisions/0037-the-schema-grants-its-own-rights.md),
  [0038](docs/decisions/0038-everything-raises-by-name.md));
  `nexgen_schema_version()`.
- Keys for a machine or an agent, in the shape of Ekwo OS's (`api_keys`,
  `create_api_key()`, `list_api_keys()`, `revoke_api_key()`,
  `use_api_key()`): issued by whoever holds `members.manage`, kept as a
  hash, carrying codes of `capabilities` their issuer holds, acting as their
  issuer within their organisation and their list, read only with `.read`
  capabilities only; and
  `create_project()`, the gesture that opens a project
  ([0046](docs/decisions/0046-a-key-acts-as-its-issuer-an-agent-reaches-the-database-as-the-person.md)).
- The quantities a meter measures at its connection point:
  `offtake_power`, `injection_power`, `apparent_power` (kVA), the inductive
  and capacitive reactive power and energy, and `voltage`, with the units
  var, kvar, varh, kvarh, V and kV; a mandate may allow a five-minute step
  (`PT5M`). The attribute types of a supply contract read from a bill:
  `subscribed_apparent_power`, `supply_contract_type`,
  `supply_energy_price` and `supply_tariff`.
- The core library, `@nexgen-os/core`, version `0.3.0`: the database
  seam, the standard place and the geocoder chain, the series API, the importers and exporters of the core, the
  connector interfaces and the runner of the program connectors; the
  gestures the command line and the MCP server share, each in a
  transaction acting as a person; `importEnergyBill()`, which attaches a
  bill with its checksum, finds or declares its meter and writes its
  contract as published attributes; `collectMeterReadings()`, the one path
  from a meter connector to the series of a meter, asking the mandate check
  first (`authoriseReading()`) and handing the connector the hub's
  conventions (`meterDataHub()`), with `meterSeriesOfR6x()` and
  `registerSource()`.

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
- `grid`: the operators of a country, with the regions, municipalities and
  identifier prefixes they cover, their substations with their hosting
  capacity, the grid side of each meter with its substation,
  `grid.operator_of()`, the operator of a meter from the most precise level
  up, `grid.same_substation()`, and the mandates that allow an organisation
  to read a meter at its operator's hub: `grid.authorise_reading()` is the
  one check a connector asks before reading, with what is read and the step
  asked, refusing by name (`mandate_missing`, `mandate_expired`,
  `mandate_scope`); how an operator's hub publishes meter data
  (`grid.operators.meter_data`: who reads it, its time zone, its quality
  letters, its history and steps); the market a
  place trades in — bidding zone, control area, imbalance settlement period
  from the pack, the transmission operator with its EIC code
  (`grid.market_of()`) — the market series naming a zone
  (`grid.zone_series()`), the roles of the market an organisation or a
  contact holds (`grid.market_parties`); the support schemes of a country
  from its pack, the contract of a producing device, the obligation to stop
  at negative prices by date and the revenue of injection hour by hour
  (`grid.support_of()`, `grid.injection_revenue()`)
  ([0049](docs/decisions/0049-the-market-follows-the-place-a-scheme-is-the-countrys-its-contract-the-devices.md)).
- `community`: energy sharing among the participants of a project, as
  settlements of a sharing program, read from the meters or, for a study,
  from the production and consumption curves, and kept to physics
  (`settlement_exceeds_physics`); the consents of the participants, a
  settlement refusing a participant without a consent to sharing where its
  rules require one; the perimeter of the operation, checked participant by
  participant against the rule of its pack (`check_perimeter()`).
- `billing`: the bridge to Ekwo OS — the participant is billed, Ekwo OS
  keeps the invoice; Ekwo OS recognised by its own marker, its keys added by
  `nexgen-os init` (`billing.link_organisation()`, `billing.reference_ekwo()`);
  on a database holding both cores, one source for each fact: a linked
  party's legal numbers, matched by their ISO 6523 code, and how it is
  reached are read from Ekwo OS (`billing.legal_identifiers()`,
  `billing.reach_of()`), and the tax of an invoice is Ekwo's tax of the
  code the pack names beside its rate (`billing.tax_of()`); `nexgen-os
  doctor` names what is held on both sides (`billing_held_twice`); an
  energy bill recorded as a purchase (`billing.record_invoice()`)
  ([0010](docs/decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md),
  [docs/with-ekwo-os.md](docs/with-ekwo-os.md)).
- `consumption`: load profiles, activity hours and a participant's curve,
  measured, estimated from a bill (`estimateFromBill()` spreads the energy
  of a bill over its period), or typical.
  A device recognised by disaggregation (`consumption.recognise_device()`):
  a device of the participant signed by its source, its
  `recognition_confidence`, the simulated series of its consumption and the
  recommendation that asks its customer to confirm it; it requires `actions`.
- `kpis`: indicators as data, their targets, the figures computed for a
  participant, a project, a meter or a device and written back as series,
  a portfolio of projects and export templates; the self-consumption a
  series measures, else the balance that gives it, said in the figure;
  the batteries in the balance and the self-consumption they add; the
  value of an energy hour by hour at a price series (day-ahead values of
  injection, sharing and residual offtake); the CO2 avoided and the scope 2
  emissions, location-based hour by hour at the carbon intensity series of
  the bidding zone when there is one, month by month at the pack's factor
  otherwise, and market-based at the supplier's mix or the residual mix,
  the figure saying which.
- `weather`: weather sources with their coverage, the points participants
  read, and the source each participant reads for each purpose.
- `solar`: PV systems and arrays, product physics, horizons, named yield
  profiles, design variants, and yields computed by PVGIS, by
  `pvwatts.ts` or by pvlib, with the IEC 61724-1 indicators read on the
  measured production of the system, the loss chain of a yield as rows
  (`solar.estimate_losses`, by the codes of `solar.loss_kinds`, each with
  its source and status) and its exceedance levels (P50, P75, P90, P95, P99
  in `solar.estimate_levels`)
  ([0012](docs/decisions/0012-a-yield-says-what-it-was-computed-from.md));
  the production of a participant read measured first
  (`solar.curve_series()`); `size()`, the PV power that best meets a named
  criterion within the roof, an estimate about the participant
  ([0045](docs/decisions/0045-to-size-is-one-gesture.md)).
- `storage`: batteries and their product physics, their dispatch on the interval series of a participant's place or of a project's sharing (self-consumption, peak shaving, arbitrage, batteries chained), and the sizing of a battery for a named criterion, as estimates ([README](modules/storage/README.md)).
  It publishes the C-rate (0.4) and the round-trip efficiency (0.85) of the
  representative residential battery of the Annual Technology Baseline 2025
  at the generic level of `parameter_of()`, valid in every country below
  every place
  ([0053](docs/decisions/0053-a-technology-figure-holds-everywhere-below-every-place.md)).
- `actions`: what has to be done on an object of the core, now or later,
  of three kinds in one table and one lifecycle (proposed, validated,
  launched, done or failed, dismissed): the steps of a project, planned from
  action templates per country, region and condition, with its phases and
  roles; recommendations resting on the estimate that gives their gain; and
  commands, a setpoint or an order asked of a device at an instant, carried
  out by a connector and stored in a setpoint or command series of the
  device (`actions.command()`, `actions.report()`)
  ([0017](docs/decisions/0017-an-action-is-something-to-do.md)).
- `charging`: electric vehicle chargers with their EVSEs and connectors,
  their OCPP identity and the meter they sit behind; their sessions,
  recorded once per source and transaction (`charging.record()`, the id
  token kept as personal data); charging profiles asked as command actions
  on the charger (`charging.limit()`), the station's answer recorded and
  the schedule stored as a setpoint series (`charging.report()`,
  [0047](docs/decisions/0047-a-charging-profile-is-a-command.md)); the
  import of a station's OCPP log; `size()`, the number of charge points and
  their power for `demand_served` or `max_power`, from the arrivals and
  departures of the vehicles and the power of the connection
  ([README](modules/charging/README.md)).

**The format libraries**, MIT, one per format, each reading a file into
plain shapes and touching no database
([packages/formats/README.md](packages/formats/README.md),
[0035](docs/decisions/0035-a-format-library-touches-no-database.md),
[0036](docs/decisions/0036-a-file-is-imported-once.md)).

- `@nexgen-os/cityjson`, `geojson`, `homeassistant`, `ifc`, `panond`,
  `parquet`, `weather-files` (EPW and TMY3) and `ocpp` (OCPP 1.6J and
  2.0.1).
- `@nexgen-os/enedis-r6x`: the R63 (load curve) and R64 (index) files of
  Enedis, JSON and XML, every step at its start in UTC from the operator's
  legal time given by the caller (the repeated autumn hour told apart by
  line order), the quality letters by the caller's table, a missing step
  kept missing, problems by name.
- `@nexgen-os/energy-bill`: the energy of a bill read once
  ([0050](docs/decisions/0050-an-energy-bill-is-read-once-a-generic-invoice-then-its-energy.md)),
  from the EN 16931 invoice a generic reader returns and the energy facts
  beside it: the meter, the consumption period, kWh per band counted once,
  prices by band and season, the revision and the projection, network
  included or billed, taxes, contributions, totals checked with named
  remarks; generic by country and currency.

**The connectors**, MIT ([packages/connectors/README.md](packages/connectors/README.md)).

- Weather and yield: `@nexgen-os/open-meteo` (forecast and ERA5 history),
  `@nexgen-os/pvgis`.
- Geocoders: `@nexgen-os/nominatim`, `@nexgen-os/photon`, and the national
  registers `@nexgen-os/ban`, `@nexgen-os/geopunt`, `@nexgen-os/urbis`,
  `@nexgen-os/icar`, chained by `geocoderChain()`.
- Meter data under the customer's mandate: `@nexgen-os/switchgrid`
  (Switchgrid's API v0 — the consent, the mandate approved on
  `ask.contract_access_granted`, R63 orders per direction, the operator's
  files read by `enedis-r6x`) and `@nexgen-os/enedis-sge` (the operator's
  web services for a third party under contract, a skeleton until
  homologation; what the contract settles is listed in its README); each
  ships its `sources` row.
- A commercial geocoder: `@nexgen-os/mapbox` (Geocoding API v6, in the
  permanent mode its terms require for a stored place), told apart from the
  open fallback by its `sources` row.
- Program connectors in any language, one JSON request in and one JSON
  result out: `pvlib` (Python), and the `sharing-example` and
  `settlement-example` programs, meant to be copied and replaced
  ([0013](docs/decisions/0013-a-program-connector-reads-one-request.md)).

**The packs**, version `0.3.0`, certification `community`, written as
JSON against `packs/schema/pack.1.json` and compiled into `supabase/seed/`
by `nexgen-os pack build` — identity and regions, identifiers, sources,
grid operators, frames of projects, municipalities and defaults, each value
with its source and reference
([packs/README.md](packs/README.md),
[0020](docs/decisions/0020-a-pack-holds-what-a-function-reads.md),
[0034](docs/decisions/0034-a-pack-upgrade-is-never-silent.md)). Each carries
golden cases, one per kind of project — a scenario and the figures an
installation must find from it, each with its source and its tolerance —
replayed for every pack by one runner (`tests/golden.test.ts`) and checked
by `pack check`, which refuses a pack without a case unless it says why.

- `fr` (France): the departments under their regions; the PRM of a meter,
  the INSEE code, SIREN and SIRET, the cadastral parcel, the address and
  building registers; the frames of collective and individual
  self-consumption; the VAT
  rate on electricity beside the code of the Ekwo OS tax it mirrors; the
  control area, the imbalance settlement period and the EIC code of the
  transmission operator; the purchase obligation and its negative-price
  threshold from 2025; the residual mix of 2024 (`market_co2_factor`,
  Association of Issuing Bodies); how Enedis's hub publishes meter data, and
  the source `enedis_sge`; five golden cases
  ([packs/fr/README.md](packs/fr/README.md)).
- `be` (Belgium): the languages in the order of its Constitution and of
  Ekwo OS; the regions; the NIS code, the enterprise number, the regional
  address and building registers; the frames of renewable, citizen and
  local energy communities and of energy sharing; the
  EAN prefixes by which `grid.operator_of()` finds an operator (the Brussels
  operator's among them), the residual mix of 2024, the reference price of
  injection of 2024 (CREG); five golden cases
  ([packs/be/README.md](packs/be/README.md)).
- `es` (Spain): the euro, four official languages, the peninsula's and the
  Canary Islands' time zones, the 50 provinces under their autonomous
  communities and the two autonomous cities; the CUPS with its control
  letters, the INE municipality code, the NIF of a legal entity and the
  cadastral reference; Red Eléctrica and eleven distribution operators found
  by the CUPS prefix the transmission operator assigns them; the bidding
  zone and the control area by their EIC code; the frames of
  Real Decreto 244/2019 and Ley 24/2013; the perimeter of a collective
  self-consumption in the wording of the Real Decreto-ley 7/2026 (the same
  transformer station, or 500 m; 5 000 m for a photovoltaic or wind
  device); VAT, the off-peak window of the 2.0 TD tariff, prices and fees,
  each with its text; four golden cases
  ([packs/es/README.md](packs/es/README.md)).

**The command line**, version `0.3.0`: `nexgen-os`, the installer: `init`,
`migrate`, `doctor`, `status`, `pack build` and `pack check`; and the
gestures of the model as a person — `key`, `project create`, `participant
add`, `meter declare`, `device install`, `series import`, `size`, `kpis` —
with `--json` ([packages/cli/README.md](packages/cli/README.md),
[0040](docs/decisions/0040-a-release-has-a-tag-a-schema-version-and-a-floor.md)).

**The MCP server**, version `0.3.0`: `@nexgen-os/mcp`, the MCP server on the
model of Ekwo OS's: over stdio, and over Streamable HTTP with the OAuth
discovery a remote client follows (RFC 9728, RFC 8414, RFC 7591), scopes
`energy` and `energy.write`; acting as the person, read only unless they
allow writing, a `service_role` key refused; the tools of the core and of
the modules installed ([packages/mcp/README.md](packages/mcp/README.md),
[0046](docs/decisions/0046-a-key-acts-as-its-issuer-an-agent-reaches-the-database-as-the-person.md)).

**The Python client**, version `0.3.0`: `nexgen_os`: the reads of the model
and attributes attached with their source, with dataframes as optional
extras ([0024](docs/decisions/0024-one-language-per-layer.md)).

**The demo**: seven loadable datasets — a house, a school, an energy
community, a farm, a district from open data, a drone survey, an office —
and the twenty-minute yield of the README
([docs/demo/README.md](docs/demo/README.md)).

**The doctrine**: the rules on one screen and fifty-three decision records
([docs/doctrine.md](docs/doctrine.md),
[docs/decisions/](docs/decisions/README.md)), and the road to 1.0
([docs/road-to-1.0.md](docs/road-to-1.0.md)).

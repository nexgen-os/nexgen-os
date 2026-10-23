# `modules/` — one Postgres schema each, beside the core

The core is the schema `nexgen`: the named objects and what is attached to them. What
is specific to a trade lives here, one folder and one schema per module.

## A module's folder

```
modules/<code>/
  module.json            the manifest: code, name, version, description, schema, requires, licence
  supabase/migrations/   the module's schema, applied in the order of the names
  src/                   its TypeScript, where it computes or imports (battery, building, charging, community, consumption, kpis, solar)
  tests/                 its tests, run by the suite with every other
  README.md              what it holds and computes, for a reader who has never seen it
```

The manifest is written against [`schema/module.1.json`](schema/module.1.json).
`npx nexgen-os init` finds a module by its manifest: every folder here with a
`module.json` is shipped, applied when asked for (`--modules`, every module
by default) after the core's migrations and seed, and recorded by the path
of each file in `nexgen.schema_migrations`. The module's first migration
writes its row into `nexgen.modules`, and a test pins that row to the
manifest (`tests/module-manifests.test.ts`).

## The rules

1. **One schema, and the core is not it.** A module depends on `nexgen` by
   foreign key; the core has no hook and no idea it exists.
2. **Start from an object of the core, and enrich it** ([0042](../docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)).
   A module that needs more about an object of the core adds a table with
   the same id (`call derive_devices('solar.devices', 'solar')`;
   `grid.meters`, keyed by the meter's id); one that adds a kind of
   object of its own gives it a foreign key to the core object it belongs
   to, and says what describes it in its own columns (`building.buildings`:
   its year, floors, energy label, the identifier of its file). The
   attachments of the core — attributes, identifiers, documents, series —
   name the six objects of the core only, by kind and id; a relation a
   module needs is a column of its table pointing to an object of the core
   (`building.spaces.occupant_id`). A table about an object of the core of
   any kind (an action) carries `object_kind` with the same
   check on the six words, beside the object's id, and goes with its
   object. The hierarchy is the
   foreign keys ([0001](../docs/decisions/0001-the-hierarchy-is-the-foreign-keys.md)).
   A module table never names a table of another module. Every module
   table that carries `organisation_id` reaches a core table other than
   `organisations` by its foreign keys; `nexgen-os doctor` names one that
   does not (`module_table_detached`). The project, the participant, the
   meter and the device are the core's: a module never holds a notion of
   its own beside them, and the participant is the node it starts from
   ([0043](../docs/decisions/0043-the-participant-is-the-node.md)).
3. **Read the core freely, write it through its functions** (`series_ensure()`,
   `store()`, `set_attribute()`…). A module that computes keeps its figures in
   a plain table named after what they give (`solar.estimates`,
   `community.settlements`), each row with its subject, its `provenance`, its
   `inputs`, its `results`, `created_at` and `updated_at`, written by the
   module's own function ([0004](../docs/decisions/0004-a-figure-says-where-it-comes-from.md)).
   A module may also publish vocabulary rows (device types, properties,
   quantities, sources) with `published_by` set to its code.
4. **Row level security on every table**, through `secure_table()`.
5. **A country is data.** No module names one; what a country decides is in
   its pack.
6. **The installed modules are a table.** A module's first migration writes
   its row into `nexgen.modules`.
7. **A module declares its inputs and outputs**, typed and with units, so
   that a figure says what it read and can be compared.

## Modules

A module computes in TypeScript or hands a computation to a program
connector (`packages/connectors/`, decision [0013](../docs/decisions/0013-a-program-connector-reads-one-request.md)):
a program in any language, JSON in and out, that never reads the database.

What an owner publishes is the core's, not a module's: a frozen document and a schema of its own
for the anonymous role ([0015](../docs/decisions/0015-publications.md)).
What a country requires is never a module: what it decides is data of its pack,
and `actions` carries what has to be done, with its reference and its condition.
A module with a folder here is shipped; a module marked *proposed* is one
whose one thing is known ([0041](../docs/decisions/0041-a-module-names-one-thing.md)).

| Module | Objects it adds | Computes |
|---|---|---|
| `grid` | the grid side of a meter of the core: the operators of a country and their substations (`operators`, `substations`, written by packs and connectors) and, for each meter, its operator, voltage level and substation (`grid.meters`, the meter's id); the mandates that allow an organisation to read a meter at its operator's hub (`mandates`); how an operator's hub publishes meter data (`operators.meter_data`); the market a place trades in and its parties (`market_parties`); support schemes and a producer's contract | whether participants sit downstream of one substation; whether a connector may read a meter (`authorise_reading()`); the operator of a meter (`operator_of()`), the market of a place (`market_of()`), the support and injection revenue of a producing device (`support_of()`, `injection_revenue()`); later, supply contracts and tariff components |
| `community` | energy sharing on the projects and participants of the core: the allocation key of a project and what it reads of a participant, as their attributes; the consents of its participants (`community.consents`); the volumes allocated to each participant as series of a settlement of the module (`community.settlements`) | whether each participant is within the perimeter of the operation, by the rule of its pack (`check_perimeter()`); who received how much: self-consumption of a participant, energy sharing in a community, volumes per participant and interval, through a sharing program; a settlement program turns them into settlement lines, handed to the invoicing side through `billing` ([why](../README.md#invoicing-and-ekwo-os)) |
| `billing` ([0010](../docs/decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md)) | the billing bridge: an organisation's Ekwo company, a contact's email, phone and Ekwo contact, and the Ekwo invoices issued for or to a participant of the core, as pointers; the line where Nexgen OS stops is in the [README](../README.md#invoicing-and-ekwo-os) | nothing: a settlement line is handed to [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os) ([ekwo.ai](https://ekwo.ai)), which keeps legal identity, invoices and the ledger; the two install side by side on one database ([with Ekwo OS](../docs/with-ekwo-os.md)) |
| `building` ([0008](../docs/decisions/0008-the-building-module-describes-what-is-built.md), [README](building/README.md)) | the physical description of a participant's place: its ground (`sites`), buildings, their floors, rooms, zones and units (one tree of spaces), roof faces, facades and ground areas with their orientation, each described in its columns, the participant that occupies a floor or a unit, the uses of a building or a place (`uses`); no placement of a device ([0026](../docs/decisions/0026-a-device-belongs-to-its-participant.md)); the importers of CityJSON, IFC and Home Assistant homes; later, georeferenced models (glTF, IFC, CityJSON, meshes), drawings, 3D Tiles tilesets | the level-of-detail 1 block of a building, the orientation of a face from its 3D polygon; later, placing a model on the globe, extrusion tiles for MapLibre, 3D Tiles builds; drone flights, scenes and videos stay outside the open repository |
| `solar` ([0012](../docs/decisions/0012-a-yield-says-what-it-was-computed-from.md)) | PV systems, PV arrays (one orientation each), module and inverter product physics, horizons, named yield profiles, design variants of a participant's PV (`variants`), the estimates it computed (`estimates`) | PV yield as an estimate that says its weather, period, conventions, models and losses, computed by PVGIS, by `pvwatts.ts` or by the pvlib engine ([0013](../docs/decisions/0013-a-program-connector-reads-one-request.md)); IEC 61724 indicators against measured production of the system; `size()`: the PV power that best meets a named criterion within the roof ([0045](../docs/decisions/0045-to-size-is-one-gesture.md)); PVGIS, Open-Meteo, EPW, PAN/OND, PVsyst and PV*SOL results as formats |
| `battery` ([README](battery/README.md)) | batteries, a device of type battery with the same id (`battery.devices`: usable capacity, charge and discharge power, round-trip efficiency, band of state of charge, objective, perimeter — the participant's place or the project's sharing), the physics of a battery product (`battery_products`), objectives as a vocabulary, the estimates it computed (`estimates`); hydrogen later | `dispatch()`: charge and discharge of the batteries of a perimeter on its interval series, chained, for self-consumption, peak shaving or arbitrage, with their series of charge, discharge and state of charge; `size()`: one more battery swept over its capacity, the point a named criterion recommends |
| `charging` ([0047](../docs/decisions/0047-a-charging-profile-is-a-command.md), [README](charging/README.md)) | electric vehicle chargers, a device of type charger with the same id (`charging.devices`: power of the station, OCPP identity, the meter it sits behind), their EVSEs and connectors (`connectors`, `connector_standards`), the sessions they deliver (`sessions`, once per source and transaction; the id token is personal data), the charging profiles they are asked to keep (`profiles`), the estimates it computed (`estimates`) | `record()`: a session from a station or a file; `limit()`: a charging profile as a command action on the charger, `report()`: the station's answer, its schedule stored as a setpoint series; `size()`: the number of charge points and their power for `demand_served` or `max_power`, from the arrivals and departures of the vehicles and the power of the connection; the import of an OCPP log through [`@nexgen-os/ocpp`](../packages/formats/ocpp/README.md) |
| `consumption` | load profiles as data, activity hours of a participant, the curves it estimated (`estimates`); next, typical weeks | a participant's consumption curve: measured, estimated from a bill and activity hours, or typical, as an estimate; the curve read measured first ([README](consumption/README.md)) |
| `contracts` (proposed) | supply, injection, physical or virtual PPA and internal community tariff contracts, with their parties and their price signals (fixed, indexed, cap, floor) | under which contract and at which price: the contract and the price signal in force over each interval, read by the settlement engine; no invoice, which is [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os)'s |
| `flexibility` (proposed) | flexible loads, offers, activations | demand response, aggregation, dispatch across participants |
| `weather` | weather points (grid cells, stations) and which participants read each (`participants`), weather models as sources (`sources`, the source's code) with their coverage, the rule that picks one per place | the weather series every other module reads: observed, typical year, forecast; the choice of model resolved per participant from the installation, the pack, the organisation, the project |
| `wind` (proposed) | wind turbines and their product physics (power curve, hub height, rotor), wind series at hub height | their yield as an estimate, like `solar` for PV; hydro gets its own module the day a project needs it, cogeneration and biomass are sources of heat |
| `heating` (proposed) | heat pumps, boilers, air handling units, thermal zones, domestic hot water | heating and cooling design, sizing, seasonal performance |
| `thermal` (proposed) | envelope elements and their U-values, thermal bridges, glazing | thermal simulation of the envelope, heat losses, energy performance inputs |
| `monitoring` (proposed) | collection schedules and their history, alarms (a connector is code, an organisation's use of it is a `connectors` row of the core: [0011](../docs/decisions/0011-external-data.md)) | live readings from equipment and hubs, control through existing systems (Home Assistant, OpenEMS), battery dispatch, demand response |
| `actions` ([0017](../docs/decisions/0017-an-action-is-something-to-do.md)) | what has to be done on an object of the core, now or later: kinds (step, recommendation, command), phases of a project's life (study to decommissioning) and the roles that carry an action, as vocabularies; action templates per country, region and condition ([0044](../docs/decisions/0044-a-condition-has-one-shape.md)), with reference and documents; actions on a project, a participant, a meter or a device — steps, recommendations resting on the estimate that gives their gain, commands asked of a device at an instant — with planned and actual dates, one lifecycle (proposed, validated, launched, done, failed, dismissed), contact, dependency and source | `plan()`: the steps of a project from the templates that match it, once; `propose()`: a step or a recommendation; `command()`, `report()`: a value asked of a device, carried out by a connector and stored in its setpoint or command series; `move()`: an action along its lifecycle; `progress()`: where a participant or a project stands on a day |
| `sensors` (proposed, [0022](../docs/decisions/0022-the-instrument-is-a-device-the-point-is-the-series.md)) | for a device that measures (temperature, humidity, CO2, presence, light, irradiance, wind, flow, air quality), its product physics (quantities measured, range, accuracy, resolution) and the series a product creates for each quantity it reads; its calibration (date, certificate as a document); its placement (the `building` space it sits in, height, orientation); no table of points beside the series | installing a sensor from its product (the device and its series in one call); checking that a series stays within the range of its product |
| `kpis` ([README](kpis/README.md)) | indicators as data (`indicators`: a formula over the series and parameters of an object, the quantity of its figure, which way is better), targets and trajectories (`targets`), the figures it computed (`figures`), export templates (`templates`) | `compute()`: an indicator of a participant, a project, a meter or a device over a period, by month, day or hour, written back as a series of the core through `store()`; `of()`: an object's indicators against their targets; `portfolio()`: the projects the caller may read, aggregated; `report()`: a template read back from the figures |

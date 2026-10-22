# `modules/` — one Postgres schema each, beside the core

The core is the schema `nexgen`: the named objects and what is attached to them. What
is specific to a trade lives here, one folder and one schema per module.

## The rules

1. **One schema, and the core is not it.** A module depends on `nexgen` by
   foreign key; the core has no hook and no idea it exists.
2. **Start from an object of the core, and enrich it** ([0042](../docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)).
   A module that needs more about an object of the core adds a table with
   the same id (`call derive_devices('solar.pv_systems', 'solar')`;
   `grid.meters`, keyed by the meter's id); one that adds a kind of
   object of its own gives it a foreign key to the core object it belongs
   to, and says what describes it in its own columns (`building.buildings`:
   its year, floors, energy label, the identifier of its file). The
   attachments of the core — attributes, identifiers, documents, series —
   name the six objects of the core only, by kind and id; a relation a
   module needs is a column of its table pointing to an object of the core
   (`building.spaces.occupant_id`). A table about an object of the core of
   any kind (a task) carries `object_kind` (or `subject_kind`) with the same
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
   `store()`, `set_attribute()`…). A module that computes keeps its runs in
   `<module>.runs`, of the one shape the core's gesture writes
   (`record_calculation('<module>.runs', …)`, [0004](../docs/decisions/0004-a-figure-is-a-run.md)).
   A module may also publish vocabulary rows (device types, properties,
   quantities, sources) with `published_by` set to its code.
4. **Row level security on every table**, through `secure_table()`.
5. **A country is data.** No module names one; what a country decides is in
   its pack.
6. **The installed modules are a table.** A module's first migration writes
   its row into `nexgen.modules`.
7. **A module declares its inputs and outputs**, typed and with units, so
   that a run can be reproduced and compared.

## Modules

A module computes in TypeScript or hands a computation to a program
connector (`packages/connectors/`, decision [0013](../docs/decisions/0013-a-program-connector-reads-one-request.md)):
a program in any language, JSON in and out, that never reads the database.

What an owner publishes is the core's, not a module's: a frozen document and a schema of its own
for the anonymous role ([0015](../docs/decisions/0015-publications.md)).
What a country requires is never a module: what it decides is data of its pack,
and `tasks` carries what has to be done, with its reference and its condition.
A module with a folder here is shipped; a module marked *proposed* is one
whose one thing is known ([0041](../docs/decisions/0041-a-module-names-one-thing.md)).

| Module | Objects it adds | Computes |
|---|---|---|
| `grid` | the grid side of a meter of the core: the operators of a country (`operators`, written by packs) and, for each meter, its operator and its voltage level (`grid.meters`, the meter's id) | later, meter-data mandates, supply contracts, tariff components and the retrieval of meter data from grid operators' hubs |
| `community` | energy sharing on the projects and participants of the core: the allocation key of a project and what it reads of a participant, as their attributes; the volumes allocated to each participant as series of a run of the module (`community.settlements`) | who received how much: self-consumption of a participant, energy sharing in a community, volumes per participant and interval, through a sharing program; a settlement program turns them into settlement lines, handed to the invoicing side through `billing` ([why](../README.md#invoicing-and-ekwo-os)) |
| `billing` ([0010](../docs/decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md)) | the billing bridge: an organisation's Ekwo company, a contact's email, phone and Ekwo contact, and the Ekwo invoices issued for or to a participant of the core, as pointers; the line where Nexgen OS stops is in the [README](../README.md#invoicing-and-ekwo-os) | nothing: a settlement line is handed to [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os) ([ekwo.ai](https://ekwo.ai)), which keeps legal identity, invoices and the ledger; the two install side by side on one database ([with Ekwo OS](../docs/with-ekwo-os.md)) |
| `building` ([0008](../docs/decisions/0008-the-building-module-describes-what-is-built.md), [README](building/README.md)) | the physical description of a participant's place: its ground (`sites`), buildings, their floors, rooms, zones and units (one tree of spaces), roof faces, facades and ground areas with their orientation, each described in its columns, the participant that occupies a floor or a unit, the uses of a building or a place (`profiles`); no placement of a device ([0026](../docs/decisions/0026-a-device-belongs-to-its-participant.md)); the importers of CityJSON, IFC and Home Assistant homes; later, georeferenced models (glTF, IFC, CityJSON, meshes), drawings, 3D Tiles tilesets | the level-of-detail 1 block of a building, the orientation of a face from its 3D polygon; later, placing a model on the globe, extrusion tiles for MapLibre, 3D Tiles builds; drone flights, scenes and videos stay outside the open repository |
| `solar` ([0012](../docs/decisions/0012-a-yield-says-what-it-was-computed-from.md)) | PV systems, PV arrays (one orientation each), module and inverter product physics, horizons, named yield profiles, design variants of a participant's PV (`variants`), the runs it computed (`runs`) | PV yield as a run that says its weather, period, conventions, models and losses, computed by PVGIS, by `pvwatts.ts` or by the pvlib engine ([0013](../docs/decisions/0013-a-program-connector-reads-one-request.md)); IEC 61724 indicators against measured production; PVGIS, Open-Meteo, EPW, PAN/OND, PVsyst and PV*SOL results as formats |
| `storage` (proposed) | batteries and their product physics (usable capacity, cycles, round-trip efficiency), hydrogen later | charge and discharge dispatch on the series `solar` and `consumption` produce |
| `charging` (proposed) | EV chargers, charging sessions | charging load and its steering |
| `consumption` | load profiles as data, activity hours of a participant, the curves it reconstructed (`runs`); next, typical weeks | a participant's consumption curve: measured, reconstructed from a bill and activity hours, or typical, as a run; the curve read measured first ([README](consumption/README.md)) |
| `contracts` (proposed) | supply, injection, physical or virtual PPA and internal community tariff contracts, with their parties and their price signals (fixed, indexed, cap, floor) | under which contract and at which price: the contract and the price signal in force over each interval, read by the settlement engine; no invoice, which is [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os)'s |
| `flexibility` (proposed) | flexible loads, offers, activations | demand response, aggregation, dispatch across participants |
| `weather` | weather points (grid cells, stations) and which participants read each (`participant_points`), weather models as sources with their coverage, the rule that picks one per place | the weather series every other module reads: observed, typical year, forecast; the choice of model resolved per participant from the installation, the pack, the organisation, the project |
| `wind` (proposed) | wind turbines and their product physics (power curve, hub height, rotor), wind series at hub height | their yield as a run, like `solar` for PV; hydro gets its own module the day a project needs it, cogeneration and biomass are sources of heat |
| `heating` (proposed) | heat pumps, boilers, air handling units, thermal zones, domestic hot water | heating and cooling design, sizing, seasonal performance |
| `thermal` (proposed) | envelope elements and their U-values, thermal bridges, glazing | thermal simulation of the envelope, heat losses, energy performance inputs |
| `monitoring` (proposed) | collection schedules and their runs, alarms (a connector is code, an organisation's use of it is a `connectors` row of the core: [0011](../docs/decisions/0011-external-data.md)) | live readings from equipment and hubs, control through existing systems (Home Assistant, OpenEMS), battery dispatch, demand response |
| `tasks` ([0017](../docs/decisions/0017-tasks-as-data.md)) | phases of a project's life (study to decommissioning) and the roles that carry a task, as vocabularies; generic task templates per kind of project and role, the same in every country, with reference, documents and condition, and the regions a template holds in; tasks on a project, a participant, a meter or a device, with planned and actual dates, status, contact, dependency and source | `plan()`: the tasks of a project from the templates that match it, once; `progress()`: where a participant or a project stands on a day |
| `kpis` (proposed) | indicators as data (a formula over series or rollups, a period, a unit), targets and trajectories | the indicators of a participant or a project, written back as series of the core through `store()` |

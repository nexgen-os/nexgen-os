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
   object of its own gives it a foreign key to the core object it belongs to
   and declares it (`call declare_object('solar.pv_arrays', 'pv_array',
   '{pv_system_id,surface_id}')`), so that attributes, identifiers, links,
   series and documents attach to it. Every module table that carries
   `organisation_id` reaches a core table other than `organisations` by its
   foreign keys; `nexgen-os doctor` names one that does not
   (`module_table_detached`). The project, the participant and the meter
   are the core's: a module never holds a notion of its own beside them.
3. **Read the core freely, write it through its functions** (`record_run()`,
   `series_ensure()`, `store()`, `link_objects()`…). A module may
   also publish vocabulary rows (device types, profiles, properties,
   quantities, link types, sources) with `published_by` set to its code.
4. **Row level security on every table**, through `secure_table()`.
5. **A country is data.** No module names one; what a country decides is in
   its pack.
6. **The registry is a table.** The last statement of a module's first
   migration writes its row into `nexgen.modules`.
7. **A module declares its inputs and outputs**, typed and with units, so
   that a run can be reproduced and compared.

## Modules

A module computes in TypeScript or hands a computation to an external
engine (`engines/`, decision [0013](../docs/decisions/0013-external-engines.md)):
a program in any language, JSON in and out, that never reads the database.

What an owner publishes is the core's, not a module's: a frozen document and a schema of its own
for the anonymous role ([0015](../docs/decisions/0015-publications.md)).
What a country requires is never a module: the rules and defaults are in the packs,
and `tasks` carries what has to be done, with its legal reference and its condition.

| Module | Objects it adds | Computes |
|---|---|---|
| `grid` (shipped) | the grid side of a meter of the core: the operators of a country (`operators`, written by packs) and, for each meter, its operator and its voltage level (`grid.meters`, the meter's id) | later, meter-data mandates, supply contracts, tariff components and the retrieval of meter data from grid operators' hubs |
| `community` (shipped) | energy sharing on the projects and participants of the core: the allocation key of a project and what it reads of a participant, as their attributes; the volumes allocated to each participant as series of a run | who received how much: self-consumption on a site, energy sharing in a community, volumes per participant and interval, through a sharing engine; with `contracts` a settlement engine turns them into settlement lines, handed to the accounting side through `accounting` ([why](../README.md#invoicing-and-ekwo-os)) |
| `accounting` (shipped, [0010](../docs/decisions/0010-ekwo-link.md)) | the accounting bridge: an organisation's Ekwo company, a contact's email, phone and Ekwo contact; the line where Nexgen OS stops is in the [README](../README.md#invoicing-and-ekwo-os) | nothing: a settlement line is handed to [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os) ([ekwo.ai](https://ekwo.ai)), which keeps legal identity, invoices and the ledger; the two install side by side on one database ([with Ekwo OS](../docs/with-ekwo-os.md)) |
| `3d` (proposed, [0008](../docs/decisions/0008-3d-module.md)) | georeferenced models (glTF, IFC, CityJSON, meshes), drawings, 3D Tiles tilesets | placing a model on the globe, extrusion tiles for MapLibre, 3D Tiles builds; drone flights, scenes and videos are Nexgen's, WeSmart's product |
| `solar` (schema shipped, [0012](../docs/decisions/0012-solar-module.md)) | PV systems, PV arrays (one orientation each), module and inverter product physics, horizons, named yield profiles | PV yield as a run that says its weather, period, conventions, models and losses, computed by PVGIS, by `pvwatts.ts` or by the pvlib engine ([0013](../docs/decisions/0013-external-engines.md)); IEC 61724 indicators against measured production; PVGIS, Open-Meteo, EPW, PAN/OND, PVsyst and PV*SOL results as formats |
| `storage` | batteries and their product physics (usable capacity, cycles, round-trip efficiency), hydrogen later | charge and discharge dispatch on the series `solar` and `consumption` produce |
| `charging` | EV chargers, charging sessions | charging load and its steering |
| `consumption` (shipped) | load profiles as data, activity hours of a site; next, typical weeks | a site's consumption curve: measured, reconstructed from a bill and activity hours, or typical, as a run; the curve read measured first ([README](consumption/README.md)) |
| `contracts` (proposed) | supply, injection, physical or virtual PPA and internal community tariff contracts, with their parties and their price signals (fixed, indexed, cap, floor) | under which contract and at which price: the contract and the price signal in force over each interval, read by the settlement engine; no invoice, which is [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os)'s |
| `flexibility` (later) | flexible loads, offers, activations | demand response, aggregation, dispatch across sites |
| `weather` | weather points (grid cells, stations) sites are linked to, weather models as sources with their coverage, the rule that picks one per place | the weather series every other module reads: observed, typical year, forecast; the choice of model resolved per site from the installation, the pack, the organisation, the project |
| `wind` (later) | wind turbines and their product physics (power curve, hub height, rotor), wind series at hub height | their yield as a run, like `solar` for PV; hydro gets its own module the day a project needs it, cogeneration and biomass are sources of heat |
| `heating` | heat pumps, boilers, air handling units, thermal zones, domestic hot water | heating and cooling design, sizing, seasonal performance |
| `thermal` | envelope elements and their U-values, thermal bridges, glazing | thermal simulation of the envelope, heat losses, energy performance inputs |
| `monitoring` | collection schedules and their runs, alarms (connections are core, connectors are libraries: [0011](../docs/decisions/0011-external-data.md)) | live readings from equipment and hubs, control through existing systems (Home Assistant, OpenEMS), battery dispatch, demand response |
| `tasks` (shipped, [0017](../docs/decisions/0017-tasks-as-data.md)) | phases of a project's life (study to decommissioning) and the roles that carry a task, as vocabularies; task templates per country, kind of project and role, with legal reference, documents and condition, published by the packs; tasks on a project, a site, a building, a surface or a device, with planned and actual dates, status, contact, dependency and source | `plan()`: the tasks of a project from the templates that match it, once; `progress()`: where a site or a project stands on a day |
| `kpis` | indicators as data (a formula over series or rollups, a period, a unit), targets and trajectories | the indicators of a site, a project or a portfolio of sites, written back as series of the core through `store()` |

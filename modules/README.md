# `modules/` — one Postgres schema each, beside the core

The core is the schema `nexgen`: the named objects and what is attached to them. What
is specific to a trade lives here, one folder and one schema per module.

## The rules

1. **One schema, and the core is not it.** A module depends on `nexgen` by
   foreign key; the core has no hook and no idea it exists.
2. **Derive, never widen.** A module that needs more about a device adds a
   table with the same id (`call derive_devices('energy.pv_systems',
   'solar')`); one that adds a kind of object declares it
   (`call declare_object('architecture.floors', 'floor', '{building_id}')`)
   so that attributes, sensors, series and documents attach to it.
3. **Read the core freely, write it through `record_run()`.** A module may
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

| Module | Objects it adds | Computes |
|---|---|---|
| `architecture` (shipped) | floors, spaces (rooms, zones, units) | the inside of a building after IFC and CityGML; BIM import and export through the format libraries |
| `3d` (proposed, [0008](../docs/decisions/0008-3d-module.md)) | georeferenced models (glTF, IFC, CityJSON, meshes), drawings, 3D Tiles tilesets | placing a model on the globe, extrusion tiles for MapLibre, 3D Tiles builds; drone flights, scenes and videos are Nexgen's, WeSmart's product |
| `solar` (schema shipped, [0012](../docs/decisions/0012-solar-module.md)) | PV systems, PV arrays (one orientation each), module and inverter product physics, horizons, named yield profiles | PV yield as a run that says its weather, period, conventions, models and losses, computed by PVGIS, by `pvwatts.ts` or by the pvlib engine ([0013](../docs/decisions/0013-external-engines.md)); IEC 61724 indicators against measured production; PVGIS, Open-Meteo, EPW, PAN/OND, PVsyst and PV*SOL results as formats |
| `storage` | batteries and their product physics (usable capacity, cycles, round-trip efficiency), hydrogen later | charge and discharge dispatch on the series `solar` and `consumption` produce |
| `charging` | EV chargers, charging sessions | charging load and its steering |
| `consumption` | load profiles, typical weeks, activity hours | a site's consumption curve: measured, reconstructed from a bill and activity hours, or typical |
| `sharing` | allocation keys, settlement lines | self-consumption on a site, energy sharing in a community, settlement handed to Ekwo for invoicing |
| `flexibility` (later) | flexible loads, offers, activations | demand response, aggregation, dispatch across sites |
| `weather` | weather points (grid cells, stations) sites are linked to, weather models as sources with their coverage, the rule that picks one per place | the weather series every other module reads: observed, typical year, forecast; the choice of model resolved per site from the installation, the pack, the organisation, the project |
| `generators` (later) | wind turbines, hydro, cogeneration, biomass and their curves | their yield, like `solar` for PV |
| `heating` | heat pumps, boilers, air handling units, thermal zones, domestic hot water | heating and cooling design, sizing, seasonal performance |
| `thermal` | envelope elements and their U-values, thermal bridges, glazing | thermal simulation of the envelope, heat losses, energy performance inputs |
| `grid` | grid operators, meter-data mandates, supply contracts, tariff components | retrieval of meter data from grid operators' hubs, tariff resolution |
| `monitoring` | collection schedules and their runs, alarms (connections are core, connectors are libraries: [0011](../docs/decisions/0011-external-data.md)) | live readings from equipment and hubs, control through existing systems (Home Assistant, OpenEMS), battery dispatch, demand response |
| `compliance` | requirements, checks, findings | regulatory analysis against the country packs: permits, solar obligations, protected zones, energy-sharing rules, performance certificates |
| `construction` (shipped) | milestones of works on a project, a site, a building or a device, in phases (a vocabulary), with planned and actual dates, a status and the contact who answers for each; inspections and a site diary later | where the works stand on a day: milestones by status, share done, the late ones, the current phase |
| `participation` (shipped, [0015](../docs/decisions/0015-publications.md)) | publications: open exports of a site or a project an owner made public, kept as published; consultations and contributions later | public consultation: what anyone reads without an account, through `participation_public`, the one schema the anonymous role is given |
| `portfolio` | targets, indicators | KPIs and trajectories across many sites |
| `nature` (later) | trees and vegetation, water bodies, land cover, soils, protected areas and habitats (CityGML Vegetation, WaterBody and LandUse; INSPIRE Land Cover, Protected Sites and Habitats; Copernicus and OpenStreetMap as sources) | what the living world around a site does to it and what a project does to it: tree shading on roofs and arrays, green roofs and their water, urban heat, stormwater, biodiversity and carbon stock, the ecological checks `compliance` asks for |

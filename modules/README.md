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

| Module | Objects it adds | Computes |
|---|---|---|
| `architecture` (shipped) | floors, spaces (rooms, zones, units) | the inside of a building after IFC and CityGML; BIM import and export through the format libraries |
| `3d` (proposed, [0008](../docs/decisions/0008-3d-module.md)) | georeferenced models (glTF, IFC, CityJSON, meshes), drawings, 3D Tiles tilesets | placing a model on the globe, extrusion tiles for MapLibre, 3D Tiles builds; drone flights, scenes and videos are the hosted edition's |
| `energy` | PV systems, batteries, chargers, wind turbines, allocation keys, tariffs, bill runs | PV production, consumption profiles, self-consumption, energy sharing, batteries, charging, flexibility; settlement lines handed to Ekwo for invoicing |
| `heating` | heat pumps, boilers, air handling units, thermal zones, domestic hot water | heating and cooling design, sizing, seasonal performance |
| `thermal` | envelope elements and their U-values, thermal bridges, glazing | thermal simulation of the envelope, heat losses, energy performance inputs |
| `grid` | grid operators, meter-data mandates, supply contracts, tariff components | retrieval of meter data from grid operators' hubs, tariff resolution |
| `monitoring` | collection schedules and their runs, alarms (connections are core, connectors are libraries: [0011](../docs/decisions/0011-external-data.md)) | live readings from equipment and hubs, control through existing systems (Home Assistant, OpenEMS), battery dispatch, demand response |
| `compliance` | requirements, checks, findings | regulatory analysis against the country packs: permits, solar obligations, protected zones, energy-sharing rules, performance certificates |
| `construction` | phases, works, inspections, site diary | commissioning and progress of works |
| `participation` | consultations, contributions | public consultation: read-only exports and portals |
| `portfolio` | targets, indicators | KPIs and trajectories across many sites |

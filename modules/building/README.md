# `building` — the shape of what is built

Status: shipped, version 0.1.0, needs core 0.3.0 — decisions
[0008](../../docs/decisions/0008-3d-module.md),
[0026](../../docs/decisions/0026-a-device-is-not-placed-for-now.md) and
[0045](../../docs/decisions/0045-the-participant-is-the-node.md).
Module code `building`, schema `building`: the thing it holds is the
building, and 3D is how a building is described.

The core keeps the participant and its place: an address, a point, a time
zone, geolocated but not described. This module enriches the participant
with what its place physically is, the territory of CityGML and of the
spatial structure of IFC. It says nothing about where a device sits: a
device belongs to its participant, behind its meters. Install it with
`npx nexgen-os init --modules building`; examples 02, 05, 06 and 07 need it.

## What it adds to the core

| Table | Holds |
|---|---|
| `building.sites` | the ground of a participant: a parcel or a plot with its outline, the area a register gives, its use, the source it was described from |
| `building.buildings` | a building of a participant, on its ground when that is described: footprint, elevation, height, profile, status, the source it was described from (CityGML `Building`, `IfcBuilding`) |
| `building.spaces` | the inside of a building, one tree: floors (with their level), rooms, zones and units (a flat, an office lot), each with its parent space (`IfcBuildingStorey`, `IfcSpace`, CityGML `Storey`, `BuildingRoom`) |
| `building.surfaces` | roof faces, facades, ground areas and carports, on a building or straight on the ground, with azimuth (degrees clockwise from true north) and tilt (CityGML `RoofSurface`, `WallSurface`) |

Sites, buildings, spaces and surfaces are kinds of object the module
publishes in `kinds`: attributes, identifiers, links, documents and series
name them by kind and id (`('surface', id)`) and go with them, and
`participant_of()` and `country_of()` of the core ask
`building.participant_of()` whose they are. `building.building_of(kind, id)`
gives the building a space or a surface is in or on;
`building.parameter_of(kind, id, …)` goes through the spaces, the building
and the ground above an object, then asks the core from its participant.

It publishes, with `published_by = 'building'`:

- the link type `occupies` (the building, floor or unit a participant of a
  project occupies, when it shares a building with others);
- the properties of a building and of its faces: `floor_area`,
  `energy_label`, `year_built`, `floors_above_ground`,
  `floors_below_ground`, `roof_area`, `material`, `u_value`, `is_external`.

## Gestures

- `building.add_site(participant, name, geometry, area, profile, source, metadata)`
- `building.add_building(participant, name, footprint, elevation, height, profile, source, metadata, scenario, site)` —
  refuses `building_site_of_other_participant`
- `building.add_space(building, kind, name, parent, level, geometry, elevation, height, source, metadata)`
- `building.add_surface(host, kind, name, geometry, azimuth, tilt, source, metadata)` — on a
  building or a ground; a roof or a facade without an orientation takes the
  one of its 3D polygon (`building.surface_orientation()`)
- `building.building_volume(building)`, `building.participant_of(kind, id)`,
  `building.building_of(kind, id)`, `building.parameter_of(kind, id, property, at, scenario)`

A PV array of the `solar` module keeps its own azimuth and tilt; this module
does not say which face it stands on.

## Importers

`modules/building/src` writes what the format libraries read (they touch no
database, [0035](../../docs/decisions/0035-a-format-library-touches-no-database.md)),
under the participant the caller names:
`importCityJson` and `exportCityJson` (`@nexgen-os/cityjson`: the buildings
of a participant), `importIfc` (`@nexgen-os/ifc`: a building of a
participant, which it places again when the model is georeferenced more
precisely; the building, room and position a model gives a device stay in
the device's metadata), `importHomeAssistant` and `exportHomeAssistant`
(`@nexgen-os/homeassistant`: floors and areas as spaces of a building, the
devices under the participant). The GeoJSON export of `@nexgen-os/core` adds
the ground, the buildings and the surfaces of a participant when this
module is installed.

## Later

Georeferenced models (`building.models`: glTF, IFC, CityJSON, meshes, with
CRS, origin, rotation, scale, up axis and units), drawings and 3D Tiles
tilesets, `building.model_to_world(model_id)`, extrusion tiles with
`ST_AsMVT` and 3D Tiles from the surfaces with pg2b3dm, when their epic
comes.

What stays out, in Nexgen, WeSmart's commercial platform: drone flights and their outputs
(images, point clouds, orthophotos), scenes, camera paths, videos and stills,
API keys, the Mapbox `model` layer and Standard style.

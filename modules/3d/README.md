# `3d` — the shape of what is built

Status: shipped, version 0.1.0, needs core 0.3.0 — decisions
[0008](../../docs/decisions/0008-3d-module.md) and
[0026](../../docs/decisions/0026-a-device-is-placed-on-a-surface-or-in-a-space.md).
Module code `3d`, schema `three_d`.

The core keeps the site: an address, a point or a parcel, a time zone,
geolocated but not described. This module holds what a place physically is,
the territory of CityGML and of the spatial structure of IFC. Install it
with `npx nexgen-os init --modules 3d`; examples 02, 05, 06 and 07 need it.

## What it adds to the core

| Table | Holds |
|---|---|
| `three_d.buildings` | a building on a site: footprint, elevation, height, profile, status, the source it was described from (CityGML `Building`, `IfcBuilding`) |
| `three_d.spaces` | the inside of a building, one tree: floors (with their level), rooms, zones and units (a flat, an office lot), each with its parent space (`IfcBuildingStorey`, `IfcSpace`, CityGML `Storey`, `BuildingRoom`) |
| `three_d.surfaces` | roof faces, facades, ground areas and carports, on a building or straight on a site, with azimuth (degrees clockwise from true north) and tilt (CityGML `RoofSurface`, `WallSurface`) |
| `three_d.placements` | where on its site a device is: the building, the space, the surface, one row per placed device with the device's id |

Buildings, spaces and surfaces are kinds of object declared with
`declare_object()`: attributes, identifiers, links, documents and series
attach to them, `site_of()` and `country_of()` find their site. A placement
gives a device its place as first parents (`declare_parents()`), so that
`site_of()`, `three_d.building_of()` and the cascade of `parameter_of()`
go through its surface, its space and its building.

It publishes, with `published_by = '3d'`:

- the link types `placed_in` (where a device was), `placed_on` (the face a
  PV array of the `solar` module sits on) and `occupies` (the building,
  floor or unit a participant of a project occupies);
- the properties of a building and of its faces: `floor_area`,
  `energy_label`, `year_built`, `floors_above_ground`,
  `floors_below_ground`, `roof_area`, `material`, `u_value`, `is_external`.

## Gestures

- `three_d.add_building(site, name, footprint, elevation, height, profile, source, metadata, scenario)`
- `three_d.add_space(building, kind, name, parent, level, geometry, elevation, height, source, metadata)`
- `three_d.add_surface(host, kind, name, geometry, azimuth, tilt, source, metadata)` — a roof or a
  facade without an orientation takes the one of its 3D polygon
  (`three_d.surface_orientation()`)
- `three_d.place_device(device, building, space, surface)` — refuses the
  `device_*_mismatch` of a place of another site or building
- `three_d.move_device(device, building, space, surface, at)` — the place it
  leaves stays as a `placed_in` link
- `three_d.place_array(array, surface, on)` — a `placed_on` link; the array
  keeps its own azimuth and tilt, filled from the face only when it has
  none; refuses `module_required: solar` without the `solar` module
- `three_d.building_volume(building)`, `three_d.building_of(object)`

## Importers

`modules/3d/src` writes what the format libraries read (they touch no
database, [0035](../../docs/decisions/0035-a-format-library-touches-no-database.md)):
`importCityJson` and `exportCityJson` (`@nexgen-os/cityjson`), `importIfc`
(`@nexgen-os/ifc`), `importHomeAssistant` and `exportHomeAssistant`
(`@nexgen-os/homeassistant`: floors and areas as spaces, devices placed in
them). The GeoJSON export of `@nexgen-os/core` adds the buildings and
surfaces of a site when this module is installed.

## Later

Georeferenced models (`three_d.models`: glTF, IFC, CityJSON, meshes, with
CRS, origin, rotation, scale, up axis and units), drawings and 3D Tiles
tilesets, `three_d.model_to_world(model_id)`, extrusion tiles with
`ST_AsMVT` and 3D Tiles from the surfaces with pg2b3dm, when their epic
comes.

What stays out, in Nexgen, WeSmart's commercial platform: drone flights and their outputs
(images, point clouds, orthophotos), scenes, camera paths, videos and stills,
API keys, the Mapbox `model` layer and Standard style.

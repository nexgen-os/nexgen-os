# `building` — the shape of what is built

Status: shipped, version 0.3.0, needs core 0.3.0 — decisions
[0008](../../docs/decisions/0008-the-building-module-describes-what-is-built.md),
[0026](../../docs/decisions/0026-a-device-belongs-to-its-participant.md) and
[0043](../../docs/decisions/0043-the-participant-is-the-node.md).
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
| `building.uses` | the uses of a building or a place (residential, office, school, a field, a car park…), with their IFC occupancy and CityGML function; a vocabulary, read by everyone signed in |
| `building.sites` | the ground of a participant: a parcel or a plot with its outline, the area a register gives, its use, the source it was described from and the identifier that source gives it |
| `building.buildings` | a building of a participant, on its ground when that is described: footprint, elevation, height, use, status, year of construction, floors above and below ground, gross floor area, energy label, the source it was described from and the identifier that source gives it (CityGML `Building`, `IfcBuilding`, `Pset_BuildingCommon`) |
| `building.spaces` | the inside of a building, one tree: floors (with their level), rooms, zones and units (a flat, an office lot), each with its parent space, its floor area and the participant that occupies it (`occupant_id`) (`IfcBuildingStorey`, `IfcSpace`, CityGML `Storey`, `BuildingRoom`) |
| `building.surfaces` | roof faces, facades, ground areas and carports, on a building or straight on the ground, with azimuth (degrees clockwise from true north) and tilt, measured area, material, U-value and whether it faces outside (CityGML `RoofSurface`, `WallSurface`, `Pset_WallCommon`) |

Sites, buildings, spaces and surfaces are the module's objects, each
described in its own columns: the attachments of the core (attributes,
identifiers, documents, series) name the six objects of the core only
([0001](../../docs/decisions/0001-the-hierarchy-is-the-foreign-keys.md)). One identifier
names one site, building, space or surface of an organisation
(`global_id`), so that a file is imported once.
`building.participant_of(kind, id)` follows their foreign keys to the
participant; `building.building_of(kind, id)` gives the building a space
or a surface is in or on.

It publishes, with `published_by = 'building'`, the property `file_record`
of a device: what an IFC model or a Home Assistant home says of a device it
describes that no column holds — its room, its position, its description —
so that an export gives it back as it came.

## Gestures

- `building.add_site(participant, name, geometry, area, use, source, metadata)`
- `building.add_building(participant, name, footprint, elevation, height, use, source, metadata, site, global_id)` —
  refuses `building_site_of_other_participant`
- `building.add_space(building, kind, name, parent, level, geometry, elevation, height, source, metadata, global_id)`
- `building.add_surface(host, kind, name, geometry, azimuth, tilt, source, metadata, global_id)` — on a
  building or a ground; a roof or a facade without an orientation takes the
  one of its 3D polygon (`building.surface_orientation()`)
- `building.building_volume(building)`, `building.participant_of(kind, id)`,
  `building.building_of(kind, id)`

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
the device's `file_record`), `importHomeAssistant` and `exportHomeAssistant`
(`@nexgen-os/homeassistant`: floors and areas as spaces of a building, the
devices under the participant). The GeoJSON export of `@nexgen-os/core` adds
the ground, the buildings and the surfaces of a participant when this
module is installed.

## Not here yet

Georeferenced models (`building.models`: glTF, IFC, CityJSON, meshes, with
CRS, origin, rotation, scale, up axis and units), drawings and 3D Tiles
tilesets, `building.model_to_world(model_id)`, extrusion tiles with
`ST_AsMVT` and 3D Tiles from the surfaces with pg2b3dm
([road to 1.0](../../docs/road-to-1.0.md)).

What stays outside the open repository: drone flights and their outputs
(images, point clouds, orthophotos), scenes, camera paths, videos and stills,
API keys, the Mapbox `model` layer and Standard style.

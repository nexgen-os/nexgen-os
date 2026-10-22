# 0008 — The `building` module describes what is built; a 3D model is a file a row points to, and it enriches a place without changing it

> Status: accepted

## Context

The core keeps the participant and its place: an address, a point, a time
zone, geolocated but not described ([0006](0006-the-core-names-six-objects.md),
[0043](0043-the-participant-is-the-node.md)). What a place physically is —
its ground, buildings with a footprint, an elevation and a height, floors,
rooms, zones and units inside them, roof faces and facades with their
azimuth and tilt — is the territory
of BIM and CityGML, and not every installation describes it. A building is
often also known by a proper three-dimensional model: the IFC of the
architect, the CityJSON tile of the city, the mesh of a survey, the glTF of
a PV layout. These files weigh megabytes to gigabytes, come in formats a
database does not read, and each carries its own numbers for what the core
already describes. The question is how they relate to the place without
becoming a second description of it.

## Decision

**The physical description of a place is the `building` module's.** One
word names it in its folder, its schema, its code and its documents: the
thing it holds is the building, and 3D is one way a building is described.
Its schema, `building`, holds the skeleton of what is built, under the
participant whose place it describes: `sites` (the ground: a parcel, an
area, a use), `buildings`, `spaces` (one tree of floors, rooms, zones and
units) and `surfaces` (roof faces, facades, ground areas, carports), each
described in its own columns — the year of construction, floors, floor
area and energy label of a building, the material and U-value of a face,
the identifier its file gives it — and the participant that occupies a
unit (`spaces.occupant_id`). It says nothing about where a device sits
([0026](0026-a-device-belongs-to-its-participant.md)). The uses of a building
or a place are its vocabulary (`building.profiles`). The
importers of CityJSON, IFC and Home Assistant homes are the module's
(`modules/building/src`). The core never names it.

**Heavy geometry stays in object storage, and a row points to it.** A 3D
model, a drawing, a point cloud, a raster or a tileset is a file; the
database holds its address, its checksum, its format, its source and its
capture date, and how it is placed on the globe. Never its bytes.

**A model is placed by data.** Its origin on the globe, its rotation, its
scale, its up axis, its units and its vertical datum are values of the row,
and the source's own georeferencing block is kept as it came, so that one
function places any model in WGS 84, whatever its format.

**A model enriches the place; it never changes its shape.** The participant keeps
its one shape ([0025](0025-a-place-has-one-shape.md)), the building its own
numbers (floors, heights, areas) in the module's tables. A roof face
measured on a model is written to `building.surfaces` with the model as its
source;
nothing keeps a second copy of the roof or of the building's numbers beside
the model.

**What is derived from a model is a calculation.** A tileset built from the
surfaces, a model generated from parameters, a layout of modules on a face:
each is produced by a calculation that records its inputs, so it can be rebuilt
([0004](0004-a-figure-says-where-it-comes-from.md)).

**The open repository describes what is built.** How a place is
photographed and shown (flights, images and their poses, scenes, camera
paths, rendered videos) is not part of the description.

## What it forbids

- File bytes in a database row.
- A second copy, inside a model's row, of numbers the module holds
  (heights, floors, roof faces).
- A building, a space or a surface in the core's schema, or a column of the
  core naming one.
- A derived 3D artefact that no calculation produced.
- A change to the shape of a place to make room for a model.

## See also

- [0003](0003-geometry-wgs84-3d-utm.md) — the frame of all geometry.
- [0035](0035-a-format-library-touches-no-database.md) — the readers of IFC,
  CityJSON and 3D Tiles are format libraries.
- [`modules/building/README.md`](../../modules/building/README.md).

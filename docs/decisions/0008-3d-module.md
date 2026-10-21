# 0008 — The `3d` module describes what is built; a 3D model is a file a row points to, and it enriches a place without changing it

> Status: accepted · 12/10/2026, rewritten 19/10/2026 and 21/10/2026

## Context

The core keeps the site: an address, a point or a parcel, a time zone,
geolocated but not described ([0006](0006-named-objects.md)). What a place
physically is — buildings with a footprint, an elevation and a height,
floors, rooms, zones and units inside them, roof faces and facades with
their azimuth and tilt, where a device sits among them — is the territory
of BIM and CityGML, and not every installation describes it. A building is
often also known by a proper three-dimensional model: the IFC of the
architect, the CityJSON tile of the city, the mesh of a survey, the glTF of
a PV layout. These files weigh megabytes to gigabytes, come in formats a
database does not read, and each carries its own numbers for what the core
already describes. The question is how they relate to the place without
becoming a second description of it.

## Decision

**The physical description of a place is the `3d` module's.** Its schema,
`three_d`, holds the skeleton of what is built: `buildings`, `spaces` (one
tree of floors, rooms, zones and units) and `surfaces` (roof faces,
facades, ground areas, carports), each a kind of object declared with
`declare_object()`, and `devices`, the 3d side of a device of the core: where
on its site it is
([0026](0026-a-device-is-placed-on-a-surface-or-in-a-space.md)). The
module publishes the link types of that description (`placed_in`,
`placed_on`, `occupies`) and the properties of a building and of its faces
(year of construction, floors, energy label, material, U-value). The
importers of CityJSON, IFC and Home Assistant homes are the module's
(`modules/3d/src`). The core never names it.

**Heavy geometry stays in object storage, and a row points to it.** A 3D
model, a drawing, a point cloud, a raster or a tileset is a file; the
database holds its address, its checksum, its format, its source and its
capture date, and how it is placed on the globe. Never its bytes.

**A model is placed by data.** Its origin on the globe, its rotation, its
scale, its up axis, its units and its vertical datum are values of the row,
and the source's own georeferencing block is kept as it came, so that one
function places any model in WGS 84, whatever its format.

**A model enriches the place; it never changes its shape.** The site keeps
its one shape ([0025](0025-a-place-has-one-shape.md)), the building its own
numbers (floors, heights, areas) in the module's tables. A roof face
measured on a model is written to `three_d.surfaces` with the model as its
source;
nothing keeps a second copy of the roof or of the building's numbers beside
the model.

**What is derived from a model is a run.** A tileset built from the
surfaces, a model generated from parameters, a layout of modules on a face:
each is produced by a run that records its inputs, so it can be rebuilt
([0004](0004-deterministic-runs.md)).

**The open repository describes what is built.** How a place is
photographed and shown (flights, images and their poses, scenes, camera
paths, rendered videos) is not part of the description.

## What it forbids

- File bytes in a database row.
- A second copy, inside a model's row, of numbers the module holds
  (heights, floors, roof faces).
- A building, a space or a surface in the core's schema, or a column of the
  core naming one.
- A derived 3D artefact that no run produced.
- A change to the shape of a place to make room for a model.

## What it replaced

A proposed `3d` module whose record mixed the rule with its tables, its
serving tiers and the line with the commercial platform; that design is in
the [road map](../road-to-0.1.md). Then, until 21/10/2026, buildings,
spaces and surfaces in the core's schema and the module holding models
only; the georeferenced models, drawings and tilesets come with their own
epic.

## See also

- [0003](0003-geometry-wgs84-3d-utm.md) — the frame of all geometry.
- [0035](0035-a-format-library-touches-no-database.md) — the readers of IFC,
  CityJSON and 3D Tiles are format libraries.
- [`modules/3d/README.md`](../../modules/3d/README.md).

# 0008 — A 3D model is a file a row points to, and it enriches a place without changing it

> Status: accepted · 12/10/2026, rewritten 19/10/2026

## Context

The core holds the first level of 3D in its own tables: geometry in WGS 84
with heights, buildings with a footprint, an elevation and a height, roof
faces with their azimuth and tilt, spaces inside a building. A building is
often also known by a proper three-dimensional model: the IFC of the
architect, the CityJSON tile of the city, the mesh of a survey, the glTF of
a PV layout. These files weigh megabytes to gigabytes, come in formats a
database does not read, and each carries its own numbers for what the core
already describes. The question is how they relate to the place without
becoming a second description of it.

## Decision

**Heavy geometry stays in object storage, and a row points to it.** A 3D
model, a drawing, a point cloud, a raster or a tileset is a file; the
database holds its address, its checksum, its format, its source and its
capture date, and how it is placed on the globe. Never its bytes.

**A model is placed by data.** Its origin on the globe, its rotation, its
scale, its up axis, its units and its vertical datum are values of the row,
and the source's own georeferencing block is kept as it came, so that one
function places any model in WGS 84, whatever its format.

**A model enriches the place; it never changes its shape.** The place keeps
its one shape ([0025](0025-a-place-has-one-shape.md)), the building its own
numbers (floors, heights, areas) in the core. A roof face measured on a
model is written to the surfaces of the core with the model as its source;
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
- A second copy, inside a model's row, of numbers the core holds (heights,
  floors, roof faces).
- A derived 3D artefact that no run produced.
- A change to the shape of a place to make room for a model.

## What it replaced

A proposed `3d` module whose record mixed the rule with its tables, its
serving tiers and the line with the commercial platform; that design is in
the [road map](../road-to-0.1.md).

## See also

- [0003](0003-geometry-wgs84-3d-utm.md) — the frame of all geometry.
- [0035](0035-a-format-library-touches-no-database.md) — the readers of IFC,
  CityJSON and 3D Tiles are format libraries.
- [`docs/research/3d-geo.md`](../research/3d-geo.md), [`docs/research/bim-3d.md`](../research/bim-3d.md).
- [`modules/3d/README.md`](../../modules/3d/README.md).

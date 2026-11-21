# 0062 — A viewer is a package beside the core: it reads the description as a person and keeps nothing of its own in the database

> Status: proposed

## Context

The `building` module describes what is built — the ground, the buildings,
their spaces and surfaces — and points to the georeferenced models of a
building or a ground ([0008](0008-the-building-module-describes-what-is-built.md)).
A place described from open data, a survey or an architect's model is
worth seeing: the terrain and the parcels, the footprints raised to their
heights, the models placed where their rows say, the aerial photograph
draped over the ground, and the photographs of the place seen from where
they were taken. That is how a description is checked against the place
itself, face by face.

Showing pulls towards its own data: views, camera paths, scenes, flights
and the poses of photographs. Decision 0008 keeps them out of the
description. The question is where the program that shows a place lives,
what it reads and what it may keep.

## Decision

**A viewer is a package beside the core, never a module.** It has no
schema, no table and no migration; it is a client of the model, as the
command line and the MCP server are, and carries the core's licence
([0005](0005-agpl-core-mit-libraries-sign-off.md)). It reads through the
API Supabase gives the schemas, as the person who opened it, under row
level security ([0039](0039-an-agent-is-a-user-of-the-model.md),
[0046](0046-a-key-acts-as-its-issuer-an-agent-reaches-the-database-as-the-person.md)):
it shows what that person may read, and nothing else.

**It shows what the description holds, placed as the description places
it.** Geometry comes in WGS 84 ([0003](0003-geometry-wgs84-3d-utm.md)) and
is set in one local frame of metres around the place, east, north and up;
a model is placed by the values of its row, the ones
`building.model_to_world()` reads, and never again from what its file
says. A building without a model is its footprint raised to its height
from its elevation. A height, a roof face or a floor the viewer would
draw differently is corrected in the description, through the module's
gestures, and then shown.

**The layers of a place come from its sources.** The terrain, the aerial
photograph and any other layer are read from the rows of `sources` the
place's pack ships, with their licence ([0011](0011-external-data.md),
[0020](0020-a-pack-holds-what-a-function-reads.md)), or from the documents
of the participant; the viewer's code names no national service and no
address.

**A photograph is a document, and its pose is what its file says.** The
position, the heading, the pitch and the field of view of a photograph are
read from its EXIF and XMP, or from the document's metadata where an
importer kept them as they came; the viewer turns them into a camera to
look through, and writes nothing back.

**What the viewer keeps is its own.** A view, a camera path or a set of
layers lives in the viewer's address or in a file the person keeps, never
in a row of the database. An image it renders is a file of the person's;
attached to a participant, it is a document like any other, with its
source.

## What it forbids

- A table, a column or a migration for a scene, a view, a camera, a camera
  path, a flight or the pose of a photograph.
- A viewer that writes the description, or reads it with the service role
  or around row level security.
- A second placement of a model, computed from its file, beside the one its
  row holds.
- The address of a national or commercial service in the viewer's code.
- A 3D artefact the viewer derives — a tileset, a mesh, a roof face — stored
  in the database without the calculation that produced it
  ([0004](0004-a-figure-says-where-it-comes-from.md)).

## See also

- [0008](0008-the-building-module-describes-what-is-built.md) — what the
  description holds, and what showing it is not.
- [0035](0035-a-format-library-touches-no-database.md) — the readers of the
  files a viewer opens (IFC, CityJSON, 3D Tiles) are format libraries.
- [Road to 1.0](../road-to-1.0.md) — the viewer and the tilesets it will
  read.

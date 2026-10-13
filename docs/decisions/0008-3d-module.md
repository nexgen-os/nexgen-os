# 0008 — The `3d` module: the shape of what is built

**Proposed 12/10/2026, narrowed 13/10/2026.** Research:
[docs/research/3d-geo.md](../research/3d-geo.md) — its sections on captures,
scenes and video stay as research for the hosted edition.

## Context

The core already holds the first level of 3D: geometry in WGS 84 with
heights, buildings with a footprint, an elevation and a height
(`building_volume()`), roof faces with azimuth and tilt, and, through
`architecture`, floors and spaces. What is missing is the proper
three-dimensional model of a building when one exists — the IFC from the
architect, the CityJSON tile from the city, the mesh from a survey, the glTF
of a PV layout — placed on the globe, so that a viewer, an export and a
computation read the same object.

The first draft of this decision went further: drone flights, images with
their poses, point clouds, orthophotos, scenes, camera paths and rendered
videos. Those describe how a place is photographed and shown, not what it
is. They stay out of the open repository, in the hosted edition, as a module
of its own there (working name `drone`: flights, photogrammetry, films).

## Decision

The `3d` module describes the built thing in three dimensions, and nothing
else. Its Postgres schema is `three_d`, since a schema name cannot start
with a digit.

| Table | What it is |
|---|---|
| `three_d.models` | one georeferenced 3D model of a building, a site or a device: format (glTF, IFC, CityJSON, mesh), file URI and checksum, CRS, origin on the globe (EPSG:4979) and in the native CRS, rotation, scale, up axis, units, vertical datum, bounding box, level of detail, the source's own georeferencing block kept as it came. `three_d.model_to_world(model_id)` is the matrix that places any of them |
| `three_d.drawings` | plans, sections, elevations, roof plans — PDF, SVG, DXF — with an optional georeference so that a plan lies on the map |
| `three_d.tilesets` | a 3D Tiles 1.1 tileset built from `surfaces` or `three_d.models`, static on object storage, with the run that built it |

Four rules:

- files on object storage, rows in Postgres: a URI and a checksum, never
  bytes;
- the building's own numbers — floors, heights, areas — stay in the core
  and in `architecture`; the module adds the model, not a second copy of the
  numbers;
- roof faces measured on a model are written to `surfaces` with their
  source; the module never keeps a second copy of roof geometry;
- every derived artefact — a tileset, a model built from parameters — is a
  run, so it can be rebuilt.

### What the pure computations become

The deterministic parts of the product's 3D — the parametric roof model
(two slopes, one slope, several spans, tables on the ground, faces drawn by
hand, in local metres), the layout of modules on a face and on the ground,
the position of the sun — are TypeScript with no WebGL and already tested.
They move into the open repository as functions of the `solar` module
(layouts) and of `3d` (roof model), and their result is persisted: one
`three_d.models` row (glTF) per layout, produced by a run, so that a viewer,
an export to PV\*SOL, IFC or CityJSON and the hosted film pipeline all read
the same object.

### How 3D is served

Three tiers, one rule:

- **every building in view** — vector tiles from `buildings` (`ST_AsMVT`,
  served by martin or written once as PMTiles) and a `fill-extrusion`
  layer: cheap, cached, no custom code;
- **real geometry** — roof faces and models as **3D Tiles 1.1** built from
  PostGIS by pg2b3dm (or tyler from CityJSON), read by the three.js tiles
  renderer, deck.gl or CesiumJS;
- **the one object of the page** — one glTF in a thin custom layer with
  three.js.

The open repository targets **MapLibre GL JS** (BSD-3): extrusions, custom
layers, terrain, globe and the free camera all exist there. Mapbox GL JS v3's
`model` layer, Standard style and tokens are the hosted edition's.

### The line with the hosted edition

| Open — this repository | Hosted edition |
|---|---|
| the schema, row level security, `model_to_world()`, the tile functions | drone flights, images and their poses, point clouds, orthophotos and surface models, photogrammetry jobs (OpenDroneMap as a service) |
| format readers (ST2): CityJSON 2.0, IFC `IfcMapConversion`, 3D Tiles tilesets, glTF anchors | scenes, camera paths, renders: the generation of videos and stills, and the pipeline that makes them |
| derivations that are pure functions of open inputs: extrusion, roof shapes from Overture, roof planes from a surface model, 3D Tiles builds | the generation of 3D objects from surveys |
| MapLibre bricks: extrusion style fragment, three.js custom layer, tiles renderer wrapper | API keys and quotas (solar API, Mapbox tokens), the Mapbox `model` layer and Standard style |
| adapters for open reference data: 3DBAG (CC BY), UrbIS, German LoD2 (CityGML), Overture | paid or restricted datasets |

## Consequences

- The module stays small: three tables, one function, the readers.
- ST2 (format libraries) starts with the readers the module needs:
  CityJSON, IFC georeferencing, 3D Tiles, glTF anchors.
- The acceptance test of the module: an IFC and a CityJSON of the same
  building land as two `three_d.models` rows and `model_to_world()` puts
  both on the same footprint.
- The hosted `drone` module reads this one; nothing here reads it.

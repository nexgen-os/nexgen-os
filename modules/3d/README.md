# `3d` — the shape of what is built

Status: proposed, decision [0008](../../docs/decisions/0008-3d-module.md).
Research: [docs/research/3d-geo.md](../../docs/research/3d-geo.md).
Schema: `three_d`.

What it adds to the core: `three_d.models` (georeferenced glTF, IFC,
CityJSON, meshes — with CRS, origin, rotation, scale, up axis, units),
`three_d.drawings` (plans, sections, elevations) and `three_d.tilesets`
(3D Tiles 1.1).

What it ships besides tables:

- `three_d.model_to_world(model_id)` — the matrix that puts a model on the
  globe whatever its format's way of saying where it is;
- tile functions for `ST_AsMVT` extrusions of `buildings`, and the recipe for
  3D Tiles from `surfaces` and `three_d.models` with pg2b3dm;
- the format readers it needs, as libraries under `formats/`.

What stays out, in the hosted edition: drone flights and their outputs
(images, point clouds, orthophotos), scenes, camera paths, videos and stills,
API keys, the Mapbox `model` layer and Standard style.

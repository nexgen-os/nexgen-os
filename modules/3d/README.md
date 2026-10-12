# `3d` — captures, models, scenes and renders

Status: proposed, decision [0008](../../docs/decisions/0008-3d-module.md).
Research: [docs/research/3d-geo.md](../../docs/research/3d-geo.md).

What it adds to the core: `captures` (a survey campaign and its STAC Item),
`images` (photos with their pose), `rasters` (orthophotos, surface and
terrain models, expiring provider layers), `point_clouds` (COPC), `models`
(georeferenced glTF, IFC, CityJSON, meshes — with CRS, origin, rotation,
scale, up axis, units), `drawings`, `tilesets` (3D Tiles 1.1), `scenes`,
`camera_paths` and `renders`.

What it ships besides tables:

- `schemas/camera-path-1.0.json` — a camera path as geographic keyframes
  (KML tour semantics in JSON), replayable on MapLibre, three.js, CesiumJS
  or exported to KML;
- `model_to_world(model_id)` — the matrix that puts a model on the globe
  whatever its format's way of saying where it is;
- tile functions for `ST_AsMVT` extrusions of `buildings`, and the recipe for
  3D Tiles from `surfaces` and `models` with pg2b3dm.

What stays out: API keys, the Mapbox `model` layer and Standard style, the
rendering farm that executes `renders`, provider layers under licence.
OpenDroneMap is used as a service, never linked.

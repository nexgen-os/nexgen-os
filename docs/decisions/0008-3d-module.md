# 0008 — The `3d` module: captures, models, scenes, and the line with the cloud

**Proposed 12/10/2026.** Research: [docs/research/3d-geo.md](../research/3d-geo.md).

## Context

The product this core comes from renders every site in 3D — a satellite map,
roofs and PV modules drawn as meshes, shadows at a chosen hour, orbit videos
for marketing — and keeps almost none of it: geometry lives as coordinate
arrays in JSON, the roof model is rebuilt on every display from a few
parameters, the surveys (LiDAR rasters, solar-API roof faces) are read,
reduced and dropped, and the only durable output is a frozen JPEG. Three
gaps, in short: no spatial type and no CRS; a 3D model that is never
persisted; raw captures that are never kept.

The core already closes the first two: geometry is PostGIS in WGS 84 3D,
`buildings` carry footprint, height and provenance, `surfaces` carry roof
faces with azimuth and tilt. What remains is a module for everything
captured, modelled, shown and filmed.

## Decision

### What the module stores — files on object storage, rows in Postgres

Every file is a URI plus a checksum; nothing binary in Postgres. Every
derived artefact is a `run` of the module (tool, version, inputs), so it can
be regenerated.

| Table | What it is |
|---|---|
| `3d.captures` | a survey campaign on a site: drone flight, LiDAR, scan; when, with what, ground sampling distance, image count, the processing options verbatim (OpenDroneMap task options), and its **STAC Item** as JSON — the interoperable face of a capture |
| `3d.images` | one photo of a capture and its pose: position (EPSG:4979), relative and sea-level altitude, gimbal and flight angles, focal length, the raw EXIF/XMP; the refined pose from photogrammetry in a second column, never overwriting the first |
| `3d.rasters` | orthophotos, digital surface and terrain models, masks, flux maps: Cloud-Optimised GeoTIFF, CRS, pixel size, bands, provider, **`fetched_at` / `expires_at` / `redistributable`** — a solar API's layers are a cache with a 30-day life, never a dataset |
| `3d.point_clouds` | one COPC file: CRS, bounding box, point count and format, octree centre and half-size, RGB and classification flags; read by HTTP range requests, no server |
| `3d.models` | one georeferenced model — glTF of a PV layout, IFC of a plant room, CityJSON tile, photogrammetry mesh: format, **CRS, origin (EPSG:4979) and origin in the native CRS, rotation (quaternion in the local frame), scale, up axis, units, vertical datum**, bounding box, level of detail, the source's own georeferencing block kept verbatim. One function, `3d.model_to_world()`, gives the matrix that puts any of them on the globe |
| `3d.drawings` | plans, sections, elevations, roof plans: PDF, SVG, DXF, with an optional georeference (affine or control points) so a plan drapes on the map |
| `3d.tilesets` | a 3D Tiles 1.1 tileset built from `surfaces`, `3d.models` or a capture, static on object storage, with what built it |
| `3d.scenes` | what is shown: an initial view, an ordered list of layers (tilesets, models, rasters, point clouds, extrusion style), the environment (date and hour for the sun, exaggeration), a basemap style URI — references, never copies |
| `3d.camera_paths` | how the camera moves: a JSON document of **geographic keyframes** (position and target in lon / lat / ellipsoidal height, roll, field of view, easing, waits — the semantics of KML tours, in JSON), validated by `modules/3d/schemas/camera-path-1.0.json`. Renderer-neutral: MapLibre's free camera, three.js, CesiumJS and a KML export all replay it, frame for frame |
| `3d.renders` | one produced video or still: scene, camera path, profile (resolution, frame rate, codec, end card), renderer and version, the file, its duration — reproducible from the three ids and the profile |

Roof faces measured on a mesh or a DSM are written to the core's `surfaces`
with their source; the module never keeps a second copy of roof geometry.

### What the pure computations become

The deterministic parts of the product's 3D — the parametric roof model
(gable, mono-pitch, multi-span, ground tables, drawn faces, in local metres),
module layout on a face and on the ground, sun position, the camera framing
and the film shots — are TypeScript with no WebGL and already tested. They
move into the open repo as functions of the `energy` module (layouts) and the
`3d` module (roof model, camera), and their result is **persisted**: a
`3d.models` row (glTF) per layout, produced by a run, so that a viewer, an
export to PV\*SOL, IFC or CityJSON and a video all read the same object.

### How 3D is served

Three tiers, one rule:

- **every building in view** — vector tiles from `buildings` (`ST_AsMVT`,
  served by martin, or baked to PMTiles) and a `fill-extrusion` layer; cheap,
  cached, no custom code;
- **real geometry** — roof faces, meshes, point clouds as **3D Tiles 1.1**
  built from PostGIS by pg2b3dm (or tyler from CityJSON), read by the
  three.js `3d-tiles-renderer`, deck.gl or CesiumJS;
- **the hero object** — one glTF in a thin custom layer with three.js.

The open repo targets **MapLibre GL JS** (BSD-3): extrusions, custom layers,
terrain, globe and the free camera all exist there. Mapbox GL JS v3's
`model` layer, Standard style, landmark meshes and tokens are a hosted
concern.

### The line with Nexgen Cloud

| Open — this repository | Private — the hosted edition |
|---|---|
| the schema, row level security, the camera-path and scene JSON schemas, `model_to_world()`, tile functions | API keys and quotas: solar API, Mapbox tokens; the Mapbox Standard style and `model` layer |
| format readers (ST2): CityJSON 2.0, IFC `IfcMapConversion`, 3D Tiles tilesets, glTF anchors, OpenDroneMap task outputs, STAC writer, EXIF/XMP poses | the rendering farm: headless browsers or Blender workers, queues, watermarks, end cards, codecs — the execution of `3d.renders` |
| derivations that are pure functions of open inputs: extrusion, LoD2-lite from Overture roof shapes, roof planes from a DSM, COPC conversion, 3D Tiles builds | the solar API fetch and its 30-day refresh; licence-gated distribution |
| MapLibre bricks: extrusion style fragment, three.js custom layer, tiles renderer wrapper, COPC loader, camera-path player | the marketing video pipeline and the hosted viewer |
| adapters for open reference data: 3DBAG (CC BY), UrbIS, German LoD2 (CityGML), Overture (ODbL-flagged rows) | paid or restricted datasets |

OpenDroneMap is AGPL: the module stores its outputs and talks to its API, and
ships none of its code. Google's solar layers are never redistributed; the
module must produce the same layers from open elevation models so that the
pipeline does not depend on them.

## Consequences

- The three gaps close: geometry has a CRS, the roof model is a row, the
  captures are kept with their provenance and their licence.
- ST2 (format libraries) starts with the readers the module needs: CityJSON,
  IFC georeferencing, 3D Tiles, glTF anchors, OpenDroneMap, STAC, EXIF.
- The first video replayed from a `camera_paths` row on MapLibre is the
  acceptance test of the module.

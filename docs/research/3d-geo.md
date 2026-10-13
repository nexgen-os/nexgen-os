# 3D, geolocation and rendering — research notes

Research done on 12/10/2026 for decision [0008](../decisions/0008-3d-module.md). Sources are linked inline; versions are the ones read that day.

On 13/10/2026 the decision was narrowed to the shape of what is built (models, drawings, tilesets). Sections 2 and 4 below (scenes, camera paths, captures) and the capture half of section 6 remain as research for Nexgen, WeSmart's commercial platform, not a plan for this repository; section 3 (georeferencing of local models) is what `three_d.models` implements.

---

## 1. Serving 3D from PostGIS to Mapbox GL JS / MapLibre / deck.gl / three.js

### 1.1 Three tiers, one rule of thumb

| Tier | Data | Format | Server | Client |
|---|---|---|---|---|
| A — extruded footprints | buildings footprint + height | Mapbox Vector Tiles (`ST_AsMVT`) | martin (or pg_tileserv) | `fill-extrusion` layer, works in both MapLibre and Mapbox |
| B — real 3D meshes (LoD2 roofs, PV layouts, drone meshes, point clouds) | PostGIS `MULTIPOLYGON Z` / stored glTF | 3D Tiles 1.1 (glTF content) | pg2b3dm (static tileset on object storage) | three.js `3d-tiles-renderer` inside a custom layer, deck.gl `Tile3DLayer`, or CesiumJS |
| C — a single object | one building, one PV array | glTF/GLB | object storage | three.js `GLTFLoader` custom layer, Mapbox `model` layer (Mapbox only) |

Rule: tier A for every building in the viewport (cheap, cached, no WebGL custom code); tier B when the geometry is real (roof planes, meshes, point clouds); tier C for the hero object of a scene (the site being filmed).

### 1.2 Tier A — ST_AsMVT + fill-extrusion

- `ST_AsMVT` is an aggregate producing an MVT layer from rows; geometry must first be put in tile space with `ST_AsMVTGeom`; every other column becomes a feature attribute, so a numeric `height` column travels into the tile ([PostGIS docs](https://www.postgis.net/docs/manual-3.0/ST_AsMVT.html)).
- Pattern: a PostGIS *function source* `tiles.buildings(z, x, y)` returning `bytea` that selects footprint + `height` + `min_height` + `roof_shape`; the style reads `"fill-extrusion-height": ["get","height"]`, `"fill-extrusion-base": ["get","min_height"]` ([Baremaps extrusion example](https://baremaps.apache.org/documentation/examples/extrusion/), [Stadia Maps 3D buildings tutorial](https://docs.stadiamaps.com/tutorials/adding-3d-buildings-to-your-maps-with-maplibre/)).
- Servers: **martin** (Rust, MapLibre org, auto-discovers tables and functions, also serves PMTiles/MBTiles, PostGIS 3.1+ recommended; crate at 1.13.0 — [github.com/maplibre/martin](https://github.com/maplibre/martin), [docs.rs martin 1.13.0](https://docs.rs/crate/martin/1.13.0/source/README.md)). **pg_tileserv** (Go, Crunchy Data, Apache-2.0) is still published but its last push was 2025-01-31 ([ecosyste.ms listing](https://awesome.ecosyste.ms/projects/github.com%2FCrunchyData%2Fpg_tileserv)); its README itself says the API "looks a lot like that of the Martin tile server". Recommendation: martin, which lives in the same GitHub org as MapLibre GL JS.
- Deterministic alternative for static datasets: `ST_AsMVT` exported to **PMTiles** (single file on object storage, HTTP range requests, no server). Martin can serve PMTiles too.

### 1.3 Tier B — 3D Tiles 1.1 from PostGIS

- **pg2b3dm** (Geodan, MIT, .NET, Docker `geodan/pg2b3dm`): "Tool for creating 3D Tiles from PostGIS geometries"; supports 3D Tiles 1.1, implicit tiling (QUADTREE/OCTREE), glTF content with `EXT_mesh_features` and `EXT_structural_metadata`, validated with the 3D Tiles Validator; latest Docker tag seen **2.25.1**, NuGet 2.18.1 ([github.com/geodan/pg2b3dm](https://github.com/geodan/pg2b3dm), [Docker Hub tags](https://hub.docker.com/r/geodan/pg2b3dm/tags), [Geodan note on 1.1 implicit tiling](https://research.geodan.nl/3d-tiles-1-1-implicit-tiling/)). Input is a table with a `geometry(MULTIPOLYGONZ)` or `POLYHEDRALSURFACEZ` column in EPSG:4326/4978-compatible coordinates plus attribute columns copied into the metadata. It is the direct fit for `surfaces` and LoD2 buildings already in PostGIS.
- **3D Tiles 1.1 facts** (from the spec repo [CesiumGS/3d-tiles specification README](https://github.com/CesiumGS/3d-tiles/blob/main/specification/README.adoc), [CHANGES.md](https://github.com/CesiumGS/3d-tiles/blob/main/CHANGES.md)): OGC Community Standard 22-025r4, version 1.1 dated 2023-01-09 (approved 2022-12-17). Right-handed, z-up, metres, radians; the global frame "will often be in a WGS 84 ECEF reference frame (EPSG 4978), but it doesn't have to be"; `region` bounding volumes are EPSG:4979 in radians. Legacy b3dm/i3dm/pnts/cmpt are deprecated in favour of glTF content; `tileset.properties` deprecated in favour of the metadata model (`3DTILES_metadata` folded into core; glTF side = `EXT_mesh_features`, `EXT_structural_metadata`, `EXT_instance_features`, plus `EXT_meshopt_compression`, `KHR_draco_mesh_compression`, `KHR_texture_basisu`).
- **CityJSON → 3D Tiles**: **tyler** (3DGI, Rust, takes CityJSONFeature files, outputs glb tile content; Docker image bundles geoflow — [github.com/3dgi/tyler](https://github.com/3dgi/tyler)); `@csi-foxbyte/cityjson-to-3d-tiles` (Node, three LODs, texture packing — [README 0.0.22](https://unpkg.com/@csi-foxbyte/cityjson-to-3d-tiles@0.0.22/README.md)). The older `citygml-to-3dtiles` only emits 1.0 b3dm ([README](https://github.com/njam/citygml-to-3dtiles/blob/master/README.md)). Simplest path for Nexgen OS: load CityJSON into PostGIS (cjio → GeoPackage/PostGIS, or a small MIT importer in ST2) and let pg2b3dm tile from the database — one tiler for every source.
- **Clients**: three.js — **`3d-tiles-renderer`** (NASA-AMMOS, Apache-2.0, three.js + Babylon; 1.1 metadata extensions supported since v0.3.36, July 2024; npm mirrors show 0.4.27 and 0.5.0 — [github.com/NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS), [Cesium blog 2024-09-11](https://cesium.com/blog/2024/09/11/enhancements-to-the-threejs-3d-tiles-renderer/)). 3DBAG's own viewer is built on it. deck.gl — `Tile3DLayer` (loaders.gl `Tiles3DLoader`) ([deck.gl gallery](https://deck.gl/gallery)). CesiumJS reads 1.1 natively (reference client).

### 1.4 Tier C — glTF/GLB for one object

- Mapbox GL JS v3 has a native **`model` layer**: glTF 2.0 `.gltf`/`.glb`, Draco and meshopt, metallic-roughness PBR; meshes capped at 65 536 vertices; glTF cameras, lights, animations and multiple scenes unsupported; models registered in the style `models` map and instanced from a GeoJSON source ([style-spec guide](https://docs.mapbox.com/style-spec/guides/using-3d-models.md), [example](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-models-using-geojson-source/)). MapLibre has **no `model` layer**; its v6 release notes mention globe, terrain and fill-extrusion only ([maplibre-gl-js releases](https://github.com/maplibre/maplibre-gl-js/releases)).
- Portable path (both libraries): a `CustomLayerInterface` layer with `renderingMode: '3d'`, a three.js scene and `GLTFLoader`; the `render(gl, matrix)` call hands the map's projection matrix, which is multiplied by a model matrix built from `MercatorCoordinate.fromLngLat(lngLat, altitude)` and `meterInMercatorCoordinateUnits()` ([Mapbox three.js example](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/)). The same code runs on MapLibre (`maplibregl.MercatorCoordinate`). MapLibre v6.13 added experimental `CustomLayerInterface.renderToTerrainTile` so custom layers can drape on terrain ([releases](https://github.com/maplibre/maplibre-gl-js/releases)).
- **Threebox** wraps that pattern (`tb.update()` in `render`) but its last release is 2.2.7 (knowledge: 2021, with the `threelibre` fork for MapLibre) ([threebox docs](https://cdn.jsdelivr.net/npm/threebox-plugin@2.2.7/docs/Threebox.md), [threelibre](https://github.com/piemonSong/threelibre/blob/HEAD/docs/Threebox.md)). Mapbox's own example still ships three@0.126. Recommendation: own thin custom layer + current three.js, no Threebox dependency.
- **deck.gl**: `MapboxOverlay({interleaved: true})` shares the map's WebGL2 context (requires maplibre-gl > 3); a dedicated `@deck.gl/maplibre` `MapLibreOverlay` is the recommended integration for MapLibre 4.5.1 / 5 / 6 ([deck.gl MapLibre overview](https://deck.gl/docs/api-reference/maplibre/overview), [using with MapLibre](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre)). Interleaving lets `Tile3DLayer`/`PointCloudLayer` sit between map layers.

### 1.5 Point clouds (COPC/EPT) on the web

- **COPC 1.0** (Hobu, 2021): a LAZ 1.4 file whose chunks are clustered as an octree; point formats 6/7/8 only; `copc` info VLR at offset 375 (octree centre + halfsize) and a hierarchy VLR; readable by any LAZ 1.4 reader sequentially or by range requests spatially ([copc.io](https://copc.io/)). One file per capture, on object storage, HTTP range requests — no server.
- Clients: **copc.js** (npm `copc`, connormanning, TypeScript; caller injects a `Getter(begin, end)` that performs the Range fetch — used by Potree (PR #1381), iTowns, Giro3D) ([Giro3D COPCSource](https://app.unpkg.com/@giro3d/giro3d@2.0.3/files/src/sources/COPCSource.ts), [Potree PR](https://github.com/potree/potree/pull/1381)); **maplibre-gl-lidar** (COPC and LAS 1.0-1.4 via deck.gl, viewport-driven range requests — [README 0.16.2](https://cdn.jsdelivr.net/npm/maplibre-gl-lidar@0.16.2/README.md), [GISHub post](https://gishub.org/blog/maplibre-gl-lidar)). Caveat: `@loaders.gl/las` LASLoader "only supports LAS/LAZ files up to LAS v1.3", so deck.gl `PointCloudLayer` needs copc.js or maplibre-gl-lidar for COPC ([LASLoader reference](https://loadershtbprolgl-s.evpn.library.nenu.edu.cn/docs/modules/las/api-reference/las-loader)).
- For very large clouds, pnts tiles are deprecated in 3D Tiles 1.1; the 1.1 route is glTF point primitives, which is what WebODM's `3d_tiles_pointcloud` export produces.

### 1.6 MapLibre vs Mapbox — licence and 3D parity

| | Mapbox GL JS | MapLibre GL JS |
|---|---|---|
| Licence | v2+ "licensed under the Mapbox TOS for use only with the relevant Mapbox product(s)"; requires "a current active Mapbox account"; terminates if the account lapses; billing/telemetry code must not be modified ([LICENSE.txt](https://github.com/mapbox/mapbox-gl-js/blob/main/LICENSE.txt)). v1.13 and earlier BSD-3. | BSD-3-Clause fork of v1.13 ([MapTiler announcement](https://www.maptiler.com/news/2021/01/mapbox-gl-open-source-fork/), [Stadia note](https://stadiamaps.com/blog/mapbox-gl-licensing-and-stadia-maps/)) |
| Latest | v3.32.0 (2026-09-29), v3.33.0-rc.1 (2026-10-06) ([releases](https://github.com/mapbox/mapbox-gl-js/releases)) | v6.14.0 (2026-10-11); v6.0.0 2026-07-22: ESM-only, WebGL2 required ([releases](https://github.com/maplibre/maplibre-gl-js/releases), [v6.0.0 notes](https://newreleases.io/project/github/maplibre/maplibre-gl-js/release/v6.0.0)) |
| Globe | yes (Standard style) | yes since 5.0 (Jan 2025); poles, sky and atmosphere fixes through 6.x |
| Terrain | yes | yes (`raster-dem`), `queryTerrainElevation`, custom-layer draping (6.13, experimental) |
| 3D models | native `model` layer, landmark meshes, 3D lights, shadows (Standard style) ([migration guide](https://docs.mapbox.com/mapbox-gl-js/guides/migrate)) | custom layers only (three.js / Babylon examples) |
| fill-extrusion | yes | yes, incl. `fill-extrusion-rounded-corner-distance`, vertical gradient over terrain |
| Free camera | `FreeCameraOptions` | same API (`setFreeCameraOptions`, `lookAtPoint`), also in MapLibre Native ([Mapbox API](https://docs.mapbox.com/mapbox-gl-js/api/properties), [MapLibre Native](https://maplibre.org/maplibre-native/cpp/api/structmbgl_1_1FreeCameraOptions.html)) |

Consequence for Nexgen OS: everything in the open repo targets MapLibre (BSD) through `fill-extrusion`, custom layers and 3D Tiles; the Mapbox `model` layer, Standard style and Mapbox tokens are a Nexgen (WeSmart's product) concern.

---

## 2. Scene / camera path / render data model

### 2.1 How existing systems represent a camera path

| System | Representation | Open? | Notes |
|---|---|---|---|
| Mapbox / MapLibre free camera | `FreeCameraOptions {position: MercatorCoordinate(x,y,z), orientation: quaternion}`; helper `lookAtPoint(lngLat, up?)`; zoom derived from altitude; example interpolates position and altitude in a `requestAnimationFrame` loop after `idle` ([example](https://docs.mapbox.com/mapbox-gl-js/example/free-camera-point/)) | API, no file format | Orientation may be rejected if ambiguous (camera upside down) |
| three.js | `CatmullRomCurve3.getPointAt(t)` for position, second curve for look-at; `AnimationClip` with `VectorKeyframeTrack`/`QuaternionKeyframeTrack` (linear by default) ([dept write-up](https://deptagency.com/en-gb/?p=44630), [drei MotionPathControls](https://drei.docs.pmnd.rs/controls/motion-path-controls)) | API | Camera is a node; FOV animated separately |
| glTF 2.0 | an `animation` whose channels target the camera node's `translation`/`rotation`; `KHR_animation_pointer` extends targets to `/cameras/0/perspective/yfov` ([KHR_animation_pointer summary](https://scrapbox.io/0b5vr/glTF:_KHR_animation_pointer)) | yes (Khronos) | Blender exports object keyframes (`location`→translation, `rotation_quaternion`→rotation) and offers "Animation Pointer (experimental)" ([Blender exporter commit](https://developer.blender.org/rBAb93459de4bf85b51826cca1c79a2602804e796c4)); Mapbox `model` layer ignores glTF cameras and animations |
| KML `gx:Tour` | `gx:Playlist` of `gx:FlyTo` (`gx:duration`, `gx:flyToMode` smooth/bounce, target `Camera` or `LookAt`) and `gx:Wait` ([Google touring doc](https://developers.google.com/kml/documentation/touring?hl=it)) | Google extension namespace, not OGC KML core | CesiumJS plays it (`KmlTour`, `KmlTourFlyTo`, `KmlTourWait`) ([Cesium 1.127 KmlTour](https://cesium.com/downloads/cesiumjs/releases/1.127/Build/Documentation/KmlTour.html)) |
| CZML | **no camera element**; camera tours must be client code ([forum](https://community.cesium.com/t/camera-control-from-czml/4891)) | yes | Cesium Stories is proprietary and time-dynamic-data oriented ([Stories doc](https://cesium.com/learn/ion/stories-time-dynamic/)) |
| Blender | `.blend` is binary and application-specific; camera = object with `location`, `rotation_euler`/`quaternion`, `lens`, keyframes in F-curves | GPL tool, format undocumented | export via glTF |

There is no open standard dedicated to geographic camera paths. KML Tour is the closest "geo" one (lon/lat/alt + heading/tilt/roll + duration + easing), glTF animation is the closest "3D" one (local metres, quaternion). Both are keyframe lists with a time and an easing hint.

### 2.2 Recommendation — store keyframes in geographic terms, derive the rest

Store the path as a **JSON document of geographic keyframes** (KML Tour semantics, JSON encoding), in a `jsonb` column validated by a JSON Schema shipped in the repo. Reason: it is renderer-neutral (MapLibre free camera, three.js, CesiumJS, Blender via a converter), human-readable, diffable, and georeferenced by construction — a glTF animation would need the model anchor to be meaningful.

```json
{
  "$schema": "https://nexgen-os.org/schemas/camera-path-1.0.json",
  "version": "1.0",
  "crs": "EPSG:4979",
  "frame_rate": 30,
  "keyframes": [
    { "t": 0.0,  "position": {"lon": 4.3517, "lat": 50.8466, "height": 220.0},
      "target":   {"lon": 4.3521, "lat": 50.8470, "height": 35.0},
      "roll": 0, "fov": 45, "easing": "smooth" },
    { "t": 8.0,  "position": {"lon": 4.3540, "lat": 50.8460, "height": 160.0},
      "target":   {"lon": 4.3521, "lat": 50.8470, "height": 35.0},
      "roll": 0, "fov": 45, "easing": "smooth" },
    { "t": 10.0, "wait": 2.0 }
  ],
  "interpolation": "catmull-rom",
  "loop": false
}
```

Conventions: `height` is metres above the WGS 84 ellipsoid (EPSG:4979, same as 3D Tiles `region`), `t` in seconds, either `target` (look-at, KML `LookAt`) or `heading/tilt` (KML `Camera`) per keyframe, `fov` vertical in degrees, `easing` in {`linear`,`smooth`,`bounce`} mirroring `gx:flyToMode`. Replay: MapLibre → `MercatorCoordinate.fromLngLat(position, height)` + `lookAtPoint(target)`; three.js → convert both to the scene's local ENU frame, `CatmullRomCurve3` on positions, `lookAt` on targets; Cesium → `Camera.setView` per frame; KML export → one `gx:FlyTo` per keyframe. Deterministic: the same JSON always produces the same frames at a given frame rate.

Scene = the thing the camera looks at: a list of layers (tile sources, models, extrusion styles, time of day for lighting) and an initial view. Render = one execution of (scene, camera_path, profile) → video file. This keeps the three apart in the schema (§6).

---

## 3. Georeferencing of local 3D models

| Format | Where the CRS lives | Where the anchor lives | Units / axes |
|---|---|---|---|
| CityJSON 2.0.2 | `metadata.referenceSystem` as OGC URL `http://www.opengis.net/def/crs/{authority}/{version}/{code}`, e.g. `…/EPSG/0/7415`; "should be a three-dimensional one"; all objects same CRS | `transform.scale` and `transform.translate`: `v = vi * scale + translate` (integer vertices; translate usually the bbox minimum); `metadata.geographicalExtent` `[minx,miny,minz,maxx,maxy,maxz]` in real-world coordinates ([spec 2.0.2, Living Standard 2026-03-27](https://www.cityjson.org/specs/2.0.2/)) | projected CRS units (m), z-up |
| 3D Tiles 1.1 | implicit ECEF EPSG:4978 or declared via tileset metadata semantic `TILESET_CRS_GEOCENTRIC`; `region` volumes EPSG:4979 radians | `tile.transform` 4×4 column-major, local → parent, root → tileset frame; composed top-down; glTF content y-up rotated to z-up (π/2 about x) before the tile transform. Large coordinates: root glTF node matrix / translation + tile transform (no `CESIUM_RTC`; `RTC_CENTER` only existed in the deprecated b3dm feature table) ([spec README](https://github.com/CesiumGS/3d-tiles/blob/main/specification/README.adoc), [b3dm README](https://github.com/CesiumGS/3d-tiles/blob/main/specification/TileFormats/Batched3DModel/README.adoc)) | m, radians, z-up tileset / y-up glTF |
| glTF 2.0 | none (no CRS concept) | none; `EXT_structural_metadata` carries attributes, not a CRS; `CESIUM_RTC` was a glTF 1.0 extension ("will still be supported" in 2018-era b3dm guidance, absent from 1.1) ([3d-tiles issue summary](https://lightrun.com/answers/cesiumgs-cesium-3d-tiles-10-updates)) | m by spec, y-up, right-handed |
| IFC4 / 4.3 | `IfcProjectedCRS` (`Name` = "EPSG:xxxx", `MapUnit`, `VerticalDatum`) as `TargetCRS` of `IfcMapConversion` | `IfcMapConversion`: `Eastings`, `Northings`, `OrthogonalHeight`, `XAxisAbscissa`, `XAxisOrdinate` (θ = atan2(ordinate, abscissa)), `Scale` (default 1.0); order: scale, rotate about z, translate; `IfcMapConversionScaled` (4.3) adds per-axis factors; takes priority over `TrueNorth` ([IFC 4.3.2.0 IfcMapConversion](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcMapConversion.htm), [Project Global Positioning concept](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/concepts/Project_Context/Project_Global_Positioning/content.html)) | project units (often mm), z-up |
| ODM mesh / OBJ | `odm_georeferencing/proj.txt` (knowledge: a PROJ string, usually UTM) alongside `odm_textured_model_geo.obj` ([ODM outputs](https://docs.opendronemap.org/outputs/)) | OBJ vertices in the projected CRS, often offset by a local origin written in the same folder | m, z-up |

All five reduce to the same six things: a horizontal CRS, a vertical reference, an anchor point, a rotation about the vertical axis (plus a full rotation for tilted scans), a scale, and an up axis. Proposed columns for `3d.models` (every row = one file in object storage, one anchor):

| Column | Type | Meaning |
|---|---|---|
| `format` | text enum `gltf|glb|cityjson|ifc|obj|3dtiles|ply|las|copc` | file format (3D Tiles rows point at `tileset.json`) |
| `uri` | text | object storage URI |
| `crs` | text | authority code of the file's native CRS, e.g. `EPSG:7415`, `EPSG:4978`, `EPSG:32631`; `local` when the file has none (plain glTF/OBJ) |
| `origin` | `geometry(PointZ, 4979)` | anchor: lon/lat + ellipsoidal height of the model's local origin (what CityJSON `translate`, IFC `Eastings/Northings/OrthogonalHeight` and the 3D Tiles root transform translation become once converted) |
| `origin_native` | `double precision[3]` | the same anchor in the native CRS, kept verbatim for round-trips (CityJSON `translate`, IFC Eastings/Northings/Height) |
| `rotation` | `double precision[4]` quaternion (x,y,z,w) in the local ENU frame at `origin` | identity when only a heading is known; heading θ from IFC `XAxisAbscissa/Ordinate` is `rotate_z(θ)` |
| `scale` | `double precision[3]` default `{1,1,1}` | IFC `Scale`/`IfcMapConversionScaled`, CityJSON `transform.scale` is *not* stored here (it is a compression detail, applied on read) |
| `up_axis` | text enum `z|y` | `y` for glTF/OBJ from DCC tools, `z` for CityJSON/IFC/3D Tiles tilesets |
| `units` | text enum `m|mm|ft` | IFC projects are often mm |
| `vertical_datum` | text | `ellipsoid` (default, EPSG:4979), or a named datum/EPSG vertical code (NAP = EPSG:5709, DHHN2016, NGF-IGN69…) when the source states it |
| `bbox` | `geometry(PolygonZ, 4979)` or `box3d` | `geographicalExtent` converted; drives tile/spatial queries |
| `lod` | text | `1.2`, `1.3`, `2.2`, `3`, `mesh`, `pointcloud` |
| `source_metadata` | jsonb | the raw `metadata` object (CityJSON), the `IfcProjectedCRS`/`IfcMapConversion` entities, the tileset `asset`, the ODM `proj.txt` — untouched for audit |

A single SQL function `3d.model_to_world(model_id)` returns the 4×4 ENU→ECEF matrix (`ST_Transform` of `origin` to 4978 + rotation + scale + up-axis flip); clients consume that matrix, so a glTF, an IFC and a CityJSON land in the same place without client-side special cases.

---

## 4. Capture data model (drones, photos, point clouds)

### 4.1 ODM / WebODM outputs

ODM task tree (ODM 3.6 docs, [outputs page](https://docs.opendronemap.org/outputs/)): `odm_orthophoto/odm_orthophoto.tif` (GeoTIFF, COG when `--cog`), `odm_orthophoto.original.tif`, `odm_dem/dsm.tif`, `odm_dem/dtm.tif` (only with `--dsm/--dtm`), `odm_georeferencing/odm_georeferenced_model.{ply,laz,csv}` (COPC via `--pc-copc`, EPT via `--pc-ept`), `odm_texturing/odm_textured_model.obj` and `odm_textured_model_geo.obj` (+ `odm_textured_model_geo.glb` with `--gltf`), `odm_meshing/odm_mesh.ply`, `opensfm/reconstruction.json` (cameras and tie points), `3d_tiles/` with `--3d-tiles`, `odm_report/report.pdf`, `odm_report/stats.json`, `odm_report/shots.geojson`, `cameras.json`.

WebODM task object (`TaskSerializer`, [app/api/tasks.py](https://raw.githubusercontent.com/OpenDroneMap/WebODM/master/app/api/tasks.py), [app/models/task.py](https://raw.githubusercontent.com/OpenDroneMap/WebODM/master/app/models/task.py), [docs](https://docs.webodm.org/api/task/)): `id` (uuid), `uuid` (NodeODM id), `project`, `name`, `processing_time` (ms), `processing_node`, `status` (10 queued, 20 running, 30 failed, 40 completed, 50 canceled), `last_error`, `options` (the ODM flags, worth storing verbatim for reproducibility), `available_assets`, `created_at`, `images_count`, `epsg`, `wkt`, `srs`, `extent` (orthophoto, else DSM, else DTM), `size` (MB), `orthophoto_bands`, `crop`, `tags`, `statistics` = `{pointcloud.points, gsd, area, start_date, end_date, spatial_refs: [gps|gcp|alignment]}` parsed from `odm_report/stats.json`.

`ASSETS_MAP` keys (download endpoint `/api/projects/{p}/tasks/{t}/download/{asset}`): `all.zip`, `orthophoto.tif|png|mbtiles|kmz`, `cutline.gpkg`, `georeferenced_model.las|laz|ply|csv`, `textured_model.zip`, `textured_model.glb`, `3d_tiles_model.zip`, `3d_tiles_pointcloud.zip`, `dsm.tif`, `dtm.tif`, `dsm_tiles.zip`, `dtm_tiles.zip`, `orthophoto_tiles.zip`, `cameras.json`, `shots.geojson`, `report.pdf`, `ground_control_points.geojson`, `splats.rad` (Gaussian splats). Hosted WebODM Lightning also exports 3D Tiles for point clouds and meshes ([docs.webodm.net task options](https://docs.webodm.net/references/task-options)).

### 4.2 STAC for captures

No drone-specific STAC extension exists; the fit is a STAC **Item per capture** with the core fields (`datetime`, `start_datetime`/`end_datetime`, `geometry`, `bbox`) plus the **proj** extension (`proj:epsg`/`proj:code`, `proj:bbox`, `proj:transform`, `proj:shape` per asset) and the **view** extension (`view:off_nadir` 0–90°, `view:azimuth` 0–360° clockwise from north, `view:sun_azimuth`, `view:sun_elevation`; schema v1.0.0) ([pystac view extension](https://pystac.readthedocs.io/en/latest/api/extensions/view.html), [Maxar ARD field definitions](https://ard.maxar.com/docs/ard-order-delivery/metadata/tile-metadata/)). Assets keyed by role: `orthophoto` (`image/tiff; application=geotiff; profile=cloud-optimized`), `dsm`, `dtm`, `pointcloud` (`application/vnd.laszip+copc`), `mesh` (`model/gltf-binary`), `tileset` (`application/json`, 3D Tiles), `report`. Storing the Item as `jsonb` in `3d.captures.stac_item` gives interoperability for free (any STAC browser/API reads it) while the typed columns carry what queries need.

### 4.3 Per-photo pose (EXIF/XMP)

DJI writes ~30 XMP fields under `http://www.dji.com/drone-dji/1.0/`: `GpsLatitude`, `GpsLongtitude` (sic), `AbsoluteAltitude` (MSL), `RelativeAltitude` (above take-off — the one that matters for mapping), `GimbalRollDegree/PitchDegree/YawDegree`, `FlightRollDegree/PitchDegree/YawDegree`, `DewarpData` (Brown distortion), plus standard EXIF `GPSLatitude/Longitude/Altitude`, `FocalLength`, `DateTimeOriginal`; Sensefly/Pix4D use their own roll/pitch/yaw namespaces, Parrot standard EXIF 2.31 + custom XMP, Skydio exports omega/phi/kappa ([Orthority EXIF/XMP reference](https://orthority.readthedocs.io/en/latest/file_formats/exif_xmp.html), [fast.io drone metadata](https://fast.io/resources/drone-photo-metadata-extraction-gps-altitude-flight-data/), [Parrot](https://developer.parrot.com/docs/pdraw/photo-metadata.html), [Skydio](https://support.skydio.com/hc/en-us/articles/32887502774171)). Worth storing per photo: `position geometry(PointZ,4979)`, `altitude_relative_m`, `altitude_msl_m`, `gimbal_rpy double[3]`, `flight_rpy double[3]`, `focal_length_mm`, `sensor_width_mm`, `image_size int[2]`, `taken_at timestamptz`, `camera_model`, `exif jsonb` (raw). Orthority notes that roll/pitch/yaw → camera orientation is approximate; the refined pose comes back from ODM `opensfm/reconstruction.json` / `shots.geojson` and should be stored as a second column (`pose_refined`), never overwriting the EXIF one.

### 4.4 COPC metadata worth indexing

From the LAS header and `copc` VLR: `point_count`, `point_format` (6/7/8), `crs` (WKT from the OGC WKT VLR), `bbox` (min/max xyz), `scale`/`offset` (LAS), `octree_center double[3]`, `octree_halfsize`, `gps_time_range`, `classification_present boolean`, `rgb_present boolean`; plus provenance: `generating_software`, `file_creation_date`, `tool_version` (PDAL/ODM) ([copc.io spec](https://copc.io/)).

---

## 5. Compatibility notes

### 5.1 Google Solar API data layers

- `dataLayers` returns `imageryDate`, `imageryProcessedDate`, `dsmUrl`, `rgbUrl`, `maskUrl`, `annualFluxUrl`, `monthlyFluxUrl`, `hourlyShadeUrls[24]`, `imageryQuality` (`HIGH|MEDIUM|BASE`); 17 GeoTIFFs; DSM is float32 at 0.1 m/pixel with `-9999` nodata; URLs are valid one hour; an API key or OAuth header is required to fetch each GeoTIFF; all layers except RGB are encoded data, not viewable images, and "cannot be used directly as an overlay image with Maps JavaScript API" ([data layers](https://developers.google.com/maps/documentation/solar/data-layers), [GeoTIFF page](https://developers.google.com/maps/documentation/solar/geotiff?hl=en)).
- Storage: the GeoTIFF page states "GeoTIFF files can be stored for up to 30 days"; the policies page says "content pre-fetching, caching, or storage is generally restricted, except for Place IDs" and defers to the Service Specific Terms ([policies, updated 2026-10-08](https://developers.google.com/maps/documentation/solar/policies)); Google's product FAQ says data must be re-downloaded every 30 days for ongoing use ([Solar product page](https://mapsplatform.google.com/intl/en/maps-products/solar/)). Attribution: "Source: Includes solar data from Google"; Solar results shown on a map must be on a Google Map. EEA billing addresses fall under the EEA Terms since 8 July 2025 and "certain content from the Solar API will no longer be returned" (the current Service Specific Terms page renders client-side; read it in a browser before relying on derived-data rules).
- Consequence: Google layers are a **cache with a TTL**, not a dataset. In the schema they are rows of `3d.rasters` with `provider = 'google_solar'`, `expires_at = fetched_at + 30 days`, `licence = 'google-maps-platform'`, `redistributable = false`; the open repo stores none of them and holds no key. Derived numbers (roof segment azimuth/tilt/area already returned by `buildingInsights`) are what Nexgen keeps long-term in `surfaces`; the open module must be able to produce the same layers from open DSMs (AHN, LiDAR HD, drone DSM) so the pipeline does not depend on Google.

### 5.2 3DBAG (NL) and other LoD2 sources

- **3DBAG**: CC BY 4.0 ("© 3DBAG by tudelft3d and 3DGI", link to the copyright page, state changes); release **2025.09.03** (9 Sept 2025); LoD1.2/1.3/2.2 (LoD1.1 for >30 000 m² or >900 roof planes); CityJSON **v2.0** files `3dbag_<version>_<tile>.json`, GeoPackage, FlatGeobuf, OBJ, IFC 4.3, WMS/WFS, API returning CityJSONFeature (`.city.jsonl`), and **3D Tiles 1.1** (glb with `EXT_mesh_features`/`EXT_structural_metadata`, EPSG:4978, one tileset per LoD, e.g. `https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json`); native CRS EPSG:7415 (RD New + NAP) ([copyright](https://docs.3dbag.nl/en/copyright/), [webservices](https://docs.3dbag.nl/en/delivery/webservices/), [release notes](https://docs.3dbag.nl/en/overview/release_notes/)). Per-roof-plane attributes (`b3_h_dak_*`, `b3_azimut`, `b3_hellingshoek` — knowledge) map straight onto `surfaces.azimuth/tilt`.
- **Brussels UrbIS 3D Constructions**: individually modelled buildings "with a level of detail equivalent to LoD 2", monthly updates, free download (Shapefile, SketchUp, DGN, DWG, GeoPackage, GeoJSON, GML) from datastore.brussels ([Geobru record](https://geobru-geonetwork.irisnet.be/geonetwork/srv/api/records/e9ec2aa4-cffd-11ee-bccc-00090ffe0001)).
- **Flanders 3D GRB**: LoD1 blocks with flat roofs (Shape, KML, WMS); LoD2 "may be added later" ([Digitaal Vlaanderen](https://www.vlaanderen.be/digitaal-vlaanderen/onze-diensten-en-platformen/basiskaart-vlaanderen-grb/3d-grb), [catalogue](https://www.vlaanderen.be/datavindplaats/catalogus/3d-grb-0)).
- **Germany**: national LoD2 delivery in CityGML (AdV profile, ZSHH format description v2.0); Berlin ~550 000 LoD2 buildings open; NRW serves LoD2 through OGC API Features ([ZSHH LoD2 format](https://sg.geodatenzentrum.de/web_public/gdz/dokumentation/deu/LoD2_Datenformatbeschreibung.pdf), [Berlin](https://community.cesium.com/t/3d-city-model-of-berlin-published-under-open-data-license/2167), [NRW](https://test.ckan.open.nrw.de/zh_Hant_TW/dataset/5d9a8abc-dfd0-4dda-b8fa-165cce4d8065/resource/a749708d-d932-449c-b422-8b18ad31ea33)).
- **France**: BD TOPO 3.5 carries building heights (LoD1 by extrusion); no national LoD2 product found; Luxembourg publishes LoD1 CityGML ([BD TOPO INSPIRE record](https://inspire-geoportal.ec.europa.eu/srv/api/records/IGNF_BD-TOPO), [data.gouv](https://www.data.gouv.fr/datasets/bd-topo-r/reuses_and_dataservices)).
- Importer rule: CityGML → CityJSON (citygml-tools, knowledge) → one MIT CityJSON reader in ST2; the reader must honour `transform`, `metadata.referenceSystem`, `geographicalExtent`, CityJSONFeature streams, and semantic surfaces (`RoofSurface` with per-surface attributes) so 3DBAG and German LoD2 feed `buildings` + `surfaces` identically.

### 5.3 Overture buildings

Schema v2.0.0 (docs updated 2026-09-17), theme licence **ODbL** (sources OSM, Microsoft, Esri, Google Open Buildings CC BY 4.0, USGS lidar heights): `height` (m, lowest to highest point), `min_height`, `num_floors`, `num_floors_underground`, `min_floor`, `is_underground`, `level`, `roof_shape` enum {dome, flat, gabled, gambrel, half_hipped, hipped, mansard, onion, pyramidal, round, saltbox, sawtooth, skillion, spherical}, `roof_direction` (bearing of the ridge line, 0–360), `roof_orientation` {across, along}, `roof_material`, `roof_height`, `roof_color`, `facade_material`, `facade_color`, `has_parts` ([building schema](https://docs.overturemaps.org/schema/reference/buildings/building/), [roof_shape](https://docs.overturemaps.org/schema/reference/buildings/types/roof_shape/), [roof_orientation](https://docs.overturemaps.org/schema/reference/buildings/types/roof_orientation/), [release notes on licensing](https://overturemaps.org/overture-january-2024-release-notes/)). Mapping: `height` → `buildings.height`; `roof_shape` + `roof_direction` → a synthetic LoD2-lite (two planes for gabled/hipped at `roof_direction` ± 90°, flat otherwise) tagged `lod = '1.3-derived'` so it is never confused with measured roof planes. ODbL share-alike applies to a derived database that is redistributed: keep Overture-derived rows flagged `source = 'overture'` so an export can isolate them.

---

## 6. Proposed `3d` module tables and the open/private line

Prefix `3d.` (schema) — naming follows `DB_NAMING_POLICY` (snake_case plural, RLS from creation, reuse before create). Every file column is a `uri` to object storage + `sha256` + `bytes`; nothing binary in Postgres. Every derived artefact records `tool`, `tool_version`, `params jsonb`, `source_ids uuid[]` so it can be regenerated deterministically.

| Table | Key columns | One line |
|---|---|---|
| `3d.captures` | `id`, `site_id`, `kind` (`drone_photogrammetry|lidar|handheld_scan|satellite|aerial_national`), `captured_at tstzrange`, `footprint geometry(Polygon,4326)`, `crs`, `gsd_m`, `images_count`, `area_m2`, `processing` jsonb (ODM `options`, `statistics`, `epsg`, `processing_time`), `stac_item jsonb`, `licence`, `source` | one acquisition campaign; the STAC Item is the interoperable face |
| `3d.capture_images` | `capture_id`, `uri`, `taken_at`, `position geometry(PointZ,4979)`, `altitude_relative_m`, `altitude_msl_m`, `gimbal_rpy`, `flight_rpy`, `focal_length_mm`, `sensor_width_mm`, `image_size`, `camera_model`, `pose_refined jsonb`, `exif jsonb` | one photo and its pose (EXIF first, ODM-refined second) |
| `3d.rasters` | `capture_id?`, `site_id`, `kind` (`orthophoto|dsm|dtm|mask|annual_flux|monthly_flux|hourly_shade|rgb`), `uri` (COG), `crs`, `bbox`, `pixel_size_m`, `nodata`, `bands`, `provider`, `fetched_at`, `expires_at`, `redistributable boolean`, `licence` | orthophotos, DSM/DTM, Google Solar layers as expiring cache rows |
| `3d.point_clouds` | `capture_id?`, `site_id`, `uri` (COPC), `format` (`copc|laz|ept`), `crs`, `bbox box3d`, `point_count`, `point_format`, `octree_center`, `octree_halfsize`, `has_rgb`, `has_classification`, `tool`, `tool_version` | one COPC file; read by range requests, no server |
| `3d.models` | `site_id`, `building_id?`, `device_id?`, `format`, `uri`, `crs`, `origin`, `origin_native`, `rotation`, `scale`, `up_axis`, `units`, `vertical_datum`, `bbox`, `lod`, `source`, `source_metadata`, `derived_from uuid[]` | one georeferenced mesh/model (§3); glTF of a PV layout, IFC of a plant room, CityJSON tile, ODM mesh |
| `3d.drawings` | `site_id`, `kind` (`plan|section|elevation|single_line|roof_plan`), `uri` (PDF/SVG/DXF), `page`, `georef jsonb` (affine or GCPs → `crs`), `scale_denominator`, `document_id` | 2D drawings with an optional georeference so a plan can be draped |
| `3d.tilesets` | `site_id?`, `scope` (`site|region|global`), `uri` (`tileset.json`), `spec_version` (`1.1`), `content` (`glb|pnts`), `lod`, `crs` (`EPSG:4978`), `bbox`, `built_from` (`pg2b3dm|tyler|odm|external`), `source_ids uuid[]`, `built_at`, `params jsonb` | one 3D Tiles tileset, static on object storage |
| `3d.scenes` | `site_id`, `name`, `initial_view jsonb` (lon/lat/height/target), `layers jsonb[]` (ordered refs to tilesets/models/rasters/point_clouds + style), `environment jsonb` (date/time for sun, exaggeration), `basemap` (`maplibre_style_uri`) | what is shown; references, never copies |
| `3d.camera_paths` | `scene_id`, `name`, `path jsonb` (schema §2.2), `duration_s`, `keyframe_count`, `checksum` | how the camera moves, renderer-neutral |
| `3d.renders` | `scene_id`, `camera_path_id`, `profile jsonb` (resolution, fps, codec, watermark, end card), `status`, `renderer`, `renderer_version`, `uri` (mp4/webm), `thumbnail_uri`, `duration_s`, `rendered_at`, `cost jsonb` | one produced video; reproducible from the three ids + profile |
| `3d.derivations` | `output_table`, `output_id`, `input_refs jsonb[]`, `tool`, `tool_version`, `params jsonb`, `ran_at`, `log_uri` | the lineage edge for every generated artefact (tiles, DSM, mesh, LoD2-lite) |

Reused from the core, not duplicated: `sites`, `buildings` (footprint, height), `surfaces` (3D polygons, azimuth, tilt), `devices` (PV layouts), `documents` (URIs). `3d.models.building_id` and `3d.rasters.site_id` are the joins; a roof surface derived from a mesh writes to `surfaces` with `source = '3d.models:<id>'`, keeping one source of truth for roof geometry.

### The open / private line

| Open (Nexgen OS, MIT/AGPL-clean) | Private (Nexgen (WeSmart's product)) |
|---|---|
| Schema above, RLS, JSON Schemas (camera path, scene), SQL functions (`model_to_world`, `ST_AsMVT` tile functions, bbox/ENU helpers) | API keys and quotas: Google Solar, Mapbox tokens, Mapbox Standard style and `model` layer |
| Importers (ST2): CityJSON 2.0 (+ CityJSONSeq), IFC `IfcMapConversion` reader, 3D Tiles tileset reader, glTF anchor reader, ODM/WebODM task ingest, STAC Item writer, EXIF/XMP pose reader | Rendering farm (headless Chromium/Puppeteer or Blender workers), queueing, `3d.renders` execution, watermarking, QR end cards, codec presets |
| Derivations that are pure functions of open inputs: footprint extrusion, LoD2-lite from Overture, roof planes from a DSM, COPC conversion (PDAL), 3D Tiles build (pg2b3dm/tyler), PMTiles build | Google Solar fetch + 30-day cache refresh, EEA terms handling, licence-gated distribution |
| MapLibre front-end bricks: `fill-extrusion` style fragment, three.js custom layer, `3d-tiles-renderer` wrapper, copc.js loader, camera-path player (free camera) | Marketing video pipeline, hosted viewer with Mapbox globe/landmarks, analytics |
| Reference data adapters: 3DBAG (CC BY), UrbIS, German LoD2, Overture (ODbL-flagged rows) | Paid or restricted datasets (commercial LoD2, national lidar under licence) |

Licence hygiene for the open side: martin (MIT/Apache-2.0), pg2b3dm (MIT), tyler (Apache-2.0/MIT — check at vendoring), 3d-tiles-renderer (Apache-2.0), copc.js (MIT), MapLibre (BSD-3), three.js (MIT), deck.gl (MIT), PDAL (BSD), ODM (AGPL-3.0 — call it as an external service or CLI, never link it into MIT code); CityJSON spec CC0, 3D Tiles spec Apache/OGC. The AGPL boundary is exactly where ODM and WebODM sit: Nexgen OS stores their outputs and talks to their API; it ships none of their code.

---

### Source list (all read 2026-10-12)

PostGIS ST_AsMVT · martin GitHub and docs.rs · Baremaps extrusion example · Stadia 3D buildings · pg_tileserv ecosyste.ms · pg2b3dm GitHub, Docker Hub, Geodan 1.1 note · 3d-tiles spec README, b3dm README, CHANGES.md · tyler · cityjson-to-3d-tiles · 3DTilesRendererJS GitHub, Cesium blog 2024-09-11 · Mapbox style-spec 3D models guide, GeoJSON model example, three.js custom layer example, free camera example, migration guide, LICENSE.txt, releases · MapLibre releases, v6.0.0 notes, Native FreeCameraOptions · deck.gl MapLibre overview and guide, PointCloudLayer · copc.io · Giro3D COPCSource · Potree PR #1381 · maplibre-gl-lidar README · loaders.gl LASLoader · Google KML touring · Cesium KmlTour 1.127, CZML camera thread, Stories · KHR_animation_pointer summary · Blender glTF exporter commits · dept camera path · drei MotionPathControls · IFC 4.3 IfcMapConversion and Global Positioning concept · CityJSON 2.0.2 spec · ODM outputs · WebODM task docs, task.py, tasks.py, webodm.net task options · pystac view extension · Maxar ARD metadata · Orthority EXIF/XMP · fast.io, Parrot, Skydio drone metadata · Google Solar data layers, GeoTIFF, policies, product page · 3DBAG copyright, webservices, release notes · Geobru UrbIS 3D · Digitaal Vlaanderen 3D GRB · ZSHH LoD2, Berlin, NRW · IGN BD TOPO INSPIRE, data.gouv · Overture building schema, roof_shape, roof_orientation, January 2024 release notes.

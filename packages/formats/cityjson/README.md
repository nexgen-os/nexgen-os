# `@nexgen-os/cityjson` — CityJSON 2.0 ⇄ plain shapes

Reads the buildings of a [CityJSON](https://www.cityjson.org) document — the
way 3DBAG, UrbIS or a converted CityGML LoD2 dataset publishes them — into
plain shapes, and writes such shapes back as CityJSON 2.0. MIT; no
dependency.

| CityJSON | `CityBuilding` | Notes |
|---|---|---|
| `Building` and its `BuildingPart`s | one building, `parts` | `id` = the CityObject id |
| `name`, `measuredHeight`, `storeysAboveGround`, `storeysBelowGround`, `yearOfConstruction` | fields of the same names | as the file writes them, null when absent |
| every other attribute | `attributes` | as it came |
| `GroundSurface` faces, else LoD 0, else every face | `footprint` | polygons in the file's reference system |
| semantic faces of the finest LoD that has semantics | `surfaces` | CityGML type, LoD, polygon, the semantic surface's attributes (3DBAG's `b3_*`) |
| the vertices | every point | resolved through `transform`, in the CRS of `metadata.referenceSystem` (`srid`) or of `options.srid` |
| other CityObjects | `skipped` | vegetation, roads, bridges |

`writeCityJson()` writes a `Building` per shape: a LoD 1 `Solid` from
`solid`, a LoD 2 `MultiSurface` with the footprint as its ground surface and
the surfaces with their semantics, the named attributes as CityGML writes
them; integer vertices in millimetres through the transform.

```ts
import { readCityJson, writeCityJson } from '@nexgen-os/cityjson';

const model = readCityJson(doc);       // { srid, buildings, skipped }
const out = writeCityJson(model);      // CityJSON 2.0
```

Refuses by name `not_cityjson` and `crs_required` (no reference system in
the file nor in the options). What it never does: compute a height, an
azimuth or a tilt, transform coordinates, open a connection. Into Nexgen
OS, `importCityJson()` of the `building` module (`modules/building/src`) writes each
building through `building.add_building()` (its footprint unioned in WGS 84,
elevation, height), `set_attribute()` (floors, year), `add_identifier()`
(scheme `cityjson`) and `building.add_surface()` (roof and wall faces,
azimuth against true north), refusing
a building already imported (`already_imported`); `exportCityJson()` reads
a participant's buildings back, in their UTM zone, and the export lands the same way
when imported again.

Left alone: textures and materials, extensions.

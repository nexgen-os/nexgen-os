# `@nexgen-os/cityjson` — CityJSON 2.0 ⇄ Nexgen OS

Reads the buildings of a [CityJSON](https://www.cityjson.org) file — the
way 3DBAG, UrbIS or a converted CityGML LoD2 dataset publishes them — into
the core, and writes a site's buildings back out. MIT, like every format
library; no field of the file is lost.

| CityJSON | Nexgen OS | Notes |
|---|---|---|
| `Building` (+ its `BuildingPart`s) | one row of `buildings` | name from `attributes.name`, else the CityObject id |
| `GroundSurface` faces, else LoD 0, else every face | `footprint` (3D, at the elevation) | projected, unioned, transformed to WGS 84 |
| lowest vertex | `elevation_m` | |
| `measuredHeight`, else highest − lowest vertex | `height_m` | |
| `storeysAboveGround`, `storeysBelowGround`, `yearOfConstruction` | the attributes `floors_above_ground`, `floors_below_ground`, `year_built` | with the file as their source; read back by the export |
| `RoofSurface`, `OuterFloorSurface` faces of the finest LoD | `surfaces` of kind `roof`, with azimuth and tilt from the face's outward normal | semantic attributes (3DBAG's `b3_*`) in `metadata.cityjson` |
| `WallSurface` faces | `surfaces` of kind `facade` | |
| the CityObject id | `external_ids`, scheme `cityjson` | |
| every other attribute | `buildings.metadata.cityjson.attributes` | given back on export |
| `metadata.referenceSystem` | the SRID the coordinates are transformed from | or `options.srid` when the file names a compound CRS the installation cannot transform |

Every row carries `source_code`: the city model the file comes from, a
`sources` row with its licence and attribution.

```ts
import { importCityJson, exportCityJson } from '@nexgen-os/cityjson';

await importCityJson(db, { organisationId, siteId }, file, { sourceCode: '3dbag', profile: 'residential' });
const out = await exportCityJson(db, { siteId }); // LoD 1 solid + LoD 2 surfaces, in the site's UTM zone
```

The export is a CityJSON 2.0 document with one `Building` per row: a LoD 1
`Solid` from the footprint and height (`building_volume()`), a LoD 2
`MultiSurface` from the roof and wall surfaces with their semantics, the
CityGML attributes from the columns and the file's own attributes back.
Importing it again gives the same building: same height, same footprint
area, same roof azimuths and tilts, same identifier and attributes. A
building already known to the organisation by its CityObject id is refused
by name (`already_imported`), never duplicated.

Left alone: CityObjects of other types (vegetation, roads, bridges —
reported in `skipped`), textures and materials, extensions.

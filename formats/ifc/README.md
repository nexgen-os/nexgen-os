# `@nexgen-os/ifc` — IFC → Nexgen OS

Reads the buildings of an [IFC](https://technical.buildingsmart.org/standards/ifc/)
model — IFC4 or IFC2x3, as a STEP file — into the core and the
`architecture` module. MIT, like every format library; the file is parsed by
[web-ifc](https://github.com/ThatOpen/engine_web-ifc) (MPL-2.0, WebAssembly),
which runs on Node as it is. IFC4 is tested on hand-written fixtures; IFC2x3
shares the attributes read here but has not been tested on a file yet.

| IFC | Nexgen OS | Notes |
|---|---|---|
| `IfcMapConversion` + `IfcProjectedCRS` | the transform from model metres to the projected CRS, then WGS 84 | site position at `rooftop` precision |
| else `IfcSite.RefLatitude` / `RefLongitude` / `RefElevation` | a transverse Mercator centred on the site's origin; north from the context's `TrueNorth`, else the site's X axis taken as east | site position at `parcel` precision |
| else `options.origin` | the same, from `{ lon, lat, rotationDeg, elevation }` | the site is left alone; without it, `georeference_missing` |
| `IfcUnitAssignment` | length and area factors | millimetres, feet and every SI prefix |
| `IfcBuilding` | one row of `buildings` | name, `ElevationOfRefHeight` (else the lowest storey) as `elevation_m`, height from the top of its geometry, floors above and below ground from its storeys, `year_built` from `Pset_BuildingCommon.YearOfConstruction` |
| ground-floor `IfcSlab` (`FLOOR`, `BASESLAB`), else exterior `IfcWall` boxes | `footprint` | union in plan; walls' holes filled; `footprint: 'none'` in the result without either |
| `IfcBuildingStorey` | `architecture.floors` | `level` 0 at the storey closest to the building's 0.00, `elevation_m`, `height_m` to the next storey |
| `IfcSpace` | `architecture.spaces`, kind `room` | name from `LongName`, else `Name`; `area_m2` from `Qto_SpaceBaseQuantities.NetFloorArea`, else `GrossFloorArea` |
| `IfcRoof`, `IfcSlab` `ROOF` | `surfaces` of kind `roof`, one per face that looks up | 3D polygon, azimuth against true north and tilt by `orientation()` of [`../geometry.ts`](../geometry.ts), shared with CityJSON |
| GlobalId | `external_ids`, scheme `ifc_guid` | on every row; a roof element with several faces names its first face |
| attributes, property sets, quantity sets | `metadata.ifc` of buildings, floors, spaces and surfaces | the building also keeps the file header, the units, the georeferencing block and the site |

Every row carries `source_code`: the model the file comes from, a `sources`
row with its licence and attribution.

```ts
import { importIfc } from './formats/ifc/index.js';

const r = await importIfc(db, { organisationId, siteId }, bytes, { sourceCode: 'architect_model' });
// r.georeference: 'map_conversion' | 'site_coordinates' | 'none'
// r.counts: { buildings, floors, spaces, roofs }; r.skipped: [{ entity, count, reason }]
```

A building already known to the organisation by its GlobalId is refused by
name (`already_imported`), never duplicated. Floors and spaces need the
`architecture` module; without it they are reported in `skipped`.

Left alone, and reported in `skipped` by entity type: every other product
(walls, doors, windows, furniture, vegetation, MEP…), type objects and
their property sets, materials, IFC2x3's `ePset_MapConversion`, and the
geometry of spaces.

## Writing IFC — a later step

This library reads only. Writing a site back out as IFC4 would need: a
GlobalId for rows that came from elsewhere (derived from their UUID, as
`docs/research/bim-3d.md` proposes), the spatial tree rebuilt from
`buildings`, `architecture.floors` and `architecture.spaces`, an
`IfcMapConversion` from the site's UTM zone, geometry for the building (an
extruded footprint) and its roof surfaces (`IfcPolygonalFaceSet`), and the
property sets in `metadata.ifc` written back as they came. web-ifc can write
STEP lines; the work is the mapping, and a round-trip test like CityJSON's.

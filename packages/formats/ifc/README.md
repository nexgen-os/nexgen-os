# `@nexgen-os/ifc` — IFC → plain shapes

Reads the buildings of an [IFC](https://technical.buildingsmart.org/standards/ifc/)
model — IFC4 or IFC2x3, as a STEP file — into plain shapes, every
coordinate in metres in the reference system the model is placed in. MIT;
the file is parsed by [web-ifc](https://github.com/ThatOpen/engine_web-ifc)
(MPL-2.0, WebAssembly), which runs on Node as it is, its one dependency.
IFC4 is tested on hand-written fixtures; IFC2x3 shares the attributes read
here but has not been tested on a file yet.

| IFC | `IfcModel` | Notes |
|---|---|---|
| `IfcMapConversion` + `IfcProjectedCRS` | `georeference` `map_conversion`: the transform from model metres to the projected CRS (`srid`) | |
| else `IfcSite.RefLatitude` / `RefLongitude` / `RefElevation` | `site_coordinates`: a transverse Mercator centred on the site's origin (`proj`); north from the context's `TrueNorth`, else the site's X axis taken as east | |
| else `options.origin` | `none`: the same, from `{ lon, lat, rotationDeg, elevation }` | without it, `georeference_missing` |
| `IfcUnitAssignment` | `units`: length and area factors | millimetres, feet and every SI prefix |
| `IfcSite` | `site`: its origin and its description | |
| `IfcBuilding` | `IfcBuilding` | name, `ElevationOfRefHeight` (else the lowest storey) as `elevation`, `height` to the top of its geometry, `yearOfConstruction` from `Pset_BuildingCommon` as the file says it |
| ground-floor `IfcSlab` (`FLOOR`, `BASESLAB`), else exterior `IfcWall` boxes | `footprint`: its `source` and plan pieces to union | `none` without either |
| `IfcBuildingStorey` | `floors` | `level` 0 at the storey closest to the building's 0.00, `elevation`, `height` to the next storey |
| `IfcSpace` | `rooms` of its floor, else of the building | name from `LongName`, else `Name`; `height` from `Qto_SpaceBaseQuantities.Height`; `area` from `NetFloorArea`, else `GrossFloorArea`, in m² |
| `IfcRoof`, `IfcSlab` `ROOF` | `roofs`, one per face that looks up | rings counter-clockwise seen from above; the element's GlobalId on its first face |
| every other product | `products` | class, `PredefinedType`, name, manufacturer and model (`Pset_ManufacturerTypeInformation`), serial number (`Pset_ManufacturerOccurrence`), position, the building and the room that contain it |
| attributes, property sets, quantity sets | `description` of every shape | with the file header (`header`) |

```ts
import { readIfc } from '@nexgen-os/ifc';

const model = await readIfc(bytes); // { georeference, units, site, buildings, products, skipped }
```

Refuses by name `not_ifc`, `invalid_ifc` (a building without a GlobalId),
`crs_unknown` (a map conversion whose CRS is not an EPSG code) and
`georeference_missing`. What it never does: decide which device type an IFC
class is, transform to WGS 84, compute an azimuth, open a connection.

Into Nexgen OS, `importIfc()` of `@nexgen-os/core` writes the shapes
through the gestures of the core: the site placed by `locate_site()` at
`rooftop` precision with a map conversion, `parcel` with the site's
coordinates, when it had no position or a coarser one; the building by
`add_building()` (footprint unioned in WGS 84, walls' holes filled), its
year by `set_attribute()`; floors and rooms by `add_space()`, a room's
area as the attribute `floor_area`; roof faces by `add_surface()` with
azimuth against true north and tilt; each product whose class a device
type names (`device_types.ifc_class`: `IfcSolarDevice`,
`IfcElectricFlowStorageDevice`, `IfcFlowMeter`, `IfcBoiler`…) by
`install_device()` — a class several types share told apart by
`PredefinedType` (`BATTERY` → `battery`), else the type they all refine
(`IfcElectricGenerator` → `generator`), else skipped; every GlobalId by
`add_identifier()`, scheme `ifc_guid`. A building already known to the
organisation by its GlobalId is refused (`already_imported`).

Left alone, and reported in `skipped` by entity type: every other product
(walls, doors, windows, furniture, vegetation, the MEP no device type
names…), type objects and
their property sets, materials, IFC2x3's `ePset_MapConversion`, and the
geometry of spaces.

## Writing IFC — a later step

This library reads only. Writing a site back out as IFC4 would need: a
GlobalId for rows that came from elsewhere (derived from their UUID, as
`docs/research/bim-3d.md` proposes), the spatial tree rebuilt from
`buildings` and `spaces`, an
`IfcMapConversion` from the site's UTM zone, geometry for the building (an
extruded footprint) and its roof surfaces (`IfcPolygonalFaceSet`), and the
property sets in `metadata.ifc` written back as they came. web-ifc can write
STEP lines; the work is the mapping, and a round-trip test like CityJSON's.

# `@nexgen-os/grb` — the buildings of a place in Flanders, from open data

Two open services of Digitaal Vlaanderen describe what is built in Flanders.
The Large-scale Reference Database (GRB) draws every building on the ground
(layer `GBG`), each with a persistent object id; the Digital Height Model of
Flanders II (DHM Vlaanderen II) gives, at 1 m, the surface the airborne laser
saw — roofs and trees — and the terrain under it. This connector reads both
and answers a CityJSON model in Belgian Lambert 72 (EPSG:31370) that the
`building` module imports as the buildings of a participant. MIT; open, no
key. Sources `grb` and `dhmv`, shipped with the package (`sources.json`).

```ts
import { registerSource } from '@nexgen-os/core';
import { grbSources, siteModel } from '@nexgen-os/grb';
import { importCityJson } from './modules/building/src/index.js'; // the building module

for (const row of grbSources) await registerSource(db, row);
const model = await siteModel({ lon: 3.72125, lat: 51.05494, radiusM: 30 });
await importCityJson(db, { participantId }, model, { sourceCode: 'grb', use: 'residential' });
```

Each building lands with:

| What | From |
|---|---|
| footprint, in WGS 84 | the GRB polygon, every hole kept |
| `elevation_m` | the median of the terrain model under the footprint, above the Ostend datum (TAW) |
| `height_m` | the ridge above that ground |
| `global_id` | `GRB.GBG.<OIDN>`, the persistent object id, the same across versions of the building |
| `metadata.cityjson.attributes.grb` | the version (`UIDN`), the type GRB gives (`hoofdgebouw`, `bijgebouw`…), the dates of the version and of the survey |
| `metadata.cityjson.attributes.heights` | ground, eave and ridge, the cells they were read from and the percentiles used |

## The heights of a footprint

`heightsInFootprint(polygons, surface, terrain, percentiles)` reads the cells
of both models whose centre lies inside the footprint and where both have a
value: the ground is the median of the terrain, the eave and the ridge two
percentiles of the surface, each above that ground, linear between cells.
The percentiles are data (`{ eave: 10, ridge: 99 }` by default): the 99th
keeps a chimney or an antenna from raising the ridge, the 10th keeps the
cells of a gutter overhanging the street out of the eave. A footprint the
grid does not cover keeps no height and is listed in `skipped`.

What the model does not say: the shape of the roof (no faces are written;
`building.surfaces` waits for a roof model or a survey), a tree over a roof
(it counts as roof), and a building built or demolished after the laser
flight (DHM Vlaanderen II was flown in 2013–2015) — `grb.survey_date` and the
heights then disagree, and the heights are the ones to check.

## The pieces

- `grb({ fetch?, baseUrl?, limit? }).buildings({ lon, lat, radiusM })` — the
  GRB footprints whose outline meets the box around the point; refuses
  `too_many_buildings` past `limit` (500) rather than return part of a place.
- `dhmv({ fetch?, baseUrl?, maxCells? }).grid('surface' | 'terrain', box)` —
  one model over a box in Lambert 72, as a `Raster`; refuses `area_too_large`
  past 4 000 000 cells.
- `readGeoTiff(bytes)` — the TIFF of a coverage answer (the second part of
  the multipart answer of WCS 2.0, or a plain file): one band of uncompressed
  32-bit floats, in strips or tiles, either byte order, placed by its pixel
  scale and tie point, no-data as `NaN`; anything else is refused
  `tiff_unsupported`.
- `siteModel(area, { percentiles?, fetch? })` — all of it, as a `CityModel`.

Refusals by name: `radius_required`, `too_many_buildings`, `area_too_large`,
`grb_unavailable`, `dhmv_unavailable`, `grid_mismatch`, `tiff_not_found`,
`tiff_unsupported`.

Licence of the data: Modellicentie Gratis Hergebruik, attribution « © Digitaal
Vlaanderen — GRB » and « © Digitaal Vlaanderen — DHM Vlaanderen II ». The
recorded answers under `tests/fixtures` are two buildings of a street in
Ghent and the two models over their box, kept under the same licence.

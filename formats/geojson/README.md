# `@nexgen-os/geojson` — Nexgen OS → GeoJSON

Writes a site, or every site taking part in a project, as one
[GeoJSON](https://www.rfc-editor.org/rfc/rfc7946) FeatureCollection: the
format every web map, every GIS and every open-data portal reads. The
places and the figures computed on them travel together, so that a
scenario can be shown to the people it concerns. MIT, like every format
library.

```ts
import { exportGeoJson } from './formats/geojson/index.js';

const fc = await exportGeoJson(db, { siteId });                         // everything the user may read
const open = await exportGeoJson(db, { projectId }, { open: true });    // what may be published
const variant = await exportGeoJson(db, { siteId }, { scenarioId });    // a design variant over reality
```

## What goes out

| Nexgen OS | Feature | Properties |
|---|---|---|
| the project (`projectId`) | its perimeter, first | `kind: "project"`, `project_kind`, `country`, `status`, `start_date`, `end_date` |
| each site | its parcel or point | address fields, `municipality_code`, `time_zone`, `location_precision`, `location_source_code`, `profile` |
| each building | its footprint | `site_id`, `elevation_m`, `height_m`, floors, `year_built`, `status`, `source_code` |
| each surface | its face, or `null` | `surface_kind`, `site_id`, `building_id`, `azimuth_deg`, `tilt_deg`, `material`, `source_code` |
| each device | its point or area, or `null` | `device_type`, `site_id`, `building_id`, `surface_id`, `manufacturer`, `model`, `rated_power_kw`, `unit_count`, `status`, `installation_date` |

Every feature also carries its `attributes` (read by `attributes_of()` at
the moment asked, in the scenario asked), its `external_ids` and the `runs`
computed on it: module, engine version, inputs hash, finish time and
results, exactly as `record_run()` kept them. The export computes nothing.

- Coordinates: WGS 84 longitude, latitude and height in metres, seven
  decimals (about a centimetre); outer rings counter-clockwise, holes
  clockwise (RFC 7946 §3.1.6); a `bbox` around every position.
- Feature `id`: the object's identifier in Nexgen OS.
- A foreign member, `nexgen_os`, says what the document is: the schema
  version, the scenario, the moment, whether it is open, every source drawn
  on with its licence and attribution, and how many objects were withheld.
- The same database gives the same document: no export time inside it.

## The open export

`open: true` is the document meant for the public — a citizens' portal, a
consultation, an open-data catalogue:

- the street lines of an address go (`street`, `address_extra`); the postal
  code, the city and the municipality stay;
- serial numbers and `metadata` go;
- an object described by a source whose licence forbids passing it on
  (`sources.redistributable = false`) is withheld, with everything on it;
  a site placed by such a source keeps its address and loses its shape;
- attributes and identifiers from such a source go;
- the runs stay: a scenario shown to the public is its figures beside its
  places.

Whoever publishes still reads the document first: names of sites and
buildings are written by people and may name people.

## What it refuses

Every refusal starts with its name: `target_required` (a `siteId` or a
`projectId`, not both), `site_not_found`, `project_not_found` (absent, or
not readable under row level security), `scenario_not_found`.

Not yet: reading GeoJSON back in, meters and participants, series.

# `@nexgen-os/geojson` — GeoJSON ⇄ plain features

[GeoJSON](https://www.rfc-editor.org/rfc/rfc7946) is the format every web
map, every GIS and every open-data portal reads, and the one interchange
format of places in Nexgen OS
([0025](../../../docs/decisions/0025-a-place-has-one-shape.md)). This
library declares the shapes of RFC 7946, writes features as one
FeatureCollection with its `bbox` and the foreign members a writer adds, and
reads a document — a FeatureCollection, a Feature or a bare geometry — back
into features. MIT; no dependency, no database, no network.

```ts
import { readGeoJson, writeGeoJson } from '@nexgen-os/geojson';

const fc = writeGeoJson(features, { source: { code: 'urbis' } }); // type, bbox, features, then the members
const { features, members, warnings } = readGeoJson(text);
```

`readGeoJson()` reports a member that is not a feature (`not_a_feature`)
and a geometry of no RFC 7946 type (`geometry_unknown`) in `warnings` and
keeps the rest; it refuses by name what is not GeoJSON (`not_geojson`). What
it never does: transform or round coordinates, rewind a polygon, open a
connection.

## The export of a participant or a project

`exportGeoJson()` of `@nexgen-os/core` writes a participant, or every
participant taking part in a project, as one FeatureCollection through `writeGeoJson()`: the
places and the figures computed on them travel together, so that a study
can be shown to the people it concerns.

```ts
import { exportGeoJson } from '@nexgen-os/core';

const fc = await exportGeoJson(db, { participantId });                  // everything the user may read
const open = await exportGeoJson(db, { projectId }, { open: true });    // what may be published
```

### What goes out

| Nexgen OS | Feature | Properties |
|---|---|---|
| the project (`projectId`) | its perimeter, first | `kind: "project"`, `project_kind`, `country`, `status`, `start_date`, `end_date` |
| each participant with a place | its point or outline | `project_id`, `role`, `status`, address fields, `time_zone`, `location_precision`, `location_source_code`; the municipality code among its identifiers |
| its ground, with the `building` module | its parcel, or `null` | `kind: "site"`, `participant_id`, `use`, `area_m2`, `global_id`, `source_code` |
| each building, with the `building` module | its footprint | `participant_id`, `site_id`, `use`, `elevation_m`, `height_m`, `year_built`, `floors_above_ground`, `floors_below_ground`, `floor_area_m2`, `energy_label`, `status`, `global_id`, `source_code` |
| each surface, with the `building` module | its face, or `null` | `surface_kind`, `participant_id`, `site_id`, `building_id`, `azimuth_deg`, `tilt_deg`, `area_m2`, `material`, `u_value`, `is_external`, `global_id`, `source_code` |
| each device | `null`: a device is not placed | `device_type`, `participant_id`, `manufacturer`, `model`, `rated_power_kw`, `unit_count`, `status`, `installation_date`, `source_code` |

Every feature also carries its `attributes` (read by `attributes_of()` at
the moment asked) and its `identifiers` — an object of the core only has
them — and the `calculations` every installed module computed on it (each
module's table of them, `solar.estimates`, `community.settlements`…):
module, table, provenance, last update and results, exactly as the module
keeps them. The export computes nothing.

- Coordinates: WGS 84 longitude, latitude and height in metres, seven
  decimals (about a centimetre); outer rings counter-clockwise, holes
  clockwise (RFC 7946 §3.1.6); a `bbox` around every position.
- Feature `id`: the object's identifier in Nexgen OS.
- A foreign member, `nexgen_os`, says what the document is: the schema
  version, the moment, whether it is open, every source drawn
  on with its licence and attribution, and how many objects were withheld.
- The same database gives the same document: no export time inside it.

### The open export

`open: true` is the document meant for the public — a citizens' portal, a
consultation, an open-data catalogue:

- the street lines of an address go (`street`, `address_extra`); the postal
  code, the city and the municipality stay;
- serial numbers and the `metadata` of a described object go;
- an object described by a source whose licence forbids passing it on
  (`sources.redistributable = false`) is withheld, with everything on it;
  a participant placed by such a source keeps its address and loses its shape;
- attributes and identifiers from such a source go;
- the calculations stay: a study shown to the public is its figures beside its
  places.

Whoever publishes still reads the document first: names of participants and
buildings are written by people and may name people.

### What it refuses

Every refusal starts with its name: `target_required` (a `participantId` or a
`projectId`, not both), `participant_not_found`, `project_not_found` (absent, or
not readable under row level security).

Not yet: importing GeoJSON places into participants, meters, series.

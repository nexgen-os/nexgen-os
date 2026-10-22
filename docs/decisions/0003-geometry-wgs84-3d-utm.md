# 0003 — Geometry is stored in WGS 84 in 3D, and measured in UTM

> Status: accepted

## Context

National grids differ by country (Lambert 72 and 2008, Lambert 93, the
Dutch RD, the many UTM and Gauss-Krueger zones), and a core that stored one
of them would name a country. WGS 84 is the exchange system of GeoJSON,
CityJSON, 3D Tiles and every web map. Measured in degrees, though, an area
or a length is meaningless; it needs a metric projection that holds
anywhere on earth.

## Decision

**Every geometry is stored in EPSG:4326, with Z in metres above sea
level.** A geometry given in any other reference system is transformed on
the way in; one given without its reference system is refused by name
(`crs_required`) rather than assumed.

**A length, an area or a volume is measured in the UTM zone of the shape.**
One function of the core chooses the zone from the geometry itself; areas
are right within a fraction of a percent at building and district scale,
everywhere.

**A geometry in the database is a shape, not a model.** Footprints, roof
faces, points and parcels are rows; a point cloud, a mesh, a BIM file, a
raster or a tileset is a file on object storage that a row points to
([0008](0008-the-building-module-describes-what-is-built.md)).

## What it forbids

- A national reference system, or any projected system, as the stored
  geometry of the core or of a module.
- A default reference system for an input that does not say its own.
- An area or a length computed in degrees, or in a projection chosen by
  country.

## See also

- [0008](0008-the-building-module-describes-what-is-built.md) — heavy geometry stays in object storage.
- [0025](0025-a-place-has-one-shape.md) — the point of a place, in WGS 84.
- [0035](0035-a-format-library-touches-no-database.md) — the libraries
  transform on the way in.

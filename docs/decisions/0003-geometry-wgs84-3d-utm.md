# 0003 — Geometry in WGS 84, three-dimensional, measured in UTM

**Decided 12/10/2026.**

Every geometry is stored in EPSG:4326 with Z in metres above sea level. Input
in any CRS is transformed on the way in. Metric computations project to the
UTM zone of the shape (`metric_srid`).

**Why.** National grids differ by country, and the core names none. WGS 84 is
the exchange CRS of GeoJSON, CityJSON, 3D Tiles and every web map. UTM gives
areas within a fraction of a percent at building and district scale, anywhere
on earth.

**Not in Postgres.** Point clouds (COPC), meshes (glTF), BIM files (IFC),
rasters (COG), 3D Tiles and videos stay in object storage. A representation
row points to them, with their source and capture date.

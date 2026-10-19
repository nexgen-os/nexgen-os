# `packages/formats/` — one MIT library per format

Readers and writers between the core model and the formats the trades use:
IFC, CityJSON, GeoJSON, 3D Tiles, glTF, COPC point clouds, gbXML, metering
data exchanges. Organised by format, never by country; each library has its
own tests and can be used without Nexgen OS.

Each library is an npm package of its own, `@nexgen-os/<format>`, with its
`package.json`, `LICENSE` and `README`; none is published yet. They import the
shared database seam and geometry from [`@nexgen-os/core`](../core/README.md).
The geocoders are not formats: they speak to services, which are sources, and
live with the [connectors](../connectors/README.md).

## Shipped

| Library | Maps | Round trip |
|---|---|---|
| [`homeassistant`](homeassistant/README.md) | floors, areas, devices, entities and recorder states ⇄ spaces (floors and rooms), devices, series of devices | tested, no field lost |
| [`cityjson`](cityjson/README.md) | CityJSON 2.0 buildings (3DBAG, UrbIS, converted CityGML) ⇄ buildings, footprints, roof and wall surfaces, identifiers, attributes | tested: the export lands the same way when imported again |
| [`panond`](panond/README.md) | PVsyst PAN (module) and OND (inverter) files → `device_directory` products with their physics: the `pvsyst` one-diode model in pvlib's keys, the inverter's efficiency curves | import only; the model gives back the file's Isc, Voc and nominal power |
| [`ifc`](ifc/README.md) | IFC4 and IFC2x3 buildings, storeys, spaces, roofs, GlobalIds, property sets → buildings, floors, spaces, roof surfaces, identifiers, `metadata.ifc`; placed by `IfcMapConversion` or the site's coordinates | import only; writing IFC is a later step |
| [`weather-files`](weather-files/README.md) | EPW and TMY3 hourly weather (typical or real years) ⇄ `ghi`, `dni`, `dhi`, `temperature`, `wind_speed` series dated at their start in UTC; the hours checked against solar noon | tested: an EPW written from the series reads back the same |
| [`geojson`](geojson/README.md) | a site or a project's sites ⇄ a GeoJSON FeatureCollection: perimeter, sites, buildings, surfaces, devices with their attributes, identifiers and runs; the sources owed; an open variant without street lines and closed sources | export only; tested on example 4 |
| [`parquet`](parquet/README.md) | series ⇄ Parquet files of the files door (series, instant in UTC, value, quality), written on the client from `export_rows()`, or by `pg_parquet` / `pg_duckdb` where the server has one | export only; tested: the file reads back row for row |

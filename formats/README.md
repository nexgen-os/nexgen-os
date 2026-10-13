# `formats/` — one MIT library per format

Readers and writers between the core model and the formats the trades use:
IFC, CityJSON, GeoJSON, 3D Tiles, glTF, COPC point clouds, gbXML, metering
data exchanges. Organised by format, never by country; each library has its
own tests and can be used without Nexgen OS.

No library is published yet. `geocoding` is the one library here that is
not a format: it speaks to geocoders, which are sources, with the same
rule — one adapter per service, usable without Nexgen OS.

## Shipped

| Library | Maps | Round trip |
|---|---|---|
| [`homeassistant`](homeassistant/README.md) | floors, areas, devices, entities and recorder states ⇄ floors, spaces, devices, sensors, series | tested, no field lost |
| [`geocoding`](geocoding/README.md) | an address ⇄ a point, with precision and source, on Nominatim and Photon; any other geocoder as an adapter of the same shape | tested on recorded answers |
| [`cityjson`](cityjson/README.md) | CityJSON 2.0 buildings (3DBAG, UrbIS, converted CityGML) ⇄ buildings, footprints, roof and wall surfaces, identifiers, attributes | tested: the export lands the same way when imported again |
| [`ifc`](ifc/README.md) | IFC4 and IFC2x3 buildings, storeys, spaces, roofs, GlobalIds, property sets → buildings, floors, spaces, roof surfaces, identifiers, `metadata.ifc`; placed by `IfcMapConversion` or the site's coordinates | import only; writing IFC is a later step |

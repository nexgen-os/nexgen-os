# `formats/` — one MIT library per format

Readers and writers between the core model and the formats the trades use:
IFC, CityJSON, GeoJSON, 3D Tiles, glTF, COPC point clouds, gbXML, metering
data exchanges. Organised by format, never by country; each library has its
own tests and can be used without Nexgen OS.

No library is published yet.

## Shipped

| Library | Maps | Round trip |
|---|---|---|
| [`homeassistant`](homeassistant/README.md) | floors, areas, devices, entities and recorder states ⇄ floors, spaces, devices, sensors, series | tested, no field lost |

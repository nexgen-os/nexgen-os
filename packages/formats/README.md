# `packages/formats/` — one MIT library per format

One npm package per file format, `@nexgen-os/<format>`, organised by format
and never by country: which formats a place uses is said by its data, never
by this directory ([0035](../../docs/decisions/0035-a-format-library-touches-no-database.md)).

Each package:

- has its own `LICENSE` (MIT), `package.json`, `README` and tests on its own
  fixtures, and can be used without Nexgen OS;
- imports nothing from Nexgen OS, opens no database connection and calls no
  network, and declares the plain shapes it reads and writes in its own
  types (`scripts/hygiene.mjs` checks it);
- carries what the file says, in the file's units and conventions,
  converted only where the format defines the conversion; reports what it
  cannot read, by name, and never corrects it.

Writing what a file holds into the model is an importer's job, in
[`@nexgen-os/core`](../core/README.md) (`src/files/`) or in the module whose
tables it fills; an exporter reads the rows back into the same shapes.

| Package | Format | Reads | Writes | Importer, exporter |
|---|---|---|---|---|
| [`homeassistant`](homeassistant/README.md) | Home Assistant registries and recorder states | floors, areas, devices, entities, states → spaces, devices, points, readings | the snapshot, no field lost | `importHomeAssistant`, `exportHomeAssistant` (`modules/building/src`) |
| [`cityjson`](cityjson/README.md) | CityJSON 2.0 (3DBAG, UrbIS, converted CityGML) | Buildings and their parts: attributes, footprint faces, semantic surfaces | LoD 1 solid, LoD 2 surfaces, attributes | `importCityJson`, `exportCityJson` (`modules/building/src`) |
| [`ifc`](ifc/README.md) | IFC4, IFC2x3 | buildings, storeys, spaces, roof faces, equipment, placed by the map conversion or the IfcSite's coordinates | — | `importIfc` (`modules/building/src`) |
| [`geojson`](geojson/README.md) | GeoJSON (RFC 7946) | features of a collection, a feature, a geometry | a FeatureCollection with its bbox | `exportGeoJson`, `importGeoJsonParticipants` (core) |
| [`weather-files`](weather-files/README.md) | EPW, TMY3 | hourly series dated at their start in UTC | EPW | `importWeatherFile`, `exportWeatherYear` (core) |
| [`parquet`](parquet/README.md) | Parquet | — | series rows | `exportSeriesParquet` (core) |
| [`ocpp`](ocpp/README.md) | OCPP 1.6J and 2.0.1 frames (Open Charge Alliance) | station identity, connector states, meter values, sessions, charging profiles and their answers | a schedule as `SetChargingProfile` | `importStationLog` (`modules/charging/src`) |
| [`panond`](panond/README.md) | PVsyst PAN, OND | a module's one-diode model, an inverter's curves | — | `importProduct` (`modules/solar/src/products.ts`) |
| [`enedis-r6x`](enedis-r6x/README.md) | Enedis R63 (load curve) and R64 (index), JSON and XML | active and reactive power, voltage, index dials, each step at its start in UTC from the operator's legal time, quality letters by the caller's table | — | `collectMeterReadings` (core), through the connectors `switchgrid` and `enedis-sge` |
| [`energy-bill`](energy-bill/README.md) | An energy bill: an EN 16931 invoice (`ReceivedInvoice` of `@ekwo-ai/factur-x`) and its energy facts | meter, consumption period, kWh per band, prices by band and season, network, taxes, totals reconciled | — | `importEnergyBill` (core), `estimateFromBill` (`modules/consumption/src`) |

The geocoders are not formats: they speak to services, which are sources,
and live with the [connectors](../connectors/README.md).

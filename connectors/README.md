# `connectors/` — reading the outside world

A **source** (a vocabulary row) says what exists out there. A **connection**
(a core row) says that an organisation reads it, for what, with which
credential by name. A **connector** is the code in between: a library that
implements one of the interfaces in [`index.ts`](index.ts) and answers in the
core's terms, so that what it brings back lands on ordinary objects,
attributes, documents and series, each carrying its source. Decision
[0011](../docs/decisions/0011-external-data.md).

| Interface | Answers with | Lands on |
|---|---|---|
| `WeatherProvider` | forecast (with its issue time) and history of weather quantities at a point | `series` of kind `forecast` on the site → `forecast_values`; history → `series_values` |
| `MeterDataProvider` | readings of a meter from a grid operator's hub, by identifier and scheme | `series` of kind `measured` on the meter → `series_values` |
| `PlacesProvider` | places around a point, with their external identifier, address and attributes | `sites` / `buildings`, `external_ids`, `attributes` with `source_code` |
| `Geocoder` (in `formats/geocoding`) | an address ⇄ a point | the site's address and point, with precision and source |

`storeSeries(db, target, series, { issuedAt })` writes what a weather or
meter connector returned: the series is found or created on the object, and
the values go to the store of their kind.

## Shipped

| Connector | Source | Licence |
|---|---|---|
| [`open-meteo`](open-meteo/index.ts) | `open_meteo` — hourly forecast of temperature and irradiance, and history from the ERA5 archive (irradiance on a plane, temperature, wind speed), worldwide | data CC BY 4.0; the free API is for non-commercial use, a paid plan otherwise |
| [`pvgis`](pvgis/index.ts) | `pvgis` — hourly energy, in-plane irradiance and temperature of a PV system over whole years (seriescalc), and its multi-year yield (PVcalc); azimuth from true north turned into PVGIS's aspect from south, hours dated at their start in UTC | free, no key, no restriction on use |

## Private connectors

The interfaces are the contract. A connector whose data is not open — a
commercial map or solar provider, a licensed register, a company's own data
service — is a private package that implements the same interface, ships
its `sources` rows with their licence and retention, and is listed in the
installation's configuration. The core and the pages never import it; the
data it writes says where it came from, so licence and attribution follow
the data, and `sources.retention_days` says when a cache expires.

## Planned: dashboards, warehouses and streams

Grafana, Power BI, Spark, InfluxDB, Kafka and MQTT come through three doors
— SQL, Parquet files, one message shape over a stream — and none of them gets
a copy of the model. The pieces and their order are in
[decision 0014](../docs/decisions/0014-integrations-dashboards-warehouses-streams.md):
`formats/parquet`, `formats/influx-line-protocol`, `formats/grafana`,
`connectors/mqtt`, `connectors/kafka`, and two flat views for BI tools.

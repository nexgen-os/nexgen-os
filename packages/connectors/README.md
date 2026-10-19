# `packages/connectors/` — reading the outside world

A **source** (a vocabulary row) says what exists out there. A **connection**
(a core row) says that an organisation reads it, for what, with which
credential by name. A **connector** is the code in between: a library that
implements one of the interfaces of [`@nexgen-os/core`](../core/src/connectors.ts) and answers in the
core's terms, so that what it brings back lands on ordinary objects,
attributes, documents and series, each carrying its source. Decision
[0011](../../docs/decisions/0011-external-data.md).

| Interface | Answers with | Lands on |
|---|---|---|
| `WeatherProvider` | forecast (with its issue time) and history of weather quantities at a point | `series` of kind `forecast` on the site, every issue kept; history as `measured` or `simulated` values |
| `MeterDataProvider` | readings of a meter from a grid operator's hub, by identifier and scheme | `series` of kind `measured` on the meter |
| `PlacesProvider` | places around a point, with their external identifier, address and attributes | `sites` / `buildings`, `external_ids`, `attributes` with `source_code` |
| `Geocoder` (in [`@nexgen-os/core`](../core/src/address.ts)) | an address ⇄ a point | the site's address and point, with precision and source |

`storeSeries(db, target, series, { issuedAt })` writes what a weather or
meter connector returned through `store()`, the one write path of the core:
the series is found or created once on the object (another value kind or
step is refused by name), the values are converted from `series.unit` by
the core's `units` vocabulary, keep their quality, and a forecast keeps its
issue time.

One package per service, `@nexgen-os/<service>`, MIT, with its own `package.json`
and `README`; the interfaces, the standard shape of a place and `storeSeries()` come
from `@nexgen-os/core`. [`series.ts`](../core/src/series.ts) types the same calls for any TypeScript client:
`store()`, `seriesEnsure()`, and the reads `resample()`, `window()`,
`latest()`, `fill()`, `coverage()`, `forecastAt()`, `exportRows()`,
`convertUnit()` — each one call of the SQL function of the same name.

## Shipped

| Connector | Source | Licence |
|---|---|---|
| [`open-meteo`](open-meteo/README.md) | `open_meteo` — hourly forecast of temperature and irradiance, and history from the ERA5 archive (irradiance on a plane, horizontal components `ghi`, `dni`, `dhi`, temperature, wind speed), worldwide | data CC BY 4.0; the free API is for non-commercial use, a paid plan otherwise |
| [`pvgis`](pvgis/README.md) | `pvgis` — hourly energy, in-plane irradiance and temperature of a PV system over whole years (seriescalc), and its multi-year yield (PVcalc); azimuth from true north turned into PVGIS's aspect from south, hours dated at their start in UTC | free, no key, no restriction on use |
| [`nominatim`](nominatim/README.md) | `nominatim` — an address ⇄ a point on OpenStreetMap, worldwide, ISO 3166-2 regions | ODbL; the public instance wants a named user agent and one request per second |
| [`photon`](photon/README.md) | `photon` — search as you type on OpenStreetMap, worldwide | ODbL; no country filter on the server, applied on the answers |
| [`ban`](ban/README.md) | `ban` — Base Adresse Nationale, France, house-number precision | Licence Ouverte 2.0; no key |
| [`geopunt`](geopunt/README.md) | `geopunt` — the Flemish address register | open; no key |
| [`urbis`](urbis/README.md) | `urbis` — the Brussels address register | open; no key |
| [`icar`](icar/README.md) | `icar` — the Walloon address register | open; no key |

A national address register is a connector of the same shape, as code never
belongs in a pack: the pack names the register as a source. One connector per
region when a country keeps one register per region (`BE-VLG`, `BE-BRU`,
`BE-WAL`). `geocoderFor({ national, fallback, commercial })` of
`@nexgen-os/core` chains them: the register of the country or its regions
first, the open fallback next, the commercial one last; each place says which
one answered ([decision 0009](../../docs/decisions/0009-addresses-and-geocoding.md)).

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
[decision 0014](../../docs/decisions/0014-integrations-dashboards-warehouses-streams.md):
`packages/formats/parquet`, `formats/influx-line-protocol`, `formats/grafana`,
`connectors/mqtt`, `connectors/kafka`, and two flat views for BI tools.

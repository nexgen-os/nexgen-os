# 0014 — Integrations: dashboards, warehouses and streams through three doors

**Decided 13/10/2026.** Builds on [0007](0007-series-at-scale.md) (plain Postgres, Parquet cold tier, one read API) and [0011](0011-external-data.md) (connectors, `CollectedSeries`).

## Context

An energy community, a building portfolio or a research group already has its tools: Grafana on a screen in the plant room, Power BI in the finance department, InfluxDB fed by Home Assistant, Spark or pandas in the lab, Kafka between the meter gateways and the back office. Nexgen OS must sit among them without asking anyone to abandon one, and without keeping a second copy of its model anywhere.

## Decision

The core offers **three doors**, and every integration uses one of them. No integration gets its own tables, its own vocabulary or its own copy of the data.

| Door | What it is | Who comes through |
|---|---|---|
| **SQL** | the Postgres wire protocol, row level security on, `resample()` and the rollups as the read API | Grafana, Power BI, Metabase, Superset, any JDBC/ODBC client |
| **Files** | Parquet (Arrow), the format of the cold tier of 0007: one file per week, sorted by series and time, zstd | Spark, DuckDB, pandas, InfluxDB 3, a data lake |
| **Stream** | one message shape, the `CollectedSeries` envelope of the connectors, over Kafka or MQTT; outbound by change data capture from the write-ahead log | Kafka, MQTT brokers, Home Assistant, IoT gateways |

### The SQL door

- **Grafana.** The Postgres data source needs nothing from us. What we add is `formats/grafana`: a format library that writes a dashboard as Grafana's JSON from the objects of a site or a project (one row per meter, one panel per quantity, the site's time zone, `resample()` in every query), and reads one back to know which series a dashboard shows. Provisioning files, not a plugin.
- **Power BI.** The Postgres connector works in Import and in DirectQuery. What a BI tool wants is flat and wide: the core adds two views, `series_daily` and `series_monthly` (series, object, site, quantity, bucket, value, in the site's time zone), built on the rollups so that a year of a portfolio is one small query. Power BI can also read the Parquet files of the cold tier from a lake; that is the files door.
- **A read role.** Each dashboard connects as a database role that carries the organisation it may see; the policies decide, as for any other reader. No dashboard connects as the owner.

### The files door

- **Parquet is the lingua franca.** The cold tier already writes it; `formats/parquet` writes any `resample()` answer or any raw range the same way, and reads a Parquet file of series back into the core with its provenance. One schema, documented in the library: `series_id`, `at` (UTC), `value`, `quality`.
- **Spark, DuckDB, pandas** read those files directly, from S3 or a disk; a Spark job needs no connector of ours. JDBC to Postgres remains for the small, live part.
- **InfluxDB.** Version 3 is Parquet-native: the files door. Versions 1 and 2 speak the line protocol, which is what Home Assistant, Node-RED and Telegraf write; `formats/influx-line-protocol` reads and writes it, both directions, because for many sites the history *is* in an InfluxDB and the first job is to bring it in.

### The stream door

- **One message shape.** A stream carries the same `CollectedSeries` envelope the connectors use — `{ contract: 1, source_code, object (external id and scheme), quantity_code, value_kind, unit, values: [{ at, value, quality? }] }` — as JSON, or as Avro with a schema registry when the broker has one. One schema, versioned, as the engines' contract is.
- **Inbound, Kafka and MQTT.** `connectors/kafka` and `connectors/mqtt` consume topics of readings and hand them to `storeSeries`, with the external id resolved to an object through `external_ids`, the same path as a file import. MQTT comes first: it is where meters and sensors actually arrive (Home Assistant discovery, SensorThings MQTT, most gateways); Kafka is its big sibling in a utility's back office.
- **Outbound, change data capture.** New rows of `series_values` and changes of objects leave through logical replication (`pgoutput` or `wal2json`), read by Debezium or by Supabase Realtime, which are the same mechanism; the topic naming (`nexgen.series_values`, `nexgen.objects`) and the message shape are documented, the core ships the publication, and nothing of ours runs inside the broker.

## Order

| Piece | Door | Licence | When |
|---|---|---|---|
| `series_daily`, `series_monthly` views | SQL | AGPL (core) | with the rollups of 0007 |
| `formats/parquet` | files | MIT | with the cold tier of 0007 |
| `formats/influx-line-protocol` | files | MIT | first site with an InfluxDB history |
| `connectors/mqtt` | stream | MIT | first site with a gateway |
| `formats/grafana` | SQL | MIT | first community screen |
| `connectors/kafka` + the CDC publication | stream | MIT / AGPL | first utility integration |
| Power BI guide (connector, views, DirectQuery) | SQL | docs | with the views |

## What stays out

- No copy of the model in another database: no MongoDB, no InfluxDB "as the store", no dedicated time-series engine. 0007 says why.
- No proprietary SDK in the core: a door is a protocol or a file format, never a vendor library.
- No message shape of its own per integration: the envelope above, or nothing.

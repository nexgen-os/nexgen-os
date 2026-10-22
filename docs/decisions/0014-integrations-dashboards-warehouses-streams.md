# 0014 — Integrations come through three doors

> Status: accepted

## Context

An energy community, the owner of many buildings or a research group already has
its tools: Grafana on a screen in the plant room, Power BI in the finance
department, InfluxDB fed by Home Assistant, Spark or pandas in the lab,
Kafka between the meter gateways and the back office. Nexgen OS has to sit
among them without asking anyone to abandon one, and without keeping a
second copy of its model anywhere. An integration that brings its own
tables, its own vocabulary or its own copy of the data is a second model
that drifts from the first.

## Decision

**Every integration comes through one of three doors**, and none gets its
own tables, its own vocabulary or its own copy of the data.

| Door | What it is | Who comes through |
|---|---|---|
| **SQL** | the Postgres wire protocol, row level security on, the read functions of the schema as the API | Grafana, Power BI, Metabase, Superset, any JDBC or ODBC client |
| **Files** | Parquet (Arrow): sorted by series and time, one documented schema | Spark, DuckDB, pandas, InfluxDB 3, a data lake |
| **Stream** | one message shape, the envelope of the connectors' series, over a broker; outbound by change data capture from the write-ahead log | Kafka, MQTT brokers, Home Assistant, gateways |

**The SQL door reads as a person.** A dashboard connects as a role that
carries the organisation it may see; the policies decide, as for any
reader, and aggregates come from the read functions
([0031](0031-one-way-to-write-a-series-one-way-to-read-it.md)), never from a
table of figures kept for one tool. No dashboard connects as the owner.

**The files door has one schema.** A file of series carries the series, the
instant in UTC, the value and the quality; a file read back into the core
keeps its provenance and goes through the one write path.

**The stream door has one message shape.** A stream carries the envelope the
connectors produce — the source, the object by its external identifier and
scheme, the quantity, the kind of value, the unit and the values — as JSON,
versioned like the engines' contract. An inbound message resolves its
object through the external identifiers, the same path as a file import.

**A door is a protocol or a file format**, never a vendor library.

## What it forbids

- A copy of the model in another database, or another store "as the store"
  of series ([0007](0007-series-at-scale.md)).
- A proprietary SDK in the core.
- A message shape of its own per integration.
- A dashboard connected with the owner's rights.

## See also

- [0007](0007-series-at-scale.md) — the store behind the three doors.
- [0011](0011-external-data.md) — connectors and the envelope of their
  series.
- [0037](0037-the-schema-grants-its-own-rights.md) — the rights a door
  reads with.

# 0022 — The instrument is a device, the point is the series

> Status: accepted · 19/10/2026, completed 21/10/2026

## Context

The first core had two tables for measurement: devices, for what is
installed, and sensors, for "a measurable or controllable point of any
object", each sensor with a quantity, a kind and an address at its source,
and each series pointing at a sensor or directly at an object. A meter's
active power was described three times: as a device, as a sensor of that
device and as a series of that sensor, with the quantity on two of them. A
Home Assistant entity, a Brick point and a SensorThings datastream all map
to one thing, and the model had two candidates for it.

## Decision

**The instrument is a device.** A meter, a temperature probe, an inverter's
data logger, a weather station: anything installed that measures is a
device, typed by the device vocabulary, belonging like any device to a
participant and not placed for now
([0026](0026-a-device-is-not-placed-for-now.md),
[0045](0045-the-participant-is-the-node.md)).

**The point is the series.** What a device measures, or what can be set on
it, is a series of the device: one quantity, one kind (measured, a setpoint,
a command, simulated, forecast), the reference the source knows the point
by, and the source's own metadata. There is no separate object for a point.

**One device, several series.** A weather station is one device with a
series per quantity it reads — temperature, irradiance, wind, humidity —
each in the unit of its quantity
([0030](0030-a-value-is-stored-in-the-unit-of-its-quantity.md)); a meter has
its offtake and its injection; a multisensor its temperature, CO2 and
presence. The diversity of measures and units of one device is held by its
series and the vocabularies, not by a table of sensors. A `sensors` module
may later describe that diversity further (calibration, accuracy, the
channels of an instrument); it is proposed in
[`modules/README.md`](../../modules/README.md), not built.

**A series belongs to one object.** A series measured by an instrument
belongs to the device; a series that describes a place without an
instrument (a weather point, a participant's computed load) belongs to that place
([0029](0029-a-series-belongs-to-an-object.md)). One path, never two.

**The round trips stay lossless.** A Home Assistant entity, a Brick point,
a Haystack point and a SensorThings datastream each map to one series, with
the device as their equipment or thing.

## What it forbids

- A table of sensors or points beside the series.
- A quantity or a kind stated on the device and again on its series.
- A series reachable both through a point and through its object.

## What it replaced

The `sensors` table of the 0.1 core and the double path of a series (its
object or its sensor).

## See also

- Brick (*Equipment* and *Point*), Project Haystack, OGC SensorThings
  (*Thing* and *Datastream*), the Home Assistant entity registry.
- Inherits Ekwo OS 0009 (*Accounts have types and are resolved by role*),
  translated: a device or a series is found by its type and its quantity,
  never by a name pattern.
- [0006](0006-named-objects.md) — the six objects of the core.
- [0031](0031-one-way-to-write-a-series-one-way-to-read-it.md) — how values
  are written and read.

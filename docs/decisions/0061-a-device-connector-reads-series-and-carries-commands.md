# 0061 — A device connector reads series and carries commands

> Status: accepted

## Context

A charger, a heat pump, an inverter, a battery or a P1 dongle is reached
through its maker's platform, an aggregator that groups several makers, a
central system it keeps a socket open to, or its local interface (Modbus,
EEBus, a home automation box). Each of these speaks its own API; there are
dozens of them, and each installation needs a few. Two things are asked of
all of them, and only two: what the device measured, and what is asked of
it. The model already holds both: what a device measures is its series
([0022](0022-the-instrument-is-a-device-the-point-is-the-series.md)), and
a value asked of it at an instant is a command of the `actions` module,
proposed, validated by a person and carried out by a connector, its effect
a value of a setpoint or command series of the device
([0017](0017-an-action-is-something-to-do.md),
[0047](0047-a-charging-profile-is-a-command.md)). The meter has its
interface (`MeterDataProvider`) and its one path (`collectMeterReadings()`);
the device had neither, so every connector of a device would have
written its own way to the series and to the actions.

## Decision

**A device connector implements two interfaces of the core, and nothing
else.** Both live in `@nexgen-os/core` beside the interfaces of
[0011](0011-external-data.md):

- `DeviceReadingsProvider` reads series of a device from `from` to `to`
  and answers them as `CollectedSeries`, each value dated at the start of
  its interval, in the unit the platform gives (the core converts);
- `CommandCarrier` carries out one command — the device, the quantity and
  kind of its series, the value in the unit of its quantity, the instant —
  and answers the instant the device acknowledged it, or why it did not.

**The device is known by an identifier.** Each interface names the
identifier scheme its platform knows devices by (`scheme`, a row of
`identifier_schemes` the connector package ships), and the device carries
its value in `identifiers`. No connector config maps a device of the model
to a device of the platform.

**One path each.** `collectDeviceReadings(db, provider, request)` checks
the organisation's `connectors` row against the provider's source, finds
the device and its identifier, and stores what comes back as `measured`
series of the device through `storeSeries()`, carrying the source.
`carryCommands(db, carrier, request)` takes the validated commands that
name the connector and are due, the earliest first, hands each to the
carrier and reports the answer through `actions.report()`: acknowledged,
the command is done and its value stored in its series at that instant;
refused, unanswered or not sent, it failed and says why, and a person may
propose it again. A module that keeps more of a command than its value —
the schedule of a charging profile — passes its own report, which calls
`actions.report()` (`charging.report()`).

**A carrier sends; it does not decide.** What reaches a carrier was
validated by a person, or by an agent the person allowed. Deciding when to
command a device — a schedule, a controller, an optimiser — is an
application's, and lands in `actions` as a proposed command like any
other.

## What it forbids

- A connector that writes a setpoint or command series itself: the value
  asked lands there through `actions.report()`, once the device
  acknowledged it.
- A carrier that sends a command not validated, or that retries a failed
  one on its own: a failed command is proposed again by a person.
- A device connector that reaches the database: it gets the device as
  `{identifier, scheme, device_type}` and answers in the core's terms; the
  two paths above read and write.
- A third interface per kind of device: a heat pump, a charger and an
  inverter are read and commanded through the same two, their differences
  being their quantities and their series.

## See also

[0011](0011-external-data.md) (a source is a row, a connector is code),
[0017](0017-an-action-is-something-to-do.md) (a command in one lifecycle),
[0022](0022-the-instrument-is-a-device-the-point-is-the-series.md),
[0047](0047-a-charging-profile-is-a-command.md),
[0031](0031-one-way-to-write-a-series-one-way-to-read-it.md).

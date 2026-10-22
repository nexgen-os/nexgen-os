# 0029 — A series belongs to an object, and a value is dated at the start of its interval

> Status: accepted

## Context

A meter reading, a temperature, a simulated yield, a weather forecast and a
setpoint are all one quantity over time. Kept in three stores, with some
values dated at the end of their hour and others at the start, a curve
loses which object it was about once it is copied; a comparison of two
tools over a few weeks finds a two-hour shift in winter that comes from
nothing else than the clock.

## Decision

**A series is one quantity over time, for one object of the core**: an
organisation, a project, a participant, a meter, a device or another
series, named by its kind and its id
([0001](0001-the-hierarchy-is-the-foreign-keys.md)). It says its quantity, its kind — measured,
simulated, forecast or asked — its source, its step, and, when it is the
output of a calculation, the calculation that wrote it.

**Every value is dated at the start of the interval it covers, in UTC.** A
quarter-hour of energy from 10:00 to 10:15 is dated 10:00. A source that
dates otherwise — at the end of the hour, in winter time all year, at an
instant — is converted by the connector or the reader that brings it in,
which knows the source's convention.

**A forecast keeps every issue.** Each value of a forecast carries the time
it was issued; a page reads the latest issue, an accuracy study reads what
was known at a given time.

**An external series needs an object to hang on.** When no participant
owns it — a weather grid point shared by many participants, a market zone —
it is a series of the organisation, named by the point or the zone, and the
module that knows the point says which participants read it.

**Days are cut in the participant's time zone.** A series is read by the
day, the month or the year in the time zone of the participant its object
belongs to (`participant_of()`, [0043](0043-the-participant-is-the-node.md));
a series of no participant has hours only.

## What it forbids

- A value dated at the end of its interval, or in local time.
- A series without an object, or one that says its object only through its
  name.
- Overwriting an earlier forecast issue with a later one.
- A second store for one kind of series.

## See also

- [0004](0004-a-figure-says-where-it-comes-from.md) — the series a calculation writes are its own.
- [0007](0007-series-at-scale.md) — where series are stored.
- [0022](0022-the-instrument-is-a-device-the-point-is-the-series.md) — the
  point is the series.
- [0030](0030-a-value-is-stored-in-the-unit-of-its-quantity.md) — the unit
  of a value.

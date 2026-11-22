# 0064 — An MIT package reaches no AGPL package; what a connector speaks is an MIT package of its own

> Status: accepted

## Context

The connectors are MIT so that any product, open or closed, can take them
([0005](0005-agpl-core-mit-libraries-sign-off.md)). Nineteen of them
depended on `@nexgen-os/core`, which is AGPL: for its types (`Fetch`,
`CollectedSeries`, `Point`, `Geocoder`, `SourceRow`…), for a few pure
functions (`azimuthFromSouth()`), and for the gestures that write
(`storeSeries()`, `registerSource()`, `requireMandate()`). A package
declared MIT that brings the core with it leaves whoever embeds it under
the core's AGPL, whatever its own licence says; decision
[0063](0063-the-computations-of-a-pv-yield-are-mit.md) drew that line for
the computations of a PV yield, and the licence check did not see it,
because it crossed the packages of this repository without judging them.

## Decision

**An MIT package of this repository reaches no package under the AGPL, by
any path of its run-time dependencies.** `scripts/check-licences.mjs`
refuses it as `licence_crossed`, with the path, in the continuous
integration. The connectors that still reach the core are named in
`STILL_CROSSING`, and only there; the list only shrinks: a package listed
that no longer crosses is refused as `licence_crossing_listed` until it is
taken off.

**What a connector speaks is `@nexgen-os/connector` (`packages/connector`),
MIT.** It holds the types and the pure functions a connector needs to answer
in the core's terms, and nothing that reads a database or the network:
`Point`, `CollectedSeries`, `WeatherProvider`, `Fetch` and
`azimuthFromSouth()` for the weather connectors; `Address`, `Place`,
`Precision`, `SearchOptions`, `Geocoder` and `SourceRow` for the
geocoders; `MeterOfHub`, `MeterReadingOptions`, `MeterDataProvider`,
`MeterMandate`, `MandateScope`, `MeterDataHub`, `requireMandate()`,
`GestureError` and `refusalCode()` for the meter data hubs;
`ChargerReading` and `ChargingSessionRecord` for the charging stations. Its only dependency is `@nexgen-os/solar`, MIT
and without dependency, for the type of a series point
(`SeriesPoint`), so that one type serves the core, the computations and the
connectors. **The core re-exports every name of the package**: an
installation and a connector share one definition, and a caller that
imported a name from the core keeps it.

**A connector moves onto the package when what it imports from the core is
there.** The weather and PV connectors (`open-meteo`, `pvgis`) and the
geocoders (`ban`, `geopunt`, `icar`, `mapbox`, `nominatim`, `photon`,
`urbis`, and `grb`, which reads its buildings with `@nexgen-os/cityjson`),
the meter data hubs (`enedis-sge`, `fluvius`, `ores`) the meters read
on the place's network (`homewizard`, `homeassistant-api`) and the charging
stations read from their cloud (`easee`, `zaptec`) import the
package, never the core. A connector
that writes through the core (`storeSeries()`, `registerSource()`,
`requireMandate()`) moves once it hands what it collected to its caller
instead, the caller being the core or a module, which write it with its
provenance, as `easee` and `zaptec` hand a `ChargerReading` to
`recordCharger()` of the `charging` module; until then it stays listed.

**What moves is the project's own code only.** Every definition that moved
was written under the project's identity, with no contributor's change in
its history: the holder that licensed it under the AGPL licenses it under
MIT too. A contribution under the AGPL is never moved into an MIT package
without its author's agreement (0005 holds).

## What it forbids

- An MIT package whose dependencies, however far, reach the core, a module,
  the command line, the MCP server or any package under the AGPL, outside
  `STILL_CROSSING`; a name added to that list.
- A definition of `@nexgen-os/connector` written again in the core, a
  module or a connector, instead of imported or re-exported.
- A function of `@nexgen-os/connector` that reads a database, the network
  or a file.

## See also

- [0005](0005-agpl-core-mit-libraries-sign-off.md) — the core and the
  modules are AGPL, the libraries MIT.
- [0011](0011-external-data.md) — a connector reads the outside world and
  what it brings carries its source.
- [0063](0063-the-computations-of-a-pv-yield-are-mit.md) — the computations
  of a PV yield are an MIT package; the same line, drawn for them first.

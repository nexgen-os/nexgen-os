# 0063 — The computations of a PV yield are an MIT package; the solar module that writes them stays AGPL

> Status: accepted

## Context

An application that computes a PV yield — a study tool, a design tool, the
first product built on the foundation — needs the models of the `solar`
module: the PVWatts DC model, the Faiman cell temperature, the typical year
chosen month by month by Finkelstein-Schafer, the exceedance levels of an
annual energy. Under the AGPL of the modules
([0005](0005-agpl-core-mit-libraries-sign-off.md)) it would take them only
by taking the AGPL, or copy them, and a copy is a second implementation
whose figures drift from the module's.

Writing MIT in a manifest is not enough. A package under MIT that imports
the core at run time leaves whoever embeds it under the core's AGPL; the
licence of what runs is the licence of the whole graph it loads. The code
the module published as a package (`@nexgen-os/solar`, reverted before
release) imported `@nexgen-os/core` for the database seam, the series API,
the engine glue, `offsetAt()` and `SeriesPoint`, and the connectors
`@nexgen-os/open-meteo` and `@nexgen-os/pvgis`, which are MIT but import the
core in turn; `@nexgen-os/panond` is MIT and imports nothing.

## Decision

**The pure computations of a PV yield are a package of their own,
`@nexgen-os/solar` (`packages/solar`), under MIT.** It holds functions of
numbers and series, and nothing that reads a database or the network:
`pvwatts.ts` (weather aligned and cleaned, the Faiman cell temperature, the
PVWatts DC model and the losses, the local standard years, the
Finkelstein-Schafer typical year, the annual totals and the scaling
factors), `exceedance.ts` (`exceedanceLevels()` and `normalQuantile()`),
`time.ts` (`offsetAt()`) and `series.ts` (`SeriesPoint`).

**It depends on nothing.** What the computations used from the core moved
into the package: `offsetAt()`, a pure helper of the same holder, and the
type `SeriesPoint`. The core re-exports both from the package, so that there
is one implementation and one type. A dependency the core takes on an MIT
package is allowed by 0005; the other way round is not.

**The `solar` module stays AGPL and computes with the package.** Its SQL,
its estimates written with their provenance, the yield by PVGIS, by PVWatts
or by an engine, sizing, performance indicators, products read from PAN and
OND files and the Sandia inverter fitted from an OND file
(`modules/solar/src/`) are bound to the core and keep its licence; they
import the computations from `@nexgen-os/solar` and keep no copy of them.

**What the package leaves out stays out of its graph.** `open-meteo` and
`pvgis` fetch weather and a yield for the module, not for the
computations; `panond` reads files for the module's product import. None
is a dependency of the package, and none is relicensed by this decision.
The Sandia inverter fit (`modules/solar/src/inverter.ts`) follows pvlib's
`inverter.fit_sandia` step by step; it stays in the AGPL module rather
than being relicensed as the project's own.

**Relicensing applies to the project's own code only.** Every file that
moved was written under the project's identity, with no contributor's
change in its history: the holder that licensed it under the AGPL licenses
it under MIT too. A contribution under the AGPL is never moved into an MIT
package without its author's agreement (0005 holds).

**The boundary is checked.** A test of the package
(`packages/solar/tests/package.test.ts`) fails when the package, by any
path of `package-lock.json`, reaches a workspace under the AGPL, when a
file of its code imports anything but its own files and the platform, or
when the module stops computing with it.

## What it forbids

- A dependency of `@nexgen-os/solar` on the core, a module, the command
  line, the MCP server or any package that reaches one of them.
- A copy of a computation of the package in the module, the core or an
  application of this repository.
- A function of the package that reads a database, the network or a file.
- Moving into the package code whose history holds a contributor's change,
  or a port of a third party's code, without the right to relicense it.

## See also

- [0005](0005-agpl-core-mit-libraries-sign-off.md) — the core and the
  modules are AGPL, the libraries MIT; this record adds the computations
  of a PV yield to the MIT side, for the project's own code.
- [0012](0012-a-yield-says-what-it-was-computed-from.md) — a yield says what
  it was computed from: the module writes the provenance, the package
  computes.
- [0035](0035-a-format-library-touches-no-database.md) — a format library is
  MIT and touches no database; the package follows the same rule.

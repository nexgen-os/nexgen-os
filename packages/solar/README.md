# `@nexgen-os/solar` — the computations of a PV yield, MIT

The models a PV yield is computed with, as plain functions of numbers and
series: what an application embeds to compute what the `solar` module of
Nexgen OS computes, with the same implementation. No database, no network,
no dependency.

| Function | What it computes |
|---|---|
| `alignWeather()`, `cleanWeather()` | hourly plane-of-array irradiance (interval means) aligned with air temperature and wind (instants), gaps and values beyond a physical bound cleaned, with their counts |
| `faimanCellTemperature()` | the Faiman cell temperature, Tcell = Tair + G / (U0 + U1 · v) |
| `pvwattsEnergyPerKwp()`, `arrayEnergy()`, `checkedGamma()` | the PVWatts DC model, E = G/1000 × [1 + γ (Tcell − 25)], times what the losses leave |
| `remainingAfterLosses()`, `withSoiling()` | the fraction a chain of losses leaves, the soiling of a place in place of a profile's own |
| `toYearGrid()`, `selectTypicalMonths()`, `finkelsteinSchafer()`, `typicalYear()` | the typical year chosen month by month by Finkelstein-Schafer on the local standard calendar, an hour the chosen month lacks taken from the multi-year mean |
| `annualTotals()`, `meanAnnualOverCoveredYears()`, `rescaleFactor()`, `anchoringFactor()` | the totals of the local standard years, and the factors that scale a typical year or anchor it on a reference annual |
| `exceedanceLevels()`, `normalQuantile()` | the P50, the interannual spread and the P75, P90, P99… of an annual energy, the named uncertainties added in quadrature |
| `offsetAt()`, `standardOffsetMinutes()`, `hourOfYear()` | the offset of a time zone at an instant, its standard offset in a year, the hour of an instant on the 365-day grid |

```ts
import { faimanCellTemperature, pvwattsEnergyPerKwp, exceedanceLevels } from '@nexgen-os/solar';

const tcell = faimanCellTemperature(800, 20, 2, { u0: 25, u1: 6.84 });
const kwhPerKwp = pvwattsEnergyPerKwp(800, tcell, -0.0037, 0.86);
const levels = exceedanceLevels([{ year: 2022, total: 9800 }, { year: 2023, total: 10150 }], { probabilities: [90] });
```

Conventions: every value is dated at the start of its interval, in UTC; days,
months and years are cut in the local standard time of the time zone given,
never assumed. A series point is `{ at, value, quality? }`, the type the series
API of `@nexgen-os/core` returns, so a series read from an installation passes
as it is. A refusal is named (`time_zone_required`, `time_zone_unknown`,
`real_years_required`, `probability_invalid`…).

## What is MIT, and what is AGPL

**This package is MIT** ([LICENSE](LICENSE)): any product, open or closed,
may embed it. It depends on nothing, and a test holds it so: it fails when
the package reaches a package under the AGPL by any path, or when its code
imports anything but its own files.

**The `solar` module of an installation is AGPL-3.0**, like the core
([`modules/solar`](../../modules/solar/README.md)): its SQL, the estimates it
writes with their inputs and their provenance, the yield by PVGIS, by PVWatts
or by an engine such as pvlib, sizing, performance indicators, products read
from PAN and OND files and the Sandia inverter fitted from an OND file. It
computes with this package and keeps no copy of it. The connectors it reads
the weather and PVGIS with (`@nexgen-os/open-meteo`, `@nexgen-os/pvgis`) are
not dependencies of this package.

Why the line runs there: decision
[0063](../../docs/decisions/0063-the-computations-of-a-pv-yield-are-mit.md).

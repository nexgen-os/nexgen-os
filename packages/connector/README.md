# `@nexgen-os/connector` — what a connector speaks, MIT

The types and the pure functions a connector of Nexgen OS answers in, so
that it runs without the core: the point it is asked about, the series it
brings back for one quantity, the interface of a weather source, the shape
of a place and the interface of a geocoder, a meter data hub and the mandate
it reads under, a refusal by name, the `sources` row it ships, the
subset of `fetch` it calls, and the azimuth counted from south that weather and PV
services expect. No database, no network.

| Name | What it is |
|---|---|
| `Point` | a point, `{ lon, lat }` in degrees (WGS 84) |
| `CollectedSeries` | the values a connector brings back for one quantity, with their value kind, step and unit, ready for `storeSeries()` of the core |
| `SeriesPoint` | one value at one instant, `{ at, value, quality? }`, the type of [`@nexgen-os/solar`](../solar/README.md) |
| `WeatherProvider` | a weather source: `forecast()` from now on, `history()` for past days, irradiance on a plane by its tilt and its azimuth clockwise from true north |
| `Address`, `Place`, `Precision` | the standard shape of a place: the address in the fields every country has, the point, how precise it is and the source that placed it (decision 0009) |
| `Geocoder`, `SearchOptions` | a geocoder: `search()` a typed address, `reverse()` a point; `geocoderFor()` of the core chains them |
| `MeterOfHub`, `MeterReadingOptions`, `MeterDataProvider` | a meter as its operator's hub knows it, what a reading is given, and the interface of a meter data hub; `collectMeterReadings()` of the core stores what it returns |
| `MeterMandate`, `MandateScope`, `MeterDataHub`, `requireMandate()` | the mandate a reading needs, what it allows, the conventions of the hub from its pack row, and the check a connector under mandate makes before it reads (`mandate_missing`, `mandate_scope`) |
| `GestureError`, `refusalCode()` | a refusal with its name first and the sentence that explains it, the one error class of every surface |
| `SourceRow` | the `sources` row a connector package ships, with its licence and retention; `registerSource()` of the core writes it |
| `Fetch` | the subset of `fetch` a connector calls, so a test or a proxy can stand in |
| `azimuthFromSouth()` | an azimuth clockwise from true north counted from south, west positive, in (-180, 180] — the convention of PVGIS, Open-Meteo and PVsyst |

```ts
import { azimuthFromSouth, type Fetch, type Point, type WeatherProvider } from '@nexgen-os/connector';

export function myWeather(options: { fetch?: Fetch } = {}): WeatherProvider {
  // …answers forecast(where: Point) with CollectedSeries[]
}
azimuthFromSouth(270); // 90: due west
```

`@nexgen-os/core` re-exports every name of this package: an installation and
a connector share one definition.

## What is MIT, and what is AGPL

**This package is MIT** ([LICENSE](LICENSE)); its only dependency,
`@nexgen-os/solar`, is MIT and depends on nothing. A connector that imports
what it speaks from here, rather than from the core, runs without the AGPL
of the core: the weather and PV connectors (`open-meteo`, `pvgis`) and the
geocoders (`ban`, `geopunt`, `icar`, `mapbox`, `nominatim`, `photon`,
`urbis`, and `grb`), the meter data hubs (`enedis-sge`, `fluvius`, `ores`)
and the meters read on the place's network (`homewizard`,
`homeassistant-api`) do. The licence
check of the repository refuses an MIT package that reaches an AGPL one by
any path (`licence_crossed`), outside the connectors still listed while they
move. Why the line runs there: decision
[0064](../../docs/decisions/0064-an-mit-package-reaches-no-agpl-package.md).

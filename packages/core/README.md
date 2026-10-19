# `@nexgen-os/core` — what the code of Nexgen OS shares

The TypeScript every other package builds on. AGPL-3.0, like the core schema
it speaks to.

| File | Holds |
|---|---|
| `src/db.ts` | `Db`, the one thing a package needs from a database driver: a query with positional parameters that answers with rows |
| `src/address.ts` | the standard shape of a place (`Address`, `Place`, precision, source), the `Geocoder` interface, `siteFields()`, `addressLines()` and `geocoderFor()`, the chain: the country's register, the open fallback, a commercial service |
| `src/series.ts` | the series API, each function one call of the SQL function of the same name: `store()`, `seriesEnsure()`, `resample()`, `window()`, `latest()`, `fill()`, `coverage()`, `forecastAt()`, `exportRows()`, `convertUnit()` |
| `src/connectors.ts` | the interfaces of the connectors (`WeatherProvider`, `MeterDataProvider`, `PlacesProvider`) and `storeSeries()` |
| `src/geometry.ts` | WKT, the normal of a face, azimuth and tilt, EPSG parsing |
| `src/engines/` | the runner of the JSON contract of the engines in other languages (`runner.ts`) and the request and result types of the `pv_yield` and `settlement` kinds |

The geocoders are connectors (`@nexgen-os/nominatim`, `photon`, `ban`,
`geopunt`, `urbis`, `icar`) and the format libraries are in
[`packages/formats`](../formats/README.md); both import this package and
nothing else of Nexgen OS. The engines themselves, programs in other
languages, are in [`engines/`](../../engines/README.md).

Inside this repository the packages import one another by name; `tsc`, `tsx`
and the tests read the names from `paths` in the root `tsconfig.json`, so
nothing needs building to run them. `npm run build` compiles each package to
its `dist/`.

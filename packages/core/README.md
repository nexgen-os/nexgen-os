# `@nexgen-os/core` — what the code of Nexgen OS shares

The TypeScript every other package builds on. AGPL-3.0, like the core schema
it speaks to.

| File | Holds |
|---|---|
| `src/db.ts` | `Db`, the one thing a package needs from a database driver: a query with positional parameters that answers with rows |
| `src/address.ts` | the standard shape of a place (`Address`, `Place`, precision, source), the `Geocoder` interface, `placeFields()`, `addressLines()` and `geocoderFor()`, the chain: the country's register, the open fallback, a commercial service |
| `src/series.ts` | the series API, each function one call of the SQL function of the same name: `store()`, `seriesEnsure()`, `resample()`, `window()`, `latest()`, `fill()`, `coverage()`, `forecastAt()`, `exportRows()`, `convertUnit()` |
| `src/connectors/` | the interfaces of the clients of external APIs (`WeatherProvider`, `MeterDataProvider`, `PlacesProvider`) and `storeSeries()` (`interfaces.ts`); the runner of the JSON contract of the program connectors (`runner.ts`) and the request and result types of the `pv_yield`, `settlement` and `energy_sharing` kinds |
| `src/geometry.ts` | WKT, the normal of a face, azimuth and tilt |
| `src/sql.ts` | `SqlClient` and `connect()`, the one way the installer, the command line and the MCP server reach Postgres (node-postgres, an optional peer, loaded lazily) |
| `src/identity.ts`, `src/refusal.ts`, `src/surface.ts` | who a surface acts as, in Ekwo OS's words: the `NEXGEN_*` variables, the refusal of a `service_role` key in every slot, the reading of a named refusal (`GestureError`, `explain()`), a session token verified by the installation's Supabase Auth |
| `src/session.ts` | `personSession()`: every transaction on one connection acting as a person — the issuer of a key (`use_api_key()`) or a user id — under the `authenticated` role, read only unless the person allows writing ([0046](../../docs/decisions/0046-a-key-acts-as-its-issuer-an-agent-reaches-the-database-as-the-person.md)) |
| `src/gestures.ts` | the gestures the command line and the MCP server share, one code path for both: the reads of the six objects, series, parameters, indicators, estimates, settlements and actions; the writes through the schema's function for each gesture; the keys; and `compute()`, which runs a module's computation handed in as `Computations` |
| `src/geocoders.ts` | the geocoder chain of a surface, from the connectors the person named (`NEXGEN_GEOCODERS`), keyed by the countries and regions their `sources` rows serve |
| `src/version.ts` | `compareVersions()` and `nexgenSchemaFloor()`, which refuses a database older than a surface (`schema_too_old`) |
| `src/files/` | the importers and exporters of the format libraries the core's objects need: `exportGeoJson` (the participants, their devices and, when the `building` module is installed, their ground, buildings and surfaces), `importWeatherFile`, `exportWeatherYear`, `exportSeriesParquet`; each writes the plain shapes of a library through the gestures of the schema (`install_device`, `set_attribute`, `add_identifier`, `locate_participant`, `series_ensure`, `store`) and reads them back. The importers of buildings — CityJSON, IFC, a Home Assistant home — are the `building` module's ([`modules/building/src`](../../modules/building/src/index.ts)) |

The geocoders are connectors (`@nexgen-os/nominatim`, `photon`, `ban`,
`geopunt`, `urbis`, `icar`) and import this package and nothing else of
Nexgen OS. The format libraries, in [`packages/formats`](../formats/README.md),
import nothing of Nexgen OS: this package imports them, for the shapes its
importers write ([0035](../../docs/decisions/0035-a-format-library-touches-no-database.md)).
The program connectors themselves, in other
languages, are in [`packages/connectors/`](../../packages/connectors/README.md#programs-in-any-language).

Inside this repository the packages import one another by name; `tsc`, `tsx`
and the tests read the names from `paths` in the root `tsconfig.json`, so
nothing needs building to run them. `npm run build` compiles each package to
its `dist/`.

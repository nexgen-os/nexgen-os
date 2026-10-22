# `packages/connectors/` — reading the outside world

Code that reaches outside the database is a **connector**, whatever language
it runs. A **source** (a vocabulary row) says what exists out there: an API,
a dataset, a register. A **connector** is the code that reads it, and, in the
core, a `connectors` row is an organisation's configured use of that code:
which source, for what, with which secret by name, its status and its last
run. Decision [0011](../../docs/decisions/0011-external-data.md).

A connector comes in one of two kinds:

- **a client of an external API**, in TypeScript: a library that implements
  one of the interfaces of [`@nexgen-os/core`](../core/src/connectors/interfaces.ts) and
  answers in the core's terms, so that what it brings back lands on ordinary
  objects, attributes, documents and series, each carrying its source;
- **a program in any language** that reads one JSON request on stdin and
  answers one JSON result on stdout (pvlib in Python, the settlement and
  sharing examples): the computation of an estimate or a settlement, done by code the core calls
  without rewriting it. Decision
  [0013](../../docs/decisions/0013-a-program-connector-reads-one-request.md); the contract is
  [below](#programs-in-any-language).

## Clients of an external API

| Interface | Answers with | Lands on |
|---|---|---|
| `WeatherProvider` | forecast (with its issue time) and history of weather quantities at a point | `series` of kind `forecast` on the participant or its weather point, every issue kept; history as `measured` or `simulated` values |
| `MeterDataProvider` | readings of a meter from a grid operator's hub, by identifier and scheme | `series` of kind `measured` on the meter |
| `PlacesProvider` | places around a point, with their external identifier, address and attributes | `participants` / `building.buildings`, `identifiers`, `attributes` with `source_code` |
| `Geocoder` (in [`@nexgen-os/core`](../core/src/address.ts)) | an address ⇄ a point | the participant's address and point, with precision and source |

`storeSeries(db, target, series, { issuedAt })` writes what a weather or
meter connector returned through `store()`, the one write path of the core:
the series is found or created once on the object (another value kind or
step is refused by name), the values are converted from `series.unit` by
the core's `units` vocabulary, keep their quality, and a forecast keeps its
issue time.

One package per service, `@nexgen-os/<service>`, MIT, with its own `package.json`
and `README`; the interfaces, the standard shape of a place and `storeSeries()` come
from `@nexgen-os/core`. [`series.ts`](../core/src/series.ts) types the same calls for any TypeScript client:
`store()`, `seriesEnsure()`, and the reads `resample()`, `window()`,
`latest()`, `fill()`, `coverage()`, `forecastAt()`, `exportRows()`,
`convertUnit()` — each one call of the SQL function of the same name.

### Shipped

| Connector | Source | Licence |
|---|---|---|
| [`open-meteo`](open-meteo/README.md) | `open_meteo` — hourly forecast of temperature and irradiance, and history from the ERA5 archive (irradiance on a plane, horizontal components `ghi`, `dni`, `dhi`, temperature, wind speed), worldwide | data CC BY 4.0; the free API is for non-commercial use, a paid plan otherwise |
| [`pvgis`](pvgis/README.md) | `pvgis` — hourly energy, in-plane irradiance and temperature of a PV system over whole years (seriescalc), and its multi-year yield (PVcalc); azimuth from true north turned into PVGIS's aspect from south, hours dated at their start in UTC | free, no key, no restriction on use |
| [`nominatim`](nominatim/README.md) | `nominatim` — an address ⇄ a point on OpenStreetMap, worldwide, ISO 3166-2 regions | ODbL; the public instance wants a named user agent and one request per second |
| [`photon`](photon/README.md) | `photon` — search as you type on OpenStreetMap, worldwide | ODbL; no country filter on the server, applied on the answers |
| [`ban`](ban/README.md) | `ban` — Base Adresse Nationale, France, house-number precision | Licence Ouverte 2.0; no key |
| [`geopunt`](geopunt/README.md) | `geopunt` — the Flemish address register | open; no key |
| [`urbis`](urbis/README.md) | `urbis` — the Brussels address register | open; no key |
| [`icar`](icar/README.md) | `icar` — the Walloon address register | open; no key |

A national address register is a connector of the same shape, as code never
belongs in a pack: the pack names the register as a source. One connector per
region when a country keeps one register per region (`BE-VLG`, `BE-BRU`,
`BE-WAL`). `geocoderFor({ national, fallback, commercial })` of
`@nexgen-os/core` chains them: the register of the country or its regions
first, the open fallback next, the commercial one last; each place says which
one answered ([decision 0009](../../docs/decisions/0009-what-applies-follows-the-region.md)).

### Private connectors

The interfaces are the contract. A connector whose data is not open — a
commercial map or solar provider, a licensed register, a company's own data
service — is a private package that implements the same interface, ships
its `sources` rows with their licence and retention, and is listed in the
installation's configuration. The core and the pages never import it; the
data it writes says where it came from, so licence and attribution follow
the data, and `sources.retention_days` says when a cache expires.

### Planned: dashboards, warehouses and streams

Grafana, Power BI, Spark, InfluxDB, Kafka and MQTT come through three doors
— SQL, Parquet files, one message shape over a stream — and none of them gets
a copy of the model
([decision 0014](../../docs/decisions/0014-integrations-dashboards-warehouses-streams.md)).
`packages/formats/parquet` writes the files; the readers and connectors still
to come, in the order installations ask for them, are in the
[road to 1.0](../../docs/road-to-1.0.md).

## Programs in any language

Much of the open science of the world and of renewables is written in
Python (pvlib, pandapower, EnergyPlus bindings, PySAM), some in R or Julia.
Nexgen OS keeps its truth in Postgres and its logic in TypeScript, and calls
such code without rewriting it: a program connector reads one request as
JSON on stdin and writes one result as JSON on stdout. The database side
stays language-agnostic; the program never touches the database. In the
contract below the program is named by the word an estimate or a settlement records it
under, its **engine** (`inputs.engine`, and the row's `provenance`): the envelope's `engine` field,
`runEngine()`, `NEXGEN_ENGINE_<NAME>` and the refusals `engine_*`.

| Connector | Request kinds | Language | Licence |
|---|---|---|---|
| [`pvlib`](pvlib/README.md) | `pv_yield` | Python 3.9+ with pvlib, pandas, numpy | MIT (pvlib itself is BSD-3) |
| [`settlement_example`](settlement-example/README.md) | `settlement` | Python 3.9+, no dependency | MIT |
| [`sharing_example`](sharing-example/README.md) | `energy_sharing` | Python 3.9+, no dependency | MIT |

Program connectors are optional. An installation without any runs everything
else; a computation that asks for one that is not installed is refused by name
(`engine_not_found`) with the line that installs it.

### The contract (version 1)

**One request in, one result out.** Both are JSON, UTF-8. The runner writes
the request on the program's stdin and closes it; the program writes its
answer on stdout and exits. stderr is a log: the runner keeps its lines and
never parses them.

```jsonc
// in
{ "engine": "pvlib", "contract": 1, "request": { "kind": "pv_yield", ... } }
// out, exit code 0
{ "engine": "pvlib", "version": "pvlib 0.16.1", "contract": 1, "result": { ... }, "log": ["..."] }
// out, exit code 1: a refusal by name
{ "error": "weather_incomplete", "detail": "no wind speed series (wind_speed)" }
```

- `version` is what the program is, in one string: the computing library and
  its version (`pvlib 0.16.1`). It is the string an estimate or a settlement records as
  its provenance, so that a figure says which program computed it.
- `contract` is this page's version. The runner refuses an answer in
  another version (`engine_contract_mismatch`); a program refuses a request
  in a version it does not speak, with the same name.
- A refusal is `{ "error": "<named_error>", "detail": "<what to fix>" }` on
  stdout with exit code 1. The runner throws it as it is,
  `weather_incomplete: no wind speed series (wind_speed)`, like every
  refusal of the core.

**Discovery.** `{ "engine": "<name>", "contract": 1, "request": { "describe": true } }`
answers, in `result`, the versions of the program's main dependencies and
the request kinds it accepts:

```json
{ "engine": "pvlib", "version": "pvlib 0.16.1", "contract": 1,
  "result": { "dependencies": { "nexgen_pvlib": "0.3.0", "python": "3.14.7", "pvlib": "0.16.1", "pandas": "3.0.6", "numpy": "2.5.4", "scipy": "1.18.1" },
              "kinds": ["pv_yield"] }, "log": [] }
```

`describeEngine()` sends it: to check that a program is installed and
answers, and to know the engine string before a computation.

**Time and series.** Every stamp is ISO 8601 with its offset and dates the
**start** of its interval, as everywhere in the core. A series is the
`CollectedSeries` of [`packages/core/src/connectors/interfaces.ts`](../core/src/connectors/interfaces.ts), with
its unit and, when it belongs to one part of the request, that part's name:

```json
{ "quantity_code": "poa_irradiance", "value_kind": "interval", "step": "1 hour", "unit": "W/m²", "array": "South",
  "values": [{ "at": "2023-01-01T10:00:00Z", "value": 149.52 }] }
```

**Units.** The `unit` of a series is a code or a symbol of the `units`
vocabulary of the core (`kWh`, `W/m²`, `°C`): the values come in that unit and
`store()` converts them to the quantity's own, or refuses by name
(`unit_unknown`) a label the vocabulary does not hold. A caller stores what a
program answers with `storeSeries()`, without translation (`engineUnit()` of
`@nexgen-os/core` reads the ASCII spellings `W/m2` and `degC` that an earlier
release of the pvlib connector used). An `interval` value is the mean (or the total, for an
energy) over its interval; an `instant` value is read at its stamp, and a
program that needs it over an interval takes the mean of the readings at the
two ends.

**Conventions, once.** Azimuth in degrees clockwise from true north (180 is
south); tilt in degrees from horizontal; energy in kWh per interval;
power in kW; irradiance in W/m²; temperature in °C; wind speed in m/s at
the height the series says (10 m unless told otherwise); losses as
fractions, in order, each applying to what the previous ones left.

### Request kinds

A request kind is a shape, written once in TypeScript beside the runner,
that any program accepting it answers in.

- `pv_yield` ([`pvlib.ts`](../core/src/connectors/pvlib.ts)): a PV system's arrays,
  models, losses and weather in; its production, plane-of-array irradiance
  and module temperature out.
- `settlement` ([`settlement.ts`](../core/src/connectors/settlement.ts)): the contracts in force
  over a period (`from`, `to`, `step`), each with its parties, its type,
  its volume basis, its priority, its price signals in the shape of
  `contracts.price_signals` and the series its volume is read from (a
  point of the request and one of its quantities, kWh per step); the
  values of the indices a price follows (`indices`) and the rules of the
  country or the project passed as they are (`rules`). Out, the settlement
  lines of each contract: over each interval a price holds, the energy,
  the price, its currency and unit, the amount and who pays whom; the
  totals of each contract and `meta`, what the program applied. How energy
  is matched with contracts — pay as consumed, pay as produced, a cascade
  by priority — and how an index, a cap or a floor are read are the
  program's own. Amounts are not rounded to a currency's minor unit, and
  no invoice comes out of a program: a line goes to Ekwo (decision
  [0010](../../docs/decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md)).
  [`settlement-example`](settlement-example/README.md) is one to copy.
- `energy_sharing` ([`sharing.ts`](../core/src/connectors/sharing.ts)): the
  participants of a sharing over a period (`from`, `to`, `step`), each with
  its role, its attributes (`allocation_share`, `allocation_rank`…) and its
  metered `offtake_energy` and `injection_energy`, kWh per step; the
  allocation key as the project holds it (`method`, `parameters`) and the
  rules of the country or the project passed as they are (`rules`). Out,
  for each participant and step, what it received from the sharing
  (`shared_offtake_energy`) and gave to it (`shared_injection_energy`),
  what is left for its supplier and the grid (`offtake_energy`,
  `injection_energy`), the totals and `meta`. How energy is shared — in
  proportion, by fixed shares, in order, in a cascade from a site to its
  community — is the program's own; the `community` module runs it on a
  project (`modules/community/src/sharing.ts`).
  [`sharing-example`](sharing-example/README.md), in proportion to offtake,
  is one to copy.

### Finding a program

`packages/connectors/<name>/` holds the program. The runner never guesses how to start
it: the caller gives the command (`{ command: ['python3', '-m', 'nexgen_pvlib'] }`),
or the environment variable `NEXGEN_ENGINE_<NAME>` does, as words separated
by spaces or as a JSON array when a path has a space:

```bash
export NEXGEN_ENGINE_PVLIB=".venv-pvlib/bin/python -m nexgen_pvlib"
export NEXGEN_ENGINE_PVLIB='["/opt/my tools/python", "-m", "nexgen_pvlib"]'
```

Nothing depends on a country, a locale or a language. The runner's
refusals:

| Name | When | Says |
|---|---|---|
| `engine_not_found` | no command given, or the program cannot be started | the line that installs the program |
| `engine_failed` | an exit code other than 0 without a refusal on stdout | the exit code and the last lines of stderr |
| `engine_contract_mismatch` | an answer that is not one JSON object, another contract version, another program's name, no version or no result | what was expected |
| `engine_timeout` | no answer within the time given (120 s by default) | the time; the program is stopped |

### What stays out of a program

A program never reads or writes the database: what it needs is in the
request, what it computes is in the result, and the caller stores it with
its provenance. It never calls the network unless the request says so and
the result records what was fetched: reading the weather is the job of a
client of an external API. It never writes a file outside a temporary
directory it creates and removes. Everything it decides is in its answer (`meta`):
the models it ran, the defaults it applied, the versions it used.

### Writing a program, in any language

1. Read stdin to the end; parse the envelope; answer `describe`.
2. Check `engine` and `contract`; refuse anything else with
   `engine_contract_mismatch`.
3. Dispatch on `request.kind`; refuse an unknown kind with `kind_unknown`.
4. Compute; refuse by name what cannot be computed (`weather_incomplete`,
   `model_unknown`…), never with a default the request did not ask for.
5. Write one JSON object on stdout, the series in the shape above, the
   choices in `meta`; exit 0.

The runner ([`runner.ts`](../core/src/connectors/runner.ts)) needs no change for a new program. The
fake program of the tests, [`tests/fixtures/connectors/fake.mjs`](../../tests/fixtures/connectors/fake.mjs),
is a complete one in forty lines of Node.

### Installing pvlib

```bash
python3 -m venv .venv-pvlib
.venv-pvlib/bin/pip install -e packages/connectors/pvlib
export NEXGEN_ENGINE_PVLIB=".venv-pvlib/bin/python -m nexgen_pvlib"
echo '{"engine":"pvlib","contract":1,"request":{"describe":true}}' | $NEXGEN_ENGINE_PVLIB
```

The last line answers the versions in use. Details: [`pvlib/README.md`](pvlib/README.md).

## Licence

MIT, every connector in its own folder with its own [`LICENSE`](pvgis/LICENSE).

# `engines/` — computations written in another language

Much of the open science of the world and of renewables is written in
Python (pvlib, pandapower, EnergyPlus bindings, PySAM), some in R or Julia.
Nexgen OS keeps its truth in Postgres and its logic in TypeScript, and calls
such code without rewriting it: an **engine** is a program that reads one
request as JSON on stdin and writes one result as JSON on stdout. The
database side stays language-agnostic; the engine side never touches the
database. Decision [0013](../docs/decisions/0013-external-engines.md).

| Engine | Request kinds | Language | Licence |
|---|---|---|---|
| [`pvlib`](pvlib/README.md) | `pv_yield` | Python 3.9+ with pvlib, pandas, numpy | MIT (pvlib itself is BSD-3) |
| [`settlement_example`](settlement-example/README.md) | `settlement` | Python 3.9+, no dependency | MIT |

Engines are optional. An installation without any runs everything else;
a run that asks for an engine that is not installed is refused by name
(`engine_not_found`) with the line that installs it.

## The contract (version 1)

**One request in, one result out.** Both are JSON, UTF-8. The runner writes
the request on the engine's stdin and closes it; the engine writes its
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

- `version` is what the engine is, in one string: the computing library and
  its version (`pvlib 0.16.1`). It is the string a run records as its
  engine, so that the same inputs and the same engine give the same run.
- `contract` is this page's version. The runner refuses an answer in
  another version (`engine_contract_mismatch`); an engine refuses a request
  in a version it does not speak, with the same name.
- A refusal is `{ "error": "<named_error>", "detail": "<what to fix>" }` on
  stdout with exit code 1. The runner throws it as it is,
  `weather_incomplete: no wind speed series (wind_speed)`, like every
  refusal of the core.

**Discovery.** `{ "engine": "<name>", "contract": 1, "request": { "describe": true } }`
answers, in `result`, the versions of the engine's main dependencies and
the request kinds it accepts:

```json
{ "engine": "pvlib", "version": "pvlib 0.16.1", "contract": 1,
  "result": { "dependencies": { "nexgen_pvlib": "0.1.0", "python": "3.14.7", "pvlib": "0.16.1", "pandas": "3.0.6", "numpy": "2.5.4", "scipy": "1.18.1" },
              "kinds": ["pv_yield"] }, "log": [] }
```

`describeEngine()` sends it: to check that an engine is installed and
answers, and to know the engine string before a run.

**Time and series.** Every stamp is ISO 8601 with its offset and dates the
**start** of its interval, as everywhere in the core. A series is the
`CollectedSeries` of [`packages/core/src/connectors.ts`](../packages/core/src/connectors.ts), with
its unit and, when it belongs to one part of the request, that part's name:

```json
{ "quantity_code": "poa_irradiance", "value_kind": "interval", "step": "1 hour", "unit": "W/m²", "array": "South",
  "values": [{ "at": "2023-01-01T10:00:00Z", "value": 149.52 }] }
```

**Units.** The `unit` of a series is a code or a symbol of the `units`
vocabulary of the core (`kWh`, `W/m²`, `°C`): the values come in that unit and
`store()` converts them to the quantity's own, or refuses by name
(`unit_unknown`) a label the vocabulary does not hold. A caller stores what an
engine answers with `storeSeries()`, without translation (`engineUnit()` of
`@nexgen-os/core` reads the ASCII spellings `W/m2` and `degC` that an earlier
release of the pvlib engine used). An `interval` value is the mean (or the total, for an
energy) over its interval; an `instant` value is read at its stamp, and an
engine that needs it over an interval takes the mean of the readings at the
two ends.

**Conventions, once.** Azimuth in degrees clockwise from true north (180 is
south); tilt in degrees from horizontal; energy in kWh per interval;
power in kW; irradiance in W/m²; temperature in °C; wind speed in m/s at
the height the series says (10 m unless told otherwise); losses as
fractions, in order, each applying to what the previous ones left.

## Request kinds

A request kind is a shape, written once in TypeScript beside the runner,
that any engine accepting it answers in.

- `pv_yield` ([`pvlib/index.ts`](../packages/core/src/engines/pvlib.ts)): a PV system's arrays,
  models, losses and weather in; its production, plane-of-array irradiance
  and module temperature out.
- `settlement` ([`settlement.ts`](../packages/core/src/engines/settlement.ts)): the contracts in force
  over a period (`from`, `to`, `step`), each with its parties, its type,
  its volume basis, its priority, its price signals in the shape of
  `contracts.price_signals` and the series its volume is read from (a
  point of the request and one of its quantities, kWh per step); the
  values of the indices a price follows (`indices`) and the rules of the
  country or the project passed as they are (`rules`). Out, the settlement
  lines of each contract: over each interval a price holds, the energy,
  the price, its currency and unit, the amount and who pays whom; the
  totals of each contract and `meta`, what the engine applied. How energy
  is matched with contracts — pay as consumed, pay as produced, a cascade
  by priority — and how an index, a cap or a floor are read are the
  engine's own. Amounts are not rounded to a currency's minor unit, and
  no invoice comes out of an engine: a line goes to Ekwo (decision
  [0010](../docs/decisions/0010-ekwo-link.md)).
  [`settlement-example`](settlement-example/README.md) is one to copy.

## Finding an engine

`engines/<name>/` holds the program. The runner never guesses how to start
it: the caller gives the command (`{ command: ['python3', '-m', 'nexgen_pvlib'] }`),
or the environment variable `NEXGEN_ENGINE_<NAME>` does, as words separated
by spaces or as a JSON array when a path has a space:

```bash
export NEXGEN_ENGINE_PVLIB=".venv-pvlib/bin/python -m nexgen_pvlib"
export NEXGEN_ENGINE_PVLIB='["/opt/my engines/python", "-m", "nexgen_pvlib"]'
```

Nothing depends on a country, a locale or a language. The runner's
refusals:

| Name | When | Says |
|---|---|---|
| `engine_not_found` | no command given, or the program cannot be started | the line that installs the engine |
| `engine_failed` | an exit code other than 0 without a refusal on stdout | the exit code and the last lines of stderr |
| `engine_contract_mismatch` | an answer that is not one JSON object, another contract version, another engine's name, no version or no result | what was expected |
| `engine_timeout` | no answer within the time given (120 s by default) | the time; the engine is stopped |

## What stays out of an engine

An engine never reads or writes the database: what it needs is in the
request, what it computes is in the result, and the caller stores it with
its provenance. It never calls the network unless the request says so and
the result records what was fetched: reading the weather is a connector's
job, not an engine's. It never writes a file outside a temporary directory
it creates and removes. Everything it decides is in its answer (`meta`):
the models it ran, the defaults it applied, the versions it used.

## Writing an engine, in any language

1. Read stdin to the end; parse the envelope; answer `describe`.
2. Check `engine` and `contract`; refuse anything else with
   `engine_contract_mismatch`.
3. Dispatch on `request.kind`; refuse an unknown kind with `kind_unknown`.
4. Compute; refuse by name what cannot be computed (`weather_incomplete`,
   `model_unknown`…), never with a default the request did not ask for.
5. Write one JSON object on stdout, the series in the shape above, the
   choices in `meta`; exit 0.

The runner ([`runner.ts`](../packages/core/src/engines/runner.ts)) needs no change for a new engine. The
fake engine of the tests, [`tests/fixtures/engines/fake.mjs`](../tests/fixtures/engines/fake.mjs),
is a complete one in forty lines of Node.

## Installing pvlib

```bash
python3 -m venv .venv-pvlib
.venv-pvlib/bin/pip install -e engines/pvlib
export NEXGEN_ENGINE_PVLIB=".venv-pvlib/bin/python -m nexgen_pvlib"
echo '{"engine":"pvlib","contract":1,"request":{"describe":true}}' | $NEXGEN_ENGINE_PVLIB
```

The last line answers the versions in use. Details: [`pvlib/README.md`](pvlib/README.md).

## Licence

MIT, like the connectors ([`LICENSE`](LICENSE)); each engine carries its own.

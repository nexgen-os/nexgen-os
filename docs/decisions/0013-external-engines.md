# 0013 — External engines: one request in, one result out

**Decided 13/10/2026.** Builds on [0004](0004-deterministic-runs.md)
(deterministic runs), [0011](0011-external-data.md) (connectors) and
[0012](0012-solar-module.md) (a yield run records its engine).

## Context

The best open science for the built world and for renewables is written
in Python — pvlib for PV, pandapower for grids, the EnergyPlus bindings for
buildings, PySAM for NREL's System Advisor Model, research code on pandas —
and some in R or Julia. Nexgen OS keeps its truth in Postgres and its logic
in TypeScript. Rewriting those libraries would lose their validation and
their community; calling them through bindings would tie the core to one
language and one way of installing it.

Decision 0012 already says that engines run outside Postgres and that a
yield run records which engine computed it. What was missing is how the
core talks to an engine.

## Decision

**An engine is a program that reads one request as JSON on stdin and
answers one result as JSON on stdout.** stderr is its log; exit code 0 with
the answer, or exit code 1 with `{ "error": "<named_error>", "detail": "…" }`.
The envelope carries the engine's name and the contract version
(`{ "engine", "contract": 1, "request" }` → `{ "engine", "version",
"contract": 1, "result", "log" }`); `{ "describe": true }` answers the
engine's version, its dependencies and the request kinds it accepts. The
full contract is [`engines/README.md`](../../engines/README.md).

- **Series are the connectors' series.** An engine reads and answers
  `CollectedSeries` (ISO 8601 with offsets, values dated at the start of
  their interval), with a unit and, when needed, the part of the request
  they belong to. A caller stores what an engine answers with
  `storeSeries()`, without translation.
- **The engine string is the engine's.** `version` (`pvlib 0.16.1`) is what
  a run records as its engine (0004: same inputs, same engine, same run);
  `describe` gives the rest of the environment, kept in the run's inputs.
- **Nothing is guessed.** The runner (`engines/runner.ts`, pure Node) is
  told the command by its caller or by `NEXGEN_ENGINE_<NAME>`; no command
  is inferred from a platform, a country or a locale. Its refusals are
  named: `engine_not_found` (with the install line), `engine_failed` (exit
  code, last lines of stderr), `engine_contract_mismatch`,
  `engine_timeout`; an engine's own refusals pass through by their name.
- **What stays out.** An engine never reads or writes the database, never
  calls the network unless the request says so and the result records it
  (fetching weather is a connector's job), never writes outside a
  temporary directory it removes. Every choice it makes is in its answer.
- **Engines are optional and MIT.** An installation without Python runs
  everything else; `engines/` is MIT like the connectors, each engine with
  its own licence.

**pvlib is the first engine** (`engines/pvlib`, request kind `pv_yield`):
pvlib's `ModelChain` with the yield profile's transposition, temperature,
incidence and spectral models, the module and inverter parameters of
`solar.module_products` and `solar.inverter_products` in pvlib's keys, and
the profile's ordered losses.

**A yield profile and an engine are two axes.** The profile chooses the
weather, the models and the losses; the engine computes. `runYield(db,
{ pvSystemId, years, profileCode, engine: { name: 'pvlib' } })` builds the
request from the same rows as the other runs, stores the answer as
`simulated` series (energy on the system, plane-of-array irradiance and
module temperature on each array), and records the engine string as the
run's `engine_version` and the profile in its inputs. The schema already
keeps them apart (`runs.engine_version`, `runs.inputs.profile`): no
migration was needed.

## Consequences

- A second engine needs no change to the runner: a program in
  `engines/<name>/`, a request kind written down in its README, the types
  of that kind in TypeScript, and the module that builds the request from
  its rows. pandapower for the `grid` module is the next candidate
  (`power_flow`: buses, lines, transformers and loads in, voltages and
  loadings out).
- CI runs the pvlib engine in a job of its own (`engine-pvlib`, Python
  3.12), so that the comparison with `modules/solar/pvwatts.ts` runs on
  every change; the main test job runs the runner and the solar
  integration with a fake engine in Node, without Python.
- With the same choices (plane-of-array irradiance given, Faiman, PVWatts
  DC, the same losses, no inverter), pvlib and `pvwatts.ts` give the same
  daily energy on the PVGIS recording to the fourth decimal; the gaps that
  remain between the two are the models `pvwatts.ts` does not have
  (inverter, incidence, transposition of its own), and they are measured
  in `tests/engines-pvlib.test.ts`.
- Open: a long-running engine as a service (the same contract over HTTP)
  when a computation outgrows one process; an engine's own cache of
  downloaded data (CEC tables, SAM's libraries) in its temporary
  directory.

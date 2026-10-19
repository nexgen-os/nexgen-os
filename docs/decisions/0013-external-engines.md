# 0013 — An engine reads one request and answers one result

> Status: accepted · 13/10/2026, rewritten 19/10/2026

## Context

The best open science for buildings and renewables is written in Python —
pvlib for PV, pandapower for grids, the EnergyPlus bindings for buildings,
PySAM for NREL's System Advisor Model, research code on pandas — and some in
R or Julia. Nexgen OS keeps its truth in Postgres and its tooling in
TypeScript. Rewriting those libraries would lose their validation and their
community; calling them through bindings would tie the core to one language
and one way of installing it. A run already records which engine computed
it ([0004](0004-deterministic-runs.md)); what was missing is how the core
talks to an engine.

## Decision

**An engine is a program that reads one request as JSON on stdin and
answers one result as JSON on stdout.** stderr is its log; exit code 0 with
the answer, or exit code 1 with `{ "error": "<named_error>", "detail": "…" }`.
The envelope carries the engine's name and the contract version
(`{ "engine", "contract": 1, "request" }` → `{ "engine", "version",
"contract": 1, "result", "log" }`); `{ "describe": true }` answers the
engine's version, its dependencies and the request kinds it accepts. The
full contract is [`engines/README.md`](../../engines/README.md).

- **Series are the connectors' series.** An engine reads and answers series
  in the shape the connectors collect (ISO 8601 with offsets, values dated
  at the start of their interval, with a unit), so that what it answers is
  stored through the one write path without translation.
- **The engine string is the engine's.** `version` (`pvlib 0.16.1`) is what
  a run records as its engine; `describe` gives the rest of the
  environment, kept in the run's inputs.
- **Nothing is guessed.** The runner is told the command by its caller or
  by `NEXGEN_ENGINE_<NAME>`; no command is inferred from a platform, a
  country or a locale. Its refusals are named: `engine_not_found` (with the
  install line), `engine_failed` (exit code, last lines of stderr),
  `engine_contract_mismatch`, `engine_timeout`; an engine's own refusals
  pass through by their name.
- **What stays out.** An engine never reads or writes the database, never
  calls the network unless the request says so and the result records it
  (fetching weather is a connector's job), and never writes outside a
  temporary directory it removes. Every choice it makes is in its answer.
- **Engines are optional and MIT.** An installation without Python runs
  everything else; each engine keeps its own licence for the tool it wraps.

**A profile and an engine are two axes.** The module's named profile
chooses the inputs, the models and the losses; the engine computes. The
module builds the request from its rows, stores the answer as `simulated`
series, and the run records the engine string and the profile apart.

**A new engine changes nothing in the runner**: a program in its own folder,
a request kind written down in its README, the types of that kind, and the
module that builds the request.

## What it forbids

- An engine that reads or writes the database, or fetches data the request
  did not ask for.
- A command chosen from a platform, a country or a locale.
- A second implementation in TypeScript of what an engine computes
  ([0024](0024-one-language-per-layer.md)).
- A run that does not record the engine string it was computed with.

## What it replaced

Bindings or rewrites as the only ways to reach a scientific library, and a
yield whose engine was the edge function that happened to compute it.

## See also

- Inherits Ekwo OS 0020 (*One tax engine, several kinds of tax*),
  translated: one engine contract, several request kinds.
- [0004](0004-deterministic-runs.md), [0012](0012-solar-module.md),
  [0016](0016-naming-third-party-methods.md).
- `packages/core/src/engines/runner.ts`, `engines/pvlib`, `tests/engines-pvlib.test.ts`.

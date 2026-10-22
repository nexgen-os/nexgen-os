# 0013 — A program connector reads one request and answers one result

> Status: accepted

## Context

The best open science for buildings and renewables is written in Python —
pvlib for PV, pandapower for grids, the EnergyPlus bindings for buildings,
PySAM for NREL's System Advisor Model, research code on pandas — and some in
R or Julia. Nexgen OS keeps its truth in Postgres and its tooling in
TypeScript. Rewriting those libraries would lose their validation and their
community; calling them through bindings would tie the core to one language
and one way of installing it. A calculation records which engine computed it
([0004](0004-a-figure-names-its-inputs-and-never-changes.md)); this record says how the core talks to
an engine.

## Decision

**A computation in another language is a connector: a program that reads
one request as JSON on stdin and answers one result as JSON on stdout.**
It lives in `packages/connectors/<name>/`, beside the clients of the
external APIs: code that reaches outside the database is a connector,
whatever language it runs ([0011](0011-external-data.md)).
**The word "engine" means what computed a calculation** (the `engine_version` of a
module's estimates and settlements): PVGIS, `pvwatts.ts` or a program connector. The
contract names the program by that word, since its answer is a calculation's
engine: the envelope's `engine`, `runEngine()`, `describeEngine()`,
`NEXGEN_ENGINE_<NAME>` and the `engine_*` refusals keep it. stderr is its log; exit code 0 with
the answer, or exit code 1 with `{ "error": "<named_error>", "detail": "…" }`.
The envelope carries the engine's name and the contract version
(`{ "engine", "contract": 1, "request" }` → `{ "engine", "version",
"contract": 1, "result", "log" }`); `{ "describe": true }` answers the
engine's version, its dependencies and the request kinds it accepts. The
full contract is in [`packages/connectors/README.md`](../../packages/connectors/README.md#programs-in-any-language).

- **Series are the connectors' series.** An engine reads and answers series
  in the shape the connectors collect (ISO 8601 with offsets, values dated
  at the start of their interval, with a unit), so that what it answers is
  stored through the one write path without translation.
- **The engine string is the engine's.** `version` (`pvlib 0.16.1`) is what
  a calculation records as its engine; `describe` gives the rest of the
  environment, kept in the calculation's inputs.
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
- **Program connectors are optional and MIT.** An installation without
  Python runs everything else; each keeps its own licence beside it, and
  the tool it wraps keeps its own.

**A profile and an engine are two axes.** The module's named profile
chooses the inputs, the models and the losses; the engine computes. The
module builds the request from its rows, stores the answer as `simulated`
series, and the calculation records the engine string and the profile apart.

**A new program changes nothing in the runner**: a program in its own folder
of `packages/connectors/`, a request kind written down in its README, the types of that kind, and the
module that builds the request.

## What it forbids

- An engine that reads or writes the database, or fetches data the request
  did not ask for.
- A command chosen from a platform, a country or a locale.
- A second implementation in TypeScript of what an engine computes
  ([0024](0024-one-language-per-layer.md)).
- A calculation that does not record the engine string it was computed with.

## See also

- Inherits Ekwo OS 0020 (*One tax engine, several kinds of tax*),
  translated: one engine contract, several request kinds.
- [0004](0004-a-figure-names-its-inputs-and-never-changes.md), [0012](0012-a-yield-says-what-it-was-computed-from.md),
  [0016](0016-naming-third-party-methods.md).
- `packages/core/src/connectors/runner.ts`, `packages/connectors/pvlib`, `tests/connectors-pvlib.test.ts`,
  `tests/connectors-runner.test.ts`.

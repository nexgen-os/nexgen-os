# 0024 — One language per layer

> Status: accepted · 19/10/2026

## Context

Nexgen OS sits between two worlds. The tools that install, import and
connect (a command line, format libraries, connectors, an MCP server) are
written in TypeScript, the language the platform built on it already
maintains. The science of the trades (pvlib, pandapower, PySAM, the
EnergyPlus bindings, research code on pandas) is written in Python, with
some R and Julia, and the scientific partners of the project work there.
Supporting both everywhere would mean two implementations of every rule,
which drift; supporting one only would either cut off the scientists or
rewrite libraries whose value is their validation.

## Decision

**The model is SQL.** The schema, its functions and its refusals are the one
implementation of the model and of every rule that spans rows
([0018](0018-one-function-per-gesture.md)); any client in any language
calls them.

**TypeScript is the one maintained toolchain.** The command line, the
format libraries, the connectors, the core client and the MCP server are
TypeScript, shipped as packages; one language to maintain, review and
standardise.

**Any other language is an engine.** A computation in Python, R or Julia
runs behind the engine contract, one JSON request in and one JSON result
out ([0013](0013-external-engines.md)), and never reads or writes the
database.

**Python is the first-class client of the scientist.** The Python client
reads and writes through the same SQL functions as every other client, with
dataframe readers as optional extras; the engines are first-class. Neither
carries business logic.

**Nothing is implemented twice.** A rule exists once, in SQL; a computation
exists once, in one module or one engine.

## What it forbids

- Business logic in the Python client.
- A second engine in TypeScript for a computation an engine already does,
  or the reverse.
- A tool of the toolchain in another language than TypeScript.
- A rule reimplemented in a client because its function was not called.

## What it replaced

Rules spread between TypeScript helpers, the Python client and SQL, with no
statement of which one is the reference.

## See also

- Inherits the principle of Ekwo OS that one rule exists once, and 0056
  (*The command line computes no amount*).
- [0013](0013-external-engines.md) — the engine contract.
- [0016](0016-naming-third-party-methods.md) — where a third party's name
  goes.
- [0035](0035-a-format-library-touches-no-database.md) — what a format
  library is.

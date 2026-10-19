# 0018 — One function per gesture

> Status: accepted · 19/10/2026

## Context

The first core was an attachment engine: forty tables, row level security on
each, and one business function, the one that records a run. Every other act
— placing a device, splitting a building, storing readings, resolving a
default — was a set of inserts that each client wrote in its own way. A rule
that lives in a client lives in every client: the command line, the Python
client, a connector and an agent each had to know it, and one of them always
forgot. Ekwo OS keeps about four functions per table, most of them named after
what a person does (post a document, reverse an entry, close a year), and its
clients compute nothing.

## Decision

**Every act that writes several rows, or that carries a rule, is one function
of the schema, named after the gesture.** Recording a run, storing the values
of a series, merging two objects, placing a device, resolving a default:
each is a function a client calls with what the person gave, and the function
writes every row the act needs, checks every rule it carries, and refuses by
name.

**A plain insert stays allowed where it is already safe.** A row that stands
alone and whose rules are all checked by the table's constraints and triggers
(a building with its footprint, an attribute with its period) may be written
directly, under row level security. What a gesture adds is the rule that
spans several rows; it never forbids the single-row write that is already
whole.

**The function is the contract.** Its name, its arguments and its refusals are
what the command line, the Python client, the connectors and an agent call;
none of them reimplements what it does. A module writes the core through the
same functions ([0032](0032-a-module-has-its-own-schema.md)).

## What it forbids

- A rule that spans several rows written in a client, a format library, a
  connector or a page instead of the schema.
- A second implementation of a gesture in another language
  ([0024](0024-one-language-per-layer.md)).
- A function named after a table operation (`insert_x`, `update_y`) where a
  gesture has a name in the trade.

## What it replaced

"The table is the API": only `record_run()` was a gesture, and the rules of
storing a series, of splitting a building and of placing a device lived in
the clients that happened to need them.

## See also

- Inherits Ekwo OS 0016 (*A correction is one gesture*), 0051 (*A module has
  its own schema and posts through a function*) and 0056 (*The command line
  computes no amount*).
- [0004](0004-deterministic-runs.md) — a figure is a run, recorded by one
  function.
- [0031](0031-one-way-to-write-a-series-one-way-to-read-it.md) — the one write
  path of series.
- [0038](0038-everything-raises-by-name.md) — a gesture refuses by name.

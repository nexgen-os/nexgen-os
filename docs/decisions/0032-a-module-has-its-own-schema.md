# 0032 — A module has its own schema and writes the core through a function

> Status: accepted

## Context

What a trade computes — a PV yield, the inside of a building, the weather of
a place, an energy-sharing settlement — is not what every installation
needs. Put in the core, it makes the core the sum of every trade; put in a
client, it escapes the database's rules. Each module of the repository
lives in a schema of its own; this record states the rule they follow.

## Decision

**A module owns one Postgres schema, and the core is not it.** Its tables,
its functions and its policies live there; it depends on the core by
foreign key, and the core has no hook and no knowledge of it. The core
lives in its own schema too, `nexgen`, and `public` stays the
installation's.

**A module derives, it never widens.** A module that needs more about a
device or a product adds a table with the same id; one that adds an object
of its own gives it a foreign key to the core object it belongs to and
describes it in its own columns
([0042](0042-a-module-starts-from-an-object-of-the-core.md)). No module
adds a column to a core table.

**A module reads the core freely and writes it through its functions.** A
figure is a calculation of the module, written by the core's gesture
(`record_calculation('<module>.<table>', …)`, [0004](0004-a-figure-names-its-inputs-and-never-changes.md)); any other write goes through
the gesture that carries its rule
([0018](0018-one-function-per-gesture.md)). A module may publish vocabulary
rows, marked as published by it.

**A module is registered, secured and declared.** Its first migration
registers it; every table it owns carries row level security by
organisation; it declares its inputs and outputs, typed and with units, so
that a calculation can be reproduced. It names no country: what a country decides
is in its pack.

## What it forbids

- A module's table in the core's schema, or a core column added by a module.
- A module writing a figure into the core outside a calculation.
- A core function that names a module.
- A module table without row level security.

## See also

- Inherits Ekwo OS 0051 (*A module has its own schema and posts through a
  function*); the core in its own schema rather than `public` is a reasoned
  divergence ([0010](0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md)).
- [0033](0033-a-module-code-outlives-its-names.md) — the code of a module.
- `modules/README.md` — the rules of a module, in practice.

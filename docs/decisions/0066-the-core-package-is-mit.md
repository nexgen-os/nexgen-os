# 0066 — The core package, `@nexgen-os/core`, is MIT; the schema, the modules, the command line and the MCP server stay AGPL

> Status: proposed

## Context

[0005](0005-agpl-core-mit-libraries-sign-off.md) put the core under the
AGPL: the schema, its functions, the modules, the installer and the core
package. [0063](0063-the-computations-of-a-pv-yield-are-mit.md) and
[0064](0064-an-mit-package-reaches-no-agpl-package.md) drew the line of an
MIT package that reaches the AGPL, and moved what a computation or a
connector needs into MIT packages of their own, so that an application can
embed them without the AGPL.

The core package is the TypeScript an application uses to speak to an
installation: the database seam, the series API, the place and the geocoder
chain, the engine glue, the importers and exporters of the formats. Under
the AGPL, an application that imports it to read and write its own
installation takes the AGPL with it, and the connectors published before
0064 still carry it in their graph. The holder of the project decided to
license the package under MIT, so that any product can speak to an
installation through it.

## Decision

**`@nexgen-os/core` (`packages/core`) is MIT**, with its own `LICENSE` in
its folder, like the format libraries and the connectors. Its code is
unchanged.

**What runs in the database stays AGPL.** The schema and its functions
(`supabase/`), the modules, the packs, the installer (`@nexgen-os/cli`),
the MCP server (`@nexgen-os/mcp`) and the viewer keep the AGPL of 0005: a
modified schema or module offered to users over a network publishes its
changes.

**The package keeps the promise of an MIT package.** It ships only what
any product may take, and reaches no package under the AGPL by any path
of its run-time dependencies: `scripts/check-licences.mjs` judges it as it
judges every MIT package of this repository (0064). Its dependencies are
MIT packages of this repository already.

**Relicensing applies to the project's own code only.** Every commit in
the history of `packages/core` was written under the project's identity,
with no contributor's change: the holder that licensed it under the AGPL
licenses it under MIT too. Versions already published keep the licence
they were published under; the package is MIT from the next release.

## What it changes in 0005

0005 said that nothing lets anyone relicense the core. This record moves
the core package, the project's own code, to the MIT side, by its holder;
the rest of 0005 holds: a sign-off is enough to contribute, there is no
contributor licence agreement, and a contribution under the AGPL is never
moved into an MIT package without its author's agreement.

## What it forbids

- A run-time dependency of `@nexgen-os/core` on a module, the command
  line, the MCP server or any package under the AGPL.
- Moving into the package code whose history holds a contributor's change
  under the AGPL, without its author's agreement.

## See also

- [0005](0005-agpl-core-mit-libraries-sign-off.md) — the core and the
  modules are AGPL, the libraries MIT; amended here for the core package.
- [0063](0063-the-computations-of-a-pv-yield-are-mit.md) — the computations
  of a PV yield are an MIT package.
- [0064](0064-an-mit-package-reaches-no-agpl-package.md) — an MIT package
  reaches no AGPL package.

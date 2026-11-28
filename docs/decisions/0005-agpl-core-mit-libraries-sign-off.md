# 0005 — The core is AGPL, the libraries MIT, and a sign-off is enough to contribute

> Status: accepted · amended by [0066](0066-the-core-package-is-mit.md)

## Context

Nexgen OS is a description of places in a database its owner keeps, and a
set of libraries that read the files and the services of the trades. Two
promises pull in different directions: whoever runs the core for others
must give back what they change, and a format library or a connector must
be usable by any product, open or not, without conditions. Contributions
also have to be accepted in a way that never lets anyone take the core away
from its licence: relicensing a community's work is how open projects
split.

## Decision

**The core and the modules are AGPL-3.0.** The schema, its functions, the
modules, the installer and the MCP server: whoever runs a modified copy
as a service offers its source to the people who use it. The core package,
`@nexgen-os/core`, the TypeScript they all build on, is MIT
([0066](0066-the-core-package-is-mit.md)). The computations
of a PV yield, the project's own pure functions, are an MIT package the
`solar` module computes with ([0063](0063-the-computations-of-a-pv-yield-are-mit.md)).

**The format libraries and the connectors are MIT**, each package with its
own licence file, so that they can be taken into any product. A program
connector wrapping a third party's tool keeps that tool's licence for the
tool itself.

**What a package ships keeps its promise.** A format library or a
connector, like the core package, ships only what any product may take:
licences that are permissive, or whose copyleft stays in the files of the
package that carries it (MPL-2.0). The command line and the MCP server ship
only what an AGPL-3.0 work may be distributed with. No package ships a
licence that forbids commercial use, a source-available licence, or a
package that names no licence. The check reads `package-lock.json` on
every pull request (`scripts/check-licences.mjs`), and every release keeps
the bill of materials of each package it publishes (`scripts/sbom.mjs`,
[`SECURITY.md`](../../SECURITY.md)).

**A sign-off is enough to contribute.** Every commit carries
`Signed-off-by:` under the Developer Certificate of Origin 1.1
(`git commit -s`): the contributor certifies that they wrote the change or
have the right to submit it under the project's licences. The repository's
check refuses a commit without it.

**There is no contributor licence agreement**, and nothing in the sign-off
lets anyone, the maintainers included, relicense a contribution: a
contributor's change keeps the licence it was submitted under, and the
libraries are MIT for good. The project licenses again only the code it
wrote under its own identity ([0063](0063-the-computations-of-a-pv-yield-are-mit.md),
[0066](0066-the-core-package-is-mit.md)).

**Paid services sit beside the open core, not inside it.** Hosting,
support, studies and commercial platforms built on the foundation are
services around it; no part of the open model is held back for them
([`docs/services.md`](../services.md)).

## What it forbids

- A contributor licence agreement, or any clause that would let a
  contributor's change take another licence than the one it was submitted
  under.
- A commit without its sign-off.
- A feature of the open model reserved to a paid service.
- A dependency that a format library or a connector would ship under GPL,
  LGPL or AGPL, and a dependency of any package under a licence that
  forbids commercial use, a source-available licence, or none.

## See also

- Inherits Ekwo OS 0061 (*AGPL core, MIT formats, an operational paid
  line*), with a reasoned divergence: a sign-off instead of Ekwo's
  contributor agreement.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md), "Sign-off".
- [0035](0035-a-format-library-touches-no-database.md) — a format library
  is MIT.
- [0063](0063-the-computations-of-a-pv-yield-are-mit.md) — the
  computations of a PV yield are an MIT package.
- [0066](0066-the-core-package-is-mit.md) — the core package is MIT.

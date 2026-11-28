# 0066 — The core package is MIT; the schema, the modules, the installer and the MCP server stay AGPL

> Status: accepted · amends [0005](0005-agpl-core-mit-libraries-sign-off.md)

## Context

`@nexgen-os/core` is the TypeScript every other package builds on: the
database seam, the standard place and the geocoder chain, the series API,
the connector interfaces, the engine glue, and the importers and exporters
of the file formats. Under the AGPL of 0005, an application that wants to
read or write a Nexgen OS database with the same functions the command line
and the MCP server use takes the AGPL with them, or writes them again, and
a second implementation drifts from the first.

The connectors published in 0.5.1 make the cost visible: eleven of them,
MIT by their own licence (`nominatim`, `photon`, `ban`, `mapbox`, `icar`,
`urbis`, `geopunt`, `open-meteo`, `pvgis`, `switchgrid`, `enedis-sge`),
depend on `@nexgen-os/core` and so bring the AGPL with them
([0064](0064-an-mit-package-reaches-no-agpl-package.md) moves them onto
`@nexgen-os/connector` for the next release). What every product of the
trade needs from the core package is the seam and the importers, not the
installation itself: the promise the AGPL keeps, that whoever runs a
modified installation for others gives back what they change, lives in the
schema, its functions and the modules.

## Decision

**`@nexgen-os/core` (`packages/core`) is MIT**, with its own `LICENSE` in
its folder, like the format libraries and the connectors. Its build no
longer copies the repository's AGPL text into it.

**What it brings keeps the promise of an MIT package.** Its dependencies,
however far, are MIT or permissive (`@nexgen-os/connector`, `@nexgen-os/solar`
and the format libraries it imports and exports with), and
`scripts/check-licences.mjs` now judges it as an MIT package: it refuses it
as `licence_crossed` the day it reaches the schema, a module, the command
line, the MCP server or any package under the AGPL.

**The rest of 0005 holds.** The schema of the core and its functions
(`supabase/`), the modules, the packs, the installer (`nexgen-os`) and the
MCP server (`@nexgen-os/mcp`) stay AGPL-3.0: they may depend on the MIT
core, never the other way round.

**Relicensing applies to the project's own code only.** Every file of
`packages/core` was written under the project's identity, with no
contributor's change in its history: the holder that licensed it under the
AGPL licenses it under MIT too. A contribution under the AGPL is never moved
into the core package without its author's agreement (0005 holds), and a
contribution to the core package from now on is made under MIT.

**Versions already published keep their licence.** `@nexgen-os/core` up to
0.5.1 was published under AGPL-3.0-only and stays so; the first version
published from this decision on is MIT.

## What it forbids

- A dependency of `@nexgen-os/core`, however far, on the schema, a module,
  the command line, the MCP server or any package under the AGPL.
- Moving into `packages/core` code whose history holds a contributor's
  change under the AGPL, or a port of a third party's code, without the
  right to license it under MIT.
- A copy of the repository's AGPL text shipped as the licence of the core
  package.

## See also

- [0005](0005-agpl-core-mit-libraries-sign-off.md) — the schema and the
  modules are AGPL, the libraries MIT; this record moves the core package to
  the MIT side.
- [0063](0063-the-computations-of-a-pv-yield-are-mit.md) — the computations
  of a PV yield are an MIT package; the same reasoning, drawn first for them.
- [0064](0064-an-mit-package-reaches-no-agpl-package.md) — an MIT package
  reaches no AGPL package, checked on every pull request.

# Road to 0.1 — the first public release

How Nexgen OS goes live, on the model of Ekwo OS, with the differences the
domain imposes. Each step is a checkbox because a release half done is
worse than none.

## What 0.1 is

The first version other people can install, read and build on: the core
schema in the `nexgen` schema, the `architecture`, `weather` and `solar`
modules, the format libraries (Home Assistant, geocoding, CityJSON) and the
connectors (Open-Meteo, PVGIS), one country pack (`fr`), seven example
datasets, and the decisions that explain them. Not stable: names may still
change until 1.0, and every change is written down.

## The steps

### Identity and ground rules

- [x] A GitHub organisation of its own, `nexgen-os`, and the repository in it.
- [x] Licences: AGPL-3.0 for the core and the modules, MIT for the format
  libraries and the connectors; DCO sign-off, no contributor agreement.
- [x] The manifesto says who builds it (WeSmart: Newide, AI4Energy), that
  Nexgen is WeSmart's commercial product built on the foundation, and that
  the foundation is also for research.
- [x] Where the open foundation stops and the product begins:
  `docs/nexgen-os-and-nexgen.md`; what the figures are: `DISCLAIMER.md`;
  how to report a flaw: `SECURITY.md`.
- [x] `AGENTS.md`: what an AI agent may do here, how, and what it never does.
- [x] **Commits and releases in the project's name.** A GitHub App of the
  organisation (as Ekwo does with its own app) signs and pushes every
  commit, tag and release; the history is rewritten once, before the
  repository goes public, so that no personal account and no assistant
  appears as an author. A ruleset on `main`: linear history, pull request
  and green checks for everyone, the app alone merging fast-forward.
- [x] A domain for the project's pages and schema identifiers: `nexgen-os.org`
  (decided 13/10/2026; `.io`, `.dev` and `.eu` held in defence), and the
  `@nexgen-os` scope on npm. The product keeps its own names (`nexgen.now`).
- [x] `nexgen-os.org` registered (13/10/2026, Gandi); `nexgen.now` registered the
  same day for the product. Still to do: point `nexgen-os.org` at the
  project pages, hold `.io`, `.dev` and `.eu`.

### What a release needs

- [x] **A schema version function**, `nexgen_schema_version()`, bumped by a
  migration of its own when a release adds anything a package reads.
- [x] **One installer**: `npx nexgen-os init` applies the core, the modules
  and the packs asked for on an empty Supabase project (PostGIS enabled),
  `nexgen-os migrate` brings an installation up to date, `nexgen-os doctor`
  says what is wrong. Ported from Ekwo's command line, which already does
  this for a schema, modules and packs.
- [ ] **The packages** on npm under `@nexgen-os`: the format libraries and
  the connectors, each usable without Nexgen OS; the installer; the core
  client.
- [ ] **An MCP server**, `@nexgen-os/mcp`, hosted and local, on the model
  of Ekwo's: an agent describes a site, imports a file, runs a yield and
  reads it back, as the user, under row level security. Agents are a first
  audience of this project, not an afterthought: `AGENTS.md` is written
  for them from 0.1.
- [x] **A changelog** per release, and a `docs/releasing.md` that lists what
  has to move, as Ekwo's does.
- [ ] Continuous integration: the test suite on three Node versions, a
  hygiene check (no country literal in code, no secret, English only), the
  DCO check, and `engine-pvlib` (the pvlib engine on Python 3.12, compared
  with `modules/solar/pvwatts.ts`).

### Before the first users

- [ ] A README that a stranger can follow from an empty Supabase project to
  a building with a yield, in twenty minutes, and the recording that proves
  it.
- [ ] The three ST2 readers that make the model worth filling: IFC
  (`IfcMapConversion`, floors and spaces), EPW/TMY weather files, PAN/OND
  product files.
- [ ] A second country pack, so that the pack mechanics are proven twice
  (`be`, with its three regional registers).
- [ ] The Nexgen application reads a Nexgen OS database for one real site,
  end to end.

## Where it differs from Ekwo OS

| | Ekwo OS | Nexgen OS |
|---|---|---|
| what is installed | a schema in `public` | a schema `nexgen`, PostGIS required |
| the unit of rules | a country pack | a country pack, with regions and municipalities inside it |
| what the libraries read | invoices, statements, filings | 3D models, weather, product files, device registries |
| what runs outside the database | nothing but the clients | the engines: yield, geocoding, format readers, connectors |
| the hosted operator | Ekwo OÜ (Estonia) | WeSmart (Newide, Belgium; AI4Energy, France) |
| the first audience | businesses and accountants | project holders, installers, cities, research partners |

The release mechanics are the same on purpose: one installer, versioned
packages, a schema floor the packages refuse to run below, a changelog,
releases cut by the project's own identity.

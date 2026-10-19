# Audit: the repository layout and the doctrine of Nexgen OS

Status: research, 19 October 2026, on `main` at `38f4c32`. Reference:
Ekwo OS, the accounting core built on the same playbook, read from a
checkout of its `main` branch.

This audit covers four questions: whether the root of the repository says
what Nexgen OS is (and where its core is), whether `formats/` holds formats,
how code is shipped, and what the written doctrine should be. The core
schema itself, the country packs and the time-series store are the subjects
of three companion audits; the points that belong to them are listed under
[Hand-offs](#hand-offs).

Every figure below was counted on the tree. "Lines" counts `.ts`, `.sql`,
`.py`, `.mjs`, `.js`, `.md`, `.json`, `.html` and `.css` files; "tests"
counts files named `*.test.*`, `test_*.py` or `*.spec.*`.

## 1. Layout side by side

### Root folders

| Nexgen OS | Files · lines · test files | What it holds | Ekwo OS counterpart (files · lines · test files) | Verdict |
|---|---|---|---|---|
| `supabase/` | 13 · 2,700 · 0 | the core: 12 migrations (2,544 lines, 40 tables, 38 functions, schema `nexgen`) and one seed of vocabularies (156 lines); no `config.toml` | `supabase/` (365 · 192,609 · 0): 195 migrations, the seeds, `config.toml` | **move** to `core/` (see below) |
| `modules/` | 16 · 3,460 · 0 | `architecture`, `weather`, `tasks` (SQL only), `solar` (SQL + 1,600 lines of TypeScript in five files), `3d` (a README, no migration) | `modules/` (49 · 15,403 · 9): each module has `module.json`, `supabase/migrations`, `tests/` | **keep**; give each module `src/` and `tests/` |
| `packs/` | 16 · 593 · 0 | `fr` (7 seeds), `be` (4 seeds), a `pack.json` each | `packs/` (1,506 · 338,766 · 0): one folder per country, JSON/CSV compiled to SQL, a golden year | **keep** (content: audit-packs) |
| `formats/` | 27 · 3,910 · 0 | 7 libraries, 2 shared files (`db.ts`, `geometry.ts`); tests live in `tests/` | `packages/formats/*`: 20 npm packages, each with its own tests | **move** to `packages/formats/*`, minus geocoding (§2) |
| `connectors/` | 5 · 497 · 0 | the connector interfaces and `storeSeries()` (`index.ts`, 161 lines), `open-meteo`, `pvgis` | none: bank files are format libraries | **move** to `packages/connectors/*`, with the geocoders (§3) |
| `engines/` | 17 · 1,428 · 0 | `pvlib` and `settlement-example` (Python, `pyproject.toml` each), TypeScript glue (`runner.ts` 166, `settlement.ts` 109, `pvlib/index.ts` 61) | none | **keep** for programs in other languages; glue moves (§3) |
| `sdk/` | 7 · 401 · 1 | `sdk/python`: the Python client, PyPI name `nexgen-os` | `packages/core` plays the same role in TypeScript | **rename** to `packages/python` (§3) |
| `packages/` | 16 · 1,359 · 3 | `packages/cli` only (`nexgen-os` on npm, 0.1.0) | `packages/{cli,core,mcp,formats}` (698 · 122,608 · 57) | **keep**; becomes the one home of shipped code |
| `examples/` | 9 · 750 · 0 | seven loadable SQL datasets and `yield.ts` | demo data lives in `supabase/seed/90_demo_company.sql` and `docs/demo/` | **keep** |
| `docs/` | 28 · 3,563 · 0 | `model.md`, 17 decisions, 7 research notes, `releasing.md`, `road-to-0.1.md`, `nexgen-os-and-nexgen.md` | `docs/` (116 · 16,912 · 0): `schema.md` (3,461 lines), 76 decisions with an index, `decisions.md` | **keep**; add `doctrine.md`, `decisions/README.md`; retire `road-to-0.1.md` |
| `scripts/` | 3 · 442 · 0 | `hygiene.mjs`, `publish.mjs`, `check-trusted-publishing.mjs` | `scripts/` (17 · 3,702 · 0), one check per rule | **keep** |
| `tests/` | 58 · 6,761 · 34 | every test of the core, modules, formats, connectors, engines, packs and examples, with `fixtures/` and `helpers/` | `tests/` (205 · 68,923 · 181) for the core; packages and modules carry their own | **keep** for the core and the examples; library and module tests move beside their code |
| `site/` | 1 · 57 · 0 | `index.html`, the project's landing page | none (the site is another repository) | **drop** or move to the site's own repository |

`.github/` holds the CI (`ci.yml`, 95 lines, five jobs), the release
workflow (`release.yml`, 64 lines), three issue templates and a pull-request
template; it stays as it is apart from the paths of §3.

### Root files

| Nexgen OS | Ekwo OS | Verdict |
|---|---|---|
| `README.md` (model in one screen, principles, install, layout) | `README.md` (why, schema in twenty lines, install, packages, what this is not) | **keep**; point "the model in one screen" at `core/README.md` and add "What this is not" (today in `DISCLAIMER.md`) |
| `MANIFESTO.md` (166 lines) | `MANIFESTO.md` | keep |
| `AGENTS.md` (an agent as a user of the model) | `AGENTS.md` (same, plus "Working on this repository") | keep |
| `CONTRIBUTING.md` (26 lines) | `CONTRIBUTING.md` (327 lines: schema rules, pack invariants, tests) | **keep, extend** with the rules of §4c |
| `DISCLAIMER.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `CHANGELOG.md` | same, plus `PRIVACY.md`, `CLA.md`, `REPORT.md` | keep; DCO stays instead of a CLA (§4b) |
| `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` | same, plus `Dockerfile`, `.env.example`, `glama.json` | keep; `web-ifc` leaves the root `dependencies` for `packages/formats/ifc` |

### "I see no core": where the core actually is

Neither repository has a folder named `core/`.

| | Ekwo OS | Nexgen OS |
|---|---|---|
| Schema | `supabase/migrations/` (195 files, schema `public`) | `supabase/migrations/` (12 files, schema `nexgen`) |
| Reference data | `supabase/seed/` | `supabase/seed/0001_core_vocabularies.sql` |
| The model on one screen | README "The schema in twenty lines": a tree of 30 tables in about twenty lines and the 12 functions that act on them | README "The model in one screen": a table of nine rows grouping the 40 tables; the four readers are named under "Principles", no act is |
| Every table and column | `docs/schema.md` (3,461 lines) | `docs/model.md` (164 lines, a diagram and the rules) |
| Code of the core | `packages/core` (`@ekwo-ai/core`: row types, a typed client of the schema's functions, the functions the CLI and the MCP server share) | none: `formats/db.ts`, `formats/geometry.ts` and `connectors/index.ts` hold what the code shares |

So the core is present in both, under the Supabase CLI's convention rather
than under its own name. Ekwo makes it visible by two texts (twenty lines
in the README, `docs/schema.md`) and one package. Nexgen OS has the texts
in a weaker form and no package, and four of its root folders
(`formats`, `connectors`, `engines`, `sdk`) carry code of the same rank as
the core, which is what makes the root read as a list of peers.

Two facts decide what a `core/` folder costs:

1. **The Supabase CLI fixes the migrations directory.** In version 2.107
   (the one installed here) migrations are read from
   `<workdir>/supabase/migrations`; `--workdir` moves the parent, not the
   folder, and `config.toml` has no key for it (`[db.migrations]
   schema_paths` is for declarative schema files, `[db.seed] sql_paths` can
   point anywhere). Nexgen OS ships no `config.toml` and installs through
   its own CLI, so nothing depends on that convention today.
2. **The installer records each file by its path.** `nexgen.schema_migrations`
   keys a step by its name, `supabase/migrations/<file>.sql`
   (`packages/cli/src/catalogue.ts:64-65`). Moving the files renames the
   steps: an installation of 0.1 would see the whole core as pending unless
   the installer maps the old names once.

| Option | What it is | Cost | Consequence |
|---|---|---|---|
| **A. `core/` holds the core** | `core/migrations/`, `core/seed/`, `core/README.md`; `supabase/` disappears | 2 lines of `catalogue.ts`, 2 of `copy-assets.mjs`, a rename map for recorded names (one migration or ten lines in `engine.ts`), 5 assertions in `packages/cli/tests/{engine,version}.test.ts`, 2 docs | the root says *core, modules, packs*; a `supabase db push` path, if ever wanted, needs a `config.toml` with `sql_paths` and a copy step |
| **B. `core/README.md` as an alias** | `supabase/` stays; `core/README.md` is the model in one screen and points to the migrations | one file | the core has a front door but two addresses; the root still lists `supabase` beside `modules` |
| **C. `packages/core`** | `@nexgen-os/core`: the row types, `Db`, the address and geometry helpers, `storeSeries()`, a typed client of the 38 functions | one package, part of the 25 imports of §3 | the code of the core gets a name; the schema still lives under `supabase/` |

**Recommendation: A, then C.** A answers the remark at the root at the cost
of one rename map, and costs least now, before 0.1 has many installations.
C is the code half of the same move and is the natural landing place of
`db.ts`, `geometry.ts` and `connectors/index.ts` (§2, §3). `core/README.md`
should be what Ekwo's twenty lines are: one tree of the key tables with
the functions that act on them, the content of which is audit-core's to
settle.

## 2. `formats/`

### Inventory

| Item | Code lines | Test file (lines, cases) | Runtime dependencies | Maps | A format? |
|---|---|---|---|---|---|
| `cityjson/` | 382 | `tests/cityjson.test.ts` (172, 5) | `../db`, `../geometry` | CityJSON 2.0 ⇄ buildings, footprints, roof and wall surfaces, identifiers, attributes | yes |
| `geocoding/` | 702 (`index.ts` 356, `belgium.ts` 268, `ban.ts` 78) | `tests/geocoding.test.ts` (128, 6) | none (a `Fetch` is injected) | an address ⇄ a point, through 6 services: Nominatim, Photon, BAN, Geopunt, UrbIS, ICAR | **no**: services, i.e. sources; two files are national registers |
| `geojson/` | 351 | `tests/geojson.test.ts` (233, 16) | `../db` | a site or project → FeatureCollection, open variant | yes (export only) |
| `homeassistant/` | 283 | `tests/homeassistant.test.ts` (145, 5) | `../db` | floors, areas, devices, entities, states ⇄ floors, spaces, devices, sensors, series | yes (a product's snapshot shape) |
| `ifc/` | 980 | `tests/ifc.test.ts` (301, 11) | `../db`, `../geometry`, `web-ifc` | IFC4/IFC2x3 → buildings, floors, spaces, roof surfaces, devices | yes (import only) |
| `panond/` | 312 | `tests/panond.test.ts` (130, 9) | `../db` | PVsyst PAN/OND → `device_directory` products | yes |
| `weather-files/` | 478 | `tests/weather-files.test.ts` (159, 11) | `../../connectors` (`storeSeries`, types) | EPW, TMY3 ⇄ `ghi`, `dni`, `dhi`, `temperature`, `wind_speed` series | yes |
| `db.ts` | 9 | — | — | the `Db` interface, imported by 5 libraries, by `connectors/index.ts` and by 3 files of `modules/solar` | no: database access |
| `geometry.ts` | 47 | — | — | WKT, Newell normal, azimuth and tilt, EPSG parsing; imported by `cityjson` and `ifc` | no: shared geometry |
| `README.md` | 22 | — | — | the list above | — |
| `LICENSE` | 21 | — | — | MIT, repeated in each library | — |

Database coupling: `cityjson` (7 queries), `geojson` (11), `homeassistant`
(10), `ifc` (12), `panond` (3) and `weather-files` (2) take a `Db` and read
or write the tables of `nexgen` directly; only `geocoding`, the parsers of
`panond` (`readPan`, `readOnd`) and of `weather-files` (`readEpw`,
`readTmy3`, `writeEpw`) are pure.

Two dependency cycles cross the root: `connectors/index.ts` imports `Db`
from `formats/db.ts` and `Address` from `formats/geocoding`, the two
connectors import `Fetch` from `formats/geocoding`, and
`formats/weather-files` imports `storeSeries` from `connectors/`.

No library has a `package.json`: none is published, all share the root
manifest (where `web-ifc` sits under `dependencies`), and their tests are
in `tests/` whereas the README says each has its own.

### Where units and quantities are handled

| Place | What it does |
|---|---|
| `supabase/migrations/20261012200100_core_vocabularies.sql:112` | `quantities`: one row per quantity with **one unit** (QUDT code) and its aggregation (`sum`, `mean`, `last`); "every stored value of this quantity is in this unit" |
| `supabase/seed/0001_core_vocabularies.sql` | 20 quantity rows |
| `formats/homeassistant/index.ts:95` | 15 pairs `device_class|unit → quantity, factor` (W → kW ×0.001, Wh → kWh…) |
| `formats/weather-files/index.ts:66,104` | fixed units per quantity (W/m², °C, m/s), missing-value markers per field |

So the rule is sound and in the core: a quantity has one unit, and each
library converts at its border with its own table. The impression of a
catch-all comes from the folder, not from units: a geocoder, two shared
modules of code and seven libraries that are importers into the schema
rather than readers of a format. A `units` vocabulary (code, quantity,
factor to the quantity's unit) would let a library look a factor up rather
than carry it; that is the core's choice (hand-off).

### Against Ekwo OS decision 0048

| Rule of 0048 | Nexgen OS today |
|---|---|
| one npm package per format under `packages/formats/` | one folder per format, no package |
| organised by format, never by country | `geocoding/ban.ts` and `belgium.ts` are national; `scripts/hygiene.mjs` exempts them by name |
| MIT, own `LICENSE` | yes |
| imports nothing from the core or another library | 6 of 7 import `../db.ts`; 2 import `../geometry.ts`; one imports `connectors/` |
| declares the flat row shapes it reads or returns | rows are read from and written to `nexgen` tables by SQL inside the library |
| zero runtime dependencies | `ifc` needs `web-ifc` (a parser of IFC; there is no lighter way) |
| a reader reports and never corrects (0049) | `weather-files` returns `warnings`; `importIfc` returns what it skipped: consistent |

### Proposal

1. **A format library parses and writes; an importer writes the model.**
   Each library exports `read<Format>()` → plain shapes and, where it
   writes, `write<Format>(shapes)`; it imports nothing of Nexgen OS. The
   part that writes `buildings`, `surfaces`, `devices` or `series` becomes
   `import<Format>(db, …)` in `packages/core` (or in the module whose tables
   it fills: floors and spaces belong to `architecture`). `panond` and
   `weather-files` already have this split; `cityjson`, `homeassistant`,
   `ifc` and `geojson` need it.
2. **Shared geometry** (`geometry.ts`, 47 lines) goes to `packages/core`
   for the importers, and is copied byte for byte into a library that needs
   it, pinned by a test, as Ekwo 0048 does for rounding.
3. **`db.ts`** goes to `packages/core`.
4. **Geocoders leave `formats/`**: `nominatim`, `photon`, `ban`, `geopunt`,
   `urbis`, `walloon` are services, hence connectors
   (`packages/connectors/geocoding-*` or one package per service); the
   address shape and `siteFields()` / `addressLines()` go to
   `packages/core`, beside decision 0009 they implement.
5. **Each library gets its `package.json`, `README.md`, `LICENSE` and
   `test/`**, and its fixtures move with it.

The reduced `formats/README.md` (then `packages/formats/README.md`):

```markdown
# Format libraries

One MIT package per file format, organised by format and never by country.
Which formats a place uses is said by its data, never by this directory.

Each package:

- has its own `LICENSE` (MIT), `package.json` and tests, and can be used
  without Nexgen OS;
- imports nothing from Nexgen OS and declares the shapes it reads and
  returns in its own types;
- reports what it cannot read in `warnings[]` and never corrects it;
- converts units at its border into the unit of the core's quantity.

Writing what a file holds into the model is an importer's job, in
`@nexgen-os/core` or in the module whose tables it fills.

| Package | Format | Reads | Writes |
|---|---|---|---|
| `@nexgen-os/cityjson` | CityJSON 2.0 | yes | yes |
| `@nexgen-os/geojson` | GeoJSON | — | yes |
| `@nexgen-os/homeassistant` | Home Assistant registry and recorder snapshot | yes | yes |
| `@nexgen-os/ifc` | IFC4, IFC2x3 | yes | — |
| `@nexgen-os/panond` | PVsyst PAN and OND | yes | — |
| `@nexgen-os/weather-files` | EPW, TMY3 | yes | EPW |
```

## 3. Code shipping conventions

### Today: six places, one of them a package

| Place | Language | Licence | Manifest | Published | Tests | Imports from |
|---|---|---|---|---|---|---|
| `formats/` | TypeScript | MIT | none | no | `tests/` (7 files) | `formats/db.ts`, `connectors/` |
| `connectors/` | TypeScript | MIT | none | no | `tests/connectors.test.ts`, `tests/pvgis.test.ts` | `formats/` |
| `engines/` | Python + TypeScript glue | MIT | `pyproject.toml` ×2 (`nexgen-pvlib`, `nexgen-settlement-example`) | no (`release.yml` publishes npm only) | `tests/engines-*.test.ts` (3) | `connectors/` |
| `sdk/python` | Python | MIT | `pyproject.toml` (`nexgen-os`) | no | `sdk/python/tests/test_client.py`, run by `tests/sdk-python.test.ts` | — |
| `packages/cli` | TypeScript | AGPL-3.0 | `package.json` (`nexgen-os` 0.1.0) | yes, the only npm workspace | `packages/cli/tests/` (3) | — |
| `modules/solar/*.ts` | TypeScript | AGPL-3.0 | none | no | `tests/solar-*.test.ts` (7) | `formats/`, `connectors/`, `engines/` |

`examples/yield.ts` also imports `packages/cli/src/sql.js` by path.
`scripts/publish.mjs` publishes "whatever is a workspace and is not
private", and the root `package.json` declares one workspace pattern,
`packages/*`: so the MIT libraries the README promises "can live inside
any product" cannot be installed by anyone today.

It is four ways to do one thing (a folder of TypeScript at the root, a
folder of TypeScript inside a module, a workspace package, a Python
project), plus the engines, which are rightly different because they are
programs in another language behind a JSON contract (decision 0013).

### Proposed convention

```
core/                      the schema: migrations/, seed/, README.md        AGPL
modules/<code>/            migrations/, src/, tests/, README.md             AGPL
packs/<cc>/                data only                                        AGPL
packages/
  cli/                     nexgen-os (npm)                                  AGPL
  core/                    @nexgen-os/core: types, Db, client, importers,
                           storeSeries, address, geometry, engine runner    AGPL
  formats/<format>/        @nexgen-os/<format>                              MIT
  connectors/<source>/     @nexgen-os/<source>  (open-meteo, pvgis,
                           nominatim, photon, ban, geopunt, urbis, icar)    MIT
  python/                  nexgen-os (PyPI)                                 MIT
engines/<tool>/            nexgen-<tool> (PyPI), any language, contract 1   MIT
```

Rules: **TypeScript ships under `packages/*` by role; a module's own code
stays in the module; a program in another language is an engine.**
Package names: the CLI keeps `nexgen-os` (npm), every other npm package is
`@nexgen-os/<name>` with the format, source or role as name (decision
0016), the Python client keeps `nexgen-os` on PyPI and engines are
`nexgen-<tool>`. The npm scope `@nexgen-os` must be reserved before the
first publish.

Where the engine glue goes: `engines/runner.ts` (the JSON contract) and
`engines/settlement.ts` to `packages/core`; `engines/pvlib/index.ts` (the
request and result types of one engine) to `modules/solar/src/`, which is
its only caller.

### Options and cost

| Option | What moves | Cost |
|---|---|---|
| **A. Everything TypeScript under `packages/*`** (above) | `formats/` (7 libraries), `connectors/` (3 files), engine glue (3 files), `formats/db.ts`, `formats/geometry.ts`, `connectors/index.ts`; `sdk/python` → `packages/python` | 25 imports across folders in code (listed in §2 and above, plus 4 inside `engines/` once the runner moves) and 47 import lines in `tests/` (16 to formats, 15 to connectors, 5 to engines, 11 to modules); `tsconfig.json` `include` (10 globs) and `vitest.config.ts` `include` (4 globs) gain `packages/*/*/…`; root `workspaces` gains `packages/formats/*`, `packages/connectors/*`; `ci.yml`: the paths `engines/pvlib` stay, `sdk/python` becomes `packages/python` (2 lines); `scripts/hygiene.mjs`: the `isData` exemption `formats/geocoding/…` becomes `packages/connectors/…` (1 regex); `publish.mjs` needs nothing (it reads workspaces); links in about 60 Markdown files (24 name `formats/`, 9 `connectors/`, 12 `engines/`, 4 `sdk/`, 13 `modules/`, some overlapping) |
| **B. Packages in place** | each of `formats/<f>`, `connectors/<c>` gets a `package.json`; root `workspaces` lists `formats/*`, `connectors/*` | no import moves; the cycle `connectors ⇄ formats` must still be broken (a `core` package is needed anyway); the root keeps six code folders |
| **C. Status quo, documented** | nothing | the libraries stay unpublishable; the root stays a list of peers |

**Recommendation: A**, in three pull requests that each leave the suite
green: (1) `packages/core` with `db.ts`, `geometry.ts`,
`connectors/index.ts` and the engine runner, which breaks the cycle;
(2) `packages/formats/*` and `packages/connectors/*`, the geocoders
included, with the importers split out; (3) `core/`, `packages/python`,
`modules/solar/src/`. `sdk/python` could instead become an engine-side
client (`engines/python-client`), but it is a reader of the model like
`@nexgen-os/core`, not an engine, and `packages/python` keeps both clients
together.

## 4. Doctrine

### (a) The 76 decisions of Ekwo OS, against Nexgen OS

**A** applies as is · **T** applies translated · **N** not applicable.

| # | Title | | How it applies |
|---|---|---|---|
| 0001 | One installation belongs to one customer | T | one installation, many organisations; `organisation_id` on every table, never a `tenant_id` |
| 0002 | The surface is closed, not merely empty | A | |
| 0003 | The schema grants its own rights | A | |
| 0004 | A permission is a capability; a role is a preset | T | `organisation_members.role` becomes presets over capabilities (`devices.write`, `runs.record`…) |
| 0005 | A guard answers true or false, and reads as the schema | A | |
| 0006 | A machine key is a caller narrower than a person | T | a connector's or a gateway's key, scoped to an organisation and capabilities |
| 0007 | An invitation names an address, not a user id | A | |
| 0008 | Documents and entries are two joined layers | T | a description (objects) and a computation (runs, series) are two layers |
| 0009 | Accounts have types and are resolved by role | T | a device or a series is found by its type and quantity code, never by a name pattern |
| 0010 | Amounts are positive; totals are derived | T | direction is a quantity (`energy_import`, `energy_export`), not a sign; aggregates are derived by `resample()` |
| 0011 | An amount is rounded at the decimals of its currency | T | a value is stored in the unit of its quantity |
| 0012 | A number is drawn at posting, from the country's pattern | N | |
| 0013 | Locks live in the database, and everything raises | A | "everything raises, by name" already holds in AGENTS.md |
| 0014 | A posted entry is immutable, in an open period too | T | a finished run never changes (Nexgen 0004) |
| 0015 | A posted document is frozen | T | a publication is frozen (Nexgen 0015) |
| 0016 | A correction is one gesture | T | a corrected figure is a new run that supersedes, through one function |
| 0017 | An append-only audit trail surrounds the ledger | T | around descriptions and attachments, not around `series_values` |
| 0018 | Reports read the ledger and know no country | T | reads (`resample()`, rollups) read series and know no country |
| 0019 | A tax posting carries the account and the box | N | |
| 0020 | One tax engine, several kinds of tax | T | one engine contract, several request kinds (yield, settlement) |
| 0021 | Cash-basis VAT waits; exchange differences are realised | N | |
| 0022 | A price that holds its tax is converted per group | N | |
| 0023 | Declaration boxes are data, with no expression language | T | a pack's rules and tariffs are rows, with no expression language |
| 0024 | A tax follows the territory of the parties | T | a rule follows the region of the site (ISO 3166-2, Nexgen 0009) |
| 0025 | A country is a pack of data, compiled into SQL | A | |
| 0026 | Ekwo maintains a pack; only an accountant reviews one | T | only a named professional of the trade (grid, building law) reviews a pack |
| 0027 | The sources of a pack are a register, not a bibliography | T | `sources` already is that register; where legal texts live is audit-packs' |
| 0028 | A pack upgrade is never silent | A | |
| 0029 | A golden year is the contract of a pack | T | a golden site per pack: a reference site and the figures its runs give |
| 0030 | A country has charts, and a financial statement is data | N | |
| 0031 | Opening and closing are parameters, not code | N | |
| 0032 | The audit file carries opening balances, never posted | N | |
| 0033 | What a country requires on a document is data | T | which identifiers a country requires on a site or a meter is data (`id_schemes`) |
| 0034 | A label is data, and a declared language is a promise | A | |
| 0035 | The chart stays whole; the working list is derived | N | |
| 0036 | Filing cadence is data, counted in months | N | |
| 0037 | A filed declaration is frozen and superseded, not edited | T | a published study is superseded by a new one, never edited |
| 0038 | A deadline is a rule of the country; null is an answer | T | a default is a value of a level (pack, organisation, project); null is an answer, never a borrowed country |
| 0039 | A deposit is an event, written from the frozen figures | N | |
| 0040 | A portfolio is what the caller may read | A | a portfolio of sites is what row level security lets the caller read |
| 0041 | A company has a profile; its first year is a parameter | T | an organisation's and a project's defaults are columns, not settings rows (audit-packs) |
| 0042 | A document is shared by a link that is the whole secret | A | |
| 0043 | A company leaves with its books | A | an organisation leaves with its places, devices and series |
| 0044 | A product is a catalogue entry in the core, not stock | T | `device_directory` pre-fills a device and never constrains it |
| 0045 | A counterparty is recognised from learned patterns | N | |
| 0046 | Settling applies identification, offers resemblance | T | a building or a meter matched by identifier is applied; matched by address or shape is offered |
| 0047 | A bank statement is imported once | T | a file is imported once (`already_imported` exists) |
| 0048 | Format libraries are MIT, one package per format | T | §2: adopted, with importers outside the library |
| 0049 | A statement reader reports and never corrects | A | |
| 0050 | An invoice file is written from the books | T | an export is written from the model's rows, never recomputed |
| 0051 | A module has its own schema and posts through a function | T | own schema already; writes to the core through `record_run()` and `derive_devices()`; the core in `nexgen`, not `public` (Nexgen 0010) |
| 0052 | The installer needs only Node and the customer's project | A | holds today |
| 0053 | The MCP server acts as the user | A | AGENTS.md says it; no MCP server ships yet |
| 0054 | The command line answers one document and an exit code | A | |
| 0055 | The command line acts as a signed-in person | A | when the CLI goes beyond installing |
| 0056 | The command line computes no amount | T | no client computes a figure; a figure is a run |
| 0057 | Two install paths make one installation | T | one path today (`nexgen-os init`); either state it or ship a `config.toml` and test both |
| 0058 | `ekwo doctor` compares against a generated inventory | A | |
| 0059 | A release has a tag, a schema version and a schema floor | A | `schema_version_0_1_0` and `schemaMin` exist |
| 0060 | Under load, the plan is the assertion, not the clock | A | |
| 0061 | AGPL core, MIT formats, an operational paid line | T | same lines, with a DCO instead of a CLA (Nexgen 0005) |
| 0062 | A machine key reaches the API, and is on its own company | A | |
| 0063 | A module code outlives its names | A | |
| 0064 | A key writes as the person who issued it | A | |
| 0065 | A shared instance keeps its tenants apart | A | |
| 0066 | A filing is proved by its hash, on a public ledger | T | a publication carries its sha256 (Nexgen 0015); a public ledger is optional |
| 0067 | An opening on the day of the takeover, with its open items | N | |
| 0068 | An analysis for every country, by account type | T | one set of indicators (specific yield, self-consumption) for every country, by device type |
| 0069 | A piece goes on its document | T | a file goes on its object (`documents`) |
| 0070 | A third-party line that names nobody is named once | N | |
| 0071 | Several lines settle together, and a small difference is booked | N | |
| 0072 | A line may be left unnamed, and a name among several is a doubt | N | |
| 0073 | The sure pairs are matched in one gesture | N | |
| 0074 | Two contacts of one company are merged, and the absorbed one is retired | T | two objects that are one are merged and the absorbed one retired (`successors`) |
| 0075 | The contacts that are probably one party are proposed | T | probable duplicates (same identifier, overlapping footprint) are proposed, never merged |
| 0076 | An analytic value is entered on the line, and read from the ledger | N | |

Tally: 23 as is, 36 translated, 17 not applicable. What does not apply is
bookkeeping proper (numbering, VAT, charts, matching of bank lines); every
rule about rights, packs, formats, modules, the installer and releases
carries over.

### (b) The 17 decisions of Nexgen OS

| # | Title | Against Ekwo's principles |
|---|---|---|
| 0001 | One entity table, with everything else attached to it | **form**: withdrawn the same day by 0006 and kept; Ekwo rewrites a decision in place and leaves its history to git. Fold its surviving part (attachments through one registry) into 0006 |
| 0002 | Standards enter through the vocabularies | consistent (0034: identifiers English, labels data) |
| 0003 | Geometry in WGS 84, three-dimensional, measured in UTM | consistent |
| 0004 | Modules hand results back as immutable, reproducible runs | consistent (0014, 0056) |
| 0005 | Questions to settle before 0.1 | **form**: a list of questions is not a rule; Ekwo records only what holds. DCO instead of Ekwo's mandatory CLA (0061) is a reasoned divergence, kept |
| 0006 | Named objects, in the words of the trades | consistent: the Ekwo factoring (one `contacts` table) is the model; whether 40 tables are few enough is audit-core's |
| 0007 | Series at scale: plain Postgres, partitioned, one read API | consistent (0060); content is audit-series' |
| 0008 | The `3d` module: the shape of what is built | **form**: proposed, no migration ships (`modules/3d/` is a README); Ekwo writes a decision when the rule holds |
| 0009 | Addresses, positions and geocoding | **content**: national geocoders inside `formats/` break "by format, never by country" (0048); the fix is §2 |
| 0010 | Where Ekwo OS runs, and what the bridge is | reasoned divergence: the core in schema `nexgen` where Ekwo's socle is in `public` (0051); keeps the rule "one schema per core, one per module" |
| 0011 | External data: sources, connections, connectors | consistent (0027, 0006) |
| 0012 | The `solar` module: a yield that says what it was computed from | consistent; it plans modules (`storage`, `charging`, `sharing`…) that do not exist, which belongs in a road map |
| 0013 | External engines: one request in, one result out | consistent (0020 translated) |
| 0014 | Integrations: dashboards, warehouses and streams through three doors | **form**: names `formats/grafana` and doors not built; partly a plan |
| 0015 | Publications: what the public reads, and how | **form**: lives in a `participation` module that does not ship |
| 0016 | Third-party tools and methods: where their names go | consistent (0063); its table of families changes with §3 |
| 0017 | Tasks: what has to be done is data of the country | consistent with Ekwo (0038 puts deadlines in packs) but at odds with tasks that are the same in every country (a feasibility study, a sizing); audit-packs |

No decision contradicts an Ekwo principle in substance; five break the form
Ekwo's records keep (a record states a rule that holds today), and one
(0009) breaks a rule in content through the place of its code.

### (c) The recurring principles of Ekwo OS

Extracted from Ekwo's `README.md` ("Why Ekwo", "What this is not"),
`MANIFESTO.md`, `docs/decisions/README.md`, `AGENTS.md` and
`CONTRIBUTING.md` ("Working on the schema", "Country rules").

**Naming**
- Identifiers are English, permanently; labels are data in every language a pack declares.
- snake_case, plural table names; foreign keys `<entity>_id`; `created_at`, `updated_at`.
- A third party's name lives where its data, computation or file is; elsewhere a function says what it does (Nexgen already has this as 0016).
- A module's code is permanent; its other names may become more precise.
- A decision's title is the rule it sets: "a X is a Y", "the schema grants its own rights".

**Tables**
- Few concrete objects, named after what the trade calls them; one table for one notion (`contacts`, not suppliers and customers).
- Compact columns: what every row has; the rest is a line table, never JSON.
- Totals are derived, never keyed in: if a header and its lines can disagree, one day they will.
- What was posted is frozen; correcting is a new gesture, never an edit.
- `company_id` on every table, no `tenant_id`.

**Functions**
- Every business act is one function of the schema (`post_document`, `reverse_entry`, `close_fiscal_year`); clients call it and compute nothing.
- A module writes the core through one function, never by hand.
- A guard answers true or false; a function sets its search path and is revoked from public.
- One rule exists once: what two clients share is in the core package.

**Refusals**
- Locks live in the database; everything raises, nothing warns.
- A refusal has a name, read in one place; the CLI answers one document and an exit code.
- A reader reports and never corrects; nothing is invented to satisfy a validator.
- No fallback country: a missing value is named, never borrowed.

**Data over code**
- A country is data, and data cannot execute: no expression language, no hook, closed vocabularies.
- No country literal in code, enforced by a check.
- A legal reference on every rule; a golden scenario proves a pack.
- A pack upgrade is never silent; nothing is deleted from a pack, it is dated.

**Ownership and machines**
- The data belongs to its owner; the installation stands with or without the vendor.
- Nothing in the core calls a model; the same inputs give the same figure.
- An agent is a user, with the same rights, through the same functions.
- The schema grants its own rights; the surface is closed.

### (d) Outline of the Nexgen OS doctrine

Status: **exists** (number of the current record, retitled), **to write**,
**fold** (merged into another). "Inherits" names the Ekwo records it
translates.

| # | Title | Theme | Status | Inherits |
|---|---|---|---|---|
| 1 | The core names a few objects, and everything else is attached to them | objects | exists 0006 (+ 0001 folded) | 0008, 0044 |
| 2 | A device is anything installed, and a sensor is a point of a device | objects | to write (audit-core) | 0044 |
| 3 | A product is a catalogue entry, and a device is an instance of it | objects | exists 0005 (part) | 0044 |
| 4 | A value attached to an object carries its period and its source | objects | exists 0006, 0011 (part) | 0027 |
| 5 | Two objects that are one are merged, and the absorbed one is retired | objects | to write (`successors`) | 0074, 0075 |
| 6 | Geometry is stored in WGS 84 in 3D, and measured in UTM | geometry | exists 0003 | — |
| 7 | An address has the fields every country has, and a position says how precise it is | geometry | exists 0009 | 0024 |
| 8 | A device is mounted on a surface or a space | geometry | to write (audit-core) | — |
| 9 | Heavy geometry stays in object storage, and a row points to it | geometry | exists 0003, 0008 (part) | — |
| 10 | A series belongs to an object, and a value is dated at the start of its interval | series | exists 0007 (+ forecasts of 0011) | — |
| 11 | A value is stored in the unit of its quantity | series | to write | 0011 |
| 12 | An aggregate is derived by one function, never stored as truth | series | exists 0007, 0014 (part) | 0010, 0018 |
| 13 | A figure is a run: the same inputs give the same run | computation | exists 0004 | 0014, 0016, 0056 |
| 14 | An engine reads one request and answers one result | computation | exists 0013 | 0020 |
| 15 | A third party's name goes where its data, its computation or its file is | computation | exists 0016 | 0063 |
| 16 | A module has its own schema and writes the core through a function | modules | to write (from 0006, 0012) | 0051 |
| 17 | A module code outlives its names | modules | to write | 0063 |
| 18 | A country is a pack of data, and data cannot execute | packs | to write (audit-packs) | 0023, 0025 |
| 19 | A default is a value of a level, and null is an answer | packs | to write (audit-packs) | 0038, 0041 |
| 20 | A pack upgrade is never silent, and a golden site is its contract | packs | to write | 0028, 0029 |
| 21 | A format library is MIT, one package per format, and reads no database | formats | to write | 0048 |
| 22 | A file is imported once, and a reader reports rather than corrects | formats | to write | 0047, 0049 |
| 23 | A source is a row, a connection names a secret, a connector is code | formats | exists 0011 | 0006, 0027 |
| 24 | The schema grants its own rights, and the surface is closed | security | to write | 0002, 0003, 0005 |
| 25 | Everything raises, by name | security | to write | 0013, 0054 |
| 26 | An agent is a user of the model | agents | to write (from AGENTS.md) | 0053, 0055 |
| 27 | Integrations come through three doors | agents | exists 0014 (trimmed to what ships) | — |
| 28 | What the public reads is a publication, kept as it was published | agents | exists 0015 (once `participation` ships) | 0037, 0042, 0066 |
| 29 | A release has a tag, a schema version and a schema floor | releases | to write | 0058, 0059 |
| 30 | The core is AGPL, the libraries MIT, and a sign-off is enough to contribute | releases | exists 0005 (part) | 0061 |

Thirty titles: 15 rest on an existing record, 15 are to write. Decisions
that are about one module (0010 the Ekwo bridge, 0012 `solar`, 0017
`tasks`) stay records but are not doctrine: they move under a heading
"Modules" of the index, or into the module's README.

### (e) Where the doctrine lives

- **`docs/doctrine.md`**, one screen: the 30 titles of (d) in six groups,
  each a link, and the rules of (c) that a contributor checks first.
  The README's "Principles" points to it instead of restating five.
- **`docs/decisions/NNNN-<title>.md`**, one file each, in Ekwo's five parts
  (Status, Context, Decision, Consequences, See also), titled as the rule.
  Numbers already published keep their file; the file is retitled and
  rewritten in place, the old slug kept as the file name or redirected by
  the index.
- **`docs/decisions/README.md`**, the index grouped by theme, with Ekwo's
  rule that a record states what holds today and a plan lives in a road
  map.

## Decisions for the owner

1. **Where does the core live at the root?**
   - A. `core/` with `migrations/`, `seed/`, `README.md`; `supabase/` removed. Cost: ~10 lines of the installer, a rename map for 0.1 installations, 5 test assertions. The root reads *core, modules, packs, packages*.
   - B. `core/README.md` only, migrations stay in `supabase/`. Cost: one file. The core has two addresses.
   - C. Nothing at the root; `packages/core` alone. Cost: one package. The schema stays unnamed.
   - **Recommended: A**, with `packages/core` as the code half: it answers the remark where it is made, and costs least before 0.1 has many installations.

2. **One convention for shipped code?**
   - A. All TypeScript under `packages/*` by role (`cli`, `core`, `formats/*`, `connectors/*`, `python`); `engines/` for other languages; module code in `modules/<m>/src`. Cost: 25 code imports, 47 test imports, links in ~60 docs, 2 config globs, 2 CI lines, 1 hygiene regex, in three pull requests.
   - B. Make `formats/*` and `connectors/*` packages where they stand. Cost: manifests only, plus a core package to break the cycle. The root keeps six code folders.
   - C. Keep the layout, document it. Cost: none. The MIT libraries stay unpublishable.
   - **Recommended: A**: one rule ("TypeScript ships under `packages/`, another language is an engine") and the libraries become installable.

3. **What may a format library touch?**
   - A. Nothing of Nexgen OS: it parses and writes plain shapes; importers that write the model live in `@nexgen-os/core` or the module. Cost: split 4 libraries (`cityjson`, `homeassistant`, `ifc`, `geojson`). Matches Ekwo 0048; usable by any product.
   - B. A `Db` interface, MIT, shared by every library. Cost: none now. The libraries stay tied to the `nexgen` schema.
   - **Recommended: A**: a library that writes `nexgen.buildings` is an importer, and calling it a format library is what makes `formats/` read as a catch-all.

4. **Where do geocoders go?**
   - A. Connectors: `@nexgen-os/nominatim`, `photon`, `ban`, `geopunt`, `urbis`, `icar`; the address shape to `@nexgen-os/core`. Cost: 3 files, 1 hygiene regex. Consistent with 0009 ("geocoders are sources").
   - B. Keep `geocoding` as one library. Cost: none. Keeps two national adapters in a folder organised by format.
   - **Recommended: A.**

5. **How is `sdk/python` named and placed?**
   - A. `packages/python`, PyPI `nexgen-os`. Cost: 2 CI lines, 4 doc links. Both clients side by side.
   - B. Stay in `sdk/python`. Cost: none. One more root folder.
   - **Recommended: A.**

6. **What form do the decision records take?**
   - A. Ekwo's: a record states a rule that holds, titled as the rule, rewritten in place; 0001 folded into 0006, 0005 split into 30 and a road map, plans removed from 0008, 0014, 0015. Cost: rewriting five records, an index.
   - B. Keep the records as written, add new ones in the new style. Cost: none now. Two styles, and withdrawn records stay readable as rules.
   - **Recommended: A**: a doctrine is read as what holds; a plan in a decision is read as a promise.

7. **Which doctrine to write?**
   - A. The 30 titles of §4d, `docs/doctrine.md` on one screen, 15 new records. Cost: 15 records of ~40 lines.
   - B. Only `docs/doctrine.md`, records written as questions arise. Cost: one page. The why stays unwritten.
   - **Recommended: A**, written in the order of the moves (records 2, 8, 16, 21 first, since the core and layout moves depend on them).

8. **`site/` at the root?**
   - A. Move the landing page to the site's own repository. Cost: one file.
   - B. Keep it. Cost: none. A product page among the folders of the foundation.
   - **Recommended: A.**

## Hand-offs

- **audit-core**: whether `sensors` becomes a kind of device (record 2 of
  §4d); mounting a device on a surface or a space and which part of
  `architecture` enters the core (record 8); the contents of
  `core/README.md` (the key tables and their functions); a `units`
  vocabulary for format libraries to read factors from (§2); whether
  importers that fill `floors` and `spaces` live in the `architecture`
  module; `core_regulation.sql` in the core.
- **audit-packs**: where legal sources live (Ekwo 0027 translated), the
  defaults cascade (records 18, 19), country task templates against decision
  0017, the golden site of a pack (Ekwo 0029), and whether `pack.json`
  moves to Ekwo's manifest-plus-compiled-seed format.
- **audit-series**: the store behind `series_values` (decision 0007), the
  read API (`resample()`), and whether `storeSeries()` belongs in
  `@nexgen-os/core` or in the series package it chooses.

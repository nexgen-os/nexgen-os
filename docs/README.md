# `docs/` — the long-form reference

| File | What it is | Edited how |
|---|---|---|
| [`model.md`](model.md) | The core model: the six objects, what attaches to them, the vocabularies, the countries and the gestures that keep them, with the diagram of every table of the schema `nexgen` | By hand, when a table, a column or a gesture of the core changes |
| [`doctrine.md`](doctrine.md) | The rules that hold, one line each, grouped by theme, each linking to the decision that says why | By hand, when a decision is added or rewritten |
| [`decisions/`](decisions/README.md) | One record per design decision — context, decision, consequences — with an index by subject | By hand: a new decision takes the next number, a changed one is rewritten to say what holds now |
| [`with-ekwo-os.md`](with-ekwo-os.md) | Nexgen OS and Ekwo OS on one database: what each core keeps, how a settlement line reaches an invoice, how the two install side by side | By hand, when the bridge or either installer changes |
| [`services.md`](services.md) | Where this repository stops: what is open, and what is a service built around it | By hand, when the line moves |
| [`road-to-1.0.md`](road-to-1.0.md) | What the promise of 1.0 covers, what is planned before it, and where the code does not yet follow a written decision | By hand, as a proof lands or a promise is settled |
| [`releasing.md`](releasing.md) | How a release is cut: the schema-version migration, the package versions, the changelog, the tag and what is published | By hand, when the procedure changes |
| [`demo/`](demo/README.md) | One loadable dataset per domain — a house, a school, an energy community, a farm, a district, a drone survey, an office — and `yield.ts`, the yield of a PV system computed as an estimate and read back by month | By hand; `tests/demo.test.ts` loads every dataset and checks what it holds |

The short version of each folder lives in that folder's own README. Start
there; come here when you need the whole picture. Four of those READMEs are
worth naming: [`supabase/`](../supabase/README.md) says what the core puts in
the database and how `npx nexgen-os init` applies it,
[`modules/`](../modules/README.md) the rules a module follows and the folder it
lives in, [`packs/`](../packs/README.md) what a country pack holds and how it is
compiled into a seed, and [`packages/cli/`](../packages/cli/README.md) is the
installation guide.

# Nexgen OS

Nexgen OS is an open digital twin of energy places — organisations, projects, participants, their meters, devices and series — driven by AI agents that work as users of the model
([0039](docs/decisions/0039-an-agent-is-a-user-of-the-model.md)).

Nexgen OS is the open foundation and the reference language. **Nexgen**, the
commercial platform of **WeSmart** (Newide, Belgium; AI4Energy, France), is
built on it and remains WeSmart's product: this repository describes the
foundation, not the product. Why the foundation exists and what it promises:
[MANIFESTO.md](MANIFESTO.md). Where the open foundation stops and the product
begins: [docs/nexgen-os-and-nexgen.md](docs/nexgen-os-and-nexgen.md). What the
figures are and are not: [DISCLAIMER.md](DISCLAIMER.md).

> Status: **0.1, the first release** — the core schema, the `architecture`, `weather`,
> `solar` and `tasks` modules, the format libraries, the Open-Meteo and PVGIS connectors,
> program connectors in any language with pvlib (Python) as the first, the `nexgen-os`
> installer, the `fr` and `be` country packs and seven example datasets; each is described
> in the [changelog](CHANGELOG.md). Tested; names may still change until 1.0, and every
> change is written down.

## The model in one screen

Six objects, in the order a page walks them — the organisation, the
project it works on, the participants taking part in it, the meters they
carry, the devices behind those meters, the series they produce — and
attachments to anything else, in the schema `nexgen`. In plain words:

- **the organisation** owns the data and has members;
- **the project** is what a person works on — a community, a portfolio, a study, a district plan;
- **the participant** is the node: an actor with its address and its point on the map, every module links to it;
- **the meter** is its connection point to a network, the frontier between the grid and the place;
- **the device** is what it has behind the meter — a PV system, a battery, a charger, a heat pump, a probe;
- **the series** is a quantity of any of them over time, as many per device as it measures.

The physical description of a place — its ground, buildings, floors, rooms
and roof faces — enriches the participant in the `building` module; a
device is not placed ([0045](docs/decisions/0045-the-participant-is-the-node.md)).

Three rules shaped this structure, and settle every new question about it:
**keep it simple**; **few words** — one word per thing across schemas,
folders and documents (the meter is `meters` in the core and `grid.meters`
in the grid module); and **stay close to the platform this core comes from**,
whose structure has proven itself in the field. The table that groups the
core's tables, the functions that act on them and the standards they follow
is in [core/README.md](core/README.md); the diagram and the rules are in
[docs/model.md](docs/model.md); the rules and why in
[docs/doctrine.md](docs/doctrine.md).

## Principles

1. **Six concrete objects, few tables.** A participant is a row of
   `participants`, a building a row of `building.buildings`, and the
   hierarchy is their foreign keys. An attribute, an identifier, a document
   or a series names one of the six objects of the core by its kind and its
   id (`('participant', id)`), with no registry and no table of kinds; the
   core is twenty-seven tables and one view. A new kind of thing is a
   module table with its own columns; a new property is a vocabulary row; a
   new API is a source row.
2. **3D WGS 84 everywhere.** Any CRS is accepted on the way in; geometry is
   stored in EPSG:4326 with heights in metres, and measured in the UTM zone it
   falls in, anywhere on earth.
3. **One way to read, one way to write.** `attributes_of()` for attributes,
   `resample()` for series (the amount of each bucket, a register's
   consumption included; `window()`, `latest()`, `fill()`, `forecast_at()`
   beside it), `participant_of(kind, id)` and `country_of(kind, id)` for whose and where, `building.building_volume()`
   for a derived 3D block. Values are written by `store()` alone, which
   converts their unit, checks their quality and step, and refreshes the
   aggregates; clients never resample, convert or fill.
4. **Deterministic core, operable by an agent.** Nothing in the core calls a
   model; a module keeps what it computes as its runs, written through
   `record_run('<module>.runs', …)`: same inputs, same engine, same run. On top of it, an AI agent works as a user of the
   model — the same tables, the same rights, the same refusals by name — so
   that describing and studying a place can be delegated without the data
   leaving its owner ([AGENTS.md](AGENTS.md)).
5. **Modules in their own schema, countries as data, formats by format,
   invoices in Ekwo OS** ([why](#invoicing-and-ekwo-os)).

## Install

On an empty Supabase project with PostGIS enabled
(`create extension if not exists postgis with schema extensions;`):

```bash
export NEXGEN_DB_URL='postgresql://…'   # the project's connection string
npx nexgen-os init --dry-run            # what would be applied
npx nexgen-os init                      # the core and every module; --packs <cc> for a country
npx nexgen-os doctor                    # what is wrong, by name
```

Program connectors are optional: a yield computed by pvlib needs Python and
`packages/connectors/pvlib` installed, as [`packages/connectors/README.md`](packages/connectors/README.md#programs-in-any-language) says.

From Python, the client reads the model and attaches with a source:
[`packages/python/README.md`](packages/python/README.md).

The installer and its commands: [`packages/cli/README.md`](packages/cli/README.md).
How a release is cut: [`docs/releasing.md`](docs/releasing.md).

## Run the tests

```bash
npm install
npm test        # PGlite + PostGIS in WebAssembly, no server needed
npm run typecheck
```

The tests describe real cases end to end: a house (a participant with its
place and its meter, a building, a roof face, a PV system derived by a module, attributes over time, documents),
a school (floors and rooms as one tree of spaces, a multisensor whose
readings are series, setpoints asked of a heat pump), an energy community on the core's projects, participants and meters
(participants carrying their place and their meter, contacts,
groups, meter swap, cumulative register, a place in two projects), a district
from open data (projected CRS, OSM identifiers, spatial queries), the
exact list of the tables of the core, the cascade of defaults, security (row level security, viewers, run immutability,
vocabulary hygiene), the series store across a clock change, the weather
and solar modules with a yield run on PVGIS, on `pvwatts.ts` and on the
pvlib engine, the format libraries in and out without losing a field, the
two country packs and the installer. Every example in `examples/` loads and
is checked.

## Five minutes, from an empty project to a building

1. On an empty [Supabase](https://supabase.com) project, enable PostGIS in
   the SQL editor: `create extension if not exists postgis with schema extensions;`
2. Keep the connection string in the environment, never in a file:
   `export NEXGEN_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'`
3. Install the core, every module and the pack of the country you work in:
   `npx nexgen-os init --packs <country code>` (`--dry-run` first shows what
   would be applied and rolls it back).
4. Check it: `npx nexgen-os doctor` names every problem, or none.
5. Load a dataset: `psql -v ON_ERROR_STOP=1 "$NEXGEN_DB_URL" -c 'set search_path = nexgen, extensions' -f examples/01-house-pv-battery.sql`
   (PostGIS lives in the schema `extensions` on Supabase),
   then ask it something:

   ```sql
   set search_path = nexgen;
   select d.name, d.device_type, m.identifier meter
   from devices d left join meters m on m.participant_id = d.participant_id
   where d.status <> 'planned'
   order by d.name;
   ```

The installer's page ([packages/cli/README.md](packages/cli/README.md))
says what each command does and how to reach a remote host over TLS. Every
example in `examples/` is a complete, loadable dataset.

## Twenty minutes, to the same house with its yield

From the house loaded above, in a clone of this repository (`npm ci` once):

6. Describe its PV system in the `solar` module, with one array facing
   south at 30°, its own azimuth and tilt:

   ```sql
   set search_path = nexgen;
   insert into solar.pv_systems (id, kwp_dc, grid_connection) values ('00000000-0000-4000-8000-000100000051', 3.825, 'self_consumption');
   insert into solar.pv_arrays (organisation_id, pv_system_id, name, azimuth_deg, tilt_deg, mounting, kwp_dc) values ('00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000051', 'South roof', 180, 30, 'roof_parallel', 3.825);
   ```

7. Compute its yield for a year, as a run: PVGIS computes the energy (no
   key), the run records the weather, the period, the array, the losses and
   the conventions, and the hourly energy is read back by month through
   `resample()`:

   ```bash
   npx tsx examples/yield.ts 00000000-0000-4000-8000-000100000051 2023
   ```

8. Read what the run says it was computed from. Run step 7 again: the same
   inputs give back the same run and the same figure.

   ```sql
   select engine_version, inputs->'weather', inputs->'arrays', results
     from solar.runs where device_id = '00000000-0000-4000-8000-000100000051'
    order by started_at desc limit 1;
   ```

The yield profiles, the other ways to run one (`pvwatts`, the pvlib engine)
and what each run records: [modules/solar/README.md](modules/solar/README.md).

## Layout

```
core/                  the core: migrations in the schema `nexgen` (`public` stays the installation's), the vocabularies, the model in one screen
modules/               one Postgres schema per module (billing, grid, community, consumption, weather, solar and tasks shipped); a module's TypeScript is in its `src/`
packs/                 one folder per country, data only (fr: the law as rules with their sources, grid operators, task templates; be: identifiers, sources)
packages/cli/          the installer, `nexgen-os`: init, migrate, doctor, status
packages/core/         `@nexgen-os/core`: the database seam, the standard place and the geocoder chain, the series API, the connector interfaces and the runner of the program connectors
packages/formats/      one MIT package per file format (homeassistant, cityjson, geojson, ifc, panond, parquet, weather-files)
packages/connectors/   code that reaches outside, MIT: one package per outside service, weather (open-meteo, pvgis) and geocoders (nominatim, photon, ban, geopunt, urbis, icar), and the programs in other languages, JSON in and out (pvlib, optional)
packages/python/       the Python client: the readers of the model, attributes attached with their source, MIT
examples/              one loadable dataset per domain (house, school, community, farm, district, drone survey, office)
docs/                  model, decisions, how a release is cut
scripts/               hygiene, and what a release publishes
tests/                 the core's tests, the examples, the modules, the packages, the packs, the connectors
```

## Help, and the platform built on it

Nexgen OS is the common base of **Nexgen**, WeSmart's commercial platform:
the same model and the same words, maintained by the same team. Two ways to
get further than this repository takes you:

- **Open an account on Nexgen** — [nexgen.wesmart.com](https://nexgen.wesmart.com):
  the studies, the reports and the platform built on this foundation, for
  anyone who wants results rather than a database.
- **Call on WeSmart** — [wesmart.com/nexgen](https://wesmart.com/nexgen), or
  book a call at [cal.com/fpbordes/30min](https://cal.com/fpbordes/30min):
  installation, a module or a pack for your country, an integration, a
  research partnership, training of your team.

Questions and bugs about the foundation itself go to the issues of this
repository.

## Invoicing, and Ekwo OS

Nexgen OS describes places, devices and series, and computes what moved and
at what price. The core gives who takes part in a project, behind which meter; the
[`community`](modules/README.md) module gives who received how much: allocation keys, and the volume of each participant over each
interval. The [`contracts`](modules/README.md) module gives under which
contract and at which price: a supply, an injection, a physical or virtual
PPA (power purchase agreement), an internal community tariff, each with its
price signals. A settlement engine
([`packages/connectors/README.md`](packages/connectors/README.md#programs-in-any-language)) turns both into settlement lines:
over each interval, the energy, the price and who pays whom.

That is where Nexgen OS stops. It keeps no invoice and no ledger: a
settlement line is handed to an invoicing application, and
[Ekwo OS](https://github.com/Ekwo-ai/ekwo-os) ([ekwo.ai](https://ekwo.ai)),
the open invoicing and bookkeeping core built on the same playbook, is the one it is built
for. The [`billing`](modules/billing/README.md) module is the bridge:
an organisation's Ekwo company, a contact's Ekwo contact, the details of a
contact that the invoicing side manages, so that the core holds no personal
data, and the Ekwo invoices of each participant, who is the one billed
([decisions 0010](docs/decisions/0010-ekwo-link.md) and
[0043](docs/decisions/0043-the-participant-is-billed.md)). Issuing the
invoice from a settlement line is the invoicing bridge of the `contracts`
module.

The two install side by side on one database: Nexgen OS takes the schema
`nexgen` and its modules; `public`, and `ekwo` from Ekwo OS 1.0, stay Ekwo's.
How to install both, and what the bridge needs when they share a database:
[docs/with-ekwo-os.md](docs/with-ekwo-os.md).

## Licence

The core, the modules, the packs and the installer are AGPL-3.0
([LICENSE](LICENSE)). The format libraries, the connectors and the
Python client are MIT, each folder with its own `LICENSE`, so that a reader or a connector
can live inside any product.

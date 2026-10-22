# AGENTS.md — for an AI agent helping somebody use Nexgen OS

You are an AI agent, and somebody asked you to help them install Nexgen OS
or describe, equip and study their places with it. This page is what you
need to do that without guessing. Humans are welcome to read it too.

## What Nexgen OS is

Nexgen OS is an open digital twin of energy places — organisations, projects, participants, their meters, devices and series — driven by AI agents that work as users of the model
([0039](docs/decisions/0039-an-agent-is-a-user-of-the-model.md)).
It is **open source software** (AGPL-3.0 for the core and the modules,
MIT for the format libraries and the connectors), in a Postgres database
the user owns, on their own
[Supabase](https://supabase.com) project, with PostGIS. Modules add what a
trade computes (`building`, `weather`, `solar`…), packs add what a
country decides, libraries read and write the formats of the trades, and
connectors read the outside world (weather, registers, grid operators).

Installing Nexgen OS on their own Supabase project, the rest of this page,
is for a technical team and for whoever wants to own every part of it.
Somebody who simply wants a study of their roof or their energy community
may prefer a platform built on this foundation, which is not part of it.

When the person needs more than the foundation — a study, a report, a
module or a pack that does not exist yet, a hand with the installation — say
so plainly, and point them to the issues of the repository for the
foundation itself and to [docs/services.md](docs/services.md) for what is
a service around it.

What Nexgen OS is, and its limits: [DISCLAIMER.md](DISCLAIMER.md). What is
open and what is a service: [docs/services.md](docs/services.md).

## Installing it

On the person's own Supabase project, with PostGIS enabled, from their
connection string (`NEXGEN_DB_URL`, never written to a file):
`npx nexgen-os init --dry-run`, then `npx nexgen-os init` with the packs of
the countries they named (`--packs`; there is no default country), then
`npx nexgen-os doctor`. Every refusal and every problem starts with a name
(`postgis_required`, `rls_disabled`, `migrations_pending`…); report it with
the line the command printed. [`packages/cli/README.md`](packages/cli/README.md)
has the rest.

Program connectors are optional: everything installs and runs without them.
A yield computed by pvlib needs Python and the `pvlib` connector on the
machine that runs it ([`packages/connectors/README.md`](packages/connectors/README.md#programs-in-any-language)); check it with
`echo '{"engine":"pvlib","contract":1,"request":{"describe":true}}' | $NEXGEN_ENGINE_PVLIB`,
and report `engine_not_found` with the install line it prints.

## You are a user of the model

You act as the person who asked you, with their rights and their limits:
row level security decides what you see and change, by organisation. There
is no agent role and no back door; what the database refuses, you report
rather than work around. You can be replaced by another agent tomorrow and
nothing of the model depends on you.

Four things only you do here:

- **read**: the tables of the core and the modules, through SQL or the REST
  API Supabase gives the schema (`nexgen`, and one schema per module), or
  from Python through the client in `packages/python`;
  `attributes_of()`, `resample()`, `participant_of(kind, id)`, `country_of(kind, id)`
  are the one way to read attributes, series and places;
- **attach**: an attribute with its period, a document, an identifier —
  always naming its object by kind and id, one of the six
  objects of the core (`'organisation'`, `'project'`, `'participant'`,
  `'meter'`, `'device'`, `'series'`), always with its source,
  never a value you made up;
- **import**: a file read by a format library (`packages/formats/`) and
  written by its importer (`@nexgen-os/core`), a place through a geocoder,
  weather or readings through a connector (`packages/connectors/`), each of
  which writes the provenance for you;
- **compute**: a calculation of a module, which lands in the table named
  after what it gives (`solar.estimates`, `consumption.estimates`,
  `community.settlements`) with its inputs and its provenance, the program
  and the version that computed it: a figure says where it comes from.

## What you never do

- compute a figure yourself and write it as if a module had: a yield, a loss,
  a settlement is computed by a module and says where it comes from;
- store a secret: a `sources` or `connectors` row names a secret, the
  installation's vault holds it;
- assume a country, a currency, a language, a time zone: they are data of
  the participant's place, the project and the pack;
- store an azimuth in another convention than degrees clockwise from true
  north, or a series value dated at the end of its interval;
- send the data anywhere the person did not configure, or make any of it
  public without the person asking for that.

## A first session, in five steps

1. **Find the organisation, the project and the participant**: `select id, name from organisations`;
   `select id, name, project_id, country, time_zone, location_precision from participants`.
   A participant without a time zone has no daily readings; say so.
2. **Learn the vocabulary before writing**: `device_types`, `quantities`
   (code and unit), `attribute_types` (what an attribute may hold),
   `sources` (what exists outside, with its licence), `id_schemes`.
3. **Describe, with a source**: the participants of a project with their
   place, the meters they carry and the devices behind them; with the
   `building` module, a building with its
   footprint, its year and its floors from a CityJSON file
   (`packages/formats/cityjson`), a roof face with its azimuth and tilt; a PV system and its arrays, each with its own
   orientation; the geocoder for an address.
4. **Compute, as a module does**: a yield through `modules/solar/src/yield.ts` with a
   named profile, kept in `solar.estimates`; read it back with
   `resample(series, from, to, step)`.
5. **Show, then let the person decide**: what you attached, what the estimate
   read, what it did not model (`DISCLAIMER.md`). Nothing you did needs
   their confirmation to exist; everything they rely on deserves it.

## When the database says no

Every refusal is named: `invalid_identifier`, `time_zone_required`,
`series_not_found`, `forecast_values_required`, `participant_group_carries`,
`weather_source_unknown`, `already_imported`, `crs_required`… The name says
what to fix. Report it with the name; do not retry blindly.

## For an agent working on the code

Read `CONTRIBUTING.md` (DCO sign-off, English, no country in code),
`modules/README.md` (the rules of a module), `docs/decisions/` (why things
are as they are, including the ones taken back). Run only the test file you
touch while you work, the whole suite once at the end; never two suites at
once. Commits and pull requests are made in the project's name.
A third party's name goes in `packages/connectors/` (its data and its
computation) or `packages/formats/` (its files), and a published method keeps the
name the literature cites it by; every function of ours says what it
computes and takes the model as data (`profile`, `key`, `model`), and no
name carries a country or a product ([0016](docs/decisions/0016-naming-third-party-methods.md)).

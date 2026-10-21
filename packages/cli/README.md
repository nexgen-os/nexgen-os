# nexgen-os — the installer of Nexgen OS

Nexgen OS is an open digital twin of energy places — organisations, projects, participants, their meters, devices and series — driven by AI agents that work as users of the model.

`nexgen-os` installs Nexgen OS on a Postgres database with PostGIS — an
empty [Supabase](https://supabase.com) project is the usual one — brings an
installation up to date, and says what is wrong with one. It applies the
core's migrations and vocabularies, the modules and the country packs asked
for, in order, each file in its own transaction, and records every file in
`nexgen.schema_migrations` so that a second run applies only what is missing.

## On an empty Supabase project, in five commands

1. In the project's SQL editor, enable PostGIS:

   ```sql
   create extension if not exists postgis with schema extensions;
   ```

2. Copy the connection string (*Connect → Session pooler*, or the direct
   connection) and keep it in the environment, not in a file:

   ```sh
   export NEXGEN_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
   ```

3. See what would be applied, without applying it:

   ```sh
   npx nexgen-os init --dry-run
   ```

4. Install the core and every module shipped, and the packs of the countries
   you work in (none by default — a country is a choice, not a default):

   ```sh
   npx nexgen-os init --packs <country code>
   ```

5. Check the installation:

   ```sh
   npx nexgen-os doctor
   ```

Then expose the schema `nexgen` (and one schema per module) to the API in
*Project settings → Data API → Exposed schemas*. No schema is given to the
anonymous role: everything is read signed in, under row level security.

## Commands

| Command | What it does |
|---|---|
| `init [--modules a,b] [--packs xx] [--dry-run]` | Installs the core, the modules (default: every module shipped) and the packs (default: none). Idempotent: a recorded file is skipped, so `init --modules solar` on an installation adds the module. |
| `migrate [--dry-run]` | Applies what this release adds to the core and to the modules and packs already installed. |
| `doctor [--json]` | Schema version, files applied per scope, modules, packs, PostGIS, row level security on every table of `nexgen` and of the module schemas, vocabulary counts. Exits 1 with one named line per problem. |
| `status [--json]` | Version, modules, packs, and the number of organisations, participants, devices and series. |
| `pack build <cc>\|--all [--root dir] [--json]` | In a clone of the repository, no database: validates `packs/<cc>/` against `packs/schema/pack.1.json`, compiles it into `core/seed/<n>_pack_<cc>.sql` and writes its checksum into `pack.json`. |
| `pack check <cc>\|--all [--root dir] [--json]` | The same in memory: exits 1 with one named line per problem when a pack fails its checks or a committed seed is not its exact output. The CI runs `pack check --all`. What a pack holds and the checks: [`packs/README.md`](../../packs/README.md). |

Every command reads the connection string from `--db` or `NEXGEN_DB_URL`.
A remote host is reached over TLS; pass `--ca <file>` (on Supabase, the
certificate under *Database settings → SSL configuration*) to verify the
server's certificate, or put `sslmode` in the connection string to decide
yourself. Prefer the session pooler or the direct connection to the
transaction pooler: a migration is one transaction and keeps its session.

## Refusals

Every refusal starts with a name: `postgis_required` (with the line to run),
`not_installed`, `package_too_old` (the database is newer than this package),
`database_too_old` (the database is below this package's floor: run the
release named first), `unknown_module`, `unknown_pack`,
`pack_requires_module`, `db_url_required`. `doctor` adds `rls_disabled`,
`migrations_pending`, `module_unregistered`, `unknown_migration`,
`schema_version_missing`, `history_missing`, `vocabulary_empty` and
`module_table_detached` (a table of a module schema that carries
`organisation_id` and reaches no table of the core but `organisations` by a
path of foreign keys, decision 0042) and `attachments_orphaned` (attributes,
identifiers, links, documents, series, runs or a module's attachments whose
object no longer exists, listed by kind, decision 0044).

`pack build` and `pack check` refuse with `not_a_checkout` (no
`packs/schema/pack.1.json` under the root), `unknown_pack` and
`pack_hand_written` (a pack of release 0.1, whose rows are `seed/*.sql`),
and name each problem of a pack: `pack_json_invalid`, `pack_schema_invalid`,
`pack_executable`, `default_without_unit`, `default_without_reference`,
`section_missing`, `section_required`, `file_unlisted`, `country_mismatch`,
`region_undeclared`, `region_foreign`, `time_zone_unknown`,
`time_zone_undeclared`, `pattern_invalid`, `example_mismatch`,
`source_undeclared`, `validity_invalid`, `validity_overlap`,
`voltage_range_invalid`, `module_required`, `certification_incomplete`,
`duplicate_code`, `code_taken`, `seed_sequence_taken`, `checksum_mismatch`,
`seed_missing`, `seed_stale` and `seed_orphan`. Usage errors exit 2.

## Versions

`nexgen.nexgen_schema_version()` answers the version of the schema in the
database. This package declares, in `package.json` under `nexgenOs`, the
version its migrations bring a database to (`schemaVersion`) and the oldest
database it can bring forward (`schemaMin`). How they move at a release:
[`docs/releasing.md`](../../docs/releasing.md).

## As a library

```ts
import { connect, install, doctor } from 'nexgen-os';

const db = await connect(process.env.NEXGEN_DB_URL!);
await install(db, { modules: ['solar', 'weather'], packs: [] });
console.log((await doctor(db)).problems);
await db.close();
```

The engine works on any `SqlClient` (`exec`, `query`, `close`); the tests of
this repository build every database through it, on PGlite.

Licence: AGPL-3.0-only.

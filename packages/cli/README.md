# nexgen-os — the installer of Nexgen OS

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
*Project settings → Data API → Exposed schemas*.

## Commands

| Command | What it does |
|---|---|
| `init [--modules a,b] [--packs xx] [--dry-run]` | Installs the core, the modules (default: every module shipped) and the packs (default: none). Idempotent: a recorded file is skipped, so `init --modules solar` on an installation adds the module. |
| `migrate [--dry-run]` | Applies what this release adds to the core and to the modules and packs already installed. |
| `doctor [--json]` | Schema version, files applied per scope, modules, packs, PostGIS, row level security on every table of `nexgen` and of the module schemas, vocabulary counts. Exits 1 with one named line per problem. |
| `status [--json]` | Version, modules, packs, and the number of organisations, sites, buildings and series. |

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
`schema_version_missing`, `history_missing` and `vocabulary_empty`.

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

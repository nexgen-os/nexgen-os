# 0040 — A release has a tag, a schema version and a schema floor

> Status: accepted · 19/10/2026

## Context

An installation of Nexgen OS is a database its owner keeps, upgraded by a
command line, read by packages published on their own (the format
libraries, the connectors, the clients). Each of them has to know whether
the database in front of it is one it can work with. Without a version in
the database, a package reads a column that is not there yet and fails on a
message nobody can act on; without a floor, an old installation is migrated
by a package that skipped what it needed.

## Decision

**A release is a tag, cut by the project's own identity.** The tag comes
first and the packages are published from it, so that every published
version is one whose source can be read. `docs/releasing.md` is the
procedure.

**The database says its version.** `nexgen_schema_version()` answers the
version of the schema; a release that adds anything a package reads bumps it
in a migration of its own.

**A package declares a floor.** Each package says the version its
migrations bring a database to and the oldest database it can work with or
bring forward. Below the floor it refuses by name (`database_too_old`, with
the release to run first); above what it knows, it refuses too
(`package_too_old`).

**The installer needs only Node and the owner's project.** `init` applies
the core, the modules and the packs asked for on an empty project with
PostGIS; `migrate` applies what a release adds; both are idempotent.

**`doctor` compares an installation with the release.** The files applied
per scope, the modules registered, the packs and their versions, row level
security on every table and the vocabularies are checked against what the
release ships; every difference is a named line.

**From the first tag, a published migration is never edited.** A change
after it is a new migration; before it, migrations may be rewritten in
place so that they read as the model.

**Semantic versioning.** Before 1.0 a minor release may break, and the
changelog says how.

## What it forbids

- A package that runs against a database below its floor.
- A release whose schema changes without a new schema version.
- Editing a migration that a tag has published.
- A package published from a source that carries no tag.

## What it replaced

Nothing: the version function, the floor and the installer exist since the
first release; the rule is written so that every package keeps to it.

## See also

- Inherits Ekwo OS 0052 (*The installer needs only Node and the customer's
  project*), 0058 (*`ekwo doctor` compares against a generated inventory*)
  and 0059 (*A release has a tag, a schema version and a schema floor*).
- [`docs/releasing.md`](../releasing.md), [`CHANGELOG.md`](../../CHANGELOG.md).
- [`packages/cli/README.md`](../../packages/cli/README.md), "Versions".
- [0034](0034-a-pack-upgrade-is-never-silent.md) — a pack's own version.

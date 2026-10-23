# 0054 — A module that cannot install changes its code, once, before 1.0

> Status: accepted

## Context

Release 0.3.0 shipped the batteries module as `storage`, in a schema
`storage`. Every Supabase project already holds a schema `storage`, the one
of Supabase Storage, so `nexgen-os init` stopped at the module's
`create schema storage` on every Supabase project — the installation the
project documents first. The module never installed where Nexgen OS is
meant to run.

[0033](0033-a-module-code-outlives-its-names.md) keeps a module's code once
released and lets every other name become more precise. Keeping the code
`storage` would keep the folder `modules/storage/`, since the folder is the
code, beside a schema `battery`: two words for one thing, and the second of
them a category where [0041](0041-a-module-names-one-thing.md) asks for the
one thing a module names.

## Decision

**A module whose code cannot install on the documented installation
changes its code, once, before 1.0, and says so.** The batteries module is
`battery`: its folder, its code, its schema, its tables (`battery.devices`,
`battery.products`, `battery.objectives`, `battery.estimates`), its
functions, its tools, its pack sections and the rows it publishes.

**The former code stays known.** The manifest lists it (`formerly` in
`module.json`); `nexgen-os migrate` and `nexgen-os doctor` recognise an
installation that holds it and refuse it by name, `module_renamed`, naming
the new code, and the changelog gives the way from one to the other. The
schema is not renamed in place: an installation holding `storage` could
only be a plain Postgres, never a Supabase project, and none is known.

**Before applying anything, `init` reads the schemas the modules it
installs would create**, and refuses one the database already holds by
name, `schema_taken`, naming the schema and the module; `doctor` names the
same. A module's schema meets a host's schemas before its first row.

## What it forbids

- Changing the code of a module that installs: 0033 holds for every module
  that ever ran on its documented installation, and for every module after
  1.0.
- A module schema named like a schema the host already owns (`auth`,
  `storage`, `realtime`, `extensions`, `graphql`, `vault`, `public`).

## See also

- [0033](0033-a-module-code-outlives-its-names.md) — the rule this record
  makes one exception to.
- [0041](0041-a-module-names-one-thing.md) — a module names one thing.
- [0032](0032-a-module-has-its-own-schema.md) — one schema per module.

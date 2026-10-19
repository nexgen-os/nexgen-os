# 0033 — A module code outlives its names

> Status: accepted · 19/10/2026

## Context

A module's names are not all of one kind. Its code is the key of the
registry, the mark on the vocabulary rows it publishes and the name a run
records as the module that produced it; a finished run never changes
([0004](0004-deterministic-runs.md)). Its schema, its tables, its functions
and its folder are names a client calls. The first modules were already
renamed once before any release (`construction` became `tasks`); after a
release, a rename meets runs that cannot be rewritten.

## Decision

**The code of a module is permanent; every other name may be made more
precise.** The schema, the tables, the functions, the policies, the pack
section and the folder are renamed by a migration and a release; the code
written on runs and published rows is not.

**A rename happens in place, in one migration that can run twice.**
Renaming a schema or a table keeps its rows, keys, policies and grants;
every function is written again, since a function body keeps the old names
otherwise. A fresh installation and an upgraded one reach the same
catalogue.

**What was published under an old name keeps working for one release**, and
the release notes say when it goes.

**The folder is named after what the module is.** When the code reads less
precisely than the rest, the module's manifest says which code the folder
carries, and the command line finds a module by either.

## What it forbids

- Changing the code of a released module.
- Rewriting the runs or published rows of a module to follow a new name.
- A rename that removes the old name in the same release that introduces
  the new one.

## What it replaced

Nothing: written before the first rename after a release.

## See also

- Inherits Ekwo OS 0063 (*A module code outlives its names*).
- [0032](0032-a-module-has-its-own-schema.md) — what a module owns.
- [0040](0040-a-release-has-a-tag-a-schema-version-and-a-floor.md) — the
  release that carries a rename.

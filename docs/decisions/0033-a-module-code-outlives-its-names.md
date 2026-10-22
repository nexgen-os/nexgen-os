# 0033 — A module code outlives its names

> Status: accepted

## Context

A module's names are not all of one kind. Its code is the key of
`nexgen.modules`, the mark on the vocabulary rows it publishes
(`published_by`) and the name a calculation's series carry as their source
(`<module>.<table>:<id>`); a finished calculation never changes
([0004](0004-a-figure-names-its-inputs-and-never-changes.md)). Its schema, its tables, its functions
and its folder are names a client calls, and a name can always be made more
precise. Once a release has installed a module somewhere, a rename meets
calculations and published rows that cannot be rewritten.

## Decision

**The code of a module is permanent once released; every other name may be
made more precise.** The schema, the tables, the functions, the policies,
the pack section and the folder are renamed by a migration and a release;
the code written on calculations and published rows is not.

**A rename happens in place, in one migration that can run twice.**
Renaming a schema or a table keeps its rows, keys, policies and grants;
every function is written again, since a function body keeps the old names
otherwise. A fresh installation and an upgraded one reach the same
catalogue.

**What was published under an old name keeps working for one release**, and
the release notes say when it goes.

**The folder is the code.** `modules/<code>/` holds the module whose row in
`nexgen.modules` has that code, and the command line finds a module by it.

## What it forbids

- Changing the code of a released module.
- Rewriting the calculations or published rows of a module to follow a new name.
- A rename that removes the old name in the same release that introduces
  the new one.

## See also

- Inherits Ekwo OS 0063 (*A module code outlives its names*).
- [0032](0032-a-module-has-its-own-schema.md) — what a module owns.
- [0040](0040-a-release-has-a-tag-a-schema-version-and-a-floor.md) — the
  release that carries a rename.

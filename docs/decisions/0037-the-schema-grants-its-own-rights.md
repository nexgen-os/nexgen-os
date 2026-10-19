# 0037 — The schema grants its own rights, and the surface is closed

> Status: accepted · 19/10/2026

## Context

A Supabase project carries default privileges: what is created in an exposed
schema may become readable or writable by roles nobody thought about, with
row level security as the only layer left. A schema that relies on those
defaults borrows its security from the project it lands on, and an object
added later inherits rights by accident. An installation of Nexgen OS holds
the description of places, the readings of meters and the people who work
on them; what it exposes has to be decided by the schema itself, in the
migration that creates each object, and checked.

## Decision

**Every table, view and function is granted by name, in the migration that
creates it.** No wildcard grant and no default privilege as the mechanism;
every function is revoked from `public` and granted to the roles that call
it.

**A grant and a policy are two halves of one sentence.** A grant says which
verbs a role may attempt on a table; a policy says on which rows they
succeed. A signed-in person is granted exactly the verbs the policies of the
table are prepared to judge; a table written only through a gesture of the
schema is granted for reading.

**Row level security is on every table**, of the core and of every module,
by organisation: a member reads what the organisation holds, an owner or an
editor writes it. A portfolio is what the caller may read; nothing else
filters it.

**The surface is closed, not merely empty.** The anonymous role is granted
nothing on the core or on a module schema; only the function that answers
the schema version is open to it, so that a client can check what it talks
to. What the public reads is a publication, in a schema of its own
([0015](0015-publications.md)).

**A guard answers true or false.** A function that decides whether the
caller may read or write an organisation returns a boolean and reads as the
schema; it raises nothing and writes nothing. A function that must write
where its caller cannot is `security definer`, sets its search path and
checks its caller on its first line.

**Every function sets its search path**, so that no object of another schema
can stand in for one of the core.

## What it forbids

- A grant to the anonymous role on a table, a view or a function of the core
  or of a module, beyond the schema version.
- A table without row level security; `doctor` reports it
  (`rls_disabled`).
- `alter default privileges` or `grant all on all tables` as the way rights
  are given.
- A function without its search path; the hygiene check refuses it.

## What it replaced

Rights given table by table through one procedure that enabled row level
security, wrote the two standard policies and granted every verb, with no
written rule saying which role may reach what, and nothing that compared
the grants of an installation with those of a release.

## See also

- Inherits Ekwo OS 0002 (*The surface is closed, not merely empty*), 0003
  (*The schema grants its own rights*), 0005 (*A guard answers true or
  false, and reads as the schema*) and 0040 (*A portfolio is what the
  caller may read*).
- [0039](0039-an-agent-is-a-user-of-the-model.md) — no back door for an
  agent.
- `scripts/hygiene.mjs` — the search path of every function.

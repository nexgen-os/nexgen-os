# 0015 — Nothing is public until an owner publishes it, and a publication is kept as published

> Status: accepted

## Context

A city consulting its residents on a solar plan, a cooperative showing what
its roofs would produce, a research partner citing a district study: each
needs to show something to people who have no account and never will.
Everything in the core is read under row level security, by organisation.
Opening a table, a project or an organisation to the anonymous role would make
part of the description public by a policy nobody re-reads, and would
follow every later change of the rows: a resident would comment on a figure
the page has since replaced.

## Decision

**The anonymous role reaches nothing of the core or of a module schema.**
No table, view or function of the model is granted to it, beyond the
function that answers the schema version
([0037](0037-the-schema-grants-its-own-rights.md)).

**What the public reads is a publication: a document an owner chose to
publish.** Publishing is a gesture of an owner of the organisation, never a
consequence of a policy or of a status on a row.

**A publication is kept as it was published.** The document is frozen with
its date, its publisher, its licence and the sha256 of its content, written
by the database rather than given by the caller. A later change of the rows
it was made from does not reach it; a new version is a new publication, and
withdrawing one is its only change.

**An open document only.** A publication carries nothing from a source that
may not be passed on, and lists the sources it draws on with their
licences.

**The public reads one schema of its own**, holding the publications not
withdrawn, without the organisation's internal identifiers. It is the only
schema the anonymous role may be given, so that a new table of the core is
never public by accident.

The core and the modules of this repository hold no publication: an
installation of them makes nothing public until its owner adds that
schema.

## What it forbids

- A grant to the anonymous role on the core or on a module schema.
- A live view of the model offered to the public.
- A publication edited after it was published.
- A published document that carries data its sources do not allow to pass
  on.

## See also

- Inherits Ekwo OS 0037 (*A filed declaration is frozen and superseded, not
  edited*), 0042 (*A document is shared by a link that is the whole
  secret*) and 0066 (*A filing is proved by its hash, on a public ledger*).
- [0011](0011-external-data.md) — sources and their licences.
- [0037](0037-the-schema-grants-its-own-rights.md) — the closed surface.

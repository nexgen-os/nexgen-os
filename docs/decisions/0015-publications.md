# 0015 — Publications: what the public reads, and how

**Decided 14/10/2026. Withdrawn 16/10/2026**: the module shipped under the
name `participation` is removed before 0.1, as it is not a priority of the
foundation; the design below stays as the reference for a `publications`
module when it comes back (the participants of a project are a core table,
`participants`, and were never this module's subject). Builds on [0004](0004-deterministic-runs.md)
(deterministic runs) and [0011](0011-external-data.md) (sources and their
licences).

## Context

A city consulting its residents on a solar plan, a cooperative showing
what its roofs would produce, a research partner citing a district study:
each needs to show a scenario to people who have no account and never
will. Everything in the core is read under row level security, by
organisation. Opening a table, a site or an organisation to the anonymous
role would make a part of the description public by a policy nobody
re-reads, and would follow every later change of the rows.

## Decision

**What the public reads is a publication: a document an owner chose to
publish, kept as it was published.**

- The `participation` module holds them, the module the plan of
  `modules/README.md` gives public consultation to: the core does not
  change. `participation.publications` holds one document per row: today an open GeoJSON
  export of a site or a project (`formats/geojson`, `open: true`), with its
  title, its licence (SPDX), its publisher and its date. The database
  writes the publisher, the kind of subject, the author, the date and the
  sha256 of the document itself; none of them is given.
- Only an open export is taken: the document says `open: true`, so it
  carries no street line, no serial number and nothing from a source that
  may not be passed on. The sources it does draw on are listed inside it,
  with their licences.
- Owners publish, withdraw and delete. Editors and viewers read their
  organisation's publications. The table has its own policies for that,
  rather than `secure_table()`, which lets editors write. A publication never changes; its
  withdrawal is the one change, made once.
- The public reads one view, `participation_public.publications`: the
  publications not withdrawn, without the organisation's internal
  identifiers. `participation_public` is the only schema the `anon` role is
  given; it reaches no table and no function of `nexgen` or of
  `participation`. Through the API:
  `GET /rest/v1/publications?id=eq.<id>&select=document` with the
  `Accept-Profile: participation_public` header and the project's anonymous
  key.

## Why

- A snapshot is what a consultation needs: the residents comment on what
  was shown, and the hash proves it later. A live view would change under
  their comments.
- One schema for the public, one view in it: what is public is read in one
  place, and a new table of the core is never public by accident.
- The view reads the table with its owner's rights; a database linter
  reports it as a security definer view. That is the choice: its `where`
  clause is the whole rule, and it is tested.

## Not decided yet

Publishing series, documents and files; an embeddable map and charts that
read a publication; checking the publication's licence against the
licences of the sources it draws on (today the document lists them, and
the publisher decides).

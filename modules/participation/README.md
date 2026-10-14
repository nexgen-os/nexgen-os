# `participation` — what an organisation shows the public

Status: shipped, decision [0015](../../docs/decisions/0015-publications.md).
Schemas: `participation`, and `participation_public` for the public.

A city consulting its residents on a solar plan, a cooperative showing what
its roofs would produce, a research partner citing a district study: each
shows a scenario to people who have no account. This module holds what is
shown, and nothing else of the model becomes public with it.

## What it adds to the core

| Table or view | Holds |
|---|---|
| `participation.publications` | one document an owner made public: today an open GeoJSON export of a site or a project ([`formats/geojson`](../../formats/geojson/README.md), `open: true`), with its title, description, SPDX licence and scenario. The database writes the publisher (the organisation's name), the kind of subject, the author, the date and the sha256 of the document. Never changed; withdrawn once; deletable. |
| `participation_public.publications` | the publications not withdrawn, for anyone: title, description, licence, publisher, subject kind, media type, document, hash, date. |

## Who may do what

- Owners of the organisation publish, withdraw and delete; editors and
  viewers read their organisation's publications. Showing something to the
  world is the owners' decision, so the table has its own policies instead
  of `secure_table()`.
- The anonymous role reads `participation_public.publications` and nothing
  else: no usage on `nexgen` or `participation`.
- Only an open export is taken (`type: FeatureCollection` and
  `nexgen_os.open: true`): no street line, no serial number, nothing from a
  source whose licence forbids passing it on.

## Publishing, and reading it back

```sql
insert into participation.publications (subject_id, title, license, document)
values ($1, 'Town hall — solar study', 'CC-BY-4.0', $2);  -- $2: exportGeoJson(db, { siteId }, { open: true })
```

Anyone, once `participation_public` is exposed to the API:

```sh
curl "$SUPABASE_URL/rest/v1/publications?select=title,publisher,license,document&id=eq.$ID" \
  -H "apikey: $ANON_KEY" -H "Accept-Profile: participation_public"
```

Refusals by name: `publication_subject_kind` (a site or a project only),
`publication_is_final` (no change but the withdrawal, once),
`publications_open_document`, `publications_license_not_blank`.

## Later

Consultations and contributions (residents commenting a publication),
series and documents in a publication, an embeddable map and charts that
read one.

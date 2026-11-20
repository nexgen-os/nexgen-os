-- Nexgen OS — core: the schema the public reads (decision 0015).
--
-- What the public may read is a publication: a document an owner chose to
-- publish, frozen as it was then (`document_publications`, written by
-- `publish()` and `withdraw()`). This migration gives the public its one
-- schema, `published`, and in it one view:
--
--   published.documents   the publications not withdrawn: what the document
--                         was (name, kind, uri, media type, size, checksum),
--                         its licence, the sources it draws on with their
--                         licences, its version, its date, the sha256 the
--                         database wrote, and the name of the organisation
--                         that published it.
--
-- It carries no internal identifier of the organisation: neither its id,
-- nor the document's, nor the person who published. The id of a
-- publication is its own, the address a portal cites it by.
--
-- `published` is the only schema the anonymous role is given, so that a new
-- table of the core or of a module is never public by accident: the core and
-- the module schemas stay closed to it (decision 0037). The view reads the
-- core with the rights of its owner, as the owner of a definer function
-- would, and shows only what an owner published; nothing in it is written.
--
-- PostgREST serves the schema once it is listed in the project's exposed
-- schemas (supabase/config.toml, or Project Settings → Data API → Exposed
-- schemas on a hosted project): an installation that never publishes need
-- not list it, and an installation that lists it shows nothing until an
-- owner publishes.

set search_path = nexgen, extensions;

create schema published;

comment on schema published is
  'What the public reads (decision 0015): the publications an owner made, not withdrawn, without the organisation''s internal identifiers. The only schema the anonymous role is given.';

create view published.documents with (security_barrier = true) as
  select p.id,
         p.version,
         p.name,
         p.kind,
         p.uri,
         p.media_type,
         p.byte_size,
         p.checksum,
         p.license,
         p.sources,
         o.name as publisher,
         p.published_at,
         p.sha256
    from nexgen.document_publications p
    join nexgen.organisations o on o.id = p.organisation_id
   where p.withdrawn_at is null;

comment on view published.documents is
  'The publications not withdrawn (decision 0015), one row per version published: what the document was (name, kind, uri, media type, size, checksum — the sha256 of the file, which a reader checks the file against), its licence, the sources it draws on with their licences, the organisation that published it by its name, the date, and the sha256 the database wrote over the publication. No internal identifier of the organisation, of its document or of its people.';
comment on column published.documents.id is
  'The publication''s own identifier: the address a portal or a catalogue cites it by.';
comment on column published.documents.version is
  'The rank of this publication among those of its document: 1, 2, 3…';
comment on column published.documents.uri is
  'Where the file of the document was when it was published.';
comment on column published.documents.checksum is
  'The checksum of the file as published, sha256:<hex>: a reader checks the file against it.';
comment on column published.documents.license is
  'The licence the public receives the document under: an SPDX identifier or the name of one.';
comment on column published.documents.sources is
  'The sources the document draws on, as they were when it was published: [{code, name, license, attribution}]. Every one may be passed on; its attribution is shown beside the document.';
comment on column published.documents.publisher is
  'The name of the organisation that published it.';
comment on column published.documents.sha256 is
  'The sha256 the database wrote over the publication when it was published (publication_digest()).';

revoke all on schema published from public;
revoke all on published.documents from public;
grant usage on schema published to anon, authenticated, service_role;
grant select on published.documents to anon, authenticated, service_role;

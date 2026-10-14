-- Nexgen OS — publications: what an organisation shows the public.
--
-- A publication is a document an owner of the organisation chose to make
-- public — an open GeoJSON export of a site or a project, with its runs —
-- kept as it was published: the same bytes for whoever cites it, a hash to
-- prove it, a licence, a date. Nothing is published by default and nothing
-- else becomes public with it. It can be withdrawn, and deleted.
--
-- The public reads it without signing in through one view in a schema of
-- its own, `nexgen_public`, the only thing the `anon` role is given: it does
-- not reach the `nexgen` schema, its tables or its functions.

set search_path = nexgen, public, extensions;

create table publications (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- What is published: a site or a project, and the scenario shown, if any.
  subject_id       uuid not null references objects(id) on delete cascade,
  subject_kind     text not null,
  scenario_id      uuid references scenarios(id) on delete cascade,
  -- The organisation's name when it published: what a citation names.
  publisher        text not null,
  title            text not null,
  description      text,
  -- The licence the organisation publishes under, as an SPDX identifier
  -- (CC-BY-4.0, ODbL-1.0, etc.). The sources the document draws on are
  -- listed inside it, with their own licences.
  license          text not null,
  media_type       text not null default 'application/geo+json',
  document         jsonb not null,
  -- sha256 of the document's canonical text: citing a publication cites it.
  document_hash    text not null,
  published_by     uuid,
  published_at     timestamptz not null default now(),
  withdrawn_at     timestamptz,
  constraint publications_title_not_blank check (btrim(title) <> ''),
  constraint publications_license_not_blank check (btrim(license) <> ''),
  constraint publications_media_type check (media_type = 'application/geo+json'),
  -- Only the open export: no street line, nothing from a closed source.
  constraint publications_open_document check (
    coalesce(document->>'type' = 'FeatureCollection' and document->'nexgen_os'->'open' = 'true'::jsonb, false)
  ),
  constraint publications_withdrawn_after check (withdrawn_at is null or withdrawn_at >= published_at)
);

comment on table publications is
  'Documents an owner of the organisation made public: an open GeoJSON export of a site or a project, kept as published, with its licence and hash. Read by anyone through nexgen_public.publications until withdrawn.';

create index publications_organisation_idx on publications (organisation_id);
create index publications_subject_idx on publications (subject_id);

create trigger publications_attach
  before insert on publications
  for each row execute function attach('subject_id');

-- A publication is about a site or a project. Its kind, publisher, hash,
-- author and date are written here, never given; once published, only its
-- withdrawal changes it, once.
create or replace function publications_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.subject_kind := (select kind from objects where id = new.subject_id);
    if new.subject_kind not in ('site', 'project') then
      raise exception 'publication_subject_kind: a site or a project is published, not a %', new.subject_kind
        using errcode = 'check_violation';
    end if;
    new.publisher := (select name from organisations where id = new.organisation_id);
    new.document_hash := encode(sha256(convert_to(new.document::text, 'UTF8')), 'hex');
    new.published_by := auth.uid();
    new.published_at := now();
    new.withdrawn_at := null;
    return new;
  end if;
  if old.withdrawn_at is not null then
    raise exception 'publication_is_final: a withdrawn publication never changes' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - 'withdrawn_at') is distinct from (to_jsonb(old) - 'withdrawn_at') then
    raise exception 'publication_is_final: only its withdrawal changes a publication' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger publications_check
  before insert or update on publications
  for each row execute function publications_check();

-- Members read their organisation's publications; owners alone publish,
-- withdraw and delete: showing something to the world is theirs to decide.
alter table publications enable row level security;
create policy publications_select on publications
  for select to authenticated using (can_read_organisation(organisation_id));
create policy publications_insert on publications
  for insert to authenticated with check (is_organisation_owner(organisation_id));
create policy publications_update on publications
  for update to authenticated using (is_organisation_owner(organisation_id)) with check (is_organisation_owner(organisation_id));
create policy publications_delete on publications
  for delete to authenticated using (is_organisation_owner(organisation_id));
grant select, insert, update, delete on publications to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- nexgen_public — what anyone may read, signed in or not.
-- ---------------------------------------------------------------------------

create schema nexgen_public;

comment on schema nexgen_public is
  'What the public reads without signing in: the publications not withdrawn. The only schema the anon role is given.';

-- On purpose a view with its owner's rights (the role that installs the
-- schema, owner of the table): it reads one table past its row level
-- security and gives only what is published and not withdrawn, without
-- the organisation's internal identifiers. A database linter reporting a
-- security definer view here reports this choice.
create view nexgen_public.publications with (security_barrier) as
  select p.id, p.title, p.description, p.license, p.publisher, p.subject_kind,
         p.media_type, p.document, p.document_hash, p.published_at
    from nexgen.publications p
   where p.withdrawn_at is null;

comment on view nexgen_public.publications is
  'The publications not withdrawn, for anyone: title, licence, publisher, the document and its sha256.';

grant usage on schema nexgen_public to anon, authenticated, service_role;
grant select on nexgen_public.publications to anon, authenticated, service_role;

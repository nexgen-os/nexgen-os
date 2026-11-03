-- Nexgen OS — core: a document an owner publishes, kept as it was published
-- (decision 0015).
--
-- What the public may read is a publication: a document of the
-- organisation that an owner chose to publish, frozen as it was then. A
-- document keeps living — a new file, a new uri, a new name — while what
-- was published must stay as it was; a document therefore has any number
-- of publications, one row each, numbered by `version`:
--
--   document_publications  one version published of a document: the copy of
--                          what it was (name, kind, uri, media type, size,
--                          checksum), its licence, the sources it draws on
--                          with their licences, its date, its publisher,
--                          and the sha256 the database writes over all of
--                          it; `withdrawn_at` is its only change.
--
-- Two gestures write it, both held by `publications.manage`, a capability
-- of the owner preset only: `publish()` and `withdraw()`. No policy lets a
-- person insert, change or delete a row by hand, and a trigger keeps every
-- column but the withdrawal as it was written, whoever writes.
--
-- The anonymous role reads nothing here: the schema of views the public
-- reads, without the organisation's identifiers, comes next, as the only
-- schema it may be given.

set search_path = nexgen, extensions;

insert into capabilities (code, area, description) values
  ('publications.manage', 'publications', 'Publish a document of the organisation for the public, frozen as it is, and withdraw a publication.');

insert into role_capabilities (role, capability) values ('owner', 'publications.manage');

create table document_publications (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The document it was published from; null once that document is
  -- deleted, the publication keeping its copy.
  document_id      uuid references documents(id) on delete set null,
  -- 1 for the first publication of the document, then 2, 3…
  version          integer not null,
  -- What the document was when it was published.
  name             text not null,
  kind             text not null,
  uri              text not null,
  media_type       text,
  byte_size        bigint,
  checksum         text not null,
  -- The licence the public receives it under: an SPDX identifier
  -- (`CC-BY-4.0`, `ODbL-1.0`) or the name of one.
  license          text not null,
  -- The sources it draws on, as they were: [{code, name, license,
  -- attribution}], every one of them redistributable.
  sources          jsonb not null default '[]',
  published_at     timestamptz not null default now(),
  published_by     uuid not null,
  -- The sha256, in hex, of the row as published (publication_digest()),
  -- written by the database.
  sha256           text not null,
  withdrawn_at     timestamptz,
  withdrawn_by     uuid,
  constraint document_publications_version unique (document_id, version),
  constraint document_publications_version_positive check (version > 0),
  constraint document_publications_license_not_blank check (btrim(license) <> ''),
  constraint document_publications_sources_array check (jsonb_typeof(sources) = 'array'),
  constraint document_publications_sha256 check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint document_publications_withdrawal check ((withdrawn_at is null) = (withdrawn_by is null))
);

comment on table document_publications is
  'One version published of a document of the organisation (decision 0015): a copy of what the document was, its licence, the sources it draws on with their licences, its date and its publisher, and the sha256 the database writes over all of it. Written by publish() and withdraw() only; withdrawn_at is its only change.';
comment on column document_publications.version is
  'The rank of this publication among those of its document: 1, 2, 3…';
comment on column document_publications.sources is
  'The sources the publication draws on, as they were when it was published: [{code, name, license, attribution}]. Every one is redistributable.';
comment on column document_publications.sha256 is
  'The sha256, in hex, of the publication as published (publication_digest()): written by the database, never given by the caller.';

create index document_publications_organisation_idx on document_publications (organisation_id);

-- The sha256 of a publication: over the text of one JSON object holding
-- every column it was published with, the file's checksum among them, so
-- that whoever holds the row can recompute it and see that nothing moved.
create or replace function publication_digest(p document_publications)
returns text
language sql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'organisation_id', p.organisation_id,
    'version', p.version,
    'name', p.name,
    'kind', p.kind,
    'uri', p.uri,
    'media_type', p.media_type,
    'byte_size', p.byte_size,
    'checksum', p.checksum,
    'license', p.license,
    'sources', p.sources,
    'published_at', to_char(p.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'published_by', p.published_by
  )::text, 'UTF8')), 'hex');
$$;

comment on function publication_digest(document_publications) is
  'The sha256, in hex, of a publication: over the JSON text of its organisation, version, name, kind, uri, media type, size, checksum, licence, sources, date (UTC) and publisher. What document_publications.sha256 holds; recomputed, it shows the row is as published.';

-- A publication is kept as it was published: whoever writes, the database
-- computes its sha256 when it is inserted, and afterwards lets only its
-- withdrawal be set, once, and its document be forgotten when deleted.
create or replace function document_publications_freeze()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.withdrawn_at := null;
    new.withdrawn_by := null;
    new.sha256 := publication_digest(new);
    return new;
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'publication_withdrawn: publication % was withdrawn on %', old.id, old.withdrawn_at
      using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - array['withdrawn_at', 'withdrawn_by', 'document_id'])
       is distinct from (to_jsonb(old) - array['withdrawn_at', 'withdrawn_by', 'document_id'])
     or (new.document_id is distinct from old.document_id and new.document_id is not null) then
    raise exception 'publication_frozen: a publication is kept as it was published; publish the document again for a new version'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function document_publications_freeze() is
  'Trigger of document_publications: writes the sha256 on insert, then refuses any change but the withdrawal (publication_frozen, publication_withdrawn) and the forgetting of a deleted document.';

create trigger document_publications_freeze
  before insert or update on document_publications
  for each row execute function document_publications_freeze();

alter table document_publications enable row level security;
-- Whoever reads the organisation reads its publications; nobody writes
-- them but the two gestures below.
create policy document_publications_select on document_publications for select to authenticated
  using (row_has_capability(organisation_id, null, null, 'data.read'));
grant select on document_publications to authenticated, service_role;
grant insert, update, delete on document_publications to service_role;

-- ---------------------------------------------------------------------------
-- publish() and withdraw()
-- ---------------------------------------------------------------------------

create or replace function publish(p_document_id uuid, p_license text, p_sources text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  d        documents%rowtype;
  v_codes  text[];
  v_bad    text;
  v_id     uuid;
begin
  select * into d from documents where id = p_document_id for update;
  if not found or not has_capability('organisation', d.organisation_id, 'data.read') then
    raise exception 'document_not_found: %', p_document_id using errcode = 'P0002';
  end if;
  if auth.uid() is null or not has_capability('organisation', d.organisation_id, 'publications.manage') then
    raise exception 'not_allowed: a document is published by a person who holds publications.manage on its organisation, an owner'
      using errcode = '42501';
  end if;
  if p_license is null or btrim(p_license) = '' then
    raise exception 'license_required: name the licence the public receives the document under (CC-BY-4.0, ODbL-1.0…)';
  end if;
  if d.checksum is null then
    raise exception 'checksum_required: document % has no checksum; attach the file again with its sha256 before publishing it', p_document_id;
  end if;
  -- The sources it draws on: those named, and the document's own.
  select coalesce(array_agg(distinct c order by c), '{}') into v_codes
    from unnest(coalesce(p_sources, '{}') || case when d.source_code is null then '{}'::text[] else array[d.source_code] end) c;
  select string_agg(c, ', ') into v_bad from unnest(v_codes) c where not exists (select 1 from sources s where s.code = c);
  if v_bad is not null then
    raise exception 'source_unknown: %', v_bad using errcode = 'foreign_key_violation';
  end if;
  select string_agg(s.code, ', ') into v_bad from sources s where s.code = any (v_codes) and not s.redistributable;
  if v_bad is not null then
    raise exception 'source_not_redistributable: the licence of % does not allow passing on what it gives', v_bad
      using errcode = 'check_violation';
  end if;
  insert into document_publications (organisation_id, document_id, version, name, kind, uri, media_type, byte_size, checksum,
                                     license, sources, published_by, sha256)
  values (d.organisation_id, d.id,
          coalesce((select max(version) from document_publications where document_id = d.id), 0) + 1,
          d.name, d.kind, d.uri, d.media_type, d.byte_size, d.checksum, btrim(p_license),
          coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'license', s.license, 'attribution', s.attribution)
                                     order by s.code)
                      from sources s where s.code = any (v_codes)), '[]'),
          auth.uid(), repeat('0', 64))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function publish(uuid, text, text[]) is
  'Publishes a document of the organisation (decision 0015), acting as an owner (publications.manage): a new version, frozen with its licence, the sources it draws on (those named and the document''s own) and the sha256 the database writes. Refuses document_not_found, not_allowed, license_required, checksum_required, source_unknown, source_not_redistributable. Returns the publication''s id.';

create or replace function withdraw(p_publication_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  p document_publications%rowtype;
begin
  select * into p from document_publications where id = p_publication_id for update;
  if not found or not has_capability('organisation', p.organisation_id, 'data.read') then
    raise exception 'publication_not_found: %', p_publication_id using errcode = 'P0002';
  end if;
  if auth.uid() is null or not has_capability('organisation', p.organisation_id, 'publications.manage') then
    raise exception 'not_allowed: a publication is withdrawn by a person who holds publications.manage on its organisation, an owner'
      using errcode = '42501';
  end if;
  update document_publications set withdrawn_at = now(), withdrawn_by = auth.uid() where id = p_publication_id;
  return now();
end;
$$;

comment on function withdraw(uuid) is
  'Withdraws a publication, acting as an owner (publications.manage): its only change, once. Refuses publication_not_found, not_allowed, publication_withdrawn. Returns when.';

revoke execute on function publish(uuid, text, text[]), withdraw(uuid) from public;
grant execute on function publish(uuid, text, text[]), withdraw(uuid), publication_digest(document_publications)
  to authenticated, service_role;

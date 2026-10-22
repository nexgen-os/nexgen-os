-- Nexgen OS — core: what is attached to an object of the core.
--
--   attributes    a value of a defined attribute type, valid over a period
--                 (IFC property sets, bSDD properties)
--   identifiers  the identifiers an object is known by elsewhere
--   documents     files about an object: a permit, a datasheet, a report, a
--                 photo, a video
--
-- Each attachment names its object by its kind and its id (`object_kind`,
-- `object_id`), the kind being one of the six objects of the core —
-- organisation, project, participant, meter, device, series — checked by a
-- plain constraint, as Ekwo OS attaches its files. It carries the
-- organisation of its object, copied by trigger through
-- `object_organisation()` so that row level security reads one column. When
-- the object is deleted, `drop_attachments()` deletes what was attached to
-- it. A relation a module needs is a column of that module's table pointing
-- to an object of the core.
-- A single row may be inserted as is, under the triggers; a gesture that
-- writes several rows or carries a rule is a function (`set_attribute()`,
-- `add_identifier()`…), so that every caller meets the same rule.

set search_path = nexgen, extensions;

-- Copies the organisation of the object its object_kind and object_id name.
create or replace function attach()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  org uuid;
begin
  org := object_organisation(new.object_kind, new.object_id);
  -- A row that says its organisation says the object's.
  if new.organisation_id is not null and new.organisation_id <> org then
    raise exception 'object_in_other_organisation: % %', new.object_kind, new.object_id using errcode = 'check_violation';
  end if;
  new.organisation_id := org;
  return new;
end;
$$;

comment on function attach() is
  'Trigger of every attachment: copies the organisation of the object its kind and id name (object_organisation). Refuses kind_unknown, object_not_found, object_in_other_organisation.';

-- A value fits an attribute type: its datatype, its range, its allowed values.
-- Shared by attributes and by the defaults of the country packs.
create or replace function attribute_value_check(p_attribute_type text, p_value jsonb)
returns void
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  def   attribute_types%rowtype;
  t     text := jsonb_typeof(p_value);
  n     numeric;
begin
  select * into def from attribute_types where code = p_attribute_type;
  if not found then
    raise exception 'attribute_type_unknown: %', p_attribute_type using errcode = 'foreign_key_violation';
  end if;
  if def.datatype in ('number', 'integer') then
    if t <> 'number' then
      raise exception 'invalid_value: % must be a number', def.code using errcode = 'check_violation';
    end if;
    n := (p_value #>> '{}')::numeric;
    if def.datatype = 'integer' and n <> trunc(n) then
      raise exception 'invalid_value: % must be an integer', def.code using errcode = 'check_violation';
    end if;
    if def.minimum is not null and n < def.minimum then
      raise exception 'invalid_value: % must be at least %', def.code, def.minimum using errcode = 'check_violation';
    end if;
    if def.maximum is not null and n > def.maximum then
      raise exception 'invalid_value: % must be at most %', def.code, def.maximum using errcode = 'check_violation';
    end if;
  elsif def.datatype in ('text', 'date') then
    if t <> 'string' then
      raise exception 'invalid_value: % must be a string', def.code using errcode = 'check_violation';
    end if;
    if def.datatype = 'date' then
      perform (p_value #>> '{}')::date;
    end if;
    if def.allowed_values is not null and not (p_value #>> '{}') = any (def.allowed_values) then
      raise exception 'invalid_value: % must be one of %', def.code, def.allowed_values using errcode = 'check_violation';
    end if;
  elsif def.datatype = 'boolean' and t <> 'boolean' then
    raise exception 'invalid_value: % must be a boolean', def.code using errcode = 'check_violation';
  end if;
end;
$$;

comment on function attribute_value_check(text, jsonb) is
  'Refuses, as invalid_value, a value that does not fit its attribute type: datatype, range, allowed values.';

-- ---------------------------------------------------------------------------
-- attributes
-- ---------------------------------------------------------------------------

create table attributes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  object_kind      text not null,
  object_id        uuid not null,
  attribute_type   text not null references attribute_types(code),
  -- A JSON scalar (or a JSON document for datatype `json`). Numbers are in
  -- the unit of the attribute type's quantity, always.
  value            jsonb not null,
  -- Period over which the value holds. Null bounds are open: a value with
  -- no dates holds always. History is kept by closing a period and opening
  -- the next, never by overwriting.
  valid_from       timestamptz,
  valid_to         timestamptz,
  -- Where the value comes from: a source of the vocabulary when it is one
  -- (an open-data API, a register, a published text), and a free note (a
  -- survey, a datasheet, a person).
  source_code      text references sources(code),
  source           text,
  -- What kind of value it is (value_statuses): published, measured,
  -- estimated or default. A value nobody qualified is estimated: never
  -- claimed measured or published without saying so.
  status           text not null default 'estimated' references value_statuses(code),
  created_at       timestamptz not null default now(),
  constraint attributes_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint attributes_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table attributes is
  'Values a trade attaches to an object beyond its columns — U-value, energy label, roof material, year of construction, efficiency — typed by attribute_types, with validity periods and provenance. A column holds what every row has and every query filters on; the rest is an attribute.';

create unique index attributes_one_per_period on attributes
  (object_kind, object_id, attribute_type, valid_from) nulls not distinct;
create index attributes_object_idx on attributes (object_kind, object_id);

create trigger attributes_attach
  before insert or update on attributes
  for each row execute function attach();

create or replace function attributes_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  def   attribute_types%rowtype;
begin
  select * into def from attribute_types where code = new.attribute_type;

  if def.applies_to is not null and not new.object_kind = any (def.applies_to) then
    raise exception 'attribute_type_not_applicable: % does not apply to a %', def.code, new.object_kind
      using errcode = 'check_violation';
  end if;
  perform attribute_value_check(new.attribute_type, new.value);

  if exists (
    select 1 from attributes a
     where a.object_kind = new.object_kind and a.object_id = new.object_id
       and a.attribute_type = new.attribute_type
       and a.id <> new.id
       and tstzrange(a.valid_from, a.valid_to) && tstzrange(new.valid_from, new.valid_to)
  ) then
    raise exception 'overlapping_value: % already has a value over that period', def.code
      using errcode = 'exclusion_violation';
  end if;
  return new;
end;
$$;

comment on function attributes_check() is
  'BEFORE INSERT / UPDATE on attributes: the attribute type applies to the object''s kind, the value fits it, and two periods never overlap (overlapping_value).';

create trigger attributes_check
  before insert or update on attributes
  for each row execute function attributes_check();

-- The attributes of an object at a moment, as one JSON object.
create or replace function attributes_of(
  p_object_id   uuid,
  p_at          timestamptz default now()
)
returns jsonb
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select coalesce(jsonb_object_agg(a.attribute_type, a.value), '{}'::jsonb)
    from attributes a
   where a.object_id = p_object_id
     and (a.valid_from is null or a.valid_from <= p_at)
     and (a.valid_to is null or a.valid_to > p_at);
$$;

comment on function attributes_of(uuid, timestamptz) is
  'Every attribute of an object holding at a moment, as one JSON object. The one place attributes are read from.';

-- ---------------------------------------------------------------------------
-- identifiers
-- ---------------------------------------------------------------------------

create table identifiers (
  organisation_id  uuid not null references organisations(id) on delete cascade,
  object_kind      text not null,
  object_id        uuid not null,
  scheme           text not null references identifier_schemes(code),
  value            text not null,
  -- When the identifier named this object: registers retire and reissue.
  valid_from       timestamptz,
  valid_to         timestamptz,
  created_at       timestamptz not null default now(),
  primary key (organisation_id, scheme, value),
  constraint identifiers_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint identifiers_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table identifiers is
  'Identifiers an object of the core is known by elsewhere (a national register, a municipality code, a geocoder''s id, a device''s serial in a hub). One value names one object per organisation.';

create index identifiers_object_idx on identifiers (object_kind, object_id);

create or replace function identifiers_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if not identifier_valid(new.scheme, new.value) then
    raise exception 'invalid_identifier: % is not a valid %', new.value, new.scheme
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function identifiers_check() is
  'BEFORE INSERT / UPDATE on identifiers: the value matches its scheme (invalid_identifier).';

create trigger identifiers_attach
  before insert or update on identifiers
  for each row execute function attach();
create trigger identifiers_check
  before insert or update on identifiers
  for each row execute function identifiers_check();

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

create table documents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  object_kind      text not null,
  object_id        uuid not null,
  name             text not null,
  -- document: a file to read; image, video: what the object looks like;
  -- plan: a drawing; report: a module's output; datasheet; permit.
  kind             text not null default 'document',
  -- A file somewhere: object storage, a public URL. With its media type.
  uri              text not null,
  media_type       text,
  -- The file itself, as Ekwo OS describes an attachment: its size in bytes,
  -- its checksum written with its algorithm (`sha256:<hex>`), so that the
  -- same file is known again wherever it is stored, and the user who
  -- uploaded it (null for what a connector or an import wrote).
  byte_size        bigint,
  checksum         text,
  uploaded_by      uuid default auth.uid(),
  -- Who or what produced it: a source of the vocabulary when it is one, and
  -- a free note (a survey, a drone flight, a render, a person).
  source_code      text references sources(code),
  source           text,
  captured_at      timestamptz,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  constraint documents_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint documents_name_not_blank check (btrim(name) <> ''),
  constraint documents_kind check (kind in ('document', 'image', 'video', 'plan', 'report', 'datasheet', 'permit')),
  constraint documents_size check (byte_size is null or byte_size >= 0)
);

comment on table documents is
  'Files about an object of the core: a permit, a datasheet, a report, a photo, a video, with their size, checksum and uploader as Ekwo OS describes an attachment. Heavy files stay in object storage; only their row is here. 3D models and point clouds are the building module''s.';

create index documents_object_idx on documents (object_kind, object_id);
create index documents_checksum_idx on documents (checksum) where checksum is not null;

create trigger documents_attach
  before insert or update on documents
  for each row execute function attach();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

call secure_table('attributes', 'project_of(object_kind, object_id)', 'participant_of(object_kind, object_id)');
call secure_table('identifiers', 'project_of(object_kind, object_id)', 'participant_of(object_kind, object_id)');
call secure_table('documents', 'project_of(object_kind, object_id)', 'participant_of(object_kind, object_id)');

-- An attribute type may be written with another capability than
-- data.write (attribute_types.written_with): the contact details and the
-- notification settings of a participant, which its own account writes.
create policy attributes_written_with on attributes for all to authenticated
  using (row_has_capability(organisation_id, project_of(object_kind, object_id), participant_of(object_kind, object_id),
         (select t.written_with from attribute_types t where t.code = attribute_type)))
  with check (row_has_capability(organisation_id, project_of(object_kind, object_id), participant_of(object_kind, object_id),
         (select t.written_with from attribute_types t where t.code = attribute_type)));

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

-- Every gesture names its object by its kind and its id, and refuses by name
-- an object it does not find (kind_unknown, object_not_found): the
-- organisation the attachment is stored in is the object's
-- (object_organisation()).

-- History is kept by closing a period and opening the next: the value that
-- holds at the moment given ends there, the new one starts there.
create or replace function set_attribute(
  p_object_kind   text,
  p_object_id     uuid,
  p_attribute_type text,
  p_value         jsonb,
  p_from          timestamptz default null,
  p_source_code   text default null,
  p_source        text default null,
  p_status        text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform object_organisation(p_object_kind, p_object_id);
  if p_from is not null then
    update attributes set valid_to = p_from
     where object_kind = p_object_kind and object_id = p_object_id and attribute_type = p_attribute_type
       and (valid_from is null or valid_from < p_from)
       and (valid_to is null or valid_to > p_from);
  end if;
  insert into attributes (id, object_kind, object_id, attribute_type, value, valid_from, source_code, source, status)
  values (v_id, p_object_kind, p_object_id, p_attribute_type, p_value, p_from, p_source_code, p_source, coalesce(p_status, 'estimated'));
  return v_id;
end;
$$;

comment on function set_attribute(text, uuid, text, jsonb, timestamptz, text, text, text) is
  'Sets an attribute of an object (its kind and id) from a moment on, with its source and its status (value_statuses; estimated when not given): the value holding then is closed there, the new one opens. Refuses kind_unknown, object_not_found, attribute_type_not_applicable, invalid_value, overlapping_value. Returns its id.';

create or replace function add_identifier(p_object_kind text, p_object_id uuid, p_scheme text, p_value text, p_from timestamptz default null)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
begin
  perform object_organisation(p_object_kind, p_object_id);
  insert into identifiers (object_kind, object_id, scheme, value, valid_from)
  values (p_object_kind, p_object_id, p_scheme, p_value, p_from);
exception when unique_violation then
  raise exception 'identifier_taken: % % already names an object of this organisation', p_scheme, p_value
    using errcode = 'unique_violation';
end;
$$;

comment on function add_identifier(text, uuid, text, text, timestamptz) is
  'Records an identifier an object (its kind and id) is known by elsewhere. Refuses kind_unknown, object_not_found, invalid_identifier, identifier_taken.';

create or replace function attach_document(
  p_object_kind  text,
  p_object_id    uuid,
  p_name         text,
  p_kind         text,
  p_uri          text,
  p_media_type   text default null,
  p_source_code  text default null,
  p_source       text default null,
  p_captured_at  timestamptz default null,
  p_byte_size    bigint default null,
  p_checksum     text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform object_organisation(p_object_kind, p_object_id);
  insert into documents (id, object_kind, object_id, name, kind, uri, media_type, source_code, source, captured_at, byte_size, checksum)
  values (v_id, p_object_kind, p_object_id, p_name, p_kind, p_uri, p_media_type, p_source_code, p_source, p_captured_at, p_byte_size, p_checksum);
  return v_id;
end;
$$;

comment on function attach_document(text, uuid, text, text, text, text, text, text, timestamptz, bigint, text) is
  'Attaches a file to an object (its kind and id): a permit, a datasheet, a report, a photo, with its size in bytes and its checksum when known; the user who calls is its uploader. Refuses kind_unknown, object_not_found. Returns its id.';

grant execute on function attributes_of(uuid, timestamptz), attribute_value_check(text, jsonb),
  set_attribute(text, uuid, text, jsonb, timestamptz, text, text, text), add_identifier(text, uuid, text, text, timestamptz),
  attach_document(text, uuid, text, text, text, text, text, text, timestamptz, bigint, text)
  to authenticated, service_role;

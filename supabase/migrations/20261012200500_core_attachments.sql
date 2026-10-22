-- Nexgen OS — core: what is attached to an object of the core.
--
--   attributes    a value of a defined property, valid over a period
--                 (IFC property sets, bSDD properties)
--   external_ids  the identifiers an object is known by elsewhere
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

set search_path = nexgen, public, extensions;

-- Copies the organisation of the object named by the pair tg_argv[0] names
-- (`object` for object_kind / object_id, the default; `subject` for
-- subject_kind / subject_id, as a task names what it is about).
create or replace function attach()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  side  text := coalesce(tg_argv[0], 'object');
  k     text;
  oid   uuid;
  org   uuid;
begin
  execute format('select ($1).%I, ($1).%I', side || '_kind', side || '_id') into k, oid using new;
  org := object_organisation(k, oid);
  -- A row that says its organisation says the object's.
  if new.organisation_id is not null and new.organisation_id <> org then
    raise exception 'object_in_other_organisation: % %', k, oid using errcode = 'check_violation';
  end if;
  new.organisation_id := org;
  return new;
end;
$$;

comment on function attach() is
  'Trigger of every attachment: copies the organisation of the object its kind and id name (object_organisation). Refuses kind_unknown, object_not_found, object_in_other_organisation.';

-- A value fits a property: its datatype, its range, its allowed values.
-- Shared by attributes and by the defaults of the country packs.
create or replace function property_value_check(p_property_code text, p_value jsonb)
returns void
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  def   property_defs%rowtype;
  t     text := jsonb_typeof(p_value);
  n     numeric;
begin
  select * into def from property_defs where code = p_property_code;
  if not found then
    raise exception 'property_unknown: %', p_property_code using errcode = 'foreign_key_violation';
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

comment on function property_value_check(text, jsonb) is
  'Refuses, as invalid_value, a value that does not fit its property: datatype, range, allowed values.';

-- ---------------------------------------------------------------------------
-- attributes
-- ---------------------------------------------------------------------------

create table attributes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  object_kind      text not null,
  object_id        uuid not null,
  property_code    text not null references property_defs(code),
  -- A JSON scalar (or a JSON document for datatype `json`). Numbers are in
  -- the unit of the property's quantity, always.
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
  created_at       timestamptz not null default now(),
  constraint attributes_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint attributes_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table attributes is
  'Values a trade attaches to an object beyond its columns — U-value, energy label, roof material, year of construction, efficiency — typed by property_defs, with validity periods and provenance. A column holds what every row has and every query filters on; the rest is an attribute.';

create unique index attributes_one_per_period on attributes
  (object_kind, object_id, property_code, valid_from) nulls not distinct;
create index attributes_object_idx on attributes (object_kind, object_id);

create trigger attributes_attach
  before insert or update on attributes
  for each row execute function attach('object');

create or replace function attributes_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  def   property_defs%rowtype;
begin
  select * into def from property_defs where code = new.property_code;

  if def.applies_to is not null and not new.object_kind = any (def.applies_to) then
    raise exception 'property_not_applicable: % does not apply to a %', def.code, new.object_kind
      using errcode = 'check_violation';
  end if;
  perform property_value_check(new.property_code, new.value);

  if exists (
    select 1 from attributes a
     where a.object_kind = new.object_kind and a.object_id = new.object_id
       and a.property_code = new.property_code
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
  'BEFORE INSERT / UPDATE on attributes: the property applies to the object''s kind, the value fits it, and two periods never overlap (overlapping_value).';

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
set search_path = nexgen, public, extensions, pg_temp
as $$
  select coalesce(jsonb_object_agg(a.property_code, a.value), '{}'::jsonb)
    from attributes a
   where a.object_id = p_object_id
     and (a.valid_from is null or a.valid_from <= p_at)
     and (a.valid_to is null or a.valid_to > p_at);
$$;

comment on function attributes_of(uuid, timestamptz) is
  'Every attribute of an object holding at a moment, as one JSON object. The one place attributes are read from.';

-- ---------------------------------------------------------------------------
-- external_ids
-- ---------------------------------------------------------------------------

create table external_ids (
  organisation_id  uuid not null references organisations(id) on delete cascade,
  object_kind      text not null,
  object_id        uuid not null,
  scheme           text not null references id_schemes(code),
  value            text not null,
  -- When the identifier named this object: registers retire and reissue.
  valid_from       timestamptz,
  valid_to         timestamptz,
  created_at       timestamptz not null default now(),
  primary key (organisation_id, scheme, value),
  constraint external_ids_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint external_ids_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table external_ids is
  'Identifiers an object of the core is known by elsewhere (a national register, a municipality code, a geocoder''s id, a device''s serial in a hub). One value names one object per organisation.';

create index external_ids_object_idx on external_ids (object_kind, object_id);

create or replace function external_ids_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if not identifier_valid(new.scheme, new.value) then
    raise exception 'invalid_identifier: % is not a valid %', new.value, new.scheme
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function external_ids_check() is
  'BEFORE INSERT / UPDATE on external_ids: the value matches its scheme (invalid_identifier).';

create trigger external_ids_attach
  before insert or update on external_ids
  for each row execute function attach('object');
create trigger external_ids_check
  before insert or update on external_ids
  for each row execute function external_ids_check();

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
  -- Who or what produced it: a source of the vocabulary when it is one, and
  -- a free note (a survey, a drone flight, a render, a person).
  source_code      text references sources(code),
  source           text,
  captured_at      timestamptz,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  constraint documents_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint documents_name_not_blank check (btrim(name) <> ''),
  constraint documents_kind check (kind in ('document', 'image', 'video', 'plan', 'report', 'datasheet', 'permit'))
);

comment on table documents is
  'Files about an object of the core: a permit, a datasheet, a report, a photo, a video. Heavy files stay in object storage; only their row is here. 3D models and point clouds are the building module''s.';

create index documents_object_idx on documents (object_kind, object_id);

create trigger documents_attach
  before insert or update on documents
  for each row execute function attach('object');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

call secure_table('attributes');
call secure_table('external_ids');
call secure_table('documents');

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
  p_property_code text,
  p_value         jsonb,
  p_from          timestamptz default null,
  p_source_code   text default null,
  p_source        text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform object_organisation(p_object_kind, p_object_id);
  if p_from is not null then
    update attributes set valid_to = p_from
     where object_kind = p_object_kind and object_id = p_object_id and property_code = p_property_code
       and (valid_from is null or valid_from < p_from)
       and (valid_to is null or valid_to > p_from);
  end if;
  insert into attributes (id, object_kind, object_id, property_code, value, valid_from, source_code, source)
  values (v_id, p_object_kind, p_object_id, p_property_code, p_value, p_from, p_source_code, p_source);
  return v_id;
end;
$$;

comment on function set_attribute(text, uuid, text, jsonb, timestamptz, text, text) is
  'Sets an attribute of an object (its kind and id) from a moment on: the value holding then is closed there, the new one opens. Refuses kind_unknown, object_not_found, property_not_applicable, invalid_value, overlapping_value. Returns its id.';

create or replace function add_identifier(p_object_kind text, p_object_id uuid, p_scheme text, p_value text, p_from timestamptz default null)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  perform object_organisation(p_object_kind, p_object_id);
  insert into external_ids (object_kind, object_id, scheme, value, valid_from)
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
  p_captured_at  timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform object_organisation(p_object_kind, p_object_id);
  insert into documents (id, object_kind, object_id, name, kind, uri, media_type, source_code, source, captured_at)
  values (v_id, p_object_kind, p_object_id, p_name, p_kind, p_uri, p_media_type, p_source_code, p_source, p_captured_at);
  return v_id;
end;
$$;

comment on function attach_document(text, uuid, text, text, text, text, text, text, timestamptz) is
  'Attaches a file to an object (its kind and id): a permit, a datasheet, a report, a photo. Refuses kind_unknown, object_not_found. Returns its id.';

grant execute on function attributes_of(uuid, timestamptz), property_value_check(text, jsonb),
  set_attribute(text, uuid, text, jsonb, timestamptz, text, text), add_identifier(text, uuid, text, text, timestamptz),
  attach_document(text, uuid, text, text, text, text, text, text, timestamptz)
  to authenticated, service_role;

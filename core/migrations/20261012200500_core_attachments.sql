-- Nexgen OS — core: what is attached to any object.
--
--   attributes    a value of a defined property, valid over a period
--                 (IFC property sets, bSDD properties)
--   external_ids  the identifiers an object is known by elsewhere
--   links         a typed link between two objects that is not a column
--                 of either (feeds, serves, shades, owns, occupies…)
--                 — and what became of an object that was split, merged or
--                 replaced (`split_into`, `merged_into`, `replaces`)
--   documents     files about an object: a permit, a datasheet, a report, a
--                 photo, a video
--
-- Each attachment names its object by its kind and its id
-- (`object_kind`, `object_id`; a link names its subject the same way). It
-- carries the organisation of its object, copied by trigger through
-- `object_organisation()` so that row level security reads one column, and
-- may belong to a scenario. When the object is deleted, `drop_attachments()`
-- deletes what was attached to it.
-- A single row may be inserted as is, under the triggers; a gesture that
-- writes several rows or carries a rule is a function (`set_attribute()`,
-- `split_object()`…), so that every caller meets the same rule.

set search_path = nexgen, public, extensions;

-- Copies the organisation of the object named by the pair tg_argv[0] names
-- (`object` for object_kind / object_id, `subject` for subject_kind /
-- subject_id), and refuses an attachment to an object of another scenario
-- than its own.
create or replace function attach()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  side  text := coalesce(tg_argv[0], 'object');
  k     text;
  oid   uuid;
  scn   uuid;
begin
  execute format('select ($1).%I, ($1).%I', side || '_kind', side || '_id') into k, oid using new;
  new.organisation_id := object_organisation(k, oid);
  scn := object_scenario(k, oid);
  if scn is not null and scn is distinct from new.scenario_id then
    raise exception 'attachment_outside_object_scenario' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function attach() is
  'Trigger of every attachment: copies the organisation of the object its kind and id name (object_organisation), and refuses an attachment outside the object''s scenario. Refuses kind_unknown, object_not_found.';

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
  object_kind      text not null references kinds(kind),
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
  scenario_id      uuid references scenarios(id) on delete cascade,
  -- Where the value comes from: a source of the vocabulary when it is one
  -- (an open-data API, a register, a published text), and a free note (a
  -- survey, a datasheet, a person).
  source_code      text references sources(code),
  source           text,
  created_at       timestamptz not null default now(),
  constraint attributes_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table attributes is
  'Values a trade attaches to an object beyond its columns — U-value, energy label, roof material, year of construction, efficiency — typed by property_defs, with validity periods and provenance. A column holds what every row has and every query filters on; the rest is an attribute.';

create unique index attributes_one_per_period on attributes
  (object_kind, object_id, property_code, scenario_id, valid_from) nulls not distinct;
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
       and a.scenario_id is not distinct from new.scenario_id
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
  'BEFORE INSERT / UPDATE on attributes: the property applies to the object''s kind, the value fits it, and two periods never overlap in one scenario (overlapping_value).';

create trigger attributes_check
  before insert or update on attributes
  for each row execute function attributes_check();

-- The attributes of an object at a moment, in a scenario, as one JSON
-- object. A scenario sees reality, overridden by what the scenario (and the
-- scenarios it builds on) changed.
create or replace function attributes_of(
  p_object_id   uuid,
  p_at          timestamptz default now(),
  p_scenario_id uuid default null
)
returns jsonb
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive chain as (
    select s.id, s.parent_id, 1 as rank from scenarios s where s.id = p_scenario_id
    union all
    select s.id, s.parent_id, chain.rank + 1 from scenarios s join chain on s.id = chain.parent_id
  ),
  candidates as (
    select a.property_code, a.value,
           coalesce((select rank from chain where chain.id = a.scenario_id), case when a.scenario_id is null then 1000000 end) as rank
      from attributes a
     where a.object_id = p_object_id
       and (a.valid_from is null or a.valid_from <= p_at)
       and (a.valid_to is null or a.valid_to > p_at)
  ),
  best as (
    select distinct on (property_code) property_code, value
      from candidates
     where rank is not null
     order by property_code, rank
  )
  select coalesce(jsonb_object_agg(property_code, value), '{}'::jsonb) from best;
$$;

comment on function attributes_of(uuid, timestamptz, uuid) is
  'Every attribute of an object holding at a moment, in a scenario (null = reality), as one JSON object. The one place attributes are read from.';

-- ---------------------------------------------------------------------------
-- external_ids
-- ---------------------------------------------------------------------------

create table external_ids (
  organisation_id  uuid not null references organisations(id) on delete cascade,
  object_kind      text not null references kinds(kind),
  object_id        uuid not null,
  scheme           text not null references id_schemes(code),
  value            text not null,
  -- When the identifier named this object: registers retire and reissue.
  valid_from       timestamptz,
  valid_to         timestamptz,
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (organisation_id, scheme, value),
  constraint external_ids_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table external_ids is
  'Identifiers an object is known by elsewhere (IFC GlobalId, OSM, Overture GERS, a cadastre, a national register). One value names one object per organisation.';

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
-- links
-- ---------------------------------------------------------------------------

create table links (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  subject_kind     text not null references kinds(kind),
  subject_id       uuid not null,
  type_code        text not null references link_types(code),
  object_kind      text not null references kinds(kind),
  object_id        uuid not null,
  valid_from       timestamptz,
  valid_to         timestamptz,
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  constraint links_not_reflexive check (subject_id <> object_id),
  constraint links_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table links is
  'Typed, dated links between two objects that are not a column of either: the tree shades the roof, the heat pump serves the building, the inverter feeds the meter, the parcel was split into two, the new meter replaces the old one.';

create unique index links_unique on links
  (subject_kind, subject_id, type_code, object_kind, object_id, scenario_id, valid_from) nulls not distinct;
create index links_subject_idx on links (subject_kind, subject_id);
create index links_object_idx on links (object_kind, object_id);

create trigger links_attach
  before insert or update on links
  for each row execute function attach('subject');

create or replace function links_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  lt   link_types%rowtype;
  scn  uuid;
begin
  select * into lt from link_types where code = new.type_code;
  if lt.subject_kinds is not null and not new.subject_kind = any (lt.subject_kinds) then
    raise exception 'link_subject_kind: % needs one of % as subject, got a %', lt.code, lt.subject_kinds, new.subject_kind
      using errcode = 'check_violation';
  end if;
  if lt.object_kinds is not null and not new.object_kind = any (lt.object_kinds) then
    raise exception 'link_object_kind: % needs one of % as object, got a %', lt.code, lt.object_kinds, new.object_kind
      using errcode = 'check_violation';
  end if;
  -- The subject's organisation is the link's (attach); the object's is read
  -- the same way, and refused by name when it is not found.
  if object_organisation(new.object_kind, new.object_id) <> new.organisation_id then
    raise exception 'link_across_organisations' using errcode = 'check_violation';
  end if;
  scn := object_scenario(new.object_kind, new.object_id);
  if scn is not null and scn is distinct from new.scenario_id then
    raise exception 'attachment_outside_object_scenario' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function links_check() is
  'BEFORE INSERT / UPDATE on links: both ends in one organisation, the object in the link''s scenario, the kinds the link type asks for (link_subject_kind, link_object_kind).';

create trigger links_check
  before insert or update on links
  for each row execute function links_check();

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

create table documents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  object_kind      text not null references kinds(kind),
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
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  constraint documents_name_not_blank check (btrim(name) <> ''),
  constraint documents_kind check (kind in ('document', 'image', 'video', 'plan', 'report', 'datasheet', 'permit'))
);

comment on table documents is
  'Files about an object: a permit, a datasheet, a report, a photo, a video. Heavy files stay in object storage; only their row is here. 3D models and point clouds are the building module''s.';

create index documents_object_idx on documents (object_kind, object_id);

create trigger documents_attach
  before insert or update on documents
  for each row execute function attach('object');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

call secure_table('attributes');
call secure_table('external_ids');
call secure_table('links');
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
  p_source        text default null,
  p_scenario_id   uuid default null
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
       and scenario_id is not distinct from p_scenario_id
       and (valid_from is null or valid_from < p_from)
       and (valid_to is null or valid_to > p_from);
  end if;
  insert into attributes (id, object_kind, object_id, property_code, value, valid_from, scenario_id, source_code, source)
  values (v_id, p_object_kind, p_object_id, p_property_code, p_value, p_from, p_scenario_id, p_source_code, p_source);
  return v_id;
end;
$$;

comment on function set_attribute(text, uuid, text, jsonb, timestamptz, text, text, uuid) is
  'Sets an attribute of an object (its kind and id) from a moment on: the value holding then is closed there, the new one opens. Refuses kind_unknown, object_not_found, property_not_applicable, invalid_value, overlapping_value. Returns its id.';

create or replace function add_identifier(p_object_kind text, p_object_id uuid, p_scheme text, p_value text, p_from timestamptz default null)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  perform object_organisation(p_object_kind, p_object_id);
  insert into external_ids (object_kind, object_id, scheme, value, valid_from, scenario_id)
  values (p_object_kind, p_object_id, p_scheme, p_value, p_from, object_scenario(p_object_kind, p_object_id));
exception when unique_violation then
  raise exception 'identifier_taken: % % already names an object of this organisation', p_scheme, p_value
    using errcode = 'unique_violation';
end;
$$;

comment on function add_identifier(text, uuid, text, text, timestamptz) is
  'Records an identifier an object (its kind and id) is known by elsewhere. Refuses kind_unknown, object_not_found, invalid_identifier, identifier_taken.';

create or replace function link_objects(
  p_subject_kind text,
  p_subject_id   uuid,
  p_type_code    text,
  p_object_kind  text,
  p_object_id    uuid,
  p_from         timestamptz default null,
  p_scenario_id  uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into links (id, subject_kind, subject_id, type_code, object_kind, object_id, valid_from, scenario_id)
  values (v_id, p_subject_kind, p_subject_id, p_type_code, p_object_kind, p_object_id, p_from, p_scenario_id);
  return v_id;
end;
$$;

comment on function link_objects(text, uuid, text, text, uuid, timestamptz, uuid) is
  'Links two objects, each named by its kind and its id, with a typed link from a moment on. Refuses kind_unknown, object_not_found, link_subject_kind, link_object_kind, link_across_organisations. Returns its id.';

create or replace function end_link(p_link_id uuid, p_at timestamptz default now())
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  update links set valid_to = p_at where id = p_link_id and valid_to is null;
  if not found then
    raise exception 'link_not_open: %', p_link_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function end_link(uuid, timestamptz) is
  'Ends an open link at a moment; the link stays as history. Refuses link_not_open.';

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
  insert into documents (id, object_kind, object_id, name, kind, uri, media_type, source_code, source, captured_at, scenario_id)
  values (v_id, p_object_kind, p_object_id, p_name, p_kind, p_uri, p_media_type, p_source_code, p_source, p_captured_at,
          object_scenario(p_object_kind, p_object_id));
  return v_id;
end;
$$;

comment on function attach_document(text, uuid, text, text, text, text, text, text, timestamptz) is
  'Attaches a file to an object (its kind and id): a permit, a datasheet, a report, a photo. Refuses kind_unknown, object_not_found. Returns its id.';

-- Identifiers never encode anything and are never reused: when a parcel is
-- split or two buildings are merged, the new objects are created as any
-- other, of the same kind, and the old and new are linked so that history
-- and external references stay traceable.
create or replace function split_object(p_kind text, p_object_id uuid, p_into uuid[], p_at timestamptz default now())
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  org   uuid := object_organisation(p_kind, p_object_id);
  part  uuid;
begin
  foreach part in array p_into loop
    if object_organisation(p_kind, part) <> org then
      raise exception 'object_in_other_organisation: %', part using errcode = 'check_violation';
    end if;
    insert into links (subject_kind, subject_id, type_code, object_kind, object_id, valid_from, scenario_id)
    values (p_kind, p_object_id, 'split_into', p_kind, part, p_at, object_scenario(p_kind, p_object_id));
  end loop;
end;
$$;

comment on function split_object(text, uuid, uuid[], timestamptz) is
  'Records that an object was split into others of its kind at a moment, as split_into links. Refuses kind_unknown, object_not_found (a part that is not of the kind), object_in_other_organisation.';

create or replace function merge_objects(p_kind text, p_objects uuid[], p_into uuid, p_at timestamptz default now())
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  org   uuid := object_organisation(p_kind, p_into);
  part  uuid;
begin
  foreach part in array p_objects loop
    if object_organisation(p_kind, part) <> org then
      raise exception 'object_in_other_organisation: %', part using errcode = 'check_violation';
    end if;
    insert into links (subject_kind, subject_id, type_code, object_kind, object_id, valid_from, scenario_id)
    values (p_kind, part, 'merged_into', p_kind, p_into, p_at, object_scenario(p_kind, part));
  end loop;
end;
$$;

comment on function merge_objects(text, uuid[], uuid, timestamptz) is
  'Records that objects were merged into another of their kind at a moment, as merged_into links. Refuses kind_unknown, object_not_found (an object that is not of the kind), object_in_other_organisation.';

grant execute on function attributes_of(uuid, timestamptz, uuid), property_value_check(text, jsonb),
  set_attribute(text, uuid, text, jsonb, timestamptz, text, text, uuid), add_identifier(text, uuid, text, text, timestamptz),
  link_objects(text, uuid, text, text, uuid, timestamptz, uuid), end_link(uuid, timestamptz),
  attach_document(text, uuid, text, text, text, text, text, text, timestamptz),
  split_object(text, uuid, uuid[], timestamptz), merge_objects(text, uuid[], uuid, timestamptz)
  to authenticated, service_role;

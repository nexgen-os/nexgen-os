-- Nexgen OS — core: what is attached to any object.
--
--   attributes    a value of a defined property, valid over a period
--                 (IFC property sets, bSDD properties)
--   external_ids  the identifiers an object is known by elsewhere
--   links         a typed link between two objects that is not a column
--                 of either (feeds, serves, shades, owns, occupies…)
--   successors       what became of an object that was split, merged or replaced
--   documents     files about an object: a permit, a datasheet, a report, a
--                 photo, a video
--
-- Each attachment carries the organisation of its object, copied by trigger
-- so that row level security reads one column, and may belong to a scenario.

set search_path = nexgen, public, extensions;

-- Copies the organisation of the object named by tg_argv[0], and refuses an
-- attachment to an object of another scenario than its own.
create or replace function attach()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  col  text := coalesce(tg_argv[0], 'object_id');
  oid  uuid;
  o    objects%rowtype;
begin
  execute format('select ($1).%I', col) into oid using new;
  select * into o from objects where id = oid;
  if not found then
    raise exception 'object_not_found: %', oid using errcode = 'foreign_key_violation';
  end if;
  if o.scenario_id is not null and o.scenario_id is distinct from new.scenario_id then
    raise exception 'attachment_outside_object_scenario' using errcode = 'check_violation';
  end if;
  new.organisation_id := o.organisation_id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- attributes
-- ---------------------------------------------------------------------------

create table attributes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  object_id        uuid not null references objects(id) on delete cascade,
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
  -- (an open-data API, a register), and a free note (a survey, a datasheet,
  -- a person).
  source_code      text references sources(code),
  source           text,
  created_at       timestamptz not null default now(),
  constraint attributes_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table attributes is
  'Values a trade attaches to an object beyond its columns — U-value, energy label, roof material, efficiency — typed by property_defs, with validity periods and provenance.';

create unique index attributes_one_per_period on attributes
  (object_id, property_code, scenario_id, valid_from) nulls not distinct;
create index attributes_object_idx on attributes (object_id);

create trigger attributes_attach
  before insert or update on attributes
  for each row execute function attach('object_id');

create or replace function attributes_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  def   property_defs%rowtype;
  kind  text;
  t     text := jsonb_typeof(new.value);
  n     numeric;
begin
  select * into def from property_defs where code = new.property_code;
  select o.kind into kind from objects o where o.id = new.object_id;

  if def.applies_to is not null and not kind = any (def.applies_to) then
    raise exception 'property_not_applicable: % does not apply to a %', def.code, kind
      using errcode = 'check_violation';
  end if;

  if def.datatype in ('number', 'integer') then
    if t <> 'number' then
      raise exception 'invalid_value: % must be a number', def.code using errcode = 'check_violation';
    end if;
    n := (new.value #>> '{}')::numeric;
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
      perform (new.value #>> '{}')::date;
    end if;
    if def.allowed_values is not null and not (new.value #>> '{}') = any (def.allowed_values) then
      raise exception 'invalid_value: % must be one of %', def.code, def.allowed_values using errcode = 'check_violation';
    end if;
  elsif def.datatype = 'boolean' and t <> 'boolean' then
    raise exception 'invalid_value: % must be a boolean', def.code using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from attributes a
     where a.object_id = new.object_id
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
  object_id        uuid not null references objects(id) on delete cascade,
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

create index external_ids_object_idx on external_ids (object_id);

create or replace function external_ids_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  pat text;
begin
  select pattern into pat from id_schemes where code = new.scheme;
  if pat is not null and new.value !~ pat then
    raise exception 'invalid_identifier: % is not a valid %', new.value, new.scheme
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger external_ids_attach
  before insert or update on external_ids
  for each row execute function attach('object_id');
create trigger external_ids_check
  before insert or update on external_ids
  for each row execute function external_ids_check();

-- ---------------------------------------------------------------------------
-- links
-- ---------------------------------------------------------------------------

create table links (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  subject_id       uuid not null references objects(id) on delete cascade,
  type_code        text not null references link_types(code),
  object_id        uuid not null references objects(id) on delete cascade,
  valid_from       timestamptz,
  valid_to         timestamptz,
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  constraint links_not_reflexive check (subject_id <> object_id),
  constraint links_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table links is
  'Typed, dated links between two objects that are not a column of either: the tree shades the roof, the company occupies the building, the heat pump serves the building, the inverter feeds the meter.';

create unique index links_unique on links
  (subject_id, type_code, object_id, scenario_id, valid_from) nulls not distinct;
create index links_object_idx on links (object_id);

create trigger links_attach
  before insert or update on links
  for each row execute function attach('subject_id');

create or replace function links_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  lt   link_types%rowtype;
  s    objects%rowtype;
  o    objects%rowtype;
begin
  select * into lt from link_types where code = new.type_code;
  select * into s from objects where id = new.subject_id;
  select * into o from objects where id = new.object_id;
  if o.organisation_id <> s.organisation_id then
    raise exception 'link_across_organisations' using errcode = 'check_violation';
  end if;
  if o.scenario_id is not null and o.scenario_id is distinct from new.scenario_id then
    raise exception 'attachment_outside_object_scenario' using errcode = 'check_violation';
  end if;
  if lt.subject_kinds is not null and not s.kind = any (lt.subject_kinds) then
    raise exception 'link_subject_kind: % needs one of % as subject, got a %', lt.code, lt.subject_kinds, s.kind
      using errcode = 'check_violation';
  end if;
  if lt.object_kinds is not null and not o.kind = any (lt.object_kinds) then
    raise exception 'link_object_kind: % needs one of % as object, got a %', lt.code, lt.object_kinds, o.kind
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger links_check
  before insert or update on links
  for each row execute function links_check();

-- ---------------------------------------------------------------------------
-- successors — what became of an object that was split, merged or replaced.
-- Identifiers never encode anything and are never reused; when a parcel is
-- split or two buildings are merged, the old and new objects are linked here
-- so that history and external references stay traceable.
-- ---------------------------------------------------------------------------

create table successors (
  organisation_id  uuid not null references organisations(id) on delete cascade,
  from_id          uuid not null references objects(id) on delete cascade,
  to_id            uuid not null references objects(id) on delete cascade,
  kind             text not null,
  at               timestamptz not null default now(),
  primary key (from_id, to_id),
  constraint successors_kind check (kind in ('split', 'merge', 'replace')),
  constraint successors_not_reflexive check (from_id <> to_id)
);

comment on table successors is
  'Splits, merges and replacements between objects, so that history and external references survive a change of identity.';

create or replace function successors_attach()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  a uuid;
  b uuid;
begin
  select organisation_id into a from objects where id = new.from_id;
  select organisation_id into b from objects where id = new.to_id;
  if a <> b then
    raise exception 'successors_across_organisations' using errcode = 'check_violation';
  end if;
  new.organisation_id := a;
  return new;
end;
$$;

create trigger successors_attach
  before insert or update on successors
  for each row execute function successors_attach();

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

create table documents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  object_id        uuid not null references objects(id) on delete cascade,
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
  'Files about an object: a permit, a datasheet, a report, a photo, a video. Heavy files stay in object storage; only their row is here. 3D models and point clouds are the 3d module''s.';

create index documents_object_idx on documents (object_id);

create trigger documents_attach
  before insert or update on documents
  for each row execute function attach('object_id');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

call secure_table('attributes');
call secure_table('external_ids');
call secure_table('links');
call secure_table('successors');
call secure_table('documents');

grant execute on function attributes_of(uuid, timestamptz, uuid) to authenticated, service_role;

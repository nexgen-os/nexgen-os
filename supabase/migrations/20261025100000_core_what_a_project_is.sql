-- Nexgen OS — core: what a project is, in the words that are read
-- (decision 0057).
--
-- * A project's kind is the frame it is carried out in, and nothing when it
--   has none: `projects.kind` is nullable, with no default. The generic
--   kinds nothing reads go — `study` (a project being studied is a project
--   in `simulation`, its status), `other` (null says it), `buildings`,
--   `construction` and `district_plan` (no condition, no template, no module
--   reads them). A project of one of them keeps everything else and has no
--   kind. The kinds that frames refine stay: `pv_roof`, `self_consumption`,
--   `individual_self_consumption`, `collective_self_consumption`,
--   `energy_community`.
-- * What a participant does with energy — producer, consumer, prosumer —
--   is its `category`: `role` names an access preset
--   (role_capabilities, decision 0051) and nothing else.
-- * The region a region is part of is `regions.parent_code`, the name of
--   the column that points at the parent row in every tree of the core.

set search_path = nexgen, extensions;

-- ---------------------------------------------------------------------------
-- projects.kind — the frame, or none.
-- ---------------------------------------------------------------------------

create or replace function projects_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k project_kinds%rowtype;
begin
  if new.kind is null then
    return new;
  end if;
  select * into k from project_kinds where code = new.kind;
  if not found then
    raise exception 'project_kind_unknown: % is not a project_kinds code', new.kind using errcode = 'foreign_key_violation';
  end if;
  if k.country is not null and k.country <> new.country then
    raise exception 'project_kind_foreign: % is a frame of %, the project is in %', new.kind, k.country, new.country
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function projects_check() is
  'BEFORE INSERT / UPDATE on projects: a kind, when given, is a project_kinds code (project_kind_unknown), and a legal frame of a country is used in that country only (project_kind_foreign).';

alter table projects alter column kind drop not null;
alter table projects alter column kind drop default;

comment on column projects.kind is
  'The frame the project is carried out in (project_kinds): a rooftop PV project, a self-consumption operation, an energy community, or the legal frame of its country a pack publishes; read as a condition of a default and of an action template. Null: no particular frame.';

comment on table projects is
  'What a person works on — an energy community, a self-consumption operation, a rooftop PV project, a portfolio of sites — with the frame it is carried out in when it has one, its country and its lifecycle (simulation, creation, active, inactive, archived). Its actors are participants.';

-- A value a country decides for one of the kinds that go would never be
-- read again: the installation says which before anything changes.
do $$
declare
  v_used text;
begin
  select string_agg(distinct d.condition->>'project_kind', ', ') into v_used
    from defaults d
   where d.condition->>'project_kind' in ('study', 'other', 'buildings', 'construction', 'district_plan');
  if v_used is not null then
    raise exception 'project_kind_in_use: a default holds for the project kind %, which 0.4.0 removes; close it or move it to a kind that stays', v_used
      using errcode = 'check_violation';
  end if;
end
$$;

update projects set kind = null where kind in ('study', 'other', 'buildings', 'construction', 'district_plan');
update project_kinds set parent_code = null where parent_code in ('study', 'other', 'buildings', 'construction', 'district_plan');
delete from project_kinds where code in ('study', 'other', 'buildings', 'construction', 'district_plan') and published_by = 'core';

create or replace function create_project(
  p_organisation_id uuid,
  p_name            text,
  p_country         text,
  p_kind            text default null,
  p_start_date      date default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_country is null or p_country !~ '^[A-Za-z]{2}$' then
    raise exception 'country_required: a project names the ISO 3166-1 alpha-2 country whose rules apply'
      using errcode = 'check_violation';
  end if;
  insert into projects (id, organisation_id, name, country, kind, start_date)
  values (v_id, p_organisation_id, p_name, upper(p_country), p_kind, p_start_date);
  return v_id;
end;
$$;

comment on function create_project(uuid, text, text, text, date) is
  'Opens a project in an organisation, in the country whose rules apply, with the frame it is carried out in (project_kinds) or none. Refusals: country_required, project_kind_unknown, project_kind_foreign, and row level security for a caller who does not write the organisation.';

-- ---------------------------------------------------------------------------
-- participants.category — producer, consumer, prosumer.
-- ---------------------------------------------------------------------------

alter table participants rename column role to category;
alter table participants rename constraint participants_role to participants_category;

comment on column participants.category is
  'What the participant does with energy: producer, consumer or prosumer (both). Consumer when nobody says.';

drop function join_project(uuid, text, jsonb, text, uuid, date, text, text, uuid);

-- An actor joins a project with its place in the standard shape, or none
-- for a group. Without a time zone given, it takes its region's, else the
-- first of its country's — both from the country pack, when one is
-- installed; never a zone of another country.
create function join_project(
  p_project_id  uuid,
  p_name        text,
  p_place       jsonb default null,
  p_category    text default 'consumer',
  p_contact_id  uuid default null,
  p_join_date   date default null,
  p_status      text default 'simulation',
  p_time_zone   text default null,
  p_parent_id   uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id      uuid := gen_random_uuid();
  p         projects%rowtype;
  v_place   jsonb := case when p_place is not null then place_check(p_place) end;
  v_country text := upper(v_place->>'country');
  v_region  text := v_place->>'region';
  v_zone    text := p_time_zone;
  i         jsonb;
begin
  select * into p from projects where id = p_project_id;
  if not found then
    raise exception 'project_not_found: %', p_project_id using errcode = 'no_data_found';
  end if;
  if v_place is not null and v_country is null then
    raise exception 'country_required: a place names its country' using errcode = 'invalid_parameter_value';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'country_invalid: % is not an ISO 3166-1 alpha-2 code', v_country using errcode = 'invalid_parameter_value';
  end if;
  if v_country is not null and v_zone is null then
    v_zone := coalesce((select r.time_zone from regions r where r.code = v_region),
                       (select c.time_zones[1] from countries c where c.code = v_country));
  end if;
  insert into participants (id, organisation_id, project_id, parent_id, name, category, contact_id, join_date, status,
                            country, address_line1, address_line2, postal_code, city, region, municipality, time_zone,
                            geometry, location_precision, location_source_code)
  values (v_id, p.organisation_id, p_project_id, p_parent_id, p_name, p_category, p_contact_id, p_join_date, p_status,
          v_country, v_place->>'address_line1', v_place->>'address_line2', v_place->>'postal_code', v_place->>'city', v_region, v_place->>'municipality', v_zone,
          case when jsonb_typeof(v_place->'geometry') = 'object' then ST_GeomFromGeoJSON(v_place->'geometry') end,
          v_place->>'location_precision', v_place->>'location_source_code');
  for i in select * from jsonb_array_elements(coalesce(v_place->'identifiers', '[]'::jsonb)) loop
    insert into identifiers (object_kind, object_id, scheme, value) values ('participant', v_id, i->>'scheme', i->>'value');
  end loop;
  return v_id;
end;
$$;

comment on function join_project(uuid, text, jsonb, text, uuid, date, text, text, uuid) is
  'An actor joins a project in its category — producer, consumer or prosumer — from a day, with its place in the standard shape, or none for a group; the time zone defaults to the region''s, else the country''s first, from the country pack. Refuses project_not_found, country_required, country_invalid, time_zone_unknown, region_unknown, invalid_geometry, place_key_unknown, participant_parent_not_a_group, participant_contact_in_other_organisation. Returns the participant.';

grant execute on function join_project(uuid, text, jsonb, text, uuid, date, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- regions.parent_code — the region it is part of.
-- ---------------------------------------------------------------------------

alter table regions rename column parent to parent_code;

comment on column regions.parent_code is
  'The region it is part of, when the pack lists two levels or more; a municipality''s is the subdivision its pack names.';

-- What a condition is matched against, for an object of the core at a
-- moment: its kind and id, the kind of its project, the segment of its
-- participant, the type of its device, the density class of its
-- municipality (the `density_class` default of the municipality of its
-- participant's place or a region above it).
create or replace function condition_facts(p_kind text, p_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_place    participants%rowtype;
  v_project  uuid;
  v_kind     text;
  v_device   text;
  v_density  text;
  v_region   text;
  v_climbed  text[] := '{}';
begin
  select * into v_place from participants where id = participant_of(p_kind, p_id);
  v_project := case when p_kind = 'project' then p_id else v_place.project_id end;
  select pr.kind into v_kind from projects pr where pr.id = v_project;
  v_device := case p_kind
                when 'device' then (select dv.device_type from devices dv where dv.id = p_id)
                when 'series' then (select dv.device_type from series se join devices dv on dv.id = se.device_id where se.id = p_id)
              end;
  if v_place.country is not null then
    v_region := coalesce(municipality_of(v_place.id), v_place.region);
    while v_region is not null and v_density is null and not v_region = any (v_climbed) loop
      v_climbed := v_climbed || v_region;
      v_density := (pack_value('density_class', v_place.country, v_region, p_at::date)).value #>> '{}';
      select r.parent_code into v_region from regions r where r.code = v_region;
    end loop;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('object_kind', p_kind, 'object_id', p_id, 'at', p_at,
    'project_kind', v_kind, 'segment', v_place.segment, 'device_type', v_device, 'density_class', v_density));
end;
$$;

comment on function condition_facts(text, uuid, timestamptz) is
  'What a condition is matched against for an object of the core at a moment: {object_kind, object_id, at, project_kind, segment, device_type, density_class}, each when the object has it.';

create or replace function parameter_of(
  p_kind          text,
  p_object_id     uuid,
  p_attribute_type text,
  p_at            timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  a          attributes%rowtype;
  d          defaults%rowtype;
  v_org      uuid;
  anc        record;
  v_place    participants%rowtype;
  v_start    text;
  v_region   text;
  v_climbed  text[] := '{}';
  v_day      date := p_at::date;
  reached    text := 'object';
  v_facts    jsonb;
  v_level    text;
  v_country  text;
begin
  if not exists (select 1 from attribute_types where code = p_attribute_type) then
    raise exception 'attribute_type_unknown: %', p_attribute_type using errcode = 'foreign_key_violation';
  end if;
  v_org := object_organisation(p_kind, p_object_id);

  -- 1. The object itself.
  a := attribute_at(p_object_id, p_attribute_type, p_at);
  if a.id is not null then
    return jsonb_build_object('value', a.value, 'level', 'object', 'object_id', p_object_id,
                              'source_code', a.source_code, 'reference', a.source, 'quality', a.quality, 'valid_from', a.valid_from);
  end if;

  -- 2. Its parents, nearest first.
  for anc in select * from parents_of(p_kind, p_object_id) loop
    reached := anc.kind;
    a := attribute_at(anc.object_id, p_attribute_type, p_at);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', anc.kind, 'object_id', anc.object_id,
                                'source_code', a.source_code, 'reference', a.source, 'quality', a.quality, 'valid_from', a.valid_from);
    end if;
  end loop;

  -- 3. Its organisation: an object like any other, whose defaults are its attributes.
  reached := 'organisation';
  if p_kind <> 'organisation' then
    a := attribute_at(v_org, p_attribute_type, p_at);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', 'organisation', 'object_id', v_org,
                                'source_code', a.source_code, 'reference', a.source, 'quality', a.quality, 'valid_from', a.valid_from);
    end if;
  end if;

  -- 4. The municipality, the region, then the country of its participant's
  -- place: the pack's, for the condition the object meets. A project has
  -- no place of its own: its country, the one whose rules apply to it.
  select * into v_place from participants where id = participant_of(p_kind, p_object_id) and country is not null;
  v_country := coalesce(v_place.country, case when p_kind = 'project' then (select pr.country from projects pr where pr.id = p_object_id) end);
  if v_country is not null then
    v_facts := condition_facts(p_kind, p_object_id, p_at);
  end if;
  if v_place.id is not null then
    v_start := coalesce(municipality_of(v_place.id), v_place.region);

    -- The municipality, the region, then the regions it is part of, up to
    -- the top of the levels its pack lists: a value decided above holds below it.
    v_region := v_start;
    while v_region is not null and not v_region = any (v_climbed) loop
      select case r.kind when 'municipality' then 'municipality' else 'region' end into v_level from regions r where r.code = v_region;
      reached := coalesce(v_level, 'region');
      v_climbed := v_climbed || v_region;
      d := pack_value(p_attribute_type, v_place.country, v_region, v_day, v_facts);
      if d.id is not null then
        if d.value is null then
          raise exception 'parameter_not_decided: % in %: %', p_attribute_type, v_region, coalesce(d.reference, 'no single value')
            using errcode = 'no_data_found';
        end if;
        return jsonb_build_object('value', d.value, 'level', reached, 'region', v_region, 'conditions', d.condition,
                                  'source_code', d.source_code, 'reference', d.reference, 'quality', d.quality, 'valid_from', d.valid_from);
      end if;
      select r.parent_code into v_region from regions r where r.code = v_region;
    end loop;
  end if;
  if v_country is not null then
    reached := 'country';
    d := pack_value(p_attribute_type, v_country, null, v_day, v_facts);
    if d.id is not null then
      if d.value is null then
        raise exception 'parameter_not_decided: % in %: %', p_attribute_type, v_country, coalesce(d.reference, 'no single value')
          using errcode = 'no_data_found';
      end if;
      return jsonb_build_object('value', d.value, 'level', 'country', 'country', v_country, 'conditions', d.condition,
                                'source_code', d.source_code, 'reference', d.reference, 'quality', d.quality, 'valid_from', d.valid_from);
    end if;
  end if;

  -- 5. A technology figure a module publishes for every country, with its
  -- cited source: below every place, so that any level above wins.
  if v_facts is null then
    v_facts := condition_facts(p_kind, p_object_id, p_at);
  end if;
  d := pack_value(p_attribute_type, null, null, v_day, v_facts);
  if d.id is not null and d.value is not null then
    return jsonb_build_object('value', d.value, 'level', 'generic', 'conditions', d.condition, 'published_by', d.published_by,
                              'source_code', d.source_code, 'reference', d.reference, 'quality', d.quality, 'valid_from', d.valid_from);
  end if;

  raise exception 'parameter_missing: % for %, reached %', p_attribute_type, p_object_id,
    case reached when 'country' then 'country ' || v_country when 'region' then 'region ' || v_place.region
                 when 'municipality' then 'municipality ' || v_start else reached end
    using errcode = 'no_data_found';
end;
$$;

comment on function parameter_of(text, uuid, text, timestamptz) is
  'The value of a parameter for an object (its kind and id) at a moment: its own attribute, its parents'' nearest first along the foreign keys (parents_of), its organisation''s, then the pack''s for the municipality of its participant''s place (municipality_of), its region, its parent regions nearest first, and the country (a project''s own country when it has no participant''s place), then the generic level a module publishes for a technology figure (a null country, decision 0053) — at each level of the pack the most specific row whose condition the object meets (the kind of its project, the segment of its participant, its device''s type, the density class of its municipality, an attribute: condition_facts, condition_matches, pack_value). {value, level, region or country, conditions, source_code, reference, quality (value_quality), valid_from}. No value chosen by the core for every country: parameter_missing names the attribute type and the level reached; parameter_not_decided gives the reference of a place that decides no single value; parameter_ambiguous names two rows as specific as each other.';

-- Nexgen OS — core: projects, the participants taking part in them, and the
-- meters they carry.
--
-- A project is what a person works on: an energy community, a portfolio, a
-- study, a construction site, a district plan, with the country whose rules
-- apply and a lifecycle.
--
-- A participant is the node of a project (decision 0045): an actor — a
-- household, a company, a tenant, a PV plant — as producer, consumer or
-- prosumer, with the contact who answers for it and the period it is in. It
-- carries the place: its address and its point on the map, its time zone,
-- in the one standard shape (`place_of()`). It carries the meters, one and
-- exceptionally several, and groups the devices behind them. Every module
-- starts from it: the description of its ground and its buildings, the grid
-- side of its meters, its bills, its share of a community, its tasks, its
-- weather. A participant is in one project; participants may be grouped
-- (two tenants of one landlord, a campus), a group having no place of its
-- own and carrying no meter and no device.
--
-- A meter, in the sense of the grid, is a connection point to a network:
-- the identifier its operator knows, carried by a participant, with what it
-- can do (take, inject, both) and the period that identifier names that
-- point (IEC CIM UsagePoint). It is the frontier between the grid and the
-- place: what is in front of it belongs to the project (the grid, the
-- market, the sharing of a community), what is behind it to the participant
-- that carries it (`meters.participant_id`, the participant it leaves kept
-- as a dated `carried_by` link). The physical meter is a device of type
-- `meter` and can be swapped. Who runs the grid and how the point is
-- connected are the `grid` module's (decision 0042).
--
-- The hierarchy a page walks: organisation → project → participant → meter
-- and device → series.

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table projects (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  name             text not null,
  -- What the project is: an energy community, a portfolio, a study, a
  -- construction site, a district plan. Modules refine it.
  kind             text not null default 'study',
  -- ISO 3166-1 alpha-2 of the country whose rules apply. Selects the packs.
  country          char(2) not null,
  -- Perimeter on the map, when it has one.
  geometry         geometry,
  status           text not null default 'simulation',
  start_date       date,
  end_date         date,
  tags             text[] not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint projects_name_not_blank check (btrim(name) <> ''),
  constraint projects_country_format check (country ~ '^[A-Z]{2}$'),
  constraint projects_status check (status in ('simulation', 'creation', 'active', 'inactive', 'archived')),
  constraint projects_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint projects_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint projects_tags_known check (tags_known(tags))
);

comment on table projects is
  'What a person works on: an energy community, a portfolio, a study, a construction site, a district plan, with its country and its lifecycle (simulation, creation, active, inactive, archived). Its actors are participants.';

create index projects_geometry_idx on projects using gist (geometry);
create trigger projects_normalize before insert or update of geometry on projects
  for each row execute function normalize_geometry('geometry');
create trigger projects_set_updated_at before update on projects
  for each row execute function set_updated_at();
create index projects_organisation_idx on projects (organisation_id);
create trigger projects_drop_attachments after delete on projects
  for each row execute function drop_attachments('project');
call secure_table('projects');

-- ---------------------------------------------------------------------------
-- participants — the node of a project, and its place.
-- ---------------------------------------------------------------------------

create table participants (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  -- The group it is part of.
  parent_id        uuid references participants(id) on delete restrict,
  name             text not null,
  role             text not null default 'consumer',
  -- Who answers for it: the owner, the tenant, the company.
  contact_id       uuid references contacts(id) on delete set null,
  status           text not null default 'simulation',
  join_date        date,
  leave_date       date,
  -- The place, in its one standard shape (`place_of()`, docs/model.md
  -- "Where"): the address in the fields every country has (the postal
  -- address of schema.org) — the street with its number, a second line for
  -- the building, floor or unit, the postal code, the city, the ISO 3166-2
  -- region, the ISO 3166-1 alpha-2 country; how a country lays them out is
  -- its pack's business. The municipality, in the country's own code, is an
  -- identifier of the participant under a scheme its pack publishes. A
  -- group has no place: its country and every place column are null.
  country          char(2),
  street           text,
  address_extra    text,
  postal_code      text,
  city             text,
  region           text,
  -- IANA time zone. Daily and monthly readings of its series are cut in it;
  -- a participant without one has no daily readings.
  time_zone        text,
  -- Its point on the map, or the outline of its place.
  geometry         geometry,
  -- How close the geometry is to the real place, and who placed it: a
  -- geocoder (a source), a GPS reading, a person on a map. `rooftop` is the
  -- building itself, `parcel` its plot, then the street, the postal code
  -- area, the city, the region. Null when nobody said.
  location_precision   text,
  location_source_code text references sources(code),
  -- What the place is used for.
  profile          text references profiles(code),
  tags             text[] not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint participants_name_not_blank check (btrim(name) <> ''),
  constraint participants_role check (role in ('producer', 'consumer', 'prosumer')),
  constraint participants_status check (status in ('simulation', 'creation', 'active', 'inactive', 'pending_consent')),
  constraint participants_period check (leave_date is null or join_date is null or leave_date >= join_date),
  constraint participants_not_own_parent check (parent_id is distinct from id),
  constraint participants_country_format check (country ~ '^[A-Z]{2}$'),
  constraint participants_region_format check (region is null or region ~ ('^' || country || '-[A-Z0-9]{1,3}$')),
  constraint participants_group_has_no_place check (country is not null or num_nonnulls(street, address_extra, postal_code, city, region,
    time_zone, geometry, location_precision, location_source_code, profile) = 0),
  constraint participants_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint participants_location_precision check (location_precision is null or location_precision in ('rooftop', 'parcel', 'street', 'postal_code', 'city', 'region')),
  constraint participants_tags_known check (tags_known(tags))
);

comment on table participants is
  'The node of a project: an actor — a household, a company, a tenant, a PV plant — as producer, consumer or prosumer, with the contact who answers for it and the period it is in. It carries the place (address, point, time zone, precision and source: the one standard shape of place_of()), the meters (meters.participant_id) and the devices behind them (devices.participant_id); every module links to it. A participant without a place is a group of others, and carries no meter and no device.';

create index participants_project_idx on participants (project_id);
create index participants_parent_idx on participants (parent_id);
create index participants_geometry_idx on participants using gist (geometry);
create trigger participants_normalize before insert or update of geometry on participants
  for each row execute function normalize_geometry('geometry');

create or replace function participants_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  p participants%rowtype;
begin
  if new.parent_id is not null then
    select * into p from participants where id = new.parent_id;
    if p.country is not null then
      raise exception 'participant_parent_not_a_group' using errcode = 'check_violation';
    end if;
    if p.project_id <> new.project_id then
      raise exception 'participant_parent_in_other_project' using errcode = 'check_violation';
    end if;
  end if;
  if new.contact_id is not null and not exists (
    select 1 from contacts c where c.id = new.contact_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'participant_contact_in_other_organisation' using errcode = 'check_violation';
  end if;
  if new.time_zone is not null then
    begin
      perform now() at time zone new.time_zone;
    exception when invalid_parameter_value then
      raise exception 'time_zone_unknown: %', new.time_zone using errcode = 'check_violation';
    end;
  end if;
  if new.country is null and tg_op = 'UPDATE' and (
       exists (select 1 from meters m where m.participant_id = new.id)
       or exists (select 1 from devices d where d.participant_id = new.id)) then
    raise exception 'participant_group_carries: a group carries no meter and no device' using errcode = 'check_violation';
  end if;
  if new.country is not null and tg_op = 'UPDATE' and exists (select 1 from participants c where c.parent_id = new.id) then
    raise exception 'participant_parent_not_a_group' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function participants_check() is
  'BEFORE INSERT / UPDATE on participants: a parent is a group of the same project (participant_parent_not_a_group, participant_parent_in_other_project), the contact is of the organisation (participant_contact_in_other_organisation), the time zone is an IANA zone Postgres knows (time_zone_unknown), a group carries no meter and no device (participant_group_carries).';

create trigger participants_check before insert or update of parent_id, project_id, contact_id, join_date, leave_date, scenario_id, time_zone, country on participants
  for each row execute function participants_check();
create trigger participants_project_id_check before insert or update of project_id, scenario_id on participants
  for each row execute function parent_check('project_id', 'projects');
create trigger participants_parent_id_check before insert or update of parent_id, scenario_id on participants
  for each row execute function parent_check('parent_id', 'participants');
create trigger participants_set_updated_at before update on participants
  for each row execute function set_updated_at();
create index participants_organisation_idx on participants (organisation_id);
create trigger participants_drop_attachments after delete on participants
  for each row execute function drop_attachments('participant');
call secure_table('participants');

-- ---------------------------------------------------------------------------
-- meters — connection points.
-- ---------------------------------------------------------------------------

create table meters (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  -- The participant that carries it: what is behind the point is that
  -- participant's.
  participant_id    uuid not null references participants(id) on delete cascade,
  name              text,
  -- The metering point identifier and its numbering scheme (a GS1 GSRN, or
  -- a national scheme a pack publishes).
  identifier        text not null,
  scheme            text not null references id_schemes(code),
  resource          text not null default 'electricity',
  -- What the point can do: take from the grid, inject into it, both.
  direction         text not null default 'both',
  -- When this identifier names this point: registers retire and reissue.
  valid_from        date,
  valid_to          date,
  tags              text[] not null default '{}',
  scenario_id       uuid references scenarios(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint meters_resource check (resource in ('electricity', 'gas', 'heat', 'water')),
  constraint meters_direction check (direction in ('offtake', 'injection', 'both')),
  constraint meters_period check (valid_to is null or valid_from is null or valid_to > valid_from),
  constraint meters_tags_known check (tags_known(tags))
);

comment on table meters is
  'A connection point to a network, with the identifier its operator knows (IEC CIM UsagePoint), carried by a participant: the frontier between the grid and the place. The devices of that participant are behind it. The physical meter is a device of type meter, and can be swapped. The grid module adds who runs it and how it is connected.';

create unique index meters_one_identifier on meters (organisation_id, scheme, identifier, scenario_id, valid_from) nulls not distinct;
create index meters_participant_idx on meters (participant_id);

create or replace function meters_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if not identifier_valid(new.scheme, new.identifier) then
    raise exception 'invalid_identifier: % is not a valid %', new.identifier, new.scheme
      using errcode = 'check_violation';
  end if;
  if (select country from participants where id = new.participant_id) is null then
    raise exception 'participant_group_carries: a group carries no meter and no device' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function meters_check() is
  'BEFORE INSERT / UPDATE on meters: the identifier matches its scheme (invalid_identifier); the participant that carries it is not a group (participant_group_carries).';

create trigger meters_check before insert or update of identifier, scheme, participant_id on meters
  for each row execute function meters_check();
create trigger meters_participant_id_check before insert or update of participant_id, scenario_id on meters
  for each row execute function parent_check('participant_id', 'participants');
create trigger meters_set_updated_at before update on meters
  for each row execute function set_updated_at();
create index meters_organisation_idx on meters (organisation_id);
create trigger meters_drop_attachments after delete on meters
  for each row execute function drop_attachments('meter');
call secure_table('meters');

-- The connection points a participant carries, or the participants it
-- groups carry.
create or replace function participant_meters(p_participant_id uuid)
returns table (meter_id uuid)
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive down as (
    select id from participants where id = p_participant_id
    union all
    select p.id from participants p join down on p.parent_id = down.id
  )
  select m.id from meters m join down on m.participant_id = down.id;
$$;

comment on function participant_meters(uuid) is
  'The connection points a participant carries (meters.participant_id), and those the participants it groups carry.';

-- ---------------------------------------------------------------------------
-- Where an object is.
-- ---------------------------------------------------------------------------

-- The participant of an object, through the foreign keys of the core's
-- kinds: a participant is its own, a meter and a device name theirs, a
-- series and a run are their object's. A kind a module publishes is the
-- module's to answer, with `<schema>.participant_of(kind, id)`: the core
-- hands it over without knowing the module. Null for what belongs to no
-- participant (an organisation, a project, a weather point).
create or replace function participant_of(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_schema       text;
  v_participant  uuid;
begin
  if p_id is null then
    return null;
  end if;
  case p_kind
    when 'participant' then
      return (select id from participants where id = p_id);
    when 'meter' then
      return (select participant_id from meters where id = p_id);
    when 'device' then
      return (select participant_id from devices where id = p_id);
    when 'series' then
      return (select participant_of(object_kind, object_id) from series where id = p_id);
    when 'run' then
      return (select participant_of(subject_kind, subject_id) from runs where id = p_id);
    when 'organisation', 'project' then
      return null;
    else
      select m.schema_name into v_schema from kinds k join modules m on m.code = k.published_by where k.kind = p_kind;
      if v_schema is null or to_regprocedure(format('%I.participant_of(text, uuid)', v_schema)) is null then
        return null;
      end if;
      execute format('select %I.participant_of($1, $2)', v_schema) into v_participant using p_kind, p_id;
      return v_participant;
  end case;
end;
$$;

comment on function participant_of(text, uuid) is
  'The participant an object named by its kind and its id belongs to: itself, its own foreign key for a meter or a device, its object''s for a series or a run, the publishing module''s <schema>.participant_of(kind, id) for a module''s kind. Null for an object of no participant (an organisation, a project, a weather point).';

create or replace function country_of(p_kind text, p_id uuid)
returns char(2)
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select country from participants where id = participant_of(p_kind, p_id);
$$;

comment on function country_of(text, uuid) is
  'The country of the place of the participant an object belongs to. Selects the country packs and the country level of parameter_of().';

-- PL/pgSQL so that it may name `external_ids`, created with the attachments.
create or replace function place_of(p_participant_id uuid)
returns jsonb
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  return (select jsonb_build_object(
    'street', p.street, 'address_extra', p.address_extra, 'postal_code', p.postal_code, 'city', p.city,
    'region', p.region, 'country', p.country,
    'geometry', ST_AsGeoJSON(p.geometry)::jsonb,
    'location_precision', p.location_precision, 'location_source_code', p.location_source_code,
    'identifiers', coalesce((select jsonb_agg(jsonb_build_object('scheme', e.scheme, 'value', e.value) order by e.scheme, e.value)
                               from external_ids e where e.object_kind = 'participant' and e.object_id = p.id), '[]'::jsonb))
    from participants p where p.id = p_participant_id and p.country is not null);
end;
$$;

comment on function place_of(uuid) is
  'A participant''s place in the one standard shape: address, country, region, GeoJSON geometry, precision, source and identifiers. Null for a group.';

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

-- An actor joins a project with its place in the standard shape, or none
-- for a group. Without a time zone given, it takes its region's, else the
-- first of its country's — both from the country pack, when one is
-- installed; never a zone of another country.
create or replace function join_project(
  p_project_id  uuid,
  p_name        text,
  p_place       jsonb default null,
  p_role        text default 'consumer',
  p_contact_id  uuid default null,
  p_join_date   date default null,
  p_status      text default 'simulation',
  p_time_zone   text default null,
  p_profile     text default null,
  p_parent_id   uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
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
  insert into participants (id, organisation_id, project_id, parent_id, name, role, contact_id, join_date, status,
                            country, street, address_extra, postal_code, city, region, time_zone,
                            geometry, location_precision, location_source_code, profile, scenario_id)
  values (v_id, p.organisation_id, p_project_id, p_parent_id, p_name, p_role, p_contact_id, p_join_date, p_status,
          v_country, v_place->>'street', v_place->>'address_extra', v_place->>'postal_code', v_place->>'city', v_region, v_zone,
          case when jsonb_typeof(v_place->'geometry') = 'object' then ST_GeomFromGeoJSON(v_place->'geometry') end,
          v_place->>'location_precision', v_place->>'location_source_code', p_profile, p.scenario_id);
  for i in select * from jsonb_array_elements(coalesce(v_place->'identifiers', '[]'::jsonb)) loop
    insert into external_ids (object_kind, object_id, scheme, value, scenario_id) values ('participant', v_id, i->>'scheme', i->>'value', p.scenario_id);
  end loop;
  return v_id;
end;
$$;

comment on function join_project(uuid, text, jsonb, text, uuid, date, text, text, text, uuid) is
  'An actor joins a project as producer, consumer or prosumer from a day, with its place in the standard shape, or none for a group; the time zone defaults to the region''s, else the country''s first, from the country pack. Refuses project_not_found, country_required, country_invalid, time_zone_unknown, region_unknown, invalid_geometry, place_key_unknown, participant_parent_not_a_group, participant_contact_in_other_organisation. Returns the participant.';

-- A participant placed again: by a geocoder, a GPS reading, a person on a
-- map. The keys the place gives replace the participant's; the keys it
-- leaves out are kept.
create or replace function locate_participant(p_participant_id uuid, p_place jsonb)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_place jsonb := place_check(p_place);
  s       participants%rowtype;
  i       jsonb;
begin
  select * into s from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  if s.country is null then
    raise exception 'participant_is_group: a group has no place' using errcode = 'check_violation';
  end if;
  if v_place ? 'country' and upper(v_place->>'country') is distinct from s.country then
    raise exception 'country_is_final: a place does not move to another country; the participant joins there' using errcode = 'check_violation';
  end if;
  update participants set
    street               = case when v_place ? 'street' then v_place->>'street' else street end,
    address_extra        = case when v_place ? 'address_extra' then v_place->>'address_extra' else address_extra end,
    postal_code          = case when v_place ? 'postal_code' then v_place->>'postal_code' else postal_code end,
    city                 = case when v_place ? 'city' then v_place->>'city' else city end,
    region               = case when v_place ? 'region' then v_place->>'region' else region end,
    geometry             = case when v_place ? 'geometry'
                                then case when jsonb_typeof(v_place->'geometry') = 'object' then ST_GeomFromGeoJSON(v_place->'geometry') end
                                else geometry end,
    location_precision   = case when v_place ? 'location_precision' then v_place->>'location_precision' else location_precision end,
    location_source_code = case when v_place ? 'location_source_code' then v_place->>'location_source_code' else location_source_code end
   where id = p_participant_id;
  for i in select * from jsonb_array_elements(coalesce(v_place->'identifiers', '[]'::jsonb)) loop
    insert into external_ids (object_kind, object_id, scheme, value, scenario_id) values ('participant', p_participant_id, i->>'scheme', i->>'value', s.scenario_id)
    on conflict do nothing;
  end loop;
end;
$$;

comment on function locate_participant(uuid, jsonb) is
  'Places a participant again from a place in the standard shape: the keys given replace, the others are kept, identifiers are added. Refuses participant_not_found, participant_is_group, country_is_final, invalid_geometry.';

create or replace function leave_project(p_participant_id uuid, p_on date default current_date)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  update participants set leave_date = p_on, status = 'inactive'
   where id = p_participant_id and leave_date is null;
  if not found then
    raise exception 'participant_not_in_project: %', p_participant_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function leave_project(uuid, date) is
  'A participant leaves its project on a day; it may join again later. Refuses participant_not_in_project.';

create or replace function declare_meter(
  p_participant_id uuid,
  p_identifier     text,
  p_scheme         text,
  p_resource       text default 'electricity',
  p_direction      text default 'both',
  p_valid_from     date default null,
  p_name           text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  p    participants%rowtype;
begin
  select * into p from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  if exists (select 1 from meters m
              where m.organisation_id = p.organisation_id and m.scheme = p_scheme and m.identifier = p_identifier
                and m.scenario_id is not distinct from p.scenario_id and m.valid_to is null) then
    raise exception 'meter_already_open: % % names an open connection point', p_scheme, p_identifier
      using errcode = 'unique_violation';
  end if;
  insert into meters (id, organisation_id, participant_id, name, identifier, scheme, resource, direction, valid_from, scenario_id)
  values (v_id, p.organisation_id, p_participant_id, p_name, p_identifier, p_scheme, p_resource, p_direction, p_valid_from, p.scenario_id);
  return v_id;
end;
$$;

comment on function declare_meter(uuid, text, text, text, text, date, text) is
  'Declares a connection point carried by a participant under the identifier its operator knows. Refuses participant_not_found, invalid_identifier, meter_already_open, participant_group_carries. Returns its id.';

-- The participant a meter leaves is kept as a dated `carried_by` link, so
-- who carried the point stays readable.
create or replace function assign_meter(p_meter_id uuid, p_participant_id uuid, p_on date default current_date)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  m       meters%rowtype;
  v_since date;
begin
  select * into m from meters where id = p_meter_id;
  if not found then
    raise exception 'meter_not_found: %', p_meter_id using errcode = 'no_data_found';
  end if;
  if m.participant_id = p_participant_id then
    return;
  end if;
  -- Carried since the previous participant left it, else since the
  -- participant joined, else since the identifier names the point.
  select coalesce(max(l.valid_to)::date, (select join_date from participants where id = m.participant_id), m.valid_from)
    into v_since
    from links l where l.subject_id = p_meter_id and l.type_code = 'carried_by';
  insert into links (subject_kind, subject_id, type_code, object_kind, object_id, valid_from, valid_to, scenario_id)
  values ('meter', p_meter_id, 'carried_by', 'participant', m.participant_id, case when v_since < p_on then v_since end, p_on, m.scenario_id);
  update meters set participant_id = p_participant_id where id = p_meter_id;
end;
$$;

comment on function assign_meter(uuid, uuid, date) is
  'Gives a meter to another participant from a day (a new tenant, a new owner); the participant it leaves is kept as a carried_by link ending that day. Refuses meter_not_found, participant_group_carries, parent_in_other_organisation.';

create or replace function close_meter(p_meter_id uuid, p_on date default current_date)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  update meters set valid_to = p_on where id = p_meter_id and valid_to is null;
  if not found then
    raise exception 'meter_not_open: %', p_meter_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function close_meter(uuid, date) is
  'Ends the period an identifier names a connection point: the register retired it. Refuses meter_not_open.';

grant execute on function participant_meters(uuid), participant_of(text, uuid), country_of(text, uuid), place_of(uuid),
  join_project(uuid, text, jsonb, text, uuid, date, text, text, text, uuid), locate_participant(uuid, jsonb), leave_project(uuid, date),
  declare_meter(uuid, text, text, text, text, date, text), assign_meter(uuid, uuid, date), close_meter(uuid, date)
  to authenticated, service_role;

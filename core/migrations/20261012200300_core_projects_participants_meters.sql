-- Nexgen OS — core: projects, the participants taking part in them, and the
-- meters of their sites.
--
-- A project is what a person works on: an energy community, a portfolio, a
-- study, a construction site, a district plan, with the country whose rules
-- apply and a lifecycle. A participant is an actor of a project — producer,
-- consumer or prosumer — on a site, with the contact who answers for it and
-- the period it is in. It may be a whole site, or one occupant of it: a
-- building with two flats is one site with two participants, each carrying
-- its own meter. Which building, floor or unit it occupies is a fact of the
-- physical description, held by the `3d` module as a link. A participant is
-- in one project; participants may be grouped (two tenants of one landlord,
-- a campus), a group having no site of its own.
--
-- A meter, in the sense of the grid, is a connection point to a network:
-- the identifier its operator knows, on a site, with what it can do (take,
-- inject, both) and the period that identifier names that point (IEC CIM
-- UsagePoint). It is the frontier between the grid and the place: what is in
-- front of it belongs to the project (the grid, the market, the sharing of a
-- community), what is behind it to the participant that carries it
-- (`meters.participant_id`, the participant it leaves kept as a dated
-- `carried_by` link). The physical meter is a device of type `meter` and can
-- be swapped; a device behind a connection point names it in
-- `devices.meter_id`. Who runs the grid and how the point is connected are
-- the `grid` module's (decision 0042).
--
-- The hierarchy a page walks: organisation → project → participant → site
-- → meter → device → series.

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table projects (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
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
call declare_object('projects', 'project');

-- ---------------------------------------------------------------------------
-- participants
-- ---------------------------------------------------------------------------

create table participants (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  -- The site it is on: the whole site, or the building, floor or unit of it
  -- the `3d` module says it occupies. Several participants may share a site.
  -- Null for a group.
  site_id          uuid references sites(id) on delete cascade,
  -- The group it is part of.
  parent_id        uuid references participants(id) on delete restrict,
  name             text not null,
  role             text not null default 'consumer',
  -- Who answers for it: the owner, the tenant, the company.
  contact_id       uuid references contacts(id) on delete set null,
  status           text not null default 'simulation',
  join_date        date,
  leave_date       date,
  tags             text[] not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint participants_name_not_blank check (btrim(name) <> ''),
  constraint participants_role check (role in ('producer', 'consumer', 'prosumer')),
  constraint participants_status check (status in ('simulation', 'creation', 'active', 'inactive', 'pending_consent')),
  constraint participants_period check (leave_date is null or join_date is null or leave_date >= join_date),
  constraint participants_not_own_parent check (parent_id is distinct from id),
  constraint participants_tags_known check (tags_known(tags))
);

comment on table participants is
  'An actor of a project on a site — the whole site, a building, a floor, one flat — as producer, consumer or prosumer, with the contact who answers for it and the period it is in. It carries its meters (meters.participant_id) and groups the devices behind them. Several participants may share a site; a participant without a site is a group of others.';

create index participants_project_idx on participants (project_id);
create index participants_site_idx on participants (site_id);
create index participants_parent_idx on participants (parent_id);

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
    if p.site_id is not null then
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
  return new;
end;
$$;

comment on function participants_check() is
  'BEFORE INSERT / UPDATE on participants: a parent is a group of the same project (participant_parent_not_a_group, participant_parent_in_other_project), the contact is of the organisation (participant_contact_in_other_organisation). Several participants may share a site.';

create trigger participants_check before insert or update of parent_id, project_id, site_id, contact_id, join_date, leave_date, scenario_id on participants
  for each row execute function participants_check();
call declare_object('participants', 'participant', '{site_id,project_id,parent_id}');

-- ---------------------------------------------------------------------------
-- meters — connection points.
-- ---------------------------------------------------------------------------

create table meters (
  id                uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id   uuid not null references organisations(id) on delete cascade,
  site_id           uuid not null references sites(id) on delete cascade,
  -- The participant that carries it, on the same site: what is behind the
  -- point is that participant's. Null while nobody does.
  participant_id    uuid references participants(id) on delete set null,
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
  'A connection point to a network on a site, with the identifier its operator knows (IEC CIM UsagePoint) and the participant that carries it: the frontier between the grid and the place. The physical meter is a device of type meter, and can be swapped; a device behind it names it in devices.meter_id. The grid module adds who runs it and how it is connected.';

create unique index meters_one_identifier on meters (organisation_id, scheme, identifier, scenario_id, valid_from) nulls not distinct;
create index meters_site_idx on meters (site_id);
create index meters_participant_idx on meters (participant_id);

create or replace function meters_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  p participants%rowtype;
begin
  if not identifier_valid(new.scheme, new.identifier) then
    raise exception 'invalid_identifier: % is not a valid %', new.identifier, new.scheme
      using errcode = 'check_violation';
  end if;
  if new.participant_id is not null then
    select * into p from participants where id = new.participant_id;
    if p.organisation_id <> new.organisation_id then
      raise exception 'meter_participant_in_other_organisation' using errcode = 'check_violation';
    end if;
    if p.site_id is distinct from new.site_id then
      raise exception 'meter_participant_site_mismatch: the participant is not on the meter''s site' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

comment on function meters_check() is
  'BEFORE INSERT / UPDATE on meters: the identifier matches its scheme (invalid_identifier); the participant that carries it is of the organisation (meter_participant_in_other_organisation) and on the meter''s site (meter_participant_site_mismatch), so a group carries none of its own.';

create trigger meters_check before insert or update of identifier, scheme, site_id, participant_id on meters
  for each row execute function meters_check();
call declare_object('meters', 'meter', '{site_id}');

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
-- Gestures
-- ---------------------------------------------------------------------------

create or replace function join_project(
  p_project_id  uuid,
  p_site_id     uuid,
  p_name        text,
  p_role        text default 'consumer',
  p_contact_id  uuid default null,
  p_join_date   date default null,
  p_status      text default 'simulation'
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  p    projects%rowtype;
begin
  select * into p from projects where id = p_project_id;
  if not found then
    raise exception 'project_not_found: %', p_project_id using errcode = 'no_data_found';
  end if;
  insert into participants (id, organisation_id, project_id, site_id, name, role, contact_id, join_date, status, scenario_id)
  values (v_id, p.organisation_id, p_project_id, p_site_id, p_name, p_role, p_contact_id, p_join_date, p_status, p.scenario_id);
  return v_id;
end;
$$;

comment on function join_project(uuid, uuid, text, text, uuid, date, text) is
  'An actor joins a project on a site as producer, consumer or prosumer from a day; several may join on one site (one per flat, one per meter). Refuses participant_contact_in_other_organisation. Returns the participant.';

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
  p_site_id        uuid,
  p_identifier     text,
  p_scheme         text,
  p_resource       text default 'electricity',
  p_direction      text default 'both',
  p_valid_from     date default null,
  p_name           text default null,
  p_participant_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  s    sites%rowtype;
begin
  select * into s from sites where id = p_site_id;
  if not found then
    raise exception 'site_not_found: %', p_site_id using errcode = 'no_data_found';
  end if;
  if exists (select 1 from meters m
              where m.organisation_id = s.organisation_id and m.scheme = p_scheme and m.identifier = p_identifier
                and m.scenario_id is not distinct from s.scenario_id and m.valid_to is null) then
    raise exception 'meter_already_open: % % names an open connection point', p_scheme, p_identifier
      using errcode = 'unique_violation';
  end if;
  insert into meters (id, organisation_id, site_id, participant_id, name, identifier, scheme, resource, direction, valid_from, scenario_id)
  values (v_id, s.organisation_id, p_site_id, p_participant_id, p_name, p_identifier, p_scheme, p_resource, p_direction, p_valid_from, s.scenario_id);
  return v_id;
end;
$$;

comment on function declare_meter(uuid, text, text, text, text, date, text, uuid) is
  'Declares a connection point on a site under the identifier its operator knows, carried by a participant of the site when one is named. Refuses invalid_identifier, meter_already_open, meter_participant_site_mismatch. Returns its id.';

-- The participant a meter leaves is kept as a dated `carried_by` link, so
-- who carried the point stays readable; null leaves it carried by nobody.
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
  if m.participant_id is not distinct from p_participant_id then
    return;
  end if;
  if m.participant_id is not null then
    -- Carried since the previous participant left it, else since the
    -- participant joined, else since the identifier names the point.
    select coalesce(max(l.valid_to)::date, (select join_date from participants where id = m.participant_id), m.valid_from)
      into v_since
      from links l where l.subject_id = p_meter_id and l.type_code = 'carried_by';
    insert into links (subject_id, type_code, object_id, valid_from, valid_to, scenario_id)
    values (p_meter_id, 'carried_by', m.participant_id, case when v_since < p_on then v_since end, p_on, m.scenario_id);
  end if;
  update meters set participant_id = p_participant_id where id = p_meter_id;
end;
$$;

comment on function assign_meter(uuid, uuid, date) is
  'Gives a meter to a participant of its site from a day, or to nobody (null); the participant it leaves is kept as a carried_by link ending that day. Refuses meter_not_found, meter_participant_site_mismatch, meter_participant_in_other_organisation.';

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

grant execute on function participant_meters(uuid),
  join_project(uuid, uuid, text, text, uuid, date, text), leave_project(uuid, date),
  declare_meter(uuid, text, text, text, text, date, text, uuid), assign_meter(uuid, uuid, date), close_meter(uuid, date)
  to authenticated, service_role;

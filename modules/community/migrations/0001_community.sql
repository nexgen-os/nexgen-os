-- Nexgen OS — module `community`: projects, and the sites taking part in them.
--
-- A project is a working perimeter: an energy community, a portfolio, a
-- study, a construction site, a district plan, with the country whose rules
-- apply and a lifecycle. A participant is a site's role in a project —
-- producer, consumer or prosumer — with the contact who answers for it and
-- the period it is in. What is in front of the meter belongs to the
-- project (the grid, the market, the community's allocation); what is
-- behind it belongs to the participant. A site takes part in a project once
-- at a time; participants may be grouped (two tenants of one landlord, a
-- campus), a group having no site of its own.

set search_path = nexgen, public, extensions;

create schema community;
grant usage on schema community to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table community.projects (
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

comment on table community.projects is
  'A working perimeter: an energy community, a portfolio, a study, a construction site, a district plan, with its country and its lifecycle (simulation, creation, active, inactive, archived). Sites take part in it as participants.';

create index projects_geometry_idx on community.projects using gist (geometry);
create trigger community_projects_normalize before insert or update of geometry on community.projects
  for each row execute function normalize_geometry('geometry');
call declare_object('community.projects', 'project');

-- ---------------------------------------------------------------------------
-- participants
-- ---------------------------------------------------------------------------

create table community.participants (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  project_id       uuid not null references community.projects(id) on delete cascade,
  -- The site behind the meter. Null for a group.
  site_id          uuid references sites(id) on delete cascade,
  -- The group it is part of.
  parent_id        uuid references community.participants(id) on delete restrict,
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

comment on table community.participants is
  'A site taking part in a project as producer, consumer or prosumer, with the contact who answers for it and the period it is in. A participant without a site is a group of others.';

create index participants_project_idx on community.participants (project_id);
create index participants_site_idx on community.participants (site_id);
create index participants_parent_idx on community.participants (parent_id);

create or replace function community.participants_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  p community.participants%rowtype;
begin
  if new.parent_id is not null then
    select * into p from community.participants where id = new.parent_id;
    if p.site_id is not null then
      raise exception 'participant_parent_not_a_group' using errcode = 'check_violation';
    end if;
    if p.project_id <> new.project_id then
      raise exception 'participant_parent_in_other_project' using errcode = 'check_violation';
    end if;
  end if;
  -- A site is in a project once at a time: a participant may leave and
  -- come back, never overlap itself.
  if new.site_id is not null and exists (
    select 1 from community.participants q
     where q.project_id = new.project_id
       and q.site_id = new.site_id
       and q.scenario_id is not distinct from new.scenario_id
       and q.id <> new.id
       and daterange(q.join_date, q.leave_date, '[]') && daterange(new.join_date, new.leave_date, '[]')
  ) then
    raise exception 'participant_site_already_in_project' using errcode = 'exclusion_violation';
  end if;
  if new.contact_id is not null and not exists (
    select 1 from contacts c where c.id = new.contact_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'participant_contact_in_other_organisation' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function community.participants_check() is
  'BEFORE INSERT / UPDATE on participants: a parent is a group of the same project, a site is in a project once at a time, the contact is of the organisation.';

create trigger participants_check before insert or update of parent_id, project_id, site_id, contact_id, join_date, leave_date, scenario_id on community.participants
  for each row execute function community.participants_check();
call declare_object('community.participants', 'participant', '{site_id,project_id,parent_id}');

-- The connection points a participant is behind: those of its site, or of
-- the sites of the participants it groups. They are the grid module's.
create or replace function community.participant_meters(p_participant_id uuid)
returns table (meter_id uuid)
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if to_regclass('grid.meters') is null then
    raise exception 'module_required: participant_meters reads the grid module' using errcode = 'undefined_table';
  end if;
  return query execute
    'with recursive down as (
       select id, site_id from community.participants where id = $1
       union all
       select p.id, p.site_id from community.participants p join down on p.parent_id = down.id
     )
     select m.id from grid.meters m join down on m.site_id = down.site_id'
    using p_participant_id;
end;
$$;

comment on function community.participant_meters(uuid) is
  'The connection points a participant is behind, groups included. Needs the grid module (module_required).';

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

create or replace function community.join_project(
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
  p    community.projects%rowtype;
begin
  select * into p from community.projects where id = p_project_id;
  if not found then
    raise exception 'project_not_found: %', p_project_id using errcode = 'no_data_found';
  end if;
  insert into community.participants (id, organisation_id, project_id, site_id, name, role, contact_id, join_date, status, scenario_id)
  values (v_id, p.organisation_id, p_project_id, p_site_id, p_name, p_role, p_contact_id, p_join_date, p_status, p.scenario_id);
  return v_id;
end;
$$;

comment on function community.join_project(uuid, uuid, text, text, uuid, date, text) is
  'A site joins a project as producer, consumer or prosumer from a day. Refuses participant_site_already_in_project, participant_contact_in_other_organisation. Returns the participant.';

create or replace function community.leave_project(p_participant_id uuid, p_on date default current_date)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  update community.participants set leave_date = p_on, status = 'inactive'
   where id = p_participant_id and leave_date is null;
  if not found then
    raise exception 'participant_not_in_project: %', p_participant_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function community.leave_project(uuid, date) is
  'A participant leaves its project on a day; it may join again later. Refuses participant_not_in_project.';

grant execute on function community.participant_meters(uuid),
  community.join_project(uuid, uuid, text, text, uuid, date, text), community.leave_project(uuid, date)
  to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('community', 'Community', '0.1.0', 'community', '0.2.0',
        'Projects — energy communities, portfolios, studies, district plans — and the sites taking part in them, with the contact who answers for each.');

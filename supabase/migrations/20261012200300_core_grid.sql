-- Nexgen OS — core: the grid side. Participants and meters.
--
-- A meter is a connection point to a network: the identifier a grid operator
-- knows, on a site. A participant is a site's role in a project — producer,
-- consumer, prosumer — behind its meters, with the contact who answers for
-- it. What is in front of the meter belongs to the project (the grid, the
-- market, the community's allocation); what is behind it belongs to the
-- participant. One site, one meter, one participant is the usual case, as in
-- Nexgen; the model also holds a site with several meters, and a site taking
-- part in two projects.

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- meters — connection points.
-- ---------------------------------------------------------------------------

create table meters (
  id                uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id   uuid not null references organisations(id) on delete cascade,
  site_id           uuid not null references sites(id) on delete cascade,
  name              text,
  -- The metering point identifier and its numbering scheme: GS1 GSRN here,
  -- EAN, PRM, MPAN, MaLo… published by the country packs.
  identifier        text not null,
  scheme            text not null references id_schemes(code),
  resource         text not null default 'electricity',
  -- What the point can do: take from the grid, inject into it, both.
  direction         text not null default 'both',
  -- The grid operator, as a contact.
  grid_operator_id  uuid references contacts(id) on delete set null,
  -- When this identifier names this point: registers retire and reissue.
  valid_from        date,
  valid_to          date,
  tags              text[] not null default '{}',
  scenario_id       uuid references scenarios(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint meters_resource check (resource in ('electricity', 'gas', 'heat', 'water')),
  constraint meters_direction check (direction in ('import', 'export', 'both')),
  constraint meters_period check (valid_to is null or valid_from is null or valid_to > valid_from),
  constraint meters_tags_known check (tags_known(tags))
);

comment on table meters is
  'A connection point to a network, with the identifier its grid operator knows (IEC CIM UsagePoint). The physical meter is a device of type meter on it, and can be swapped.';

create unique index meters_one_identifier on meters (organisation_id, scheme, identifier, scenario_id, valid_from) nulls not distinct;
create index meters_site_idx on meters (site_id);

create or replace function meters_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  pat text;
begin
  select pattern into pat from id_schemes where code = new.scheme;
  if pat is not null and new.identifier !~ pat then
    raise exception 'invalid_identifier: % is not a valid %', new.identifier, new.scheme
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger meters_check before insert or update of identifier, scheme on meters
  for each row execute function meters_check();
call declare_object('meters', 'meter', '{site_id}');

-- ---------------------------------------------------------------------------
-- participants — a site's role in a project.
-- ---------------------------------------------------------------------------

create table participants (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  -- The site behind the meter. Null for a group.
  site_id          uuid references sites(id) on delete cascade,
  -- Groups and campuses: a participant may gather others (Nexgen's
  -- is_group / parent_id). A group has no site of its own.
  parent_id        uuid references participants(id) on delete restrict,
  is_group         boolean not null default false,
  name             text not null,
  role             text not null default 'consumer',
  -- Who answers for it: the owner, the tenant, the company. An Ekwo contact.
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
  constraint participants_group_has_no_site check (is_group = (site_id is null)),
  constraint participants_period check (leave_date is null or join_date is null or leave_date >= join_date),
  constraint participants_not_own_parent check (parent_id is distinct from id),
  constraint participants_tags_known check (tags_known(tags))
);

comment on table participants is
  'A site taking part in a project as producer, consumer or prosumer, behind its meters, with the contact who answers for it and the period it is in. A group gathers participants and has no site (Nexgen participants).';

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
    if not p.is_group then
      raise exception 'participant_parent_not_a_group' using errcode = 'check_violation';
    end if;
    if p.project_id <> new.project_id then
      raise exception 'participant_parent_in_other_project' using errcode = 'check_violation';
    end if;
  end if;
  -- A site is in a project once at a time: a participant may leave and
  -- come back, never overlap itself.
  if new.site_id is not null and exists (
    select 1 from participants q
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

create trigger participants_check before insert or update of parent_id, project_id, site_id, contact_id, join_date, leave_date, scenario_id on participants
  for each row execute function participants_check();
call declare_object('participants', 'participant', '{project_id,site_id,parent_id}');

-- The meters a participant is behind: those of its site, or of the sites of
-- the participants it groups.
create or replace function participant_meters(p_participant_id uuid)
returns table (meter_id uuid)
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive down as (
    select id, site_id from participants where id = p_participant_id
    union all
    select p.id, p.site_id from participants p join down on p.parent_id = down.id
  )
  select m.id from meters m join down on m.site_id = down.site_id;
$$;

comment on function participant_meters(uuid) is
  'The connection points a participant is behind, groups included.';

create or replace function site_of(p_object_id uuid)
returns uuid
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  k text;
begin
  select kind into k from objects where id = p_object_id;
  return case k
    when 'site'        then p_object_id
    when 'building'    then (select site_id from buildings where id = p_object_id)
    when 'surface'     then coalesce((select site_id from surfaces where id = p_object_id),
                                     (select b.site_id from surfaces s join buildings b on b.id = s.building_id where s.id = p_object_id))
    when 'meter'       then (select site_id from meters where id = p_object_id)
    when 'participant' then (select site_id from participants where id = p_object_id)
    else null
  end;
end;
$$;

grant execute on function participant_meters(uuid) to authenticated, service_role;

-- Nexgen OS — module `construction`: the milestones of works.
--
-- From the permit to the handover, works on a site go through phases, and
-- each phase through milestones: the roof survey done, the panels
-- delivered, the inverter installed, the grid connection granted, the
-- system commissioned. A milestone is about one object — a project, a site,
-- a building, a surface, a device — has a planned and an actual date, a
-- status and a contact who answers for it. It is an object itself, so that
-- photos, reports and inspection results attach to it as documents and
-- attributes, like to anything else.
--
-- `construction.progress()` sums the milestones of a site or a project up
-- on a given day: what the owner of the works and the site manager read.

set search_path = nexgen, public, extensions;

create schema construction;
grant usage on schema construction to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- phases — the steps works go through, as data.
-- ---------------------------------------------------------------------------

create table construction.phases (
  code          text primary key,
  name          text not null,
  -- The usual order of the phases; works may overlap them.
  position      integer not null,
  description   text,
  published_by  text not null default 'construction',
  constraint phases_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table construction.phases is
  'The phases works go through, in their usual order: design, permitting, procurement, installation, grid connection, commissioning, handover. Vocabulary: read by everyone signed in, written by migrations, modules and packs.';

insert into construction.phases (code, name, position, description) values
  ('design',            'Design',            10, 'Surveys, studies and the design of what will be built.'),
  ('permitting',        'Permitting',        20, 'Permits, declarations and the authorisations the works need.'),
  ('procurement',       'Procurement',       30, 'Orders and deliveries of equipment and materials.'),
  ('site_preparation',  'Site preparation',  40, 'Access, safety, scaffolding, earthworks, structural reinforcement.'),
  ('installation',      'Installation',      50, 'Mounting and wiring of the equipment.'),
  ('grid_connection',   'Grid connection',   60, 'The connection request, the works of the grid operator and the meter.'),
  ('commissioning',     'Commissioning',     70, 'Tests, inspections and putting the equipment into service.'),
  ('handover',          'Handover',          80, 'Acceptance by the owner, documents handed over, warranties starting.');

alter table construction.phases enable row level security;
create policy construction_phases_read on construction.phases for select to authenticated using (true);
grant select on construction.phases to authenticated;
grant select, insert, update, delete on construction.phases to service_role;

-- ---------------------------------------------------------------------------
-- milestones
-- ---------------------------------------------------------------------------

create table construction.milestones (
  id                      uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id         uuid not null references organisations(id) on delete cascade,
  -- What the milestone is about: a project, a site, a building, a surface,
  -- a device.
  subject_id              uuid not null references objects(id) on delete cascade,
  phase                   text not null references construction.phases(code),
  name                    text not null,
  -- planned, in_progress, done, blocked, cancelled.
  status                  text not null default 'planned',
  planned_start           date,
  planned_end             date,
  actual_start            date,
  actual_end              date,
  -- Who answers for it: the installer, the grid operator, the architect.
  responsible_contact_id  uuid references contacts(id) on delete set null,
  notes                   text,
  tags                    text[] not null default '{}',
  scenario_id             uuid references scenarios(id) on delete cascade,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint milestones_name_not_blank check (btrim(name) <> ''),
  constraint milestones_status check (status in ('planned', 'in_progress', 'done', 'blocked', 'cancelled')),
  constraint milestones_planned_order check (planned_end is null or planned_start is null or planned_end >= planned_start),
  constraint milestones_actual_order check (actual_end is null or actual_start is null or actual_end >= actual_start),
  -- A milestone started has its start; one done has its end; nothing ends
  -- before it is done.
  constraint milestones_started check (status not in ('in_progress', 'done') or actual_start is not null),
  constraint milestones_done check ((status = 'done') = (actual_end is not null)),
  constraint milestones_tags_known check (tags_known(tags))
);

comment on table construction.milestones is
  'A milestone of works on a project, a site, a building, a surface or a device: its phase, planned and actual dates, status and the contact who answers for it. An object: photos, reports and inspection results attach to it.';

create index milestones_subject_idx on construction.milestones (subject_id);
create index milestones_phase_idx on construction.milestones (phase);
call declare_object('construction.milestones', 'milestone', '{subject_id}');

-- The contact who answers for a milestone is one of its organisation's.
create or replace function construction.milestones_contact_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if new.responsible_contact_id is not null
     and not exists (select 1 from contacts c where c.id = new.responsible_contact_id and c.organisation_id = new.organisation_id) then
    raise exception 'contact_in_other_organisation: %', new.responsible_contact_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger milestones_contact_check
  before insert or update of responsible_contact_id, organisation_id on construction.milestones
  for each row execute function construction.milestones_contact_check();

-- ---------------------------------------------------------------------------
-- progress — where the works stand on a day.
-- ---------------------------------------------------------------------------

-- The milestones of a site (on the site or anything on it) or of a project
-- (on the project or on the sites taking part in it), in the world as it is
-- or in a scenario, summed up on a given day: how many by status, the share
-- done among those not cancelled, those late (planned to end before the day
-- and not done), and the phase of the earliest milestone still open. The
-- day is always given: the same call gives the same answer.
create or replace function construction.progress(p_object_id uuid, p_on date, p_scenario_id uuid default null)
returns jsonb
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive chain as (
    select s.id, s.parent_id from scenarios s where s.id = p_scenario_id
    union all
    select s.id, s.parent_id from scenarios s join chain on s.id = chain.parent_id
  ),
  sites as (
    select p_object_id as id
    union
    select p.site_id from participants p where p.project_id = p_object_id and p.site_id is not null
  ),
  m as (
    select m.*, ph.position
      from construction.milestones m
      join construction.phases ph on ph.code = m.phase
     where (m.scenario_id is null or m.scenario_id in (select id from chain))
       and (m.subject_id = p_object_id or site_of(m.subject_id) in (select id from sites))
  )
  select jsonb_build_object(
    'on', p_on,
    'total', count(*),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from m group by status) s), '{}'::jsonb),
    'done_share', case when count(*) filter (where status <> 'cancelled') = 0 then null
                       else round(count(*) filter (where status = 'done')::numeric / count(*) filter (where status <> 'cancelled'), 4) end,
    'late', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'phase', l.phase, 'planned_end', l.planned_end) order by l.planned_end, l.name)
                        from m l where l.status not in ('done', 'cancelled') and l.planned_end < p_on), '[]'::jsonb),
    'current_phase', (select o.phase from m o where o.status not in ('done', 'cancelled') order by o.position, o.planned_start nulls last, o.name limit 1)
  )
  from m;
$$;

comment on function construction.progress(uuid, date, uuid) is
  'Where the works of a site or a project stand on a day: milestones by status, share done, the late ones, the current phase. Reads under the caller''s row level security.';

grant execute on function construction.progress(uuid, date, uuid) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('construction', 'Construction', '0.1.0', 'construction', '0.1.0',
        'The milestones of works on a project, a site, a building or a device: phases, planned and actual dates, status, who answers for it, and where the works stand on a day.');

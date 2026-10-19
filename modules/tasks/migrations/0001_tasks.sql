-- Nexgen OS — module `tasks`: what has to be done on a project, and where it stands.
--
-- A project lives through phases, from the first study to the day its
-- equipment is taken down, and each phase through tasks: the grid study
-- accepted, the permit filed, the loan signed, the panels delivered, the
-- array wired, the injection point energised, the system commissioned, the
-- yearly inspection done. A task is about one object — a project, a site, a
-- building, a surface, a device — has a phase, a role that carries it and
-- the contact who holds that role, planned and actual dates, a status, and
-- may depend on another task. It is an object itself, so that photos,
-- reports and certificates attach to it as documents and attributes.
--
-- What has to be done is data. A template says, for a country, a kind of
-- project and a role, one task of one phase, with the reference it answers
-- and the documents it expects; the module publishes the generic ones
-- (0003), the installation and private overlays add theirs. `tasks.plan()` reads the templates
-- that match a project and creates its tasks, once. `tasks.progress()` sums
-- the tasks of a site or a project up on a day.
--
-- Projects and their participants are the `community` module's, which has
-- to be installed first.

set search_path = nexgen, public, extensions;

do $$
begin
  if to_regclass('community.projects') is null then
    raise exception 'module_required: tasks needs the community module (projects and participants)' using errcode = 'undefined_table';
  end if;
end
$$;

create schema tasks;
grant usage on schema tasks to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- phases — the life of a project, as data.
-- ---------------------------------------------------------------------------

create table tasks.phases (
  code          text primary key,
  name          text not null,
  -- The usual order of the phases; a project may overlap them.
  position      integer not null,
  description   text,
  published_by  text not null default 'tasks',
  constraint phases_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table tasks.phases is
  'The phases a project goes through, in their usual order, from study to decommissioning. Vocabulary: read by everyone signed in, written by migrations, modules and packs.';

insert into tasks.phases (code, name, position, description) values
  ('study',             'Study',             10,  'Feasibility, measurements, the first figures and the decision to go on.'),
  ('design',            'Design',            20,  'Surveys, studies and the design of what will be built.'),
  ('permitting',        'Permitting',        30,  'Permits, declarations, notifications and the authorisations the project needs.'),
  ('financing',         'Financing',         40,  'Budget, grants, loans and the contracts that pay for the project.'),
  ('procurement',       'Procurement',       50,  'Quotes, orders and deliveries of equipment and materials.'),
  ('site_preparation',  'Site preparation',  60,  'Access, safety, scaffolding, earthworks, structural reinforcement.'),
  ('installation',      'Installation',      70,  'Mounting and wiring of the equipment.'),
  ('grid_connection',   'Grid connection',   80,  'The connection request, the works of the grid operator and the meter.'),
  ('commissioning',     'Commissioning',     90,  'Tests, inspections, certificates and putting the equipment into service.'),
  ('handover',          'Handover',          100, 'Acceptance by the owner, documents handed over, warranties and registrations starting.'),
  ('operation',         'Operation',         110, 'Monitoring, maintenance, periodic inspections, reporting and the obligations that return every year.'),
  ('decommissioning',   'Decommissioning',   120, 'End of life: dismantling, recycling, the closing of contracts and registrations.');

alter table tasks.phases enable row level security;
create policy tasks_phases_read on tasks.phases for select to authenticated using (true);
grant select on tasks.phases to authenticated;
grant select, insert, update, delete on tasks.phases to service_role;

-- ---------------------------------------------------------------------------
-- roles — who carries a task in a project, as data.
-- ---------------------------------------------------------------------------

create table tasks.roles (
  code          text primary key,
  name          text not null,
  description   text,
  published_by  text not null default 'tasks',
  constraint roles_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table tasks.roles is
  'The roles that carry the tasks of a project: owner, installer, grid operator, municipality, regulator, financer, notary, community manager. Distinct from the roles of an organisation''s members and from a participant''s role in the energy flows. Vocabulary: written by migrations, modules and packs.';

insert into tasks.roles (code, name, description) values
  ('owner',              'Owner',              'The owner of the site or of the project: decides, signs, pays.'),
  ('installer',          'Installer',          'The company that designs, supplies and installs the equipment.'),
  ('grid_operator',      'Grid operator',      'The distribution or transmission operator: connection, meter, data.'),
  ('municipality',       'Municipality',       'The local authority: permits, declarations, public consultation.'),
  ('regulator',          'Regulator',          'The energy regulator or the agency that registers, certifies or subsidises.'),
  ('financer',           'Financer',           'The bank, the fund or the grant body that pays for part of the project.'),
  ('notary',             'Notary',             'The notary: deeds, statutes, rights on the land and the roof.'),
  ('community_manager',  'Community manager',  'Who runs an energy community: members, keys, settlement, reporting.');

alter table tasks.roles enable row level security;
create policy tasks_roles_read on tasks.roles for select to authenticated using (true);
grant select on tasks.roles to authenticated;
grant select, insert, update, delete on tasks.roles to service_role;

-- ---------------------------------------------------------------------------
-- templates — what has to be done, for a country, a kind of project, a role.
-- ---------------------------------------------------------------------------

create table tasks.templates (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  -- Who published it: 'tasks' for the generic ones, or the installation's own name.
  published_by     text not null,
  -- The country whose rules ask for it (ISO 3166-1 alpha-2); null: every country.
  country          char(2),
  -- The kind of project it applies to (`community.projects.kind`); null: every kind.
  project_kind     text,
  phase            text not null references tasks.phases(code),
  role             text references tasks.roles(code),
  name             text not null,
  description      text,
  -- The text the task answers, as its publisher cites it: a code, and the
  -- article or the citation in words. Law itself is not kept in the model.
  legal_source_code text,
  legal_reference  text,
  -- The documents the task is expected to produce or collect.
  documents        text[] not null default '{}',
  -- When the task applies, on one attribute of the project:
  -- {"property": "installed_power", "op": ">=", "value": 10}. Null: always.
  applies_when     jsonb,
  -- The code of another template of the same publisher the task waits for.
  depends_on_code  text,
  position         integer not null default 0,
  constraint templates_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint templates_once_per_publisher unique (published_by, code),
  constraint templates_name_not_blank check (btrim(name) <> ''),
  constraint templates_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  constraint templates_applies_when_shape check (
    applies_when is null
    or (jsonb_typeof(applies_when) = 'object'
        and applies_when ? 'property' and applies_when ? 'op' and applies_when ? 'value'
        and applies_when->>'op' in ('=', '<>', '<', '<=', '>', '>=')
        and jsonb_typeof(applies_when->'value') = 'number'))
);

comment on table tasks.templates is
  'What has to be done on a project, as data: for a country and a kind of project, one task of one phase carried by one role, with the legal reference it answers, the documents it expects, the condition under which it applies and the template it waits for. Published by the module (generic, for every country), by the installation and by private overlays; never by a country pack.';

create index templates_country_kind_idx on tasks.templates (country, project_kind);

alter table tasks.templates enable row level security;
create policy tasks_templates_read on tasks.templates for select to authenticated using (true);
grant select on tasks.templates to authenticated;
grant select, insert, update, delete on tasks.templates to service_role;

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

create table tasks.tasks (
  id                      uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id         uuid not null references organisations(id) on delete cascade,
  -- What the task is about: a project, a site, a building, a surface, a device.
  subject_id              uuid not null references objects(id) on delete cascade,
  phase                   text not null references tasks.phases(code),
  -- The role that carries it, and the contact who holds that role here.
  role                    text references tasks.roles(code),
  responsible_contact_id  uuid references contacts(id) on delete set null,
  name                    text not null,
  -- planned, in_progress, done, blocked, cancelled.
  status                  text not null default 'planned',
  planned_start           date,
  planned_end             date,
  actual_start            date,
  actual_end              date,
  -- The task this one waits for.
  depends_on              uuid references tasks.tasks(id) on delete set null,
  -- Where it comes from: a template `tasks.plan()` applied, a hand, or an
  -- action of the application that uses the foundation (`source_ref` names it).
  source                  text not null default 'manual',
  source_ref              text,
  template_id             uuid references tasks.templates(id) on delete set null,
  notes                   text,
  tags                    text[] not null default '{}',
  scenario_id             uuid references scenarios(id) on delete cascade,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint tasks_name_not_blank check (btrim(name) <> ''),
  constraint tasks_status check (status in ('planned', 'in_progress', 'done', 'blocked', 'cancelled')),
  constraint tasks_source check (source in ('template', 'manual', 'action')),
  constraint tasks_template_source check (template_id is null or source = 'template'),
  constraint tasks_planned_order check (planned_end is null or planned_start is null or planned_end >= planned_start),
  constraint tasks_actual_order check (actual_end is null or actual_start is null or actual_end >= actual_start),
  -- A task started has its start; one done has its end; nothing ends
  -- before it is done.
  constraint tasks_started check (status not in ('in_progress', 'done') or actual_start is not null),
  constraint tasks_done check ((status = 'done') = (actual_end is not null)),
  constraint tasks_not_own_dependency check (depends_on is distinct from id),
  constraint tasks_tags_known check (tags_known(tags))
);

comment on table tasks.tasks is
  'A task on a project, a site, a building, a surface or a device: its phase, the role that carries it and the contact who holds it, planned and actual dates, status, the task it waits for and where it comes from (a template, a hand, an action). An object: photos, reports and certificates attach to it.';

create index tasks_subject_idx on tasks.tasks (subject_id);
create index tasks_phase_idx on tasks.tasks (phase);
create index tasks_role_idx on tasks.tasks (role);
-- A template is applied once to a subject, in the world as it is or in a scenario.
create unique index tasks_template_once on tasks.tasks (subject_id, template_id, coalesce(scenario_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where template_id is not null;
call declare_object('tasks.tasks', 'task', '{subject_id}');

-- The contact who holds a task and the task it waits for are of its organisation.
create or replace function tasks.tasks_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if new.responsible_contact_id is not null
     and not exists (select 1 from contacts c where c.id = new.responsible_contact_id and c.organisation_id = new.organisation_id) then
    raise exception 'contact_in_other_organisation: %', new.responsible_contact_id using errcode = 'check_violation';
  end if;
  if new.depends_on is not null
     and not exists (select 1 from tasks.tasks t where t.id = new.depends_on and t.organisation_id = new.organisation_id) then
    raise exception 'dependency_in_other_organisation: %', new.depends_on using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger tasks_check
  before insert or update of responsible_contact_id, depends_on, organisation_id on tasks.tasks
  for each row execute function tasks.tasks_check();

-- ---------------------------------------------------------------------------
-- plan — the tasks of a project, from the templates that match it.
-- ---------------------------------------------------------------------------

-- Reads the project's country and kind, takes every template that matches
-- them (a null country or kind on the template matches every project),
-- checks the template's condition against the project's attributes, and
-- creates one task per template not yet applied. A template whose condition
-- names an attribute the project does not have is skipped and said so:
-- nothing is decided in the dark. Dependencies between templates become
-- dependencies between the tasks created. Calling it again creates nothing
-- twice. It writes under the caller's row level security.
create or replace function tasks.plan(p_project_id uuid, p_scenario_id uuid default null)
returns jsonb
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_country   char(2);
  v_kind      text;
  v_org       uuid;
  v_created   integer := 0;
  v_existing  integer := 0;
  v_skipped   jsonb := '[]'::jsonb;
  v_value     numeric;
  v_wanted    numeric;
  v_applies   boolean;
  t           record;
begin
  select p.country, p.kind, p.organisation_id into v_country, v_kind, v_org from community.projects p where p.id = p_project_id;
  if not found then
    raise exception 'project_not_found: %', p_project_id using errcode = 'no_data_found';
  end if;

  for t in
    select * from tasks.templates tp
     where (tp.country is null or tp.country = v_country)
       and (tp.project_kind is null or tp.project_kind = v_kind)
     order by tp.position, tp.code
  loop
    if exists (select 1 from tasks.tasks x
                where x.subject_id = p_project_id and x.template_id = t.id
                  and x.scenario_id is not distinct from p_scenario_id) then
      v_existing := v_existing + 1;
      continue;
    end if;

    if t.applies_when is not null then
      -- An attribute's value is JSON; the core keeps a number property's
      -- value a JSON number.
      select case when jsonb_typeof(a.value) = 'number' then (a.value #>> '{}')::numeric end into v_value
        from attributes a
       where a.object_id = p_project_id and a.property_code = t.applies_when->>'property'
       limit 1;
      if v_value is null then
        v_skipped := v_skipped || jsonb_build_object('code', t.code, 'published_by', t.published_by,
                                                     'reason', 'attribute_missing', 'property', t.applies_when->>'property');
        continue;
      end if;
      v_wanted := (t.applies_when->>'value')::numeric;
      v_applies := case t.applies_when->>'op'
                     when '='  then v_value =  v_wanted
                     when '<>' then v_value <> v_wanted
                     when '<'  then v_value <  v_wanted
                     when '<=' then v_value <= v_wanted
                     when '>'  then v_value >  v_wanted
                     when '>=' then v_value >= v_wanted
                   end;
      if not v_applies then
        continue;
      end if;
    end if;

    insert into tasks.tasks (organisation_id, subject_id, phase, role, name, notes, source, template_id, scenario_id)
    values (v_org, p_project_id, t.phase, t.role, t.name, t.description, 'template', t.id, p_scenario_id);
    v_created := v_created + 1;
  end loop;

  -- A task waits for the task its template waits for, when both exist here.
  update tasks.tasks x
     set depends_on = d.id
    from tasks.templates tp
    join tasks.templates dt on dt.published_by = tp.published_by and dt.code = tp.depends_on_code
    join tasks.tasks d on d.template_id = dt.id and d.subject_id = p_project_id
                      and d.scenario_id is not distinct from p_scenario_id
   where x.template_id = tp.id and x.subject_id = p_project_id
     and x.scenario_id is not distinct from p_scenario_id
     and x.depends_on is null;

  return jsonb_build_object('project_id', p_project_id, 'created', v_created, 'existing', v_existing, 'skipped', v_skipped);
end;
$$;

comment on function tasks.plan(uuid, uuid) is
  'Creates the tasks of a project from the templates that match its country, its kind and its attributes, once; says what it created, what already was there and what it could not decide. Writes under the caller''s row level security.';

grant execute on function tasks.plan(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- progress — where a project stands on a day.
-- ---------------------------------------------------------------------------

-- The tasks of a site (on the site or anything on it) or of a project (on
-- the project or on the sites taking part in it), in the world as it is or
-- in a scenario, summed up on a given day: how many by status, the share
-- done among those not cancelled, those late (planned to end before the
-- day and not done), and the phase of the earliest task still open. The
-- day is always given: the same call gives the same answer.
create or replace function tasks.progress(p_object_id uuid, p_on date, p_scenario_id uuid default null)
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
    select p.site_id from community.participants p where p.project_id = p_object_id and p.site_id is not null
  ),
  m as (
    select m.*, ph.position
      from tasks.tasks m
      join tasks.phases ph on ph.code = m.phase
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

comment on function tasks.progress(uuid, date, uuid) is
  'Where a site or a project stands on a day: tasks by status, share done, the late ones, the current phase. Reads under the caller''s row level security.';

grant execute on function tasks.progress(uuid, date, uuid) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('tasks', 'Tasks', '0.1.0', 'tasks', '0.2.0',
        'What has to be done on a project and where it stands: phases from study to decommissioning, roles, task templates per country and kind of project, the tasks of a project planned from them, and the progress of a site or a project on a day.');

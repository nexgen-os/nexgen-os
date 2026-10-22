-- Nexgen OS — module `actions`: what has to be done on an object of the
-- core, now or later, and where it stands.
--
-- An action is something to do on an object of the core — a project, a
-- participant, a meter, a device. It comes in three kinds, one table and one
-- lifecycle for all three (decision 0017):
--
--   * a step of a project, planned from a template or by a person: the grid
--     study accepted, the permit filed, the panels delivered, the system
--     commissioned, the yearly inspection done;
--   * a recommendation, proposed and resting on the estimate of a module
--     that gives its gain: install a battery, with the yearly gain the
--     estimate gives;
--   * a command, in real time: a setpoint or an order asked of a device at
--     an instant, carried out by a connector; its effect is a value of a
--     series of kind `setpoint` or `command` of the device (decision 0022).
--
-- An action has a phase, a role that carries it and the contact who holds
-- that role, planned and actual dates, a status in the lifecycle
-- proposed → validated → launched → done (or failed: a command refused or
-- not acknowledged; or dismissed, and restored), and may wait for another
-- action. Photos, reports and certificates attach to its object as
-- documents.
--
-- What has to be done on a project is data. An action template says, for a
-- country, its regions and the condition a project meets (the one shape of
-- a condition of the core, decision 0044), one step of one phase carried by
-- one role, with the reference it answers and the documents it expects; the
-- module publishes the generic ones (0002), the installation and private
-- overlays add theirs. `actions.plan()` reads the templates that match a
-- project and creates its steps, once. `actions.progress()` sums the actions
-- of a participant or a project up on a day. `actions.command()` asks a
-- device for a value at an instant and `actions.report()` records what the
-- connector that carried it out answered. Detectors that propose actions,
-- the scoring of recommendations and the controllers that decide commands
-- are an application's (docs/services.md).
--
-- Projects and their participants are the core's: an action is a secondary
-- table of the core objects it is about (decision 0042).

set search_path = nexgen, extensions;

create schema actions;
grant usage on schema actions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kinds — what an action is: a step, a recommendation, a command.
-- ---------------------------------------------------------------------------

create table actions.kinds (
  code          text primary key,
  name          text not null,
  description   text,
  published_by  text not null default 'actions',
  constraint kinds_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table actions.kinds is
  'What an action is: a step of a project, a recommendation resting on an estimate, a command asked of a device in real time. Vocabulary: read by everyone signed in; the checks of actions.actions name the three the module knows.';

insert into actions.kinds (code, name, description) values
  ('step',           'Step',           'A step of a project, planned from a template or by a person: a study, a permit, a delivery, a commissioning, an inspection.'),
  ('recommendation', 'Recommendation', 'Something proposed, resting on the estimate of a module that gives its gain: install a battery, insulate a roof.'),
  ('command',        'Command',        'A setpoint or an order asked of a device at an instant, carried out by a connector; its effect is a value of a series of kind setpoint or command of the device.');

alter table actions.kinds enable row level security;
create policy actions_kinds_read on actions.kinds for select to authenticated using (true);
grant select on actions.kinds to authenticated;
grant select, insert, update, delete on actions.kinds to service_role;

-- ---------------------------------------------------------------------------
-- phases — the life of a project, as data.
-- ---------------------------------------------------------------------------

create table actions.phases (
  code          text primary key,
  name          text not null,
  -- The usual order of the phases; a project may overlap them.
  position      integer not null,
  description   text,
  published_by  text not null default 'actions',
  constraint phases_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table actions.phases is
  'The phases a project goes through, in their usual order, from study to decommissioning. Vocabulary: read by everyone signed in, written by migrations, modules and packs.';

insert into actions.phases (code, name, position, description) values
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

alter table actions.phases enable row level security;
create policy actions_phases_read on actions.phases for select to authenticated using (true);
grant select on actions.phases to authenticated;
grant select, insert, update, delete on actions.phases to service_role;

-- ---------------------------------------------------------------------------
-- roles — who carries an action in a project, as data.
-- ---------------------------------------------------------------------------

create table actions.roles (
  code          text primary key,
  name          text not null,
  description   text,
  published_by  text not null default 'actions',
  constraint roles_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table actions.roles is
  'The roles that carry the actions of a project: owner, installer, grid operator, municipality, regulator, financer, notary, community manager. Distinct from the roles of an organisation''s members and from a participant''s role in the energy flows. Vocabulary: written by migrations, modules and packs.';

insert into actions.roles (code, name, description) values
  ('owner',              'Owner',              'The owner of the place or of the project: decides, signs, pays.'),
  ('installer',          'Installer',          'The company that designs, supplies and installs the equipment.'),
  ('grid_operator',      'Grid operator',      'The distribution or transmission operator: connection, meter, data.'),
  ('municipality',       'Municipality',       'The local authority: permits, declarations, public consultation.'),
  ('regulator',          'Regulator',          'The energy regulator or the agency that registers, certifies or subsidises.'),
  ('financer',           'Financer',           'The bank, the fund or the grant body that pays for part of the project.'),
  ('notary',             'Notary',             'The notary: deeds, statutes, rights on the land and the roof.'),
  ('community_manager',  'Community manager',  'Who runs an energy community: members, keys, settlement, reporting.');

alter table actions.roles enable row level security;
create policy actions_roles_read on actions.roles for select to authenticated using (true);
grant select on actions.roles to authenticated;
grant select, insert, update, delete on actions.roles to service_role;

-- ---------------------------------------------------------------------------
-- templates — the action templates: what has to be done, for a country, its
-- regions, a condition and a role.
-- ---------------------------------------------------------------------------

create table actions.templates (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  -- Who published it: 'actions' for the generic ones, or the installation's own name.
  published_by     text not null,
  -- The country whose rules ask for it (ISO 3166-1 alpha-2), and the
  -- ISO 3166-2 regions of that country it holds in; null and empty: every
  -- country, the whole country.
  country          char(2),
  regions          text[] not null default '{}',
  -- When it applies to a project, in the one shape of a condition of the
  -- core (condition_check()): the kind of the project and the kinds refining
  -- it, an attribute of the project compared with a number. {}: always.
  condition        jsonb not null default '{}',
  phase            text not null references actions.phases(code),
  role             text references actions.roles(code),
  name             text not null,
  description      text,
  -- The text the action answers, as its publisher cites it: a code, and the
  -- article or the citation in words. Law itself is not kept in the model.
  legal_source_code text,
  legal_reference  text,
  -- The documents the action is expected to produce or collect.
  documents        text[] not null default '{}',
  -- The code of another template of the same publisher the action waits for.
  depends_on_code  text,
  position         integer not null default 0,
  constraint templates_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint templates_once_per_publisher unique (published_by, code),
  constraint templates_name_not_blank check (btrim(name) <> ''),
  constraint templates_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  constraint templates_regions_in_country check (regions = '{}' or country is not null)
);

comment on table actions.templates is
  'The action templates: what has to be done on a project, as data — for a country and its regions, under a condition in the one shape of the core, one action of one phase carried by one role, with the legal reference it answers, the documents it expects and the template it waits for. Published by the module (generic, for every country), by the installation and by private overlays; never by a country pack.';

comment on column actions.templates.regions is
  'The ISO 3166-2 regions of the country the template holds in; empty: the whole country.';

create or replace function actions.templates_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  perform condition_check(new.condition);
  if new.condition ?| array['segment', 'device_type', 'density_class'] then
    raise exception 'condition_invalid: a template is matched against a project, which has a kind and attributes, not a %',
      (select string_agg(k, ', ') from jsonb_object_keys(new.condition) k where k in ('segment', 'device_type', 'density_class'))
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function actions.templates_check() is
  'BEFORE INSERT / UPDATE on actions.templates: the condition has the one shape of the core (condition_invalid), and names only what a project has (its kind, an attribute).';

create trigger templates_check before insert or update of condition on actions.templates
  for each row execute function actions.templates_check();

create index templates_country_idx on actions.templates (country);

alter table actions.templates enable row level security;
create policy actions_templates_read on actions.templates for select to authenticated using (true);
grant select on actions.templates to authenticated;
grant select, insert, update, delete on actions.templates to service_role;

-- ---------------------------------------------------------------------------
-- actions
-- ---------------------------------------------------------------------------

create table actions.actions (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references organisations(id) on delete cascade,
  -- What the action is about, by its kind and its id: a project, a
  -- participant, a meter, a device. Its organisation is the object's
  -- (`attach`), and it goes with its object (`drop_attachments`).
  object_kind             text not null,
  object_id               uuid not null,
  -- A step, a recommendation or a command (actions.kinds).
  kind                    text not null default 'step' references actions.kinds(code),
  phase                   text not null references actions.phases(code),
  -- The role that carries it, and the contact who holds that role here.
  role                    text references actions.roles(code),
  responsible_contact_id  uuid references contacts(id) on delete set null,
  name                    text not null,
  -- proposed, validated, launched, done; or failed, or dismissed.
  status                  text not null default 'proposed',
  planned_start           date,
  planned_end             date,
  actual_start            date,
  actual_end              date,
  -- The action this one waits for.
  depends_on              uuid references actions.actions(id) on delete set null,
  -- The estimate that gives its expected gain, when it rests on one: the
  -- table of a module's figures and the row's id, named as the core names
  -- an object, by kind and id (no foreign key to another module), with the
  -- gain per year in the currency of the place and the horizon it holds
  -- over, copied for reading.
  estimate_kind           text,
  estimate_id             uuid,
  expected_gain_per_year  numeric,
  gain_horizon_years      integer,
  -- A command: the series of kind setpoint or command of the device that
  -- receives it, the value asked (in the unit of the series' quantity), the
  -- instant it is due, the connector that carries it out, the instant the
  -- device acknowledged it, and why it failed when it did.
  series_id               uuid references series(id) on delete cascade,
  value                   double precision,
  due_at                  timestamptz,
  connector_id            uuid references connectors(id) on delete set null,
  acknowledged_at         timestamptz,
  failure                 text,
  -- Where it comes from: a template `actions.plan()` applied, a person, an
  -- agent, or a detector of an application (`source_ref` names which).
  source                  text not null default 'person',
  source_ref              text,
  template_id             uuid references actions.templates(id) on delete set null,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint actions_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint actions_name_not_blank check (btrim(name) <> ''),
  constraint actions_status check (status in ('proposed', 'validated', 'launched', 'done', 'failed', 'dismissed')),
  constraint actions_kind check (kind in ('step', 'recommendation', 'command')),
  -- A recommendation rests on an estimate, and only a recommendation does.
  constraint actions_recommendation_estimate check ((kind = 'recommendation') = (estimate_id is not null)),
  -- A command is asked of a device: its series, its value and its instant;
  -- nothing else carries them.
  constraint actions_command_device check (kind <> 'command' or object_kind = 'device'),
  constraint actions_command_fields check ((kind = 'command') = (series_id is not null and value is not null and due_at is not null)),
  constraint actions_command_only check (kind = 'command' or (series_id is null and value is null and due_at is null and connector_id is null and acknowledged_at is null)),
  constraint actions_acknowledged_done check (acknowledged_at is null or status = 'done'),
  -- A failed action says why; only a failed one does.
  constraint actions_failure check ((status = 'failed') = (failure is not null and btrim(failure) <> '')),
  constraint actions_source check (source in ('template', 'person', 'agent', 'detector')),
  constraint actions_template_source check (template_id is null or source = 'template'),
  constraint actions_estimate_kind_format check (estimate_kind is null or estimate_kind ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint actions_estimate_pair check ((estimate_kind is null) = (estimate_id is null)),
  constraint actions_gain_on_estimate check (estimate_id is not null or (expected_gain_per_year is null and gain_horizon_years is null)),
  constraint actions_horizon_positive check (gain_horizon_years is null or gain_horizon_years > 0),
  constraint actions_planned_order check (planned_end is null or planned_start is null or planned_end >= planned_start),
  constraint actions_actual_order check (actual_end is null or actual_start is null or actual_end >= actual_start),
  -- An action launched has its start; one done has its end; nothing ends
  -- before it is done.
  constraint actions_launched check (status not in ('launched', 'done', 'failed') or actual_start is not null),
  constraint actions_done check ((status = 'done') = (actual_end is not null)),
  constraint actions_not_own_dependency check (depends_on is distinct from id)
);

comment on table actions.actions is
  'Something to do on a project, a participant, a meter or a device, now or later — a step of the project, a recommendation or a command: its kind, phase, the role that carries it and the contact who holds it, planned and actual dates, status (proposed, validated, launched, done, failed, dismissed), the action it waits for, the estimate of a module that gives the expected gain of a recommendation (by kind and id, with the gain per year and its horizon copied), the series, value, instant and connector of a command, and where it comes from (a template, a person, an agent, a detector).';

create index actions_object_idx on actions.actions (object_kind, object_id);
create index actions_phase_idx on actions.actions (phase);
create index actions_role_idx on actions.actions (role);
create index actions_estimate_idx on actions.actions (estimate_kind, estimate_id);
create index actions_kind_idx on actions.actions (kind);
-- The commands still to carry out, by the instant they are due.
create index actions_commands_due_idx on actions.actions (due_at) where kind = 'command' and status = 'validated';
-- A template is applied once to an object.
create unique index actions_template_once on actions.actions (object_kind, object_id, template_id)
  where template_id is not null;
create trigger actions_attach before insert or update of object_kind, object_id on actions.actions
  for each row execute function attach();
create trigger actions_set_updated_at before update on actions.actions
  for each row execute function set_updated_at();
create index actions_organisation_idx on actions.actions (organisation_id);
call secure_table('actions.actions', 'project_of(object_kind, object_id)', 'participant_of(object_kind, object_id)');

-- The contact who holds an action and the action it waits for are of its
-- organisation; a status moves along the lifecycle only.
create or replace function actions.actions_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if new.responsible_contact_id is not null
     and not exists (select 1 from contacts c where c.id = new.responsible_contact_id and c.organisation_id = new.organisation_id) then
    raise exception 'contact_in_other_organisation: %', new.responsible_contact_id using errcode = 'check_violation';
  end if;
  if new.depends_on is not null
     and not exists (select 1 from actions.actions t where t.id = new.depends_on and t.organisation_id = new.organisation_id) then
    raise exception 'dependency_in_other_organisation: %', new.depends_on using errcode = 'check_violation';
  end if;
  if new.series_id is not null and new.object_kind = 'device' and not exists (
       select 1 from series se
        where se.id = new.series_id and se.kind in ('setpoint', 'command')
          and (se.device_id = new.object_id or (se.object_kind = 'device' and se.object_id = new.object_id))) then
    raise exception 'command_series_invalid: series % is not a setpoint or command series of device %', new.series_id, new.object_id
      using errcode = 'check_violation';
  end if;
  if new.connector_id is not null
     and not exists (select 1 from connectors c where c.id = new.connector_id and c.organisation_id = new.organisation_id) then
    raise exception 'connector_in_other_organisation: %', new.connector_id using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.status <> old.status and not (
       (old.status, new.status) in (('proposed', 'validated'), ('validated', 'launched'), ('launched', 'done'), ('launched', 'failed'),
                                    ('dismissed', 'proposed'), ('failed', 'proposed'))
       or (new.status = 'dismissed' and old.status not in ('done', 'failed'))) then
    raise exception 'action_status_invalid: an action goes proposed → validated → launched → done or failed, is dismissed, and a dismissed or failed one is restored to proposed; not % → %',
      old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger actions_check
  before insert or update of responsible_contact_id, depends_on, organisation_id, status, series_id, connector_id, object_id on actions.actions
  for each row execute function actions.actions_check();

-- ---------------------------------------------------------------------------
-- Gestures on an action.
-- ---------------------------------------------------------------------------

-- Proposes an action: a recommendation when it rests on an estimate that
-- gives its gain, a step otherwise.
create or replace function actions.propose(
  p_object_kind     text,
  p_object_id       uuid,
  p_phase           text,
  p_name            text,
  p_source          text default 'person',
  p_source_ref      text default null,
  p_estimate_kind   text default null,
  p_estimate_id     uuid default null,
  p_gain_per_year   numeric default null,
  p_horizon_years   integer default null,
  p_role            text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_estimate_kind is not null and to_regclass(p_estimate_kind) is null then
    raise exception 'estimate_kind_unknown: % is not a table of this installation', p_estimate_kind using errcode = 'foreign_key_violation';
  end if;
  insert into actions.actions (object_kind, object_id, kind, phase, role, name, source, source_ref,
                                estimate_kind, estimate_id, expected_gain_per_year, gain_horizon_years)
  values (p_object_kind, p_object_id, case when p_estimate_id is null then 'step' else 'recommendation' end,
          p_phase, p_role, p_name, p_source, p_source_ref,
          p_estimate_kind, p_estimate_id, p_gain_per_year, p_horizon_years)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function actions.propose(text, uuid, text, text, text, text, text, uuid, numeric, integer, text) is
  'Proposes an action about an object of the core: its phase, its name, where it comes from and, for a recommendation, the estimate of a module that gives its expected gain (the table and the row''s id, with the gain per year and its horizon); a step without one. Refuses estimate_kind_unknown, kind_unknown, object_not_found. Returns its id.';

-- Moves an action along its lifecycle on a day: validated, launched (its
-- actual start), done (its actual end), failed (with why), dismissed, or
-- proposed again.
create or replace function actions.move(p_action_id uuid, p_status text, p_on date default null, p_failure text default null)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if not exists (select 1 from actions.actions where id = p_action_id) then
    raise exception 'action_not_found: %', p_action_id using errcode = 'no_data_found';
  end if;
  if p_status in ('launched', 'done') and p_on is null then
    raise exception 'action_day_required: an action is % on a day', p_status using errcode = 'invalid_parameter_value';
  end if;
  if p_status = 'failed' and nullif(btrim(p_failure), '') is null then
    raise exception 'action_failure_required: a failed action says why' using errcode = 'invalid_parameter_value';
  end if;
  update actions.actions
     set status = p_status,
         actual_start = case when p_status = 'launched' then p_on else actual_start end,
         actual_end = case when p_status = 'done' then p_on else actual_end end,
         failure = case when p_status = 'failed' then p_failure end
   where id = p_action_id;
end;
$$;

comment on function actions.move(uuid, text, date, text) is
  'Moves an action along its lifecycle — proposed → validated → launched (on its actual start) → done (on its actual end) or failed (with why), dismissed from any status but done and failed, restored from dismissed or failed to proposed. Refuses action_not_found, action_day_required, action_failure_required, action_status_invalid.';

-- The answer of the person a recommendation is made to: validated or
-- dismissed. The account of a participant reads its actions and writes none
-- of them; this is the one thing it decides (account.decide), and only
-- about a recommendation still waiting for it, or that it dismissed.
create or replace function actions.decide(p_action_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  a actions.actions%rowtype;
begin
  select * into a from actions.actions where id = p_action_id for update;
  if a.id is null or not (caller_bypasses_rls() or has_capability(a.object_kind, a.object_id, 'account.decide')) then
    raise exception 'action_not_found: %', p_action_id using errcode = 'no_data_found';
  end if;
  if a.kind <> 'recommendation' or p_status not in ('validated', 'dismissed') then
    raise exception 'action_not_decided: a recommendation is validated or dismissed, not % (%)', p_status, a.kind
      using errcode = 'check_violation';
  end if;
  update actions.actions set status = p_status where id = p_action_id;
end;
$$;

comment on function actions.decide(uuid, text) is
  'Validates or dismisses a recommendation, as the person it is made to: whoever holds account.decide on its object (the account of its participant, an editor, an owner). Refuses action_not_found, action_not_decided, action_status_invalid.';

grant execute on function actions.propose(text, uuid, text, text, text, text, text, uuid, numeric, integer, text),
  actions.move(uuid, text, date, text), actions.decide(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- command and report — an action in real time.
-- ---------------------------------------------------------------------------

-- Asks a device for a value at an instant: a setpoint (a temperature, a
-- power limit, a charge rate) or an order (on, off, a scene), on a series of
-- kind setpoint or command of the device, in the unit of its quantity. The
-- command is proposed; once validated, the connector that carries it out
-- sends it and reports what the device answered (actions.report()).
create or replace function actions.command(
  p_series_id     uuid,
  p_value         double precision,
  p_due_at        timestamptz,
  p_name          text default null,
  p_source        text default 'person',
  p_source_ref    text default null,
  p_connector_id  uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  s     series%rowtype;
  v_id  uuid;
begin
  select * into s from series se where se.id = p_series_id;
  if not found then
    raise exception 'series_not_found: %', p_series_id using errcode = 'no_data_found';
  end if;
  if s.kind not in ('setpoint', 'command') or coalesce(s.device_id, case when s.object_kind = 'device' then s.object_id end) is null then
    raise exception 'command_series_invalid: series % is not a setpoint or command series of a device', p_series_id using errcode = 'check_violation';
  end if;
  insert into actions.actions (object_kind, object_id, kind, phase, name, series_id, value, due_at, connector_id, source, source_ref)
  values ('device', coalesce(s.device_id, s.object_id), 'command', 'operation',
          coalesce(p_name, format('%s %s: %s', s.kind, s.quantity_code, p_value)),
          p_series_id, p_value, p_due_at, p_connector_id, p_source, p_source_ref)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function actions.command(uuid, double precision, timestamptz, text, text, text, uuid) is
  'Proposes a command: a value asked of a device at an instant, on a setpoint or command series of the device (in the unit of its quantity), carried out by a connector. Refuses series_not_found, command_series_invalid. Returns its id.';

-- What the connector that carried a command out reports: the instant the
-- device answered, and why it failed when it did. A validated command is
-- launched on that day; acknowledged, it is done and its value is stored
-- in its series at that instant (store()), which is its effect; refused or
-- not acknowledged, it failed. The day is the one of the participant of the
-- device, in its time zone.
create or replace function actions.report(p_action_id uuid, p_at timestamptz, p_failure text default null)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  a      actions.actions%rowtype;
  v_tz   text;
  v_day  date;
begin
  select * into a from actions.actions x where x.id = p_action_id;
  if not found then
    raise exception 'action_not_found: %', p_action_id using errcode = 'no_data_found';
  end if;
  if a.kind <> 'command' then
    raise exception 'action_not_command: % is a %', p_action_id, a.kind using errcode = 'invalid_parameter_value';
  end if;
  if a.status not in ('validated', 'launched') then
    raise exception 'action_status_invalid: a command is reported once validated or launched, not %', a.status using errcode = 'check_violation';
  end if;
  v_tz := series_time_zone(a.series_id);
  if v_tz is null then
    raise exception 'time_zone_required: the participant of device % has no time zone', a.object_id using errcode = 'invalid_parameter_value';
  end if;
  v_day := (p_at at time zone v_tz)::date;
  if a.status = 'validated' then
    update actions.actions set status = 'launched', actual_start = v_day where id = p_action_id;
  end if;
  if p_failure is null then
    update actions.actions set status = 'done', actual_end = greatest(v_day, actual_start), acknowledged_at = p_at where id = p_action_id;
    perform store(a.series_id, array[p_at], array[a.value]);
  else
    perform actions.move(p_action_id, 'failed', null, p_failure);
  end if;
end;
$$;

comment on function actions.report(uuid, timestamptz, text) is
  'What the connector that carried a command out reports: acknowledged at an instant, the command is done and its value stored in its series at that instant; with a failure, it failed and says why. Refuses action_not_found, action_not_command, action_status_invalid, time_zone_required, action_failure_required.';

grant execute on function actions.command(uuid, double precision, timestamptz, text, text, text, uuid),
  actions.report(uuid, timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- plan — the actions of a project, from the templates that match it.
-- ---------------------------------------------------------------------------

-- Takes every template of the project's country (or of every country) and
-- of the regions of its participants, matches its condition against the
-- project with the core's one matcher (condition_matches()), and creates
-- one action per template not yet applied, validated: a step of the plan.
-- A template whose condition reads an attribute the project does not
-- have, or holds in regions while no participant says its region, is
-- skipped and said so: nothing is decided in the dark. Dependencies between
-- templates become dependencies between the actions created. Calling it
-- again creates nothing twice. It writes under the caller's row level
-- security.
create or replace function actions.plan(p_project_id uuid)
returns jsonb
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_country   char(2);
  v_org       uuid;
  v_facts     jsonb;
  v_created   integer := 0;
  v_existing  integer := 0;
  v_skipped   jsonb := '[]'::jsonb;
  v_matches   boolean;
  v_regions   text[];
  t           record;
begin
  select p.country, p.organisation_id into v_country, v_org from projects p where p.id = p_project_id;
  if not found then
    raise exception 'project_not_found: %', p_project_id using errcode = 'no_data_found';
  end if;
  v_facts := condition_facts('project', p_project_id);

  -- The regions of a project are those of the participants taking part in it.
  select coalesce(array_agg(distinct pa.region order by pa.region), '{}') into v_regions
    from participants pa
   where pa.project_id = p_project_id and pa.region is not null;

  for t in
    select * from actions.templates tp
     where tp.country is null or tp.country = v_country
     order by tp.position, tp.code
  loop
    if exists (select 1 from actions.actions x
                where x.object_kind = 'project' and x.object_id = p_project_id and x.template_id = t.id) then
      v_existing := v_existing + 1;
      continue;
    end if;

    if t.regions <> '{}' then
      if v_regions = '{}' then
        v_skipped := v_skipped || jsonb_build_object('code', t.code, 'published_by', t.published_by,
                                                     'reason', 'region_missing', 'regions', to_jsonb(t.regions));
        continue;
      end if;
      if not t.regions && v_regions then
        continue;
      end if;
    end if;

    v_matches := condition_matches(t.condition, v_facts);
    if v_matches is null then
      v_skipped := v_skipped || jsonb_build_object('code', t.code, 'published_by', t.published_by,
                                                   'reason', 'attribute_missing', 'attribute_type', t.condition#>>'{attribute,attribute_type}');
      continue;
    end if;
    if not v_matches then
      continue;
    end if;

    insert into actions.actions (organisation_id, object_kind, object_id, phase, role, name, notes, status, source, template_id)
    values (v_org, 'project', p_project_id, t.phase, t.role, t.name, t.description, 'validated', 'template', t.id);
    v_created := v_created + 1;
  end loop;

  -- An action waits for the action its template waits for, when both exist here.
  update actions.actions x
     set depends_on = d.id
    from actions.templates tp
    join actions.templates dt on dt.published_by = tp.published_by and dt.code = tp.depends_on_code
    join actions.actions d on d.template_id = dt.id and d.object_kind = 'project' and d.object_id = p_project_id
   where x.template_id = tp.id and x.object_kind = 'project' and x.object_id = p_project_id
     and x.depends_on is null;

  return jsonb_build_object('project_id', p_project_id, 'created', v_created, 'existing', v_existing, 'skipped', v_skipped);
end;
$$;

comment on function actions.plan(uuid) is
  'Creates the actions of a project, validated, from the templates of its country and of the regions of its participants whose condition it meets (condition_matches()), once; says what it created, what already was there and what it could not decide (attribute_missing, region_missing). Writes under the caller''s row level security.';

grant execute on function actions.plan(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- progress — where a project stands on a day.
-- ---------------------------------------------------------------------------

-- The actions of a participant (on the participant or anything of it) or of
-- a project (on the project or on the participants taking part in it),
-- summed up on a given day: how many by status, the share done among those
-- not dismissed, those late (planned to end before the day and not done),
-- and the phase of the earliest action still open. The day is always
-- given: the same call gives the same answer.
create or replace function actions.progress(p_object_id uuid, p_on date)
returns jsonb
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with nodes as (
    select p_object_id as id
    union
    select p.id from participants p where p.project_id = p_object_id
  ),
  m as (
    select m.*, ph.position
      from actions.actions m
      join actions.phases ph on ph.code = m.phase
     where (m.object_id = p_object_id or participant_of(m.object_kind, m.object_id) in (select id from nodes))
  )
  select jsonb_build_object(
    'on', p_on,
    'total', count(*),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from m group by status) s), '{}'::jsonb),
    'done_share', case when count(*) filter (where status <> 'dismissed') = 0 then null
                       else round(count(*) filter (where status = 'done')::numeric / count(*) filter (where status <> 'dismissed'), 4) end,
    'late', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'phase', l.phase, 'planned_end', l.planned_end) order by l.planned_end, l.name)
                        from m l where l.status not in ('done', 'failed', 'dismissed') and l.planned_end < p_on), '[]'::jsonb),
    'current_phase', (select o.phase from m o where o.status not in ('done', 'failed', 'dismissed') order by o.position, o.planned_start nulls last, o.name limit 1)
  )
  from m;
$$;

comment on function actions.progress(uuid, date) is
  'Where a participant or a project stands on a day: actions by status, share done, the late ones (not done, failed or dismissed), the current phase. Reads under the caller''s row level security.';

grant execute on function actions.progress(uuid, date) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('actions', 'Actions', '0.3.0', 'actions', '0.3.0',
        'What has to be done on an object of the core, now or later: steps of a project planned from templates per country, region and condition, recommendations resting on an estimate, commands asked of a device in real time — one lifecycle for all three — and the progress of a participant or a project on a day.');

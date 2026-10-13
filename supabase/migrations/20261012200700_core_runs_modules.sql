-- Nexgen OS — core: computation runs and the module registry.
--
-- A module computes — PV production, self-consumption, heat losses, a
-- compliance check, a construction progress — in its own schema. What it
-- hands back to the core is a run: the inputs it read, the engine version
-- that read them, and the results. A finished run never changes, and the
-- same inputs given to the same engine version find the same run: a figure
-- shown to someone can always be traced to what produced it and reproduced.
-- Nothing in the core calls a model; a module that uses one says so in its
-- engine version and its inputs.

set search_path = nexgen, public, extensions;

create table modules (
  code              text primary key,
  name              text not null,
  version           text not null,
  -- The Postgres schema the module owns. The core has no idea what is in it.
  schema_name       text not null unique,
  requires_core_min text not null,
  description       text,
  installed_at      timestamptz not null default now(),
  constraint modules_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table modules is
  'Modules installed beside the core, one Postgres schema each. The last statement of a module''s first migration writes its row here.';

create table runs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  module_code      text not null references modules(code),
  engine_version   text not null,
  -- The object the run is about: a project, a site, a building, a device.
  subject_id       uuid not null references objects(id) on delete cascade,
  scenario_id      uuid references scenarios(id) on delete cascade,
  inputs           jsonb not null,
  -- sha256 of module, engine version and inputs: the identity of a result.
  inputs_hash      text not null,
  results          jsonb,
  status           text not null default 'running',
  error            text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint runs_status check (status in ('running', 'succeeded', 'failed')),
  constraint runs_finished check ((status = 'running') = (finished_at is null))
);

comment on table runs is
  'Computations a module ran on an object: inputs, engine version, results. Immutable once finished; same inputs + same engine = same run.';

create unique index runs_one_success_per_input on runs (organisation_id, inputs_hash) where status = 'succeeded';
create index runs_subject_idx on runs (subject_id);

create trigger runs_attach
  before insert on runs
  for each row execute function attach('subject_id');

create or replace function runs_immutable()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if old.status <> 'running' then
    raise exception 'run_is_final: a finished run never changes' using errcode = 'check_violation';
  end if;
  if new.inputs is distinct from old.inputs or new.inputs_hash is distinct from old.inputs_hash
     or new.module_code is distinct from old.module_code or new.engine_version is distinct from old.engine_version
     or new.subject_id is distinct from old.subject_id or new.scenario_id is distinct from old.scenario_id then
    raise exception 'run_inputs_are_final' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger runs_immutable
  before update on runs
  for each row execute function runs_immutable();

create or replace function run_hash(p_module text, p_engine_version text, p_inputs jsonb)
returns text
language sql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
  -- jsonb text output is canonical: keys sorted, whitespace normalised.
  select encode(sha256(convert_to(p_module || E'\n' || p_engine_version || E'\n' || p_inputs::text, 'UTF8')), 'hex');
$$;

-- The one way a module hands a result to the core. Returns the run: an
-- existing successful run with the same identity, or the new one.
create or replace function record_run(
  p_module_code    text,
  p_engine_version text,
  p_subject_id     uuid,
  p_scenario_id    uuid,
  p_inputs         jsonb,
  p_results        jsonb
)
returns uuid
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  h    text := run_hash(p_module_code, p_engine_version,
                        p_inputs || jsonb_build_object('subject', p_subject_id, 'scenario', p_scenario_id));
  org  uuid;
  rid  uuid;
begin
  select organisation_id into org from objects where id = p_subject_id;
  select id into rid from runs where organisation_id = org and inputs_hash = h and status = 'succeeded';
  if rid is not null then
    return rid;
  end if;
  insert into runs (organisation_id, module_code, engine_version, subject_id, scenario_id, inputs, inputs_hash, results, status, finished_at)
  values (org, p_module_code, p_engine_version, p_subject_id, p_scenario_id, p_inputs, h, p_results, 'succeeded', now())
  returning id into rid;
  return rid;
end;
$$;

comment on function record_run(text, text, uuid, uuid, jsonb, jsonb) is
  'The one way a module writes a result into the core. Idempotent: the same module, engine version, subject, scenario and inputs return the same run.';

alter table modules enable row level security;
create policy modules_read on modules for select to authenticated using (true);
grant select on modules to authenticated;
grant select, insert, update, delete on modules to service_role;

call secure_table('runs');

grant execute on function run_hash(text, text, jsonb),
  record_run(text, text, uuid, uuid, jsonb, jsonb) to authenticated, service_role;

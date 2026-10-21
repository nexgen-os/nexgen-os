-- Nexgen OS — core: computation runs and the modules installed.
--
-- A module computes — PV production, self-consumption, heat losses, a
-- compliance check, a construction progress — in its own schema. What it
-- hands back to the core is a run: the inputs it read, the engine version
-- that read them, the results, and the series it produced. A finished run
-- never changes, its series included, and the same inputs given to the same
-- engine version find the same run: a figure shown to someone can always be
-- traced to what produced it and reproduced. Nothing in the core calls a
-- model; a module that uses one says so in its engine version and inputs.
--
-- Runs come before series in this set of migrations because a series may
-- belong to a run (`series.run_id`).

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
  constraint modules_code_format check (code ~ '^[a-z0-9][a-z0-9_]*$')
);

comment on table modules is
  'Modules installed beside the core, one Postgres schema each. A module''s first migration writes its row here.';

create table runs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  module_code      text not null references modules(code),
  engine_version   text not null,
  -- The object the run is about, by its kind and its id: a site, a
  -- building, a device, a project.
  subject_kind     text not null references kinds(kind),
  subject_id       uuid not null,
  scenario_id      uuid references scenarios(id) on delete cascade,
  inputs           jsonb not null,
  -- sha256 of module, engine version and inputs: the identity of a result.
  inputs_hash      text not null,
  results          jsonb,
  -- running: started, its series being written (start_run); succeeded:
  -- final; superseded: a later run of the same module on the same subject
  -- replaced it and its series were discarded (`discard_superseded_series`).
  status           text not null default 'running',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint runs_status check (status in ('running', 'succeeded', 'superseded')),
  constraint runs_finished check ((status = 'running') = (finished_at is null))
);

comment on table runs is
  'Computations a module ran on an object: inputs, engine version, results, and the series it owns. Immutable once finished; same inputs + same engine = same run.';

create unique index runs_one_success_per_input on runs (organisation_id, inputs_hash) where status = 'succeeded';
create index runs_subject_idx on runs (subject_kind, subject_id);

create trigger runs_attach
  before insert on runs
  for each row execute function attach('subject');

-- A finished run never changes. The one move it makes is to `superseded`,
-- when its series are discarded, with nothing else touched.
create or replace function runs_immutable()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if new.inputs is distinct from old.inputs or new.inputs_hash is distinct from old.inputs_hash
     or new.module_code is distinct from old.module_code or new.engine_version is distinct from old.engine_version
     or new.subject_kind is distinct from old.subject_kind or new.subject_id is distinct from old.subject_id or new.scenario_id is distinct from old.scenario_id then
    if old.status = 'running' then
      raise exception 'run_inputs_are_final' using errcode = 'check_violation';
    end if;
    raise exception 'run_is_final: a finished run never changes' using errcode = 'check_violation';
  end if;
  if old.status = 'running' then
    return new;
  end if;
  if old.status = 'succeeded' and new.status = 'superseded'
     and new.results is not distinct from old.results and new.finished_at is not distinct from old.finished_at then
    return new;
  end if;
  raise exception 'run_is_final: a finished run never changes' using errcode = 'check_violation';
end;
$$;

comment on function runs_immutable() is
  'BEFORE UPDATE on runs: inputs never change, and a finished run changes only from succeeded to superseded (run_is_final).';

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

comment on function run_hash(text, text, jsonb) is
  'The identity of a result: sha256 of module, engine version and canonical inputs.';

-- How a module hands a result to the core. A run writes its own series,
-- never another's, while it runs, and is final once finished:
--
--   start_run()   the run of an identity — module, engine version, subject,
--                 scenario, inputs: the finished one when it exists (the
--                 module has nothing to write), else a new running one
--   series_ensure(…, run) and store()   the series the run computed
--   finish_run()  its results; from then on nothing of it changes
--
-- `record_run()` does the three in one call, for a result whose series fit
-- in one JSON argument.
create or replace function start_run(
  p_module_code    text,
  p_engine_version text,
  p_subject_kind   text,
  p_subject_id     uuid,
  p_scenario_id    uuid,
  p_inputs         jsonb,
  out run_id       uuid,
  out finished     boolean
)
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  h    text := run_hash(p_module_code, p_engine_version,
                        p_inputs || jsonb_build_object('subject', p_subject_id, 'scenario', p_scenario_id));
  org  uuid := object_organisation(p_subject_kind, p_subject_id);
begin
  select r.id into run_id from runs r where r.organisation_id = org and r.inputs_hash = h and r.status = 'succeeded';
  if run_id is not null then
    finished := true;
    return;
  end if;
  run_id := gen_random_uuid();
  finished := false;
  insert into runs (id, organisation_id, module_code, engine_version, subject_kind, subject_id, scenario_id, inputs, inputs_hash)
  values (run_id, org, p_module_code, p_engine_version, p_subject_kind, p_subject_id, p_scenario_id, p_inputs, h);
end;
$$;

comment on function start_run(text, text, text, uuid, uuid, jsonb) is
  'Starts the run of an identity (module, engine version, subject named by its kind and id, scenario, inputs), or finds the finished one: finished = true means the result exists and nothing is to be written. Refuses kind_unknown, object_not_found.';

create or replace function finish_run(p_run_id uuid, p_results jsonb)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  r runs%rowtype;
begin
  select * into r from runs where id = p_run_id;
  if not found then
    raise exception 'run_not_found: %', p_run_id using errcode = 'no_data_found';
  end if;
  if r.status <> 'running' then
    raise exception 'run_is_final: a finished run never changes' using errcode = 'check_violation';
  end if;
  begin
    update runs set results = p_results, status = 'succeeded', finished_at = now() where id = p_run_id;
  exception when unique_violation then
    raise exception 'run_already_recorded: another run of the same identity finished first' using errcode = 'unique_violation';
  end;
  return p_run_id;
end;
$$;

comment on function finish_run(uuid, jsonb) is
  'Finishes a running run with its results: from then on neither the run nor its series change. Refuses run_not_found, run_is_final, run_already_recorded.';

-- Each element of `p_series` opens a series that belongs to the run and
-- stores its values, before the run is final:
--
--   { "key": "production", "object_kind": "device", "object_id": "…",
--     "quantity_code": "production_energy",
--     "value_kind": "interval", "step": "1 hour", "kind": "simulated",
--     "name": null, "source_code": null, "device_id": null,
--     "unit": null,
--     "at": ["2026-01-01T00:00:00Z", …], "value": [0.0, …] }
--
-- and the results name the series under `series.<key>`. A series that names
-- no object is the subject's.
create or replace function record_run(
  p_module_code    text,
  p_engine_version text,
  p_subject_kind   text,
  p_subject_id     uuid,
  p_scenario_id    uuid,
  p_inputs         jsonb,
  p_results        jsonb,
  p_series         jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  run    record;
  s      jsonb;
  sid    uuid;
  owned  jsonb := '{}';
  n      integer := 0;
begin
  select * into run from start_run(p_module_code, p_engine_version, p_subject_kind, p_subject_id, p_scenario_id, p_inputs);
  if run.finished then
    return run.run_id;
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_series, '[]'::jsonb)) loop
    n := n + 1;
    sid := series_ensure(
      case when s ? 'object_id' then s->>'object_kind' else p_subject_kind end,
      coalesce((s->>'object_id')::uuid, p_subject_id), s->>'quantity_code', coalesce(s->>'kind', 'simulated'),
      coalesce(s->>'value_kind', 'interval'), (s->>'step')::interval, (s->>'device_id')::uuid, null,
      s->>'source_code', s->>'name', p_scenario_id, '{}'::jsonb, run.run_id);
    perform store(sid,
      array(select jsonb_array_elements_text(s->'at'))::timestamptz[],
      array(select jsonb_array_elements_text(s->'value'))::float8[],
      null, s->>'unit',
      case when coalesce(s->>'kind', 'simulated') = 'forecast' then now() end);
    owned := owned || jsonb_build_object(coalesce(s->>'key', s->>'name', s->>'quantity_code', n::text), sid);
  end loop;
  return finish_run(run.run_id,
    case when owned = '{}' then p_results else coalesce(p_results, '{}'::jsonb) || jsonb_build_object('series', owned) end);
end;
$$;

comment on function record_run(text, text, text, uuid, uuid, jsonb, jsonb, jsonb) is
  'The one-call way a module writes a result into the core, with the series it owns (results.series names them). Idempotent: the same module, engine version, subject, scenario and inputs return the same run.';

-- The cleanup of superseded simulations. A run's series are its figures and
-- never change; once later runs of the same module on the same subject and
-- scenario exist, the series of the older ones may be discarded to save
-- space. The run stays, with its inputs and results, marked superseded: the
-- same inputs given again make a new run with fresh series.
create or replace function discard_superseded_series(p_subject_id uuid, p_keep integer default 1)
returns integer
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  old_runs uuid[];
  n        integer;
begin
  if p_keep < 1 then
    raise exception 'keep_at_least_one: the latest run keeps its series' using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(array_agg(id), '{}') into old_runs
    from (select r.id, row_number() over (partition by r.module_code, r.scenario_id order by r.finished_at desc, r.id) rank
            from runs r
           where r.subject_id = p_subject_id and r.status = 'succeeded'
             and exists (select 1 from series s where s.run_id = r.id)) ranked
   where rank > p_keep;
  delete from series where run_id = any (old_runs);
  get diagnostics n = row_count;
  update runs set status = 'superseded' where id = any (old_runs);
  return n;
end;
$$;

comment on function discard_superseded_series(uuid, integer) is
  'Deletes the series of the runs on a subject that later runs of the same module and scenario superseded, keeping the latest p_keep; the runs stay, marked superseded. Returns the number of series deleted.';

alter table modules enable row level security;
create policy modules_read on modules for select to authenticated using (true);
grant select on modules to authenticated;
grant select, insert, update, delete on modules to service_role;

call secure_table('runs');
create trigger runs_drop_attachments after delete on runs
  for each row execute function drop_attachments('run');

grant execute on function run_hash(text, text, jsonb), start_run(text, text, text, uuid, uuid, jsonb), finish_run(uuid, jsonb),
  record_run(text, text, text, uuid, uuid, jsonb, jsonb, jsonb), discard_superseded_series(uuid, integer)
  to authenticated, service_role;

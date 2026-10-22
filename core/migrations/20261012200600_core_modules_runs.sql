-- Nexgen OS — core: the modules installed, and the gesture of a run.
--
-- A module computes — PV production, a consumption curve, the sharing of a
-- community — in its own schema, and keeps there what it computed: a run,
-- with the inputs it read, the engine version that read them, its results
-- and the series it wrote (decision 0004). A run is the module's: each
-- module that computes has a `<module>.runs` table of one shape, its
-- subject a foreign key to an object of the core (`solar.runs.device_id`,
-- `consumption.runs.participant_id`, `community.runs.project_id`). The core
-- keeps no run, only the gesture every such table shares, so that a run is
-- recorded, found again and closed the same way in every module
-- (decision 0046):
--
--   run_hash()     the identity of a result
--   run_is_final() the trigger that keeps a finished run as it is
--   start_run(), finish_run(), record_run()   the one way to write a run,
--                  naming the module's table
--
-- A finished run never changes, its series included, and the same inputs
-- given to the same engine version find the same run: a figure shown to
-- someone can always be traced to what produced it and reproduced. Nothing
-- in the core calls a model; a module that uses one says so in its engine
-- version and inputs.
--
-- The shape of a module's runs, in its first migration:
--
--   create table <module>.runs (
--     id               uuid primary key default gen_random_uuid(),
--     organisation_id  uuid not null references organisations(id) on delete cascade,
--     <kind>_id        uuid not null references <the kind's table>(id) on delete cascade,
--     engine_version   text not null,
--     inputs           jsonb not null,
--     inputs_hash      text not null,
--     results          jsonb,
--     status           text not null default 'running' check (status in ('running', 'succeeded')),
--     started_at       timestamptz not null default now(),
--     finished_at      timestamptz,
--     check ((status = 'running') = (finished_at is null)));
--   create unique index … on <module>.runs (organisation_id, inputs_hash) where status = 'succeeded';
--   create trigger runs_is_final before update on <module>.runs for each row execute function run_is_final();
--   call secure_table('<module>.runs');

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

-- ---------------------------------------------------------------------------
-- The gesture of a run, on a module's runs table.
-- ---------------------------------------------------------------------------

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
  'The identity of a result: sha256 of the module''s runs table, engine version and canonical inputs.';

-- BEFORE UPDATE on a module's runs: the inputs, the subject and the engine
-- of a run never change, and a finished run does not change at all.
create or replace function run_is_final()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if (to_jsonb(new) - array['results', 'status', 'finished_at']) is distinct from (to_jsonb(old) - array['results', 'status', 'finished_at']) then
    if old.status = 'running' then
      raise exception 'run_inputs_are_final' using errcode = 'check_violation';
    end if;
    raise exception 'run_is_final: a finished run never changes' using errcode = 'check_violation';
  end if;
  if old.status <> 'running' then
    raise exception 'run_is_final: a finished run never changes' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function run_is_final() is
  'BEFORE UPDATE on a module''s runs table: inputs, subject and engine never change, and a finished run never changes (run_inputs_are_final, run_is_final).';

-- The status of the run a series was written by, from its `source`
-- (`<module>.runs:<run id>`, set by record_run() and the modules); null for
-- a series no run wrote.
create or replace function run_status_of(p_source text)
returns text
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  t       regclass;
  status  text;
begin
  if p_source is null or p_source !~ '^[a-z][a-z0-9_]*\.runs:[0-9a-f-]{36}$' then
    return null;
  end if;
  t := to_regclass(split_part(p_source, ':', 1));
  if t is null then
    return null;
  end if;
  execute format('select status from %s where id = $1', t) into status using split_part(p_source, ':', 2)::uuid;
  return status;
end;
$$;

comment on function run_status_of(text) is
  'The status of the run a series'' source names (<module>.runs:<id>), null when no run wrote it.';

-- How a module writes a run, naming its runs table and the subject by its
-- kind and its id (the table's `<kind>_id`):
--
--   start_run()   the run of an identity — table, engine version, subject,
--                 inputs: the finished one when it exists (the module has
--                 nothing to write), else a new running one
--   series_ensure(…, source => '<module>.runs:<id>') and store()
--                 the series the run computed, written while it runs
--   finish_run()  its results; from then on nothing of it changes
--
-- `record_run()` does the three in one call, for a result whose series fit
-- in one JSON argument.
create or replace function start_run(
  p_runs           regclass,
  p_kind           text,
  p_id             uuid,
  p_engine_version text,
  p_inputs         jsonb,
  out run_id       uuid,
  out finished     boolean
)
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  h    text := run_hash(p_runs::text, p_engine_version, p_inputs || jsonb_build_object('subject', p_id));
  org  uuid := object_organisation(p_kind, p_id);
begin
  execute format('select id from %s where organisation_id = $1 and inputs_hash = $2 and status = ''succeeded''', p_runs)
    into run_id using org, h;
  if run_id is not null then
    finished := true;
    return;
  end if;
  run_id := gen_random_uuid();
  finished := false;
  execute format('insert into %s (id, organisation_id, %I, engine_version, inputs, inputs_hash) values ($1, $2, $3, $4, $5, $6)',
                 p_runs, p_kind || '_id')
    using run_id, org, p_id, p_engine_version, p_inputs, h;
end;
$$;

comment on function start_run(regclass, text, uuid, text, jsonb) is
  'Starts the run of an identity in a module''s runs table (engine version, subject named by its kind and id, inputs), or finds the finished one: finished = true means the result exists and nothing is to be written. Refuses kind_unknown, object_not_found.';

create or replace function finish_run(p_runs regclass, p_run_id uuid, p_results jsonb)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  status text;
begin
  execute format('select status from %s where id = $1', p_runs) into status using p_run_id;
  if status is null then
    raise exception 'run_not_found: %', p_run_id using errcode = 'no_data_found';
  end if;
  if status <> 'running' then
    raise exception 'run_is_final: a finished run never changes' using errcode = 'check_violation';
  end if;
  begin
    execute format('update %s set results = $1, status = ''succeeded'', finished_at = now() where id = $2', p_runs)
      using p_results, p_run_id;
  exception when unique_violation then
    raise exception 'run_already_recorded: another run of the same identity finished first' using errcode = 'unique_violation';
  end;
  return p_run_id;
end;
$$;

comment on function finish_run(regclass, uuid, jsonb) is
  'Finishes a running run of a module''s runs table with its results: from then on neither the run nor its series change. Refuses run_not_found, run_is_final, run_already_recorded.';

-- Each element of `p_series` opens a series the run writes and stores its
-- values, before the run is final:
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
  p_runs           regclass,
  p_kind           text,
  p_id             uuid,
  p_engine_version text,
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
  select * into run from start_run(p_runs, p_kind, p_id, p_engine_version, p_inputs);
  if run.finished then
    return run.run_id;
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_series, '[]'::jsonb)) loop
    n := n + 1;
    sid := series_ensure(
      case when s ? 'object_id' then s->>'object_kind' else p_kind end,
      coalesce((s->>'object_id')::uuid, p_id), s->>'quantity_code', coalesce(s->>'kind', 'simulated'),
      coalesce(s->>'value_kind', 'interval'), (s->>'step')::interval, (s->>'device_id')::uuid, null,
      s->>'source_code', s->>'name', '{}'::jsonb, p_runs::text || ':' || run.run_id);
    perform store(sid,
      array(select jsonb_array_elements_text(s->'at'))::timestamptz[],
      array(select jsonb_array_elements_text(s->'value'))::float8[],
      null, s->>'unit',
      case when coalesce(s->>'kind', 'simulated') = 'forecast' then now() end);
    owned := owned || jsonb_build_object(coalesce(s->>'key', s->>'name', s->>'quantity_code', n::text), sid);
  end loop;
  return finish_run(p_runs, run.run_id,
    case when owned = '{}' then p_results else coalesce(p_results, '{}'::jsonb) || jsonb_build_object('series', owned) end);
end;
$$;

comment on function record_run(regclass, text, uuid, text, jsonb, jsonb, jsonb) is
  'The one-call way a module writes a run into its runs table, with the series it writes (results.series names them, their source names the run). Idempotent: the same table, engine version, subject and inputs return the same run.';

alter table modules enable row level security;
create policy modules_read on modules for select to authenticated using (true);
grant select on modules to authenticated;
grant select, insert, update, delete on modules to service_role;

grant execute on function run_hash(text, text, jsonb), run_status_of(text),
  start_run(regclass, text, uuid, text, jsonb), finish_run(regclass, uuid, jsonb),
  record_run(regclass, text, uuid, text, jsonb, jsonb, jsonb)
  to authenticated, service_role;

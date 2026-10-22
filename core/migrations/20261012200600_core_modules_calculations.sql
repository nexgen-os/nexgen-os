-- Nexgen OS — core: the modules installed, and the gesture of a calculation.
--
-- A module computes — PV production, a consumption curve, the sharing of a
-- community — in its own schema, and keeps there what it computed, in a
-- table named after what it holds: the inputs it read, the engine version
-- that read them, its results and the series it wrote (decision 0004). The
-- table is the module's, of one shape in every module, its subject a
-- foreign key to an object of the core (`solar.estimates.device_id`,
-- `consumption.estimates.participant_id`,
-- `community.settlements.project_id`). The core keeps no figure, only the
-- gesture every such table shares, so that a calculation is recorded,
-- found again and closed the same way in every module (decision 0004):
--
--   calculation_hash()      the identity of a result
--   calculation_is_final()  the trigger that keeps a finished calculation
--                           as it is, and marks the table as one of them
--   start_calculation(), finish_calculation(), record_calculation()
--                           the one way to write one, naming the module's table
--
-- A finished calculation never changes, its series included, and the same
-- inputs given to the same engine version find the same row: a figure shown
-- to someone can always be traced to what produced it and reproduced.
-- Nothing in the core calls a model; a module that uses one says so in its
-- engine version and inputs.
--
-- The shape of such a table, in the module's first migration (`<table>` is
-- the word of what it holds: `estimates`, `settlements`):
--
--   create table <module>.<table> (
--     id               uuid primary key default gen_random_uuid(),
--     organisation_id  uuid not null references organisations(id) on delete cascade,
--     <kind>_id        uuid not null references <the kind's table>(id) on delete cascade,
--     engine_version   text not null,
--     inputs           jsonb not null,
--     inputs_hash      text not null,
--     results          jsonb,
--     status           text not null default 'started' check (status in ('started', 'finished')),
--     started_at       timestamptz not null default now(),
--     finished_at      timestamptz,
--     check ((status = 'started') = (finished_at is null)));
--   create unique index … on <module>.<table> (organisation_id, inputs_hash) where status = 'finished';
--   create trigger <table>_is_final before update on <module>.<table> for each row execute function calculation_is_final();
--   call secure_table('<module>.<table>');

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
-- The gesture of a calculation, on a module's table of them.
-- ---------------------------------------------------------------------------

create or replace function calculation_hash(p_table text, p_engine_version text, p_inputs jsonb)
returns text
language sql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
  -- jsonb text output is canonical: keys sorted, whitespace normalised.
  select encode(sha256(convert_to(p_table || E'\n' || p_engine_version || E'\n' || p_inputs::text, 'UTF8')), 'hex');
$$;

comment on function calculation_hash(text, text, jsonb) is
  'The identity of a result: sha256 of the module''s table, engine version and canonical inputs.';

-- BEFORE UPDATE on a module's table of calculations: the inputs, the
-- subject and the engine never change, and a finished calculation does not
-- change at all.
create or replace function calculation_is_final()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if (to_jsonb(new) - array['results', 'status', 'finished_at']) is distinct from (to_jsonb(old) - array['results', 'status', 'finished_at']) then
    if old.status = 'started' then
      raise exception 'calculation_inputs_are_final' using errcode = 'check_violation';
    end if;
    raise exception 'calculation_is_final: a finished calculation never changes' using errcode = 'check_violation';
  end if;
  if old.status <> 'started' then
    raise exception 'calculation_is_final: a finished calculation never changes' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function calculation_is_final() is
  'BEFORE UPDATE on a module''s table of calculations: inputs, subject and engine never change, and a finished calculation never changes (calculation_inputs_are_final, calculation_is_final). The trigger is also what marks the table as one of them.';

-- The status of the calculation a series was written by, from its `source`
-- (`<module>.<table>:<id>`, set by record_calculation() and the modules);
-- null for a series no calculation wrote. A table is one of calculations
-- when calculation_is_final() guards it.
create or replace function calculation_status_of(p_source text)
returns text
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  t       regclass;
  status  text;
begin
  if p_source is null or p_source !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*:[0-9a-f-]{36}$' then
    return null;
  end if;
  t := to_regclass(split_part(p_source, ':', 1));
  if t is null or not exists (
    select 1 from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
     where tg.tgrelid = t and p.proname = 'calculation_is_final'
  ) then
    return null;
  end if;
  execute format('select status from %s where id = $1', t) into status using split_part(p_source, ':', 2)::uuid;
  return status;
end;
$$;

comment on function calculation_status_of(text) is
  'The status of the calculation a series'' source names (<module>.<table>:<id>, a table guarded by calculation_is_final()), null when no calculation wrote it.';

-- How a module writes a calculation, naming its table and the subject by
-- its kind and its id (the table's `<kind>_id`):
--
--   start_calculation()   the calculation of an identity — table, engine
--                         version, subject, inputs: the finished one when it
--                         exists (the module has nothing to write), else a
--                         new started one
--   series_ensure(…, source => '<module>.<table>:<id>') and store()
--                         the series it computed, written before it finishes
--   finish_calculation()  its results; from then on nothing of it changes
--
-- `record_calculation()` does the three in one call, for a result whose
-- series fit in one JSON argument.
create or replace function start_calculation(
  p_table          regclass,
  p_kind           text,
  p_id             uuid,
  p_engine_version text,
  p_inputs         jsonb,
  out calculation_id uuid,
  out finished     boolean
)
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  h    text := calculation_hash(p_table::text, p_engine_version, p_inputs || jsonb_build_object('subject', p_id));
  org  uuid := object_organisation(p_kind, p_id);
begin
  execute format('select id from %s where organisation_id = $1 and inputs_hash = $2 and status = ''finished''', p_table)
    into calculation_id using org, h;
  if calculation_id is not null then
    finished := true;
    return;
  end if;
  calculation_id := gen_random_uuid();
  finished := false;
  execute format('insert into %s (id, organisation_id, %I, engine_version, inputs, inputs_hash) values ($1, $2, $3, $4, $5, $6)',
                 p_table, p_kind || '_id')
    using calculation_id, org, p_id, p_engine_version, p_inputs, h;
end;
$$;

comment on function start_calculation(regclass, text, uuid, text, jsonb) is
  'Starts the calculation of an identity in a module''s table (engine version, subject named by its kind and id, inputs), or finds the finished one: finished = true means the result exists and nothing is to be written. Refuses kind_unknown, object_not_found.';

create or replace function finish_calculation(p_table regclass, p_id uuid, p_results jsonb)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  status text;
begin
  execute format('select status from %s where id = $1', p_table) into status using p_id;
  if status is null then
    raise exception 'calculation_not_found: %', p_id using errcode = 'no_data_found';
  end if;
  if status <> 'started' then
    raise exception 'calculation_is_final: a finished calculation never changes' using errcode = 'check_violation';
  end if;
  begin
    execute format('update %s set results = $1, status = ''finished'', finished_at = now() where id = $2', p_table)
      using p_results, p_id;
  exception when unique_violation then
    raise exception 'calculation_already_recorded: another calculation of the same identity finished first' using errcode = 'unique_violation';
  end;
  return p_id;
end;
$$;

comment on function finish_calculation(regclass, uuid, jsonb) is
  'Finishes a started calculation of a module''s table with its results: from then on neither it nor its series change. Refuses calculation_not_found, calculation_is_final, calculation_already_recorded.';

-- Each element of `p_series` opens a series the calculation writes and
-- stores its values, before it is final:
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
create or replace function record_calculation(
  p_table          regclass,
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
  c      record;
  s      jsonb;
  sid    uuid;
  owned  jsonb := '{}';
  n      integer := 0;
begin
  select * into c from start_calculation(p_table, p_kind, p_id, p_engine_version, p_inputs);
  if c.finished then
    return c.calculation_id;
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_series, '[]'::jsonb)) loop
    n := n + 1;
    sid := series_ensure(
      case when s ? 'object_id' then s->>'object_kind' else p_kind end,
      coalesce((s->>'object_id')::uuid, p_id), s->>'quantity_code', coalesce(s->>'kind', 'simulated'),
      coalesce(s->>'value_kind', 'interval'), (s->>'step')::interval, (s->>'device_id')::uuid, null,
      s->>'source_code', s->>'name', '{}'::jsonb, p_table::text || ':' || c.calculation_id);
    perform store(sid,
      array(select jsonb_array_elements_text(s->'at'))::timestamptz[],
      array(select jsonb_array_elements_text(s->'value'))::float8[],
      null, s->>'unit',
      case when coalesce(s->>'kind', 'simulated') = 'forecast' then now() end);
    owned := owned || jsonb_build_object(coalesce(s->>'key', s->>'name', s->>'quantity_code', n::text), sid);
  end loop;
  return finish_calculation(p_table, c.calculation_id,
    case when owned = '{}' then p_results else coalesce(p_results, '{}'::jsonb) || jsonb_build_object('series', owned) end);
end;
$$;

comment on function record_calculation(regclass, text, uuid, text, jsonb, jsonb, jsonb) is
  'The one-call way a module writes a calculation into its table, with the series it writes (results.series names them, their source names the calculation). Idempotent: the same table, engine version, subject and inputs return the same row.';

alter table modules enable row level security;
create policy modules_read on modules for select to authenticated using (true);
grant select on modules to authenticated;
grant select, insert, update, delete on modules to service_role;

grant execute on function calculation_hash(text, text, jsonb), calculation_status_of(text),
  start_calculation(regclass, text, uuid, text, jsonb), finish_calculation(regclass, uuid, jsonb),
  record_calculation(regclass, text, uuid, text, jsonb, jsonb, jsonb)
  to authenticated, service_role;

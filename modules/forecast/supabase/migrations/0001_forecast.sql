-- Nexgen OS — module `forecast`: forecasts of a series of the core.
--
-- The core stores every series, forecasts included: a series of kind
-- `forecast` keeps each issue in `forecast_values`, with the time it was
-- issued, and `forecast_at()` reads it as it was known (decisions 0029,
-- 0031). A connector that receives a forecast (a weather model) writes it
-- there with no model at all. This module computes one: a forecast of a
-- series of the core by a method, each issue written as a forecast series
-- of the same object through `store()`, and its accuracy read back against
-- what was measured.
--
-- A method is data (`forecast.methods`). The module ships the two
-- benchmarks every forecast is measured against (Hyndman and
-- Athanasopoulos, Forecasting: Principles and Practice, 3rd edition, §5.2):
-- `naive`, every value ahead is the last one observed, and
-- `seasonal_naive`, every value ahead is the one observed one season
-- earlier. Regressions, trees and weather-driven models come next, in
-- TypeScript or through a program connector (decision 0013).
--
-- Conventions: a value is dated at the start of its interval, in UTC; a
-- season, a horizon and a history are elapsed time, so a daily season is 24
-- hours of UTC and a change of daylight-saving time shifts a local pattern
-- by an hour for the days after it.

set search_path = nexgen, extensions;

create schema forecast;
grant usage on schema forecast to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- methods — how a forecast is computed, as data.
-- ---------------------------------------------------------------------------

create table forecast.methods (
  code          text primary key,
  name          text not null,
  -- Whether the method repeats a season, which a forecast then gives.
  seasonal      boolean not null,
  -- Where the method is described, as the literature cites it.
  reference     text,
  published_by  text not null default 'forecast',
  description   text,
  constraint methods_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table forecast.methods is
  'How a forecast is computed: the methods `forecast.issue()` knows, with whether each repeats a season and where it is described. Vocabulary: read by everyone signed in, written by migrations and modules.';

insert into forecast.methods (code, name, seasonal, reference, description) values
  ('naive', 'Naive', false,
   'Hyndman, R.J. and Athanasopoulos, G., Forecasting: Principles and Practice, 3rd edition, OTexts, 2021, §5.2',
   'Every value ahead is the last value observed before the issue: the benchmark of a series that changes slowly.'),
  ('seasonal_naive', 'Seasonal naive', true,
   'Hyndman, R.J. and Athanasopoulos, G., Forecasting: Principles and Practice, 3rd edition, OTexts, 2021, §5.2',
   'Every value ahead is the value observed one season earlier, or the latest whole seasons earlier when it lies beyond the last value observed: the benchmark of a series with a daily or weekly pattern.');

alter table forecast.methods enable row level security;
create policy forecast_methods_read on forecast.methods for select to authenticated using (true);
grant select on forecast.methods to authenticated;
grant select, insert, update, delete on forecast.methods to service_role;

-- ---------------------------------------------------------------------------
-- forecasts — a series of the core forecast by a method (decision 0004).
-- ---------------------------------------------------------------------------

create table forecast.forecasts (
  id                  uuid primary key default gen_random_uuid(),
  -- The organisation of the series forecast, copied from it.
  organisation_id     uuid not null references organisations(id) on delete cascade,
  -- The series forecast: measured or simulated, regular, of values per
  -- interval or at an instant.
  series_id           uuid not null references series(id) on delete cascade,
  method              text not null references forecast.methods(code),
  -- The season a seasonal method repeats (`1 day`, `7 days`): a whole
  -- number of steps of the series; null for a method that repeats none.
  season              interval,
  -- How far beyond the time of an issue it forecasts.
  horizon             interval not null,
  -- How far before the time of an issue it reads the series.
  history             interval not null default '28 days',
  -- The forecast series it writes, of the same object, quantity and step,
  -- once issued.
  forecast_series_id  uuid references series(id) on delete set null,
  -- Where it comes from: the program and the version that computed the
  -- latest issue.
  provenance          text,
  inputs              jsonb not null default '{}',
  results             jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint forecasts_fixed_lengths check (
    extract(year from horizon) = 0 and extract(month from horizon) = 0
    and extract(year from history) = 0 and extract(month from history) = 0
    and (season is null or (extract(year from season) = 0 and extract(month from season) = 0))
  ),
  constraint forecasts_positive check (horizon > interval '0' and history > interval '0' and (season is null or season > interval '0'))
);

comment on table forecast.forecasts is
  'A series of the core forecast by a method of this module, over a horizon, from a history: its inputs, its provenance (the program and version of its latest issue), its results (the forecast series and its latest issue). Every issue stays in the forecast series, with the time it was issued.';

create index forecasts_series_id_idx on forecast.forecasts (series_id);
create index forecasts_organisation_id_idx on forecast.forecasts (organisation_id);

-- A forecast takes the organisation of its series, a season when its
-- method is seasonal and only then, a season that is a whole number of
-- steps of the series, and a history at least one season long.
create or replace function forecast.forecasts_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  seasonal boolean;
  step interval;
begin
  select m.seasonal into seasonal from forecast.methods m where m.code = new.method;
  select se.step into step from series se where se.id = new.series_id;
  new.organisation_id := object_organisation('series', new.series_id);
  if seasonal and new.season is null then
    raise exception 'season_required: % repeats a season; give one (1 day, 7 days)', new.method using errcode = 'check_violation';
  elsif not seasonal and new.season is not null then
    raise exception 'season_unexpected: % repeats no season', new.method using errcode = 'check_violation';
  end if;
  if new.season is not null and step is not null
     and mod(extract(epoch from new.season)::numeric, extract(epoch from step)::numeric) <> 0 then
    raise exception 'season_not_whole_steps: a season of % is not a whole number of steps of %', new.season, step using errcode = 'check_violation';
  end if;
  if new.season is not null and new.history < new.season then
    raise exception 'history_too_short: a history of % reads less than one season of %', new.history, new.season using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function forecast.forecasts_check() is
  'BEFORE INSERT / UPDATE on forecasts: the organisation of its series; a season for a seasonal method and only then (season_required, season_unexpected), a whole number of steps (season_not_whole_steps), within the history (history_too_short).';

create trigger forecasts_check
  before insert or update on forecast.forecasts
  for each row execute function forecast.forecasts_check();
create trigger forecasts_set_updated_at before update on forecast.forecasts
  for each row execute function set_updated_at();
call secure_table('forecast.forecasts', 'project_of(''series'', series_id)', 'participant_of(''series'', series_id)');

-- ---------------------------------------------------------------------------
-- issue — a forecast computed as known at a time, and written.
-- ---------------------------------------------------------------------------

-- Issues a forecast at `p_issued_at`: reads the series over the history
-- before it, the values whose interval had ended by then and that are not
-- missing; forecasts every step after the last value observed until the
-- horizon after the issue; writes them through `store()` into the forecast
-- series, with `p_issued_at` as their issue time. The same issue time gives
-- the same values again, so an issue in the past is a backtest. Returns the
-- forecast series. Runs under the caller's row level security.
create or replace function forecast.issue(p_forecast_id uuid, p_issued_at timestamptz default now())
returns uuid
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  f forecast.forecasts%rowtype;
  s series%rowtype;
  seasonal boolean;
  last_at timestamptz;
  last_value double precision;
  ats timestamptz[];
  vals double precision[];
  sid uuid;
begin
  select * into f from forecast.forecasts where id = p_forecast_id;
  if not found then
    raise exception 'forecast_not_found: %', p_forecast_id using errcode = 'no_data_found';
  end if;
  select * into s from series where id = f.series_id;
  if not found then
    raise exception 'series_not_found: %', f.series_id using errcode = 'no_data_found';
  end if;
  if s.kind not in ('measured', 'simulated') then
    raise exception 'series_kind_unsupported: series % is %; a forecast continues a measured or simulated series', s.id, s.kind using errcode = 'invalid_parameter_value';
  end if;
  if s.value_kind = 'cumulative' then
    raise exception 'value_kind_unsupported: series % is a cumulative register; forecast its amount per interval', s.id using errcode = 'invalid_parameter_value';
  end if;
  if s.step is null or extract(year from s.step) <> 0 or extract(month from s.step) <> 0 then
    raise exception 'step_required: series % has no step of fixed length; a forecast continues a regular series', s.id using errcode = 'invalid_parameter_value';
  end if;
  select m.seasonal into seasonal from forecast.methods m where m.code = f.method;

  select w.at, w.value into last_at, last_value
    from nexgen.window(s.id, p_issued_at - f.history, p_issued_at) w
   where w.quality <> 3 and w.at + s.step <= p_issued_at
   order by w.at desc
   limit 1;
  if last_at is null then
    raise exception 'history_required: series % has no value observed in the % before %', s.id, f.history, p_issued_at using errcode = 'no_data_found';
  end if;

  with history as (
    select w.at, w.value
      from nexgen.window(s.id, p_issued_at - f.history, p_issued_at) w
     where w.quality <> 3 and w.at <= last_at
  ), ahead as (
    select g.at from generate_series(last_at + s.step, p_issued_at + f.horizon, s.step) g(at)
     where g.at < p_issued_at + f.horizon
  ), ahead_values as (
    select a.at,
           case when not seasonal then last_value
                else (select h.value from history h
                       where h.at < a.at
                         and mod(extract(epoch from a.at - h.at)::numeric, extract(epoch from f.season)::numeric) = 0
                       order by h.at desc limit 1)
           end as value
      from ahead a
  )
  select array_agg(x.at order by x.at), array_agg(x.value order by x.at) into ats, vals
    from ahead_values x where x.value is not null;
  if ats is null then
    raise exception 'history_required: series % has no value one season before the instants ahead of %', s.id, p_issued_at using errcode = 'no_data_found';
  end if;

  select r.series_id into sid
    from store(null, ats, vals, null, null, p_issued_at,
               jsonb_build_object('object_kind', s.object_kind, 'object_id', s.object_id, 'quantity_code', s.quantity_code,
                                  'kind', 'forecast', 'value_kind', s.value_kind, 'step', s.step::text, 'device_id', s.device_id,
                                  'name', f.method, 'source', 'forecast.forecasts:' || f.id)) r;

  update forecast.forecasts
     set forecast_series_id = sid,
         provenance = 'forecast.issue 0.5.0',
         inputs = jsonb_build_object(
           'series_id', s.id, 'method', f.method, 'season', f.season, 'horizon', f.horizon, 'history', f.history,
           'issued_at', p_issued_at, 'read', jsonb_build_object('from', p_issued_at - f.history, 'to', p_issued_at),
           'last_observed', jsonb_build_object('at', last_at, 'value', last_value),
           'conventions', jsonb_build_object('time', 'interval start, UTC', 'season', 'elapsed time', 'unit', 'the unit of the quantity')),
         results = jsonb_build_object(
           'series_id', sid, 'issued_at', p_issued_at, 'from', ats[1], 'to', ats[cardinality(ats)] + s.step, 'values', cardinality(ats))
   where id = f.id;
  return sid;
end;
$$;

comment on function forecast.issue(uuid, timestamptz) is
  'Issues a forecast as known at p_issued_at (now by default): every step after the last value observed until the horizon, by its method, written into its forecast series with that issue time; the same time gives the same values (a backtest). Returns the forecast series. Refuses forecast_not_found, series_kind_unsupported, value_kind_unsupported, step_required, history_required.';

-- ---------------------------------------------------------------------------
-- accuracy — a forecast against what was measured.
-- ---------------------------------------------------------------------------

-- How far a forecast was from its series over a period: each instant where
-- both have a value, the forecast as issued at least `p_horizon` before it
-- (its latest issue without one), the series' value when it is not missing.
-- Mean absolute error, root mean square error and mean error (the bias,
-- positive when the forecast is above), in the unit of the quantity.
create or replace function forecast.accuracy(p_forecast_id uuid, p_from timestamptz, p_to timestamptz, p_horizon interval default null)
returns jsonb
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  f forecast.forecasts%rowtype;
  unit text;
  r jsonb;
begin
  select * into f from forecast.forecasts where id = p_forecast_id;
  if not found then
    raise exception 'forecast_not_found: %', p_forecast_id using errcode = 'no_data_found';
  end if;
  if f.forecast_series_id is null then
    raise exception 'forecast_not_issued: % has no issue yet', p_forecast_id using errcode = 'no_data_found';
  end if;
  select q.unit into unit from series se join quantities q on q.code = se.quantity_code where se.id = f.series_id;
  select jsonb_build_object(
           'pairs', count(*),
           'mae', avg(abs(p.forecast - p.measured)),
           'rmse', sqrt(avg((p.forecast - p.measured) ^ 2)),
           'bias', avg(p.forecast - p.measured))
    into r
    from (select fa.value forecast, w.value measured
            from forecast_at(f.forecast_series_id, p_from, p_to, null, p_horizon) fa
            join nexgen.window(f.series_id, p_from, p_to) w on w.at = fa.at and w.quality <> 3) p;
  return r || jsonb_build_object('from', p_from, 'to', p_to, 'horizon', p_horizon, 'unit', unit,
                                 'series_id', f.series_id, 'forecast_series_id', f.forecast_series_id, 'method', f.method);
end;
$$;

comment on function forecast.accuracy(uuid, timestamptz, timestamptz, interval) is
  'The accuracy of a forecast over a period against its series: the pairs compared, mean absolute error, root mean square error and bias, in the unit of the quantity, each value forecast at least p_horizon ahead (its latest issue without one). Refuses forecast_not_found, forecast_not_issued.';

grant execute on function forecast.issue(uuid, timestamptz) to authenticated, service_role;
grant execute on function forecast.accuracy(uuid, timestamptz, timestamptz, interval) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('forecast', 'Forecast', '0.5.0', 'forecast', '0.3.0',
        'Forecasts of a series of the core: a method as data, each issue written as a forecast series with the time it was issued, and its accuracy against what was then measured.');

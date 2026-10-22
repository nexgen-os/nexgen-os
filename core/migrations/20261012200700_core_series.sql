-- Nexgen OS — core: series, their values, and the one way to write and read
-- them.
--
-- Values that change continuously — energy through a meter, temperature in a
-- room, production of a PV system, state of charge of a battery, a setpoint
-- sent to a heat pump — are series of values attached to an object. The
-- instrument is a device, the point is the series: a series says what is
-- observed (an object), which quantity (hence the unit), by which device,
-- read or asked, at which step; its values are the timestamped values. It
-- is a Datastream of OGC SensorThings (Thing = the object, Sensor = the
-- device), a Point of Brick and of Project Haystack, an entity of Home
-- Assistant.
--
-- Measured, simulated and forecast series share the same shape, so a page
-- compares them with one query: a simulated hourly profile is a series of
-- kind `simulated`; a series a run computed names that run in its source
-- (`<module>.runs:<id>`) and changes with nobody else's. There is one series store,
-- built for a hundred thousand meters (decision 0007): partitioned by week,
-- no per-row organisation, a two-byte quality.
--
-- The package, in the order of this file:
--
--   series, units                            what a series is, and its units
--   series_values, forecast_values           the values, in the quantity's
--                                            unit, with their quality code
--   series_rollups, series_latest            what the write path keeps beside
--                                            the values: hourly and daily
--                                            aggregates, refreshed by every
--                                            write, and the last value of
--                                            each series, a view
--   series_ensure(), store()                 the one way to write (0031)
--   resample(), window(), latest(), fill(),  the one family of reads, every
--   coverage(), forecast_at(), export_rows() one security definer with one
--                                            access check per series

set search_path = nexgen, public, extensions;

create table series (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- What is observed, by its kind and its id: a participant, a meter, a
  -- device, a project, an organisation.
  object_kind      text not null,
  object_id        uuid not null,
  quantity_code    text not null references quantities(code),
  -- The device that produces or receives the values: the thermometer, the
  -- inverter, the meter, the heat pump asked a setpoint. Null for a series
  -- computed by a model or read from a data hub with no device described.
  device_id        uuid references devices(id) on delete set null,
  name             text,
  -- measured: read from a device or a data hub; simulated: produced by a
  -- model; forecast: about the future; setpoint: a value asked of a device;
  -- command: an order sent to it (on, off, open, a scene).
  kind             text not null default 'measured',
  -- What one value means (the state classes of Home Assistant, the
  -- accumulation behaviour of Green Button): `interval` covers [at, at +
  -- step) — an energy over a quarter-hour, `at` being the start; `instant`
  -- is a reading at `at` — a power, a temperature; `cumulative` is an
  -- ever-rising register — a meter index, whose consumption is the
  -- difference between two values.
  value_kind       text not null default 'interval',
  -- Regular step of the series, null when irregular.
  step             interval,
  -- Where the values come from: a source of the vocabulary (a grid
  -- operator's hub, a device protocol, a model), and a free note. A run of
  -- a module names itself here, `<module>.runs:<run id>`: its values are
  -- the run's figures, written while it runs and never changed after.
  source_code      text references sources(code),
  source           text,
  -- How a connector finds the point: a Modbus register, an MQTT topic, a
  -- BACnet object, an API path, a Home Assistant entity.
  external_ref     text,
  -- What the source knows about the point beyond these columns (a Home
  -- Assistant entity's class, icon, original unit). Extensions only.
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  constraint series_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint series_kind check (kind in ('measured', 'simulated', 'forecast', 'setpoint', 'command')),
  -- A simulated series is a figure: the run that computed it, or the named
  -- source that published it (a typical year of a weather service).
  constraint series_run_required check (kind <> 'simulated' or source is not null or source_code is not null),
  constraint series_value_kind check (value_kind in ('interval', 'instant', 'cumulative')),
  constraint series_step_positive check (step is null or step > interval '0')
);

comment on table series is
  'One quantity over time for one object of the core, by one device when there is one — measured, simulated, forecast, asked or ordered (OGC SensorThings Datastream, Brick and Haystack point, Home Assistant entity). A run''s series name it in their source.';

-- One series per identity: two imports of the same meter find the same
-- series, two runs never share one.
create unique index series_identity on series
  (object_kind, object_id, quantity_code, kind, source_code, source, name) nulls not distinct;
create index series_quantity_idx on series (quantity_code);
create index series_device_idx on series (device_id);

create trigger series_attach
  before insert or update on series
  for each row execute function attach('object');

-- The device of a series is of the series' organisation.
create or replace function series_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  d devices%rowtype;
begin
  if new.device_id is null then
    return new;
  end if;
  select * into d from devices where id = new.device_id;
  if d.organisation_id <> new.organisation_id then
    raise exception 'device_in_other_organisation: %', new.device_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function series_check() is
  'BEFORE INSERT / UPDATE on series: the device is of the series'' organisation.';

create trigger series_check
  before insert or update of device_id, organisation_id on series
  for each row execute function series_check();

-- ---------------------------------------------------------------------------
-- Units.
-- ---------------------------------------------------------------------------

-- Units: how a value given in another unit reaches the unit of its quantity
-- (decision 0030). Each unit names its QUDT quantity kind and, as QUDT does,
-- the factor and offset that bring it to the SI unit of that kind:
-- si = value × factor + offset. Two units convert when their kinds are the
-- same. The rows are the core seed's; a module or a pack adds its own with
-- `published_by` set to its code.
create table units (
  code           text primary key,
  name           text not null,
  -- The common symbol a device or an API writes (kWh, °C, W/m²): what a
  -- format library looks a unit up by.
  symbol         text unique,
  quantity_kind  text not null,
  factor         double precision not null,
  "offset"       double precision not null default 0,
  published_by   text not null default 'core',
  constraint units_factor_positive check (factor > 0)
);

comment on table units is
  'Units by their QUDT code and symbol, with their QUDT quantity kind and the factor and offset to the SI unit of that kind. The one place a unit is converted (convert_unit(), store()).';

-- The unit a code or a symbol names; unit_unknown otherwise.
create or replace function unit_code(p_unit text)
returns text
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  c text;
begin
  select u.code into c from units u where u.code = p_unit;
  if c is null then
    select u.code into c from units u where u.symbol = p_unit;
  end if;
  if c is null then
    raise exception 'unit_unknown: % is not in the units vocabulary', p_unit using errcode = 'invalid_parameter_value';
  end if;
  return c;
end;
$$;

comment on function unit_code(text) is
  'The QUDT code of a unit given by its code or its symbol (kWh, °C). Refuses unit_unknown: a unit is never guessed from its spelling.';

create or replace function convert_unit(p_value double precision, p_from text, p_to text)
returns double precision
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  a units%rowtype;
  b units%rowtype;
begin
  select * into a from units where code = unit_code(p_from);
  select * into b from units where code = unit_code(p_to);
  if a.code = b.code then
    return p_value;
  end if;
  if a.quantity_kind <> b.quantity_kind then
    raise exception 'unit_incompatible: % measures %, % measures %', a.code, a.quantity_kind, b.code, b.quantity_kind
      using errcode = 'invalid_parameter_value';
  end if;
  return (p_value * a.factor + a."offset" - b."offset") / b.factor;
end;
$$;

comment on function convert_unit(double precision, text, text) is
  'A value converted from one unit to another, each named by its code or symbol, through the factor and offset of the units vocabulary. Refuses unit_unknown, unit_incompatible.';

-- ---------------------------------------------------------------------------
-- series_values — the hot table.
-- ---------------------------------------------------------------------------

create table series_values (
  series_id  uuid not null references series(id) on delete cascade,
  -- Start of the interval for an `interval` series; the instant otherwise.
  at         timestamptz not null,
  -- In the unit of the series' quantity, always. A missing value is NaN.
  value      double precision not null,
  -- One word per code, the same everywhere (decision 0007 and the files
  -- door of 0014 use these words): 0 measured, read as it was measured;
  -- 1 estimated, by the source or filled on read by fill(), never written
  -- by the core; 2 substituted after validation, by a run of a module;
  -- 3 missing, kept so that a gap is known and left out of every
  -- aggregate. Codes from 100 up are a pack's mapping of the flags of a
  -- national data hub; the core never reads them as more than "not
  -- missing".
  quality    smallint not null default 0,
  primary key (series_id, at),
  constraint series_values_quality check (quality in (0, 1, 2, 3) or quality >= 100)
) partition by range (at);

comment on table series_values is
  'Timestamped values of a series, in its quantity''s unit. Partitioned by week on `at`; the organisation is the series''. Written through store() only; an installation adds pg_partman for the partitions and pg_cron for the maintenance.';

-- Everything lands here until an installation creates weekly partitions
-- (`series_values_partition()` or pg_partman).
create table series_values_default partition of series_values default;

create index series_values_at_brin on series_values using brin (at) with (pages_per_range = 32);

-- A weekly partition, named by its Monday, for installations without
-- pg_partman. Its bounds are written in UTC, whatever the session's time
-- zone. Rows already in the default partition for that week move.
create or replace function series_values_partition(p_week date)
returns text
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  monday date := date_trunc('week', p_week)::date;
  name   text := format('series_values_%s', to_char(monday, 'IYYY_"w"IW'));
  lower  timestamptz := monday::timestamp at time zone 'UTC';
  upper  timestamptz := (monday + 7)::timestamp at time zone 'UTC';
begin
  if to_regclass(name) is not null then
    return name;
  end if;
  execute format('create table %I (like series_values including defaults including constraints)', name || '_new');
  execute format('insert into %I select * from series_values_default where at >= %L and at < %L', name || '_new', lower, upper);
  execute format('delete from series_values_default where at >= %L and at < %L', lower, upper);
  execute format('alter table series_values attach partition %I for values from (%L) to (%L)', name || '_new', lower, upper);
  execute format('alter table %I rename to %I', name || '_new', name);
  return name;
end;
$$;

comment on function series_values_partition(date) is
  'Creates the weekly partition holding a date, bounds in UTC, and moves the week''s rows out of the default partition. pg_partman does the same on a schedule.';

-- ---------------------------------------------------------------------------
-- forecast_values — a forecast is issued again and again.
-- ---------------------------------------------------------------------------

-- A forecast series keeps every issue: the value for 14:00 as issued at
-- 06:00, then as issued at 12:00. Pages read the latest issue; a study of
-- forecast accuracy, or of what was known when a decision was taken, reads
-- the issues known at a given time (`forecast_at()`). Measured, simulated
-- and setpoint series have one value per instant and live in series_values.
-- Small next to series_values: an installation partitions it the same way
-- when it needs to.
create table forecast_values (
  series_id  uuid not null references series(id) on delete cascade,
  at         timestamptz not null,
  -- When the forecast was made (the belief time of FlexMeasures).
  issued_at  timestamptz not null,
  value      double precision not null,
  primary key (series_id, at, issued_at)
);

comment on table forecast_values is
  'Every issue of a forecast series: one row per instant and issue time, in the quantity''s unit. The latest issue is what a page shows; earlier issues are what an accuracy study reads (forecast_at()).';

create index forecast_values_at_brin on forecast_values using brin (at) with (pages_per_range = 32);
create index forecast_values_issued_brin on forecast_values using brin (issued_at) with (pages_per_range = 32);

-- Each kind of series has its one store: a forecast goes to forecast_values
-- with its issue time, everything else to series_values. The values of a
-- run's series are written while the run runs, and never after. store()
-- checks the same before it writes and says so in `nexgen.store_series`,
-- so that a bulk write pays no lookup per row.
create or replace function series_store_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  sid  uuid := case when tg_op = 'DELETE' then old.series_id else new.series_id end;
  k    text;
  rs   text;
begin
  if tg_op <> 'DELETE' and current_setting('nexgen.store_series', true) = sid::text then
    return new;
  end if;
  select se.kind, run_status_of(se.source) into k, rs from series se where se.id = sid;
  if not found then
    -- The series itself is being deleted: its values go with it.
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if rs is not null and rs <> 'running' then
    raise exception 'run_is_final: series % belongs to a finished run', sid using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_table_name = 'forecast_values' and k <> 'forecast' then
    raise exception 'not_a_forecast: series % is %, its values go to series_values', sid, k using errcode = 'check_violation';
  elsif tg_table_name <> 'forecast_values' and k = 'forecast' then
    raise exception 'forecast_values_required: series % is a forecast, its values go to forecast_values with their issue time', sid using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function series_store_check() is
  'Trigger of series_values and forecast_values: each kind of series in its one store (forecast_values_required, not_a_forecast), and the values of a finished run''s series never change (run_is_final).';

create trigger series_values_store before insert or update or delete on series_values
  for each row execute function series_store_check();
create trigger forecast_values_store before insert or update or delete on forecast_values
  for each row execute function series_store_check();

-- ---------------------------------------------------------------------------
-- What the write path keeps beside the values.
-- ---------------------------------------------------------------------------

-- Hourly and daily aggregates of a series, derived from its values and
-- rebuilt from them by every write (decision 0031): the hour in UTC, the day in the time
-- zone of its participant (a series with none has hours only). Months and years are
-- summed from days. The columns are what every read needs: the count of
-- readings, their sum, extremes and last value, and for a cumulative
-- register the consumption of the bucket and the count of increments.
create table series_rollups (
  series_id   uuid not null references series(id) on delete cascade,
  step        text not null,
  bucket      timestamptz not null,
  samples     integer not null,
  total       double precision,
  minimum     double precision,
  maximum     double precision,
  last_value  double precision,
  delta       double precision,
  increments  integer not null default 0,
  quality     smallint not null default 0,
  primary key (series_id, step, bucket),
  constraint series_rollups_step check (step in ('hour', 'day'))
);

comment on table series_rollups is
  'Hourly (UTC) and daily (participant time zone) aggregates of a series, refreshed by every write of its values; read by resample() when the step allows. Derived, never edited.';

-- The last stored value of each series that is not missing: a live tile
-- reads one row, found at the end of the series' primary key.
create view series_latest with (security_invoker = true) as
  select s.id as series_id, l.at, l.value, l.quality
    from series s
    cross join lateral (
      select v.at, v.value, v.quality from series_values v
       where v.series_id = s.id and v.quality <> 3
       order by v.at desc limit 1) l;

comment on view series_latest is
  'The latest value that is not missing, one row per series that has one; read under the policies of series and series_values.';

-- ---------------------------------------------------------------------------
-- Access and buckets: the helpers every read shares.
-- ---------------------------------------------------------------------------

-- The role that called: the one a `set role` chose (PostgREST's
-- authenticated, service_role), else the login role. A security definer
-- function runs as its owner but keeps this setting.
create or replace function caller_bypasses_rls()
returns boolean
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select coalesce((select r.rolsuper or r.rolbypassrls from pg_roles r
                    where r.rolname = coalesce(nullif(current_setting('role', true), 'none'), session_user)), false);
$$;

comment on function caller_bypasses_rls() is
  'True when the calling role bypasses row level security (a superuser, service_role): the one case where a read function skips the organisation check.';

-- The series a caller may read, else series_not_found: a role without a
-- signed-in user reads nothing unless it bypasses row level security.
create or replace function series_for_read(p_series_id uuid)
returns series
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s series%rowtype;
begin
  select * into s from series where id = p_series_id;
  if not found or not (caller_bypasses_rls() or can_read_organisation(s.organisation_id)) then
    raise exception 'series_not_found: %', p_series_id using errcode = 'no_data_found';
  end if;
  return s;
end;
$$;

comment on function series_for_read(uuid) is
  'The series when the caller may read it (a member of its organisation, or a role that bypasses row level security); series_not_found otherwise.';

-- The time zone a series is read in for steps of a day or more: the one of
-- the participant its object belongs to. Null when there is none; never a
-- default.
create or replace function series_time_zone(p_series_id uuid)
returns text
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select p.time_zone
    from series se
    join participants p on p.id = participant_of(se.object_kind, se.object_id)
   where se.id = p_series_id;
$$;

comment on function series_time_zone(uuid) is
  'The time zone of the participant a series'' object belongs to; null when there is none, never a default.';

-- A step is a duration under a day (bins of absolute time), a whole number
-- of days, or a whole number of months (calendar bins in a time zone).
-- Anything else — `1 day 2 hours`, `1 month 3 days` — is refused.
create or replace function series_step_shape(p_step interval)
returns text
language plpgsql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  months  numeric := extract(year from p_step) * 12 + extract(month from p_step);
  days    numeric := extract(day from p_step);
  seconds numeric := extract(hour from p_step) * 3600 + extract(minute from p_step) * 60 + extract(second from p_step);
begin
  if p_step is null or p_step <= interval '0' then
    raise exception 'step_unsupported: a step is a positive duration' using errcode = 'invalid_parameter_value';
  elsif months = 0 and days = 0 then
    return 'time';
  elsif months = 0 and seconds = 0 and days > 0 then
    return 'days';
  elsif days = 0 and seconds = 0 and months > 0 then
    return 'months';
  end if;
  raise exception 'step_unsupported: % mixes calendar units; give a duration under a day, a number of days or a number of months', p_step
    using errcode = 'invalid_parameter_value';
end;
$$;

comment on function series_step_shape(interval) is
  'time (under a day, binned in absolute time), days or months (calendar bins in a time zone); refuses step_unsupported.';

-- The start of the bucket an instant falls in. Durations bin from
-- `p_origin`; days and months count from the local day or month of
-- `p_origin` in the time zone.
create or replace function series_bucket(p_at timestamptz, p_step interval, p_origin timestamptz, p_time_zone text)
returns timestamptz
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select case
    when extract(year from p_step) = 0 and extract(month from p_step) = 0 and extract(day from p_step) = 0 then
      date_bin(p_step, p_at, p_origin)
    when extract(year from p_step) = 0 and extract(month from p_step) = 0 then
      ((p_origin at time zone p_time_zone)::date
        + (((p_at at time zone p_time_zone)::date - (p_origin at time zone p_time_zone)::date)
           / extract(day from p_step)::int) * extract(day from p_step)::int
      )::timestamp at time zone p_time_zone
    else
      (date_trunc('month', p_origin at time zone p_time_zone)
        + make_interval(months =>
            (((extract(year from p_at at time zone p_time_zone) * 12 + extract(month from p_at at time zone p_time_zone))
              - (extract(year from p_origin at time zone p_time_zone) * 12 + extract(month from p_origin at time zone p_time_zone)))::int
             / (extract(year from p_step) * 12 + extract(month from p_step))::int)
            * (extract(year from p_step) * 12 + extract(month from p_step))::int)
      ) at time zone p_time_zone
  end;
$$;

comment on function series_bucket(timestamptz, interval, timestamptz, text) is
  'The start of the bucket of an instant: date_bin from the origin for a duration, local days or months counted from the origin''s for a calendar step.';

-- The origin buckets count from: the local midnight of `p_from` (UTC
-- midnight without a time zone), so that hours and quarter-hours fall on
-- the participant's own clock, half-hour time zones included.
create or replace function series_origin(p_from timestamptz, p_time_zone text)
returns timestamptz
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select date_trunc('day', p_from at time zone coalesce(p_time_zone, 'UTC')) at time zone coalesce(p_time_zone, 'UTC');
$$;

comment on function series_origin(timestamptz, text) is
  'The local midnight of an instant in a time zone (UTC when none): the origin of a read''s buckets.';

-- Every bucket start of a read, whether it holds values or not.
create or replace function series_bucket_starts(p_from timestamptz, p_to timestamptz, p_step interval, p_time_zone text)
returns setof timestamptz
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select b from (
    select g as b
      from generate_series(series_bucket(p_from, p_step, series_origin(p_from, p_time_zone), p_time_zone), p_to, p_step) g
     where extract(year from p_step) = 0 and extract(month from p_step) = 0 and extract(day from p_step) = 0
    union all
    select g at time zone p_time_zone
      from generate_series(series_bucket(p_from, p_step, series_origin(p_from, p_time_zone), p_time_zone) at time zone p_time_zone,
                           p_to at time zone p_time_zone, p_step) g
     where not (extract(year from p_step) = 0 and extract(month from p_step) = 0 and extract(day from p_step) = 0)
  ) starts
  where b < p_to
  order by b;
$$;

comment on function series_bucket_starts(timestamptz, timestamptz, interval, text) is
  'The start of every bucket of a step between two instants, in the time zone for a calendar step.';

-- The values a read sees: the stored values of a series, or the latest
-- issue of a forecast (issued before `p_issued_before` when given).
create or replace function series_points(p_series series, p_from timestamptz, p_to timestamptz, p_issued_before timestamptz default null)
returns table (at timestamptz, value double precision, quality smallint)
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select v.at, v.value, v.quality from series_values v
   where p_series.kind <> 'forecast' and v.series_id = p_series.id and v.at >= p_from and v.at < p_to
  union all
  select l.at, l.value, 0::smallint from (
    select distinct on (f.at) f.at, f.value from forecast_values f
     where p_series.kind = 'forecast' and f.series_id = p_series.id and f.at >= p_from and f.at < p_to
       and (p_issued_before is null or f.issued_at < p_issued_before)
     order by f.at, f.issued_at desc) l
  order by 1;
$$;

comment on function series_points(series, timestamptz, timestamptz, timestamptz) is
  'The values of a series between two instants in time order: stored values, or a forecast''s latest issue (before p_issued_before).';

-- The aggregates of each bucket, from the values. Missing values are left
-- out. A cumulative register counts the increment from each reading to the
-- next in the bucket of the earlier one — the consumption over that
-- interval — reading one value past `p_to` to close the last bucket; an
-- index that falls back is a reset, and the increment is the new index.
-- The one computation behind resample() and series_rollup_hours().
create or replace function series_buckets(
  p_series        series,
  p_from          timestamptz,
  p_to            timestamptz,
  p_step          interval,
  p_time_zone     text,
  p_origin        timestamptz,
  p_issued_before timestamptz default null
)
returns table (bucket timestamptz, samples integer, total double precision, minimum double precision, maximum double precision,
               last_value double precision, delta double precision, increments integer, quality smallint)
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with readings as (
    select p.at, p.value, p.quality from series_points(p_series, p_from, p_to, p_issued_before) p where p.quality <> 3
    union all
    select n.at, n.value, n.quality from (
      select v.at, v.value, v.quality from series_values v
       where p_series.value_kind = 'cumulative' and v.series_id = p_series.id and v.at >= p_to and v.quality <> 3
       order by v.at limit 1) n
  ), steps as (
    select r.at, r.value, r.quality, lead(r.value) over (order by r.at) next_value from readings r
  )
  select series_bucket(s.at, p_step, p_origin, p_time_zone) b,
         count(*)::int,
         sum(s.value), min(s.value), max(s.value),
         (array_agg(s.value order by s.at desc))[1],
         sum(case when s.next_value is null then null
                  when s.next_value >= s.value then s.next_value - s.value
                  else s.next_value end),
         count(s.next_value)::int,
         max(s.quality)::smallint
    from steps s
   where s.at < p_to
   group by 1
   order by 1;
$$;

comment on function series_buckets(series, timestamptz, timestamptz, interval, text, timestamptz, timestamptz) is
  'Per bucket: readings, sum, minimum, maximum, last value, and for a cumulative register its consumption (resets handled) and count of increments. Missing values left out.';

-- ---------------------------------------------------------------------------
-- Reading series.
-- ---------------------------------------------------------------------------

-- The one way series are read: resampled on a regular step, the amount of
-- each bucket. Its value is combined the way the quantity says (sum, mean
-- or last); a cumulative register gives what was consumed or produced in
-- the bucket. Durations bin from the local midnight of `p_from`; a day or
-- more is cut in the participant's time zone (or the one given), counted from the
-- local day or month of `p_from`. A forecast gives its latest issue, or the
-- latest issued before `p_issued_before`. Hourly and daily rollups are read
-- instead of the values when the bucket is made of whole rollups; the
-- figures are the same either way. `expected` is the
-- count of values a regular series should have in the bucket, `quality`
-- the worst code among those it has.
create or replace function resample(
  p_series_id     uuid,
  p_from          timestamptz,
  p_to            timestamptz,
  p_step          interval,
  p_time_zone     text default null,
  p_issued_before timestamptz default null
)
returns table (bucket timestamptz, value double precision, samples int, expected int, quality smallint)
language plpgsql
stable
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s       series%rowtype := series_for_read(p_series_id);
  agg     text;
  shape   text := series_step_shape(p_step);
  own_tz  text := series_time_zone(p_series_id);
  tz      text := coalesce(p_time_zone, own_tz);
  origin  timestamptz;
  rollup  text;
  per     double precision;
begin
  select q.aggregation into agg from quantities q where q.code = s.quantity_code;
  if shape <> 'time' and tz is null then
    raise exception 'time_zone_required: a step of a day or more needs the participant''s time zone' using errcode = 'invalid_parameter_value';
  end if;
  origin := series_origin(p_from, tz);
  -- Seconds of one value of a regular series, for `expected`.
  if s.step is not null and series_step_shape(s.step) = 'time' then
    per := extract(epoch from s.step);
  end if;

  if s.kind <> 'forecast' and p_issued_before is null then
    if shape = 'time' and extract(epoch from p_step)::numeric % 3600 = 0
       and extract(epoch from origin)::numeric % 3600 = 0
       and extract(epoch from p_from)::numeric % 3600 = 0 and extract(epoch from p_to)::numeric % 3600 = 0 then
      rollup := 'hour';
    elsif shape <> 'time' and tz = own_tz
       and p_from = date_trunc('day', p_from, tz) and p_to = date_trunc('day', p_to, tz) then
      rollup := 'day';
    end if;
    if rollup is not null
       and not exists (select 1 from series_rollups r where r.series_id = s.id and r.step = rollup and r.bucket >= p_from and r.bucket < p_to) then
      rollup := null;
    end if;
  end if;

  return query
    with parts as (
      select r.bucket, r.samples, r.total, r.minimum, r.maximum, r.last_value, r.delta, r.increments, r.quality
        from series_rollups r
       where rollup is not null and r.series_id = s.id and r.step = rollup and r.bucket >= p_from and r.bucket < p_to
      union all
      select b.bucket, b.samples, b.total, b.minimum, b.maximum, b.last_value, b.delta, b.increments, b.quality
        from series_buckets(s, p_from, p_to, p_step, tz, origin, p_issued_before) b
       where rollup is null
    ), buckets as (
      select series_bucket(p.bucket, p_step, origin, tz) b,
             sum(p.samples)::int n,
             sum(p.total) total,
             (array_agg(p.last_value order by p.bucket desc))[1] last_value,
             sum(p.delta) delta,
             sum(p.increments)::int increments,
             max(p.quality)::smallint quality
        from parts p
       group by 1
    )
    select x.b,
           case
             when s.value_kind = 'cumulative' then x.delta
             when agg = 'sum'  then x.total
             when agg = 'mean' then x.total / x.n
             else x.last_value
           end,
           case when s.value_kind = 'cumulative' then x.increments else x.n end,
           case when per is null then null
                else floor(extract(epoch from
                       least(p_to, case when shape = 'time' then x.b + p_step else ((x.b at time zone tz) + p_step) at time zone tz end)
                       - greatest(p_from, x.b)) / per)::int
           end,
           x.quality
      from buckets x
     where s.value_kind <> 'cumulative' or x.increments > 0
     order by 1;
end;
$$;

comment on function resample(uuid, timestamptz, timestamptz, interval, text, timestamptz) is
  'A series on a regular step, the amount of each bucket: combined by its quantity''s aggregation, the consumption of the bucket for a cumulative register (resets handled). Durations bin from local midnight; days and months cut in the participant''s time zone. Reads hourly and daily rollups when they cover the buckets. Returns samples, expected (regular series) and the worst quality. Refuses series_not_found, time_zone_required, step_unsupported.';

-- The values themselves, in time order: the only read without aggregation,
-- and the way an index of a cumulative register is read.
create or replace function "window"(p_series_id uuid, p_from timestamptz, p_to timestamptz, p_limit integer default 100000)
returns table (at timestamptz, value double precision, quality smallint)
language plpgsql
stable
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s series%rowtype := series_for_read(p_series_id);
begin
  return query select p.at, p.value, p.quality from series_points(s, p_from, p_to) p order by p.at limit p_limit;
end;
$$;

comment on function "window"(uuid, timestamptz, timestamptz, integer) is
  'The stored values of a series between two instants, in time order, at most p_limit (a forecast: its latest issue). Call it as nexgen.window(): window is a reserved word. Refuses series_not_found.';

create or replace function latest(p_series_ids uuid[])
returns table (series_id uuid, at timestamptz, value double precision, quality smallint)
language plpgsql
stable
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  perform series_for_read(i) from unnest(p_series_ids) i;
  return query select l.series_id, l.at, l.value, l.quality from series_latest l where l.series_id = any (p_series_ids) order by 1;
end;
$$;

comment on function latest(uuid[]) is
  'The latest value that is not missing of each series, from the view series_latest: one row per series that has one. Refuses series_not_found.';

-- The gaps of a regular series: the instants its step expects and that
-- hold no value, or a missing one, grouped in runs.
create or replace function coverage(p_series_id uuid, p_from timestamptz, p_to timestamptz)
returns table (gap_from timestamptz, gap_to timestamptz, missing int)
language plpgsql
stable
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s series%rowtype := series_for_read(p_series_id);
begin
  if s.step is null then
    raise exception 'series_step_required: series % is irregular, its gaps are not defined', p_series_id using errcode = 'invalid_parameter_value';
  end if;
  if series_step_shape(s.step) <> 'time' then
    raise exception 'step_unsupported: coverage() reads series of a step under a day' using errcode = 'invalid_parameter_value';
  end if;
  return query
    with present as (
      select series_bucket(p.at, s.step, series_origin(p_from, null), null) at
        from series_points(s, p_from, p_to) p where p.quality <> 3
      union
      select series_bucket(p_from, s.step, series_origin(p_from, null), null) - s.step
      union
      select p_to
    ), runs as (
      select pr.at + s.step g_from, lead(pr.at) over (order by pr.at) g_to from present pr
    )
    select greatest(r.g_from, p_from), r.g_to, (extract(epoch from r.g_to - greatest(r.g_from, p_from)) / extract(epoch from s.step))::int
      from runs r
     where r.g_to is not null and r.g_to > greatest(r.g_from, p_from)
     order by 1;
end;
$$;

comment on function coverage(uuid, timestamptz, timestamptz) is
  'The gaps of a regular series between two instants: each run of expected values that are absent or missing, with its bounds and its count. Refuses series_not_found, series_step_required, step_unsupported.';

-- A read with its gaps filled, on the fly (decision 0031): every bucket of
-- the period, those with no value filled by the method and flagged
-- estimated (1). Nothing is written; a substitute value that must be
-- stored is a run of a module, with its method.
--
--   none      empty buckets stay null, flagged missing (3)
--   zero      0
--   previous  the value of the last bucket before that has one
--   linear    between the buckets on each side, by position
create or replace function fill(
  p_series_id  uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_step       interval,
  p_method     text default 'linear',
  p_time_zone  text default null
)
returns table (bucket timestamptz, value double precision, quality smallint, samples int, expected int)
language plpgsql
stable
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s    series%rowtype := series_for_read(p_series_id);
  tz   text := coalesce(p_time_zone, series_time_zone(p_series_id));
  per  double precision;
begin
  if s.step is not null and series_step_shape(s.step) = 'time' then
    per := extract(epoch from s.step);
  end if;
  if p_method not in ('none', 'zero', 'previous', 'linear') then
    raise exception 'fill_method_unknown: % (none, zero, previous, linear)', p_method using errcode = 'invalid_parameter_value';
  end if;
  return query
    with r as (
      select * from resample(p_series_id, p_from, p_to, p_step, p_time_zone)
    ), grid as (
      select g.b, row_number() over (order by g.b) i, r.value v, r.samples n, r.expected e, r.quality q
        from series_bucket_starts(p_from, p_to, p_step, tz) g(b)
        left join r on r.bucket = g.b
    ), sides as (
      select grid.*,
             count(grid.v) over (order by grid.i) before_group,
             count(grid.v) over (order by grid.i desc) after_group
        from grid
    ), known as (
      select sides.*,
             first_value(sides.v) over (partition by sides.before_group order by sides.i) prev_v,
             first_value(sides.i) over (partition by sides.before_group order by sides.i) prev_i,
             first_value(sides.v) over (partition by sides.after_group order by sides.i desc) next_v,
             first_value(sides.i) over (partition by sides.after_group order by sides.i desc) next_i
        from sides
    )
    select k.b,
           case
             when k.v is not null then k.v
             when p_method = 'zero' then 0::double precision
             when p_method = 'previous' and k.before_group > 0 then k.prev_v
             when p_method = 'linear' and k.before_group > 0 and k.next_v is not null and k.next_i > k.i then
               k.prev_v + (k.next_v - k.prev_v) * (k.i - k.prev_i)::double precision / (k.next_i - k.prev_i)
           end,
           case
             when k.v is not null then k.q
             when p_method = 'zero' or (p_method = 'previous' and k.before_group > 0)
                  or (p_method = 'linear' and k.before_group > 0 and k.next_v is not null and k.next_i > k.i) then 1::smallint
             else 3::smallint
           end,
           coalesce(k.n, 0),
           coalesce(k.e, case when per is not null then
             floor(extract(epoch from
               least(p_to, case when series_step_shape(p_step) = 'time' then k.b + p_step else ((k.b at time zone tz) + p_step) at time zone tz end)
               - greatest(p_from, k.b)) / per)::int end)
      from known k
     order by k.b;
end;
$$;

comment on function fill(uuid, timestamptz, timestamptz, interval, text, text) is
  'resample() on every bucket of the period, empty buckets filled on the fly (none, zero, previous, linear) and flagged estimated, or missing when they cannot be filled. Writes nothing. Refuses fill_method_unknown and what resample() refuses.';

-- A forecast as it was known: at `p_as_of`, the latest issue made by then;
-- with `p_horizon`, for each instant the latest issue made at least that
-- long before it (the day-ahead view of a 24-hour horizon); with neither,
-- the latest issue.
create or replace function forecast_at(
  p_series_id uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_as_of     timestamptz default null,
  p_horizon   interval default null
)
returns table (at timestamptz, value double precision, issued_at timestamptz)
language plpgsql
stable
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s series%rowtype := series_for_read(p_series_id);
begin
  if s.kind <> 'forecast' then
    raise exception 'not_a_forecast: series % is %', p_series_id, s.kind using errcode = 'invalid_parameter_value';
  end if;
  if p_as_of is not null and p_horizon is not null then
    raise exception 'as_of_or_horizon: a forecast is read as known at a time, or at a horizon, not both' using errcode = 'invalid_parameter_value';
  end if;
  return query
    select distinct on (f.at) f.at, f.value, f.issued_at
      from forecast_values f
     where f.series_id = s.id and f.at >= p_from and f.at < p_to
       and (p_as_of is null or f.issued_at <= p_as_of)
       and (p_horizon is null or f.issued_at <= f.at - p_horizon)
     order by f.at, f.issued_at desc;
end;
$$;

comment on function forecast_at(uuid, timestamptz, timestamptz, timestamptz, interval) is
  'A forecast between two instants as known at p_as_of, or issued at least p_horizon before each instant, or its latest issue; each value with its issue time. Refuses series_not_found, not_a_forecast, as_of_or_horizon.';

-- The rows of the files door (decision 0014): series, instant in UTC,
-- value, quality, sorted by series and time. packages/formats/parquet writes them
-- as a Parquet file.
create or replace function export_rows(p_series_ids uuid[], p_from timestamptz, p_to timestamptz)
returns table (series_id uuid, at timestamptz, value double precision, quality smallint)
language plpgsql
stable
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  i uuid;
  s series%rowtype;
begin
  for i in select distinct u from unnest(p_series_ids) u order by 1 loop
    s := series_for_read(i);
    return query select s.id, p.at, p.value, p.quality from series_points(s, p_from, p_to) p order by p.at;
  end loop;
end;
$$;

comment on function export_rows(uuid[], timestamptz, timestamptz) is
  'The values of several series between two instants as the rows of the files door — series, instant, value, quality — sorted by series and time. Refuses series_not_found.';

-- ---------------------------------------------------------------------------
-- Writing series: one way to open a series, one way to write its values.
-- ---------------------------------------------------------------------------

-- The series of an identity — object, quantity, kind, source, name —
-- found or created once. A second writer with the same identity
-- finds the first one's series, never a twin; one that says another value
-- kind or another step is refused.
create or replace function series_ensure(
  p_object_kind   text,
  p_object_id     uuid,
  p_quantity_code text,
  p_kind          text default 'measured',
  p_value_kind    text default 'interval',
  p_step          interval default null,
  p_device_id     uuid default null,
  p_external_ref  text default null,
  p_source_code   text default null,
  p_name          text default null,
  p_metadata      jsonb default '{}',
  p_source        text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s series%rowtype;
begin
  if not exists (select 1 from quantities where code = p_quantity_code) then
    raise exception 'quantity_unknown: %', p_quantity_code using errcode = 'foreign_key_violation';
  end if;
  if p_kind = 'simulated' and p_source is null and p_source_code is null then
    raise exception 'series_run_required: a simulated series is written by a run, or comes from a named source' using errcode = 'check_violation';
  end if;
  insert into series (object_kind, object_id, quantity_code, kind, value_kind, step, device_id, external_ref, source_code, name,
                      metadata, source)
  values (p_object_kind, p_object_id, p_quantity_code, p_kind, p_value_kind, p_step, p_device_id, p_external_ref, p_source_code, p_name,
          coalesce(p_metadata, '{}'), p_source)
  on conflict (object_kind, object_id, quantity_code, kind, source_code, source, name) do nothing;
  select * into s from series
   where object_kind = p_object_kind and object_id = p_object_id and quantity_code = p_quantity_code and kind = p_kind
     and source_code is not distinct from p_source_code and source is not distinct from p_source
     and name is not distinct from p_name;
  if not found then
    raise exception 'series_not_found: the series of % % and quantity % is not readable', p_object_kind, p_object_id, p_quantity_code using errcode = 'no_data_found';
  end if;
  if s.value_kind <> p_value_kind then
    raise exception 'series_value_kind_mismatch: the series % holds % values, not %', s.id, s.value_kind, p_value_kind
      using errcode = 'check_violation';
  end if;
  if s.step is distinct from p_step then
    raise exception 'series_step_mismatch: the series % has a step of %, not %',
      s.id, coalesce(s.step::text, 'irregular'), coalesce(p_step::text, 'irregular') using errcode = 'check_violation';
  end if;
  return s.id;
end;
$$;

comment on function series_ensure(text, uuid, text, text, text, interval, uuid, text, text, text, jsonb, text) is
  'The series of an identity (object by its kind and id, quantity, kind, source code, source, name), found or created once, with the device that produces it and where a connector finds it. Refuses quantity_unknown, series_run_required, series_value_kind_mismatch, series_step_mismatch. Returns its id.';

-- The one way values are written (decision 0031). The series is named by
-- its id, or by its identity in `p_series` — the keys of series_ensure():
--
--   { "object_kind": "meter", "object_id": "…", "quantity_code": "offtake_energy", "kind": "measured",
--     "source_code": "…", "value_kind": "interval", "step": "15 minutes",
--     "name": null, "source": null, "device_id": null,
--     "external_ref": null, "metadata": {} }
--
-- Values come in the unit `p_unit` names (the quantity's when null) and are
-- converted to the quantity's unit; a null value is stored missing; a
-- quality is a code of series_values.quality (0 measured when none). A value
-- equal to the one stored is not rewritten, so that importing the same file
-- twice changes nothing. A regular series refuses an instant off its step.
-- A forecast's values are stored with their issue time, and an issue
-- already stored is kept. The hourly and daily rollups of the hours written
-- are computed again by the trigger of series_values.
create or replace function store(
  p_series_id uuid,
  p_at        timestamptz[],
  p_value     float8[],
  p_quality   smallint[] default null,
  p_unit      text default null,
  p_issued_at timestamptz default null,
  p_series    jsonb default null,
  out series_id uuid,
  out changed   integer
)
language plpgsql
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  s        series%rowtype;
  q        quantities%rowtype;
  org      uuid;
  f_from   units%rowtype;
  f_to     units%rowtype;
  converting boolean := false;
  anchor   timestamptz;
  removed  date;
  tz       text;
  status   text;
begin
  -- The series: by id, or ensured from its identity.
  if p_series_id is null then
    if p_series is null or p_series->>'object_kind' is null or p_series->>'object_id' is null or p_series->>'quantity_code' is null then
      raise exception 'series_required: name a series by its id, or by its object (kind and id) and quantity' using errcode = 'invalid_parameter_value';
    end if;
    org := object_organisation(p_series->>'object_kind', (p_series->>'object_id')::uuid);
    if not (caller_bypasses_rls() or can_write_organisation(org)) then
      raise exception 'object_not_found: %', p_series->>'object_id' using errcode = 'no_data_found';
    end if;
    p_series_id := series_ensure(
      p_series->>'object_kind', (p_series->>'object_id')::uuid, p_series->>'quantity_code', coalesce(p_series->>'kind', 'measured'),
      coalesce(p_series->>'value_kind', 'interval'), (p_series->>'step')::interval, (p_series->>'device_id')::uuid,
      p_series->>'external_ref', p_series->>'source_code', p_series->>'name',
      coalesce(p_series->'metadata', '{}'::jsonb), p_series->>'source');
  end if;
  select * into s from series se where se.id = p_series_id;
  if not found or not (caller_bypasses_rls() or can_read_organisation(s.organisation_id)) then
    raise exception 'series_not_found: %', p_series_id using errcode = 'no_data_found';
  end if;
  if not (caller_bypasses_rls() or can_write_organisation(s.organisation_id)) then
    raise exception 'series_read_only: the caller reads series % but does not write its organisation', p_series_id using errcode = 'insufficient_privilege';
  end if;
  series_id := s.id;
  changed := 0;
  if s.kind = 'forecast' and p_issued_at is null then
    raise exception 'issued_at_required: a forecast is stored with the time it was issued' using errcode = 'invalid_parameter_value';
  end if;

  -- The values: aligned, dated once each.
  if coalesce(cardinality(p_at), 0) <> coalesce(cardinality(p_value), 0)
     or (p_quality is not null and cardinality(p_quality) <> coalesce(cardinality(p_at), 0)) then
    raise exception 'values_misaligned: as many instants, values and qualities' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(cardinality(p_at), 0) = 0 then
    return;
  end if;
  if exists (select 1 from unnest(p_at) a where a is null) then
    raise exception 'instant_required: every value is dated' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(distinct a) from unnest(p_at) a) <> cardinality(p_at) then
    raise exception 'values_duplicated: an instant is given twice in one write' using errcode = 'invalid_parameter_value';
  end if;
  if p_quality is not null and exists (
       select 1 from unnest(p_quality) c where c is not null and not (c in (0, 1, 2, 3) or c >= 100)) then
    raise exception 'quality_unknown: a quality is 0 measured, 1 estimated, 2 substituted, 3 missing, or a pack''s code from 100 up' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(p_value, coalesce(p_quality, array_fill(null::smallint, array[cardinality(p_at)]))) v(value, quality)
              where v.value is null and coalesce(v.quality, 0) <> 3) then
    raise exception 'value_required: a value is given, or its quality says missing (3)' using errcode = 'invalid_parameter_value';
  end if;

  -- The run: a run's series is written while the run runs.
  status := run_status_of(s.source);
  if status is not null and status <> 'running' then
    raise exception 'run_is_final: series % belongs to a finished run', s.id using errcode = 'check_violation';
  end if;
  if s.kind = 'simulated' and s.source is null and s.source_code is null then
    raise exception 'series_run_required: a simulated series is written by a run, or comes from a named source' using errcode = 'check_violation';
  end if;

  -- The unit: converted on the way in, refused when it measures something else.
  select * into q from quantities where code = s.quantity_code;
  if p_unit is not null and unit_code(p_unit) <> q.unit then
    select * into f_from from units where code = unit_code(p_unit);
    select * into f_to from units where code = q.unit;
    if f_to.code is null or f_from.quantity_kind <> f_to.quantity_kind then
      raise exception 'series_unit_mismatch: % is not a unit of % (stored in %)', p_unit, q.code, q.unit using errcode = 'check_violation';
    end if;
    converting := true;
  end if;

  -- The step: a regular series takes instants on its grid only.
  if s.step is not null and series_step_shape(s.step) = 'time' then
    select v.at into anchor from series_values v where v.series_id = s.id order by v.at desc limit 1;
    anchor := coalesce(anchor, (select min(a) from unnest(p_at) a));
    if exists (select 1 from unnest(p_at) a where (extract(epoch from a - anchor)::numeric % extract(epoch from s.step)::numeric) <> 0) then
      raise exception 'series_step_mismatch: series % takes a value every %; an instant falls between', s.id, s.step using errcode = 'check_violation';
    end if;
  end if;

  -- The device: a series whose device was removed takes no value after the removal day.
  if s.device_id is not null then
    select d.removal_date into removed from devices d where d.id = s.device_id;
    if removed is not null then
      tz := coalesce(series_time_zone(s.id), 'UTC');
      if exists (select 1 from unnest(p_at) a where (a at time zone tz)::date > removed) then
        raise exception 'device_retired: the device of series % was removed on %', s.id, removed using errcode = 'check_violation';
      end if;
    end if;
  end if;

  perform set_config('nexgen.store_series', s.id::text, true);

  if s.kind = 'forecast' then
    insert into forecast_values (series_id, at, issued_at, value)
    select s.id, v.at, p_issued_at,
           case when converting then (v.value * f_from.factor + f_from."offset" - f_to."offset") / f_to.factor else v.value end
      from unnest(p_at, p_value) as v(at, value)
     where v.value is not null
     order by v.at
    on conflict do nothing;
    get diagnostics changed = row_count;
    perform set_config('nexgen.store_series', '', true);
    return;
  end if;
  if p_issued_at is not null then
    raise exception 'not_a_forecast: series % is %, its values have no issue time', s.id, s.kind using errcode = 'invalid_parameter_value';
  end if;

  insert into series_values as sv (series_id, at, value, quality)
  select s.id, v.at,
         case when v.value is null then 'NaN'::float8
              when converting then (v.value * f_from.factor + f_from."offset" - f_to."offset") / f_to.factor
              else v.value end,
         case when v.value is null then 3 else coalesce(v.quality, 0) end
    from unnest(p_at, p_value, coalesce(p_quality, array_fill(null::smallint, array[cardinality(p_at)]))) as v(at, value, quality)
   order by v.at
  on conflict (series_id, at) do update set value = excluded.value, quality = excluded.quality
   where (sv.value, sv.quality) is distinct from (excluded.value, excluded.quality);
  get diagnostics changed = row_count;

  perform set_config('nexgen.store_series', '', true);
end;
$$;

comment on function store(uuid, timestamptz[], float8[], smallint[], text, timestamptz, jsonb) is
  'The one way values are written: the series by id or by identity (series_ensure()), values converted from p_unit to the quantity''s unit, qualities checked, a forecast stored with its issue time, equal values left untouched, the rollups of the hours written refreshed. Refuses series_required, object_not_found, series_not_found, series_read_only, values_misaligned, instant_required, values_duplicated, quality_unknown, value_required, run_is_final, series_run_required, unit_unknown, series_unit_mismatch, series_step_mismatch, device_retired, issued_at_required, not_a_forecast. Returns the series and the rows changed.';

-- ---------------------------------------------------------------------------
-- The rollups, refreshed by every write.
-- ---------------------------------------------------------------------------

-- The hourly rollups of the hours given, and the daily rollups of the
-- local days they fall in, computed again from the values.
create or replace function series_rollup_hours(p_series_id uuid, p_hours timestamptz[])
returns void
language plpgsql
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s          series%rowtype;
  tz         text;
  days       timestamptz[];
  utc0       constant timestamptz := timestamptz '2000-01-01 00:00:00+00';
begin
  select * into s from series where id = p_series_id;
  if not found or coalesce(cardinality(p_hours), 0) = 0 then
    return;
  end if;
  delete from series_rollups x where x.series_id = s.id and x.step = 'hour' and x.bucket = any (p_hours);
  insert into series_rollups (series_id, step, bucket, samples, total, minimum, maximum, last_value, delta, increments, quality)
  select s.id, 'hour', b.bucket, b.samples, b.total, b.minimum, b.maximum, b.last_value, b.delta, b.increments, b.quality
    from series_buckets(s, p_hours[1], p_hours[cardinality(p_hours)] + interval '1 hour', interval '1 hour', 'UTC', utc0) b
   where b.bucket = any (p_hours);

  tz := series_time_zone(s.id);
  if tz is not null then
    days := array(select distinct date_trunc('day', h, tz) from unnest(p_hours) h order by 1);
    delete from series_rollups x where x.series_id = s.id and x.step = 'day' and x.bucket = any (days);
    insert into series_rollups (series_id, step, bucket, samples, total, minimum, maximum, last_value, delta, increments, quality)
    select s.id, 'day', b.bucket, b.samples, b.total, b.minimum, b.maximum, b.last_value, b.delta, b.increments, b.quality
      from series_buckets(s, days[1], ((days[cardinality(days)] at time zone tz) + interval '1 day') at time zone tz,
                          interval '1 day', tz, days[1]) b
     where b.bucket = any (days);
  end if;
end;
$$;

comment on function series_rollup_hours(uuid, timestamptz[]) is
  'Computes again from the values the hourly rollups of the hours given (UTC starts, in order) and the daily rollups of the local days they fall in.';

-- AFTER each statement that writes or deletes values, whoever runs it: the
-- rollups of the hours it touched are computed again, so that they are
-- always fresh. A cumulative register also refreshes the hour of the
-- reading before the first one written: its consumption is read up to the
-- next reading.
create or replace function series_values_refresh_rollups()
returns trigger
language plpgsql
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  r record;
begin
  for r in
    with touched as (
      select c.series_id, date_bin('1 hour', c.at, timestamptz '2000-01-01 00:00:00+00') as hour
        from changed c join series s on s.id = c.series_id
      union
      select f.series_id, date_bin('1 hour', p.at, timestamptz '2000-01-01 00:00:00+00')
        from (select c.series_id, min(c.at) first_at
                from changed c join series s on s.id = c.series_id
               where s.value_kind = 'cumulative'
               group by c.series_id) f
        cross join lateral (select v.at from series_values v
                             where v.series_id = f.series_id and v.at < f.first_at
                             order by v.at desc limit 1) p
    )
    select t.series_id, array_agg(t.hour order by t.hour) hours from touched t group by t.series_id
  loop
    perform series_rollup_hours(r.series_id, r.hours);
  end loop;
  return null;
end;
$$;

comment on function series_values_refresh_rollups() is
  'AFTER statement on series_values: computes again the rollups of the hours the statement touched (and, for a cumulative register, of the hour of the reading before).';

create trigger series_values_rollups_insert after insert on series_values
  referencing new table as changed for each statement execute function series_values_refresh_rollups();
create trigger series_values_rollups_update after update on series_values
  referencing new table as changed for each statement execute function series_values_refresh_rollups();
create trigger series_values_rollups_delete after delete on series_values
  referencing old table as changed for each statement execute function series_values_refresh_rollups();

-- ---------------------------------------------------------------------------
-- Row level security and rights
-- ---------------------------------------------------------------------------

call secure_table('series');
create trigger series_drop_attachments after delete on series
  for each row execute function drop_attachments('series');

-- Values are read under the policy of their series and written by store()
-- only: no insert, update or delete is granted to the API roles.
alter table series_values enable row level security;
create policy series_values_select on series_values
  for select to authenticated
  using (series_id in (select id from series where can_read_organisation(organisation_id)));
grant select on series_values to authenticated;
grant select, insert, update, delete on series_values to service_role;

alter table forecast_values enable row level security;
create policy forecast_values_select on forecast_values
  for select to authenticated
  using (series_id in (select id from series where can_read_organisation(organisation_id)));
grant select on forecast_values to authenticated;
grant select, insert, update, delete on forecast_values to service_role;

grant select on series_latest to authenticated, service_role;

alter table series_rollups enable row level security;
create policy series_rollups_select on series_rollups
  for select to authenticated
  using (series_id in (select id from series where can_read_organisation(organisation_id)));
grant select on series_rollups to authenticated, service_role;

alter table units enable row level security;
create policy units_read on units for select to authenticated using (true);
grant select on units to authenticated;
grant select, insert, update, delete on units to service_role;

-- The helpers run inside the read and write functions, as their owner.
revoke execute on function series_points(series, timestamptz, timestamptz, timestamptz),
  series_buckets(series, timestamptz, timestamptz, interval, text, timestamptz, timestamptz),
  series_rollup_hours(uuid, timestamptz[]), series_values_refresh_rollups() from public;

grant execute on function unit_code(text), convert_unit(double precision, text, text),
  caller_bypasses_rls(), series_for_read(uuid), series_time_zone(uuid), series_step_shape(interval),
  series_bucket(timestamptz, interval, timestamptz, text), series_origin(timestamptz, text),
  series_bucket_starts(timestamptz, timestamptz, interval, text),
  resample(uuid, timestamptz, timestamptz, interval, text, timestamptz),
  "window"(uuid, timestamptz, timestamptz, integer), latest(uuid[]), coverage(uuid, timestamptz, timestamptz),
  fill(uuid, timestamptz, timestamptz, interval, text, text),
  forecast_at(uuid, timestamptz, timestamptz, timestamptz, interval),
  export_rows(uuid[], timestamptz, timestamptz),
  series_values_partition(date),
  series_ensure(text, uuid, text, text, text, interval, uuid, text, text, text, jsonb, text),
  store(uuid, timestamptz[], float8[], smallint[], text, timestamptz, jsonb)
  to authenticated, service_role;

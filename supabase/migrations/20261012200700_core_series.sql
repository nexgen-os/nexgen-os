-- Nexgen OS — core: series and their values.
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
-- kind `simulated`, usually in a scenario; a series a run computed belongs
-- to that run and changes with nobody else's. There is one series store,
-- built for a hundred thousand meters (decision 0007): partitioned by week,
-- no per-row organisation, a two-byte quality, one read function.

set search_path = nexgen, public, extensions;

create table series (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- What is observed: a room, a building, a site, a device, a meter.
  object_id        uuid not null references objects(id) on delete cascade,
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
  scenario_id      uuid references scenarios(id) on delete cascade,
  -- Where the values come from: a source of the vocabulary (a grid
  -- operator's hub, a device protocol, a model), and a free note.
  source_code      text references sources(code),
  source           text,
  -- How a connector finds the point: a Modbus register, an MQTT topic, a
  -- BACnet object, an API path, a Home Assistant entity.
  external_ref     text,
  -- What the source knows about the point beyond these columns (a Home
  -- Assistant entity's class, icon, original unit). Extensions only.
  metadata         jsonb not null default '{}',
  -- The run that computed it. Its values are the run's figures: written
  -- inside record_run() and never changed after.
  run_id           uuid references runs(id) on delete cascade,
  created_at       timestamptz not null default now(),
  constraint series_kind check (kind in ('measured', 'simulated', 'forecast', 'setpoint', 'command')),
  constraint series_run_computed check (run_id is null or kind in ('simulated', 'forecast')),
  constraint series_value_kind check (value_kind in ('interval', 'instant', 'cumulative')),
  constraint series_step_positive check (step is null or step > interval '0')
);

comment on table series is
  'One quantity over time for one object, by one device when there is one — measured, simulated, forecast, asked or ordered (OGC SensorThings Datastream, Brick and Haystack point, Home Assistant entity). A run''s series belong to it.';

-- One series per identity: two imports of the same meter find the same
-- series, two runs never share one.
create unique index series_identity on series
  (object_id, quantity_code, kind, source_code, scenario_id, name, run_id) nulls not distinct;
create index series_quantity_idx on series (quantity_code);
create index series_device_idx on series (device_id);
create index series_run_idx on series (run_id);

create trigger series_attach
  before insert or update on series
  for each row execute function attach('object_id');

-- The device of a series is of the series' organisation, and of its
-- scenario when it exists only in one.
create or replace function series_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  d objects%rowtype;
begin
  if new.device_id is null then
    return new;
  end if;
  select * into d from objects where id = new.device_id;
  if d.organisation_id <> new.organisation_id then
    raise exception 'device_in_other_organisation: %', new.device_id using errcode = 'check_violation';
  end if;
  if d.scenario_id is not null and d.scenario_id is distinct from new.scenario_id then
    raise exception 'attachment_outside_object_scenario' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function series_check() is
  'BEFORE INSERT / UPDATE on series: the device is of the series'' organisation and scenario.';

create trigger series_check
  before insert or update of device_id, organisation_id, scenario_id on series
  for each row execute function series_check();

-- ---------------------------------------------------------------------------
-- series_values — the hot table.
-- ---------------------------------------------------------------------------

create table series_quality_codes (
  code  smallint primary key,
  name  text not null unique
);

comment on table series_quality_codes is
  'The quality vocabulary of metering data exchanges, kept short: measured, estimated, substituted, missing.';

insert into series_quality_codes (code, name) values
  (0, 'measured'), (1, 'estimated'), (2, 'substituted'), (3, 'missing');

create table series_values (
  series_id  uuid not null references series(id) on delete cascade,
  -- Start of the interval for an `interval` series; the instant otherwise.
  at         timestamptz not null,
  -- In the unit of the series' quantity, always.
  value      double precision not null,
  quality    smallint not null default 0 references series_quality_codes(code),
  primary key (series_id, at)
) partition by range (at);

comment on table series_values is
  'Timestamped values of a series, in its quantity''s unit. Partitioned by week on `at`; the organisation is the series''. An installation adds pg_partman for the partitions and pg_cron for the maintenance.';

-- Everything lands here until an installation creates weekly partitions
-- (`series_values_partition()` or pg_partman).
create table series_values_default partition of series_values default;

create index series_values_at_brin on series_values using brin (at) with (pages_per_range = 32);

-- A weekly partition, named by its Monday, for installations without
-- pg_partman. Rows already in the default partition for that week move.
create or replace function series_values_partition(p_week date)
returns text
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  monday date := date_trunc('week', p_week)::date;
  name   text := format('series_values_%s', to_char(monday, 'IYYY_"w"IW'));
begin
  if to_regclass(name) is not null then
    return name;
  end if;
  execute format('create table %I (like series_values including defaults including constraints)', name || '_new');
  execute format('insert into %I select * from series_values_default where at >= %L and at < %L', name || '_new', monday, monday + 7);
  execute format('delete from series_values_default where at >= %L and at < %L', monday, monday + 7);
  execute format('alter table series_values attach partition %I for values from (%L) to (%L)', name || '_new', monday, monday + 7);
  execute format('alter table %I rename to %I', name || '_new', name);
  return name;
end;
$$;

comment on function series_values_partition(date) is
  'Creates the weekly partition holding a date and moves the week''s rows out of the default partition. pg_partman does the same on a schedule.';

-- ---------------------------------------------------------------------------
-- forecast_values — a forecast is issued again and again.
-- ---------------------------------------------------------------------------

-- A forecast series keeps every issue: the value for 14:00 as issued at
-- 06:00, then as issued at 12:00. Pages read the latest issue; a study of
-- forecast accuracy, or of what was known when a decision was taken, reads
-- the issues before a given time (`resample(..., p_issued_before)`).
-- Measured, simulated and setpoint series have one value per instant and
-- live in series_values. Small next to series_values: an installation
-- partitions it the same way when it needs to.
create table forecast_values (
  series_id  uuid not null references series(id) on delete cascade,
  at         timestamptz not null,
  -- When the forecast was made (the belief time of FlexMeasures).
  issued_at  timestamptz not null,
  value      double precision not null,
  primary key (series_id, at, issued_at)
);

comment on table forecast_values is
  'Every issue of a forecast series: one row per instant and issue time, in the quantity''s unit. The latest issue is what a page shows; earlier issues are what an accuracy study reads.';

create index forecast_values_at_brin on forecast_values using brin (at) with (pages_per_range = 32);

-- Each kind of series has its one store: a forecast goes to forecast_values
-- with its issue time, everything else to series_values. The values of a
-- run's series are written while the run runs, and never after.
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
  select se.kind, r.status into k, rs from series se left join runs r on r.id = se.run_id where se.id = sid;
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
-- Reading series: one function.
-- ---------------------------------------------------------------------------

-- The time zone a series is read in for steps of a day or more: the one of
-- the site of its object. Null when there is none; never a default.
create or replace function series_time_zone(p_series_id uuid)
returns text
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select s.time_zone
    from series se
    join sites s on s.id = site_of(se.object_id)
   where se.id = p_series_id;
$$;

comment on function series_time_zone(uuid) is
  'The time zone of the site a series'' object is on; null when there is none, never a default.';

-- The one way series are read: resampled on a regular step, combined the
-- way the quantity says (sum, mean or last). Steps shorter than a day are
-- binned in absolute time, safe across daylight-saving changes; a day or
-- more is truncated in the site's time zone (or the one given). A forecast
-- series gives its latest issue, or the latest issued before a given time.
-- Security definer: access is checked once on the series, the values carry
-- no policy cost on the hot path.
create or replace function resample(
  p_series_id     uuid,
  p_from          timestamptz,
  p_to            timestamptz,
  p_step          interval,
  p_time_zone     text default null,
  p_issued_before timestamptz default null
)
returns table (bucket timestamptz, value double precision, samples int)
language plpgsql
stable
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s     series%rowtype;
  q     quantities%rowtype;
  tz    text;
  unit  text;
begin
  select * into s from series where id = p_series_id;
  if not found or (auth.uid() is not null and not can_read_organisation(s.organisation_id)) then
    raise exception 'series_not_found: %', p_series_id using errcode = 'no_data_found';
  end if;
  select * into q from quantities where code = s.quantity_code;

  if p_step < interval '1 day' then
    return query
      with points as (
        select v.at, v.value from series_values v
         where s.kind <> 'forecast' and v.series_id = p_series_id
           and v.at >= p_from and v.at < p_to and v.quality <> 3
        union all
        select latest.at, latest.value from (
          select distinct on (f.at) f.at, f.value from forecast_values f
           where s.kind = 'forecast' and f.series_id = p_series_id
             and f.at >= p_from and f.at < p_to
             and (p_issued_before is null or f.issued_at < p_issued_before)
           order by f.at, f.issued_at desc) latest
      )
      select date_bin(p_step, v.at, timestamptz '2000-01-01 00:00:00+00') as bucket,
             case
               when s.value_kind = 'cumulative' then (array_agg(v.value order by v.at desc))[1]
               when q.aggregation = 'sum'  then sum(v.value)
               when q.aggregation = 'mean' then avg(v.value)
               else (array_agg(v.value order by v.at desc))[1]
             end as value,
             count(*)::int as samples
        from points v
       group by 1
       order by 1;
    return;
  end if;

  tz := coalesce(p_time_zone, series_time_zone(p_series_id));
  if tz is null then
    raise exception 'time_zone_required: a step of a day or more needs the site''s time zone' using errcode = 'invalid_parameter_value';
  end if;
  unit := case
            when p_step >= interval '1 year'  then 'year'
            when p_step >= interval '1 month' then 'month'
            when p_step >= interval '7 days'  then 'week'
            else 'day'
          end;
  return query
    with points as (
      select v.at, v.value from series_values v
       where s.kind <> 'forecast' and v.series_id = p_series_id
         and v.at >= p_from and v.at < p_to and v.quality <> 3
      union all
      select latest.at, latest.value from (
        select distinct on (f.at) f.at, f.value from forecast_values f
         where s.kind = 'forecast' and f.series_id = p_series_id
           and f.at >= p_from and f.at < p_to
           and (p_issued_before is null or f.issued_at < p_issued_before)
         order by f.at, f.issued_at desc) latest
    )
    select date_trunc(unit, v.at, tz) as bucket,
           case
             when s.value_kind = 'cumulative' then (array_agg(v.value order by v.at desc))[1]
             when q.aggregation = 'sum'  then sum(v.value)
             when q.aggregation = 'mean' then avg(v.value)
             else (array_agg(v.value order by v.at desc))[1]
           end as value,
           count(*)::int as samples
      from points v
     group by 1
     order by 1;
end;
$$;

comment on function resample(uuid, timestamptz, timestamptz, interval, text, timestamptz) is
  'A series resampled on a regular step, combined by its quantity''s aggregation; a cumulative register gives its last index per step. Sub-day steps bin in absolute time; a day or more truncates in the site''s time zone. A forecast gives its latest issue, or the latest issued before p_issued_before. The one function pages and modules read series through.';

-- ---------------------------------------------------------------------------
-- Gestures: one way to open a series, one way to write its values.
-- ---------------------------------------------------------------------------

-- The series of an identity — object, quantity, kind, source, scenario,
-- name, run — found or created once. A second writer with the same identity
-- finds the first one's series, never a twin.
create or replace function open_series(
  p_object_id     uuid,
  p_quantity_code text,
  p_kind          text default 'measured',
  p_value_kind    text default 'interval',
  p_step          interval default null,
  p_device_id     uuid default null,
  p_external_ref  text default null,
  p_source_code   text default null,
  p_name          text default null,
  p_scenario_id   uuid default null,
  p_metadata      jsonb default '{}',
  p_run_id        uuid default null
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
  insert into series (object_id, quantity_code, kind, value_kind, step, device_id, external_ref, source_code, name,
                      scenario_id, metadata, run_id)
  values (p_object_id, p_quantity_code, p_kind, p_value_kind, p_step, p_device_id, p_external_ref, p_source_code, p_name,
          p_scenario_id, coalesce(p_metadata, '{}'), p_run_id)
  on conflict (object_id, quantity_code, kind, source_code, scenario_id, name, run_id) do nothing;
  select * into s from series
   where object_id = p_object_id and quantity_code = p_quantity_code and kind = p_kind
     and source_code is not distinct from p_source_code and scenario_id is not distinct from p_scenario_id
     and name is not distinct from p_name and run_id is not distinct from p_run_id;
  if s.value_kind <> p_value_kind or s.step is distinct from p_step then
    raise exception 'series_shape_mismatch: the series % holds % values every %, not % every %',
      s.id, s.value_kind, coalesce(s.step::text, 'irregular step'), p_value_kind, coalesce(p_step::text, 'irregular step')
      using errcode = 'check_violation';
  end if;
  return s.id;
end;
$$;

comment on function open_series(uuid, text, text, text, interval, uuid, text, text, text, uuid, jsonb, uuid) is
  'The series of an identity (object, quantity, kind, source, scenario, name, run), found or created once, with the device that produces it and where a connector finds it. Refuses quantity_unknown, series_shape_mismatch. Returns its id.';

-- Values in the quantity's unit, replaced where already present. A series
-- whose device was removed takes no value after the removal day.
create or replace function store_values(
  p_series_id uuid,
  p_at        timestamptz[],
  p_value     float8[],
  p_quality   smallint[] default null
)
returns integer
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s        series%rowtype;
  removed  date;
  tz       text;
  n        integer;
begin
  select * into s from series where id = p_series_id;
  if not found then
    raise exception 'series_not_found: %', p_series_id using errcode = 'no_data_found';
  end if;
  if cardinality(p_at) <> cardinality(p_value) or (p_quality is not null and cardinality(p_quality) <> cardinality(p_at)) then
    raise exception 'values_misaligned: as many instants, values and qualities' using errcode = 'invalid_parameter_value';
  end if;
  if s.device_id is not null then
    select d.removal_date into removed from devices d where d.id = s.device_id;
    if removed is not null then
      tz := coalesce(series_time_zone(p_series_id), 'UTC');
      if exists (select 1 from unnest(p_at) a where (a at time zone tz)::date > removed) then
        raise exception 'device_retired: the device of series % was removed on %', p_series_id, removed using errcode = 'check_violation';
      end if;
    end if;
  end if;
  insert into series_values (series_id, at, value, quality)
  select p_series_id, v.at, v.value, coalesce(v.quality, 0)
    from unnest(p_at, p_value, coalesce(p_quality, array_fill(null::smallint, array[cardinality(p_at)]))) as v(at, value, quality)
  on conflict (series_id, at) do update set value = excluded.value, quality = excluded.quality;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function store_values(uuid, timestamptz[], float8[], smallint[]) is
  'Stores values of a series (quality 0 measured unless given), replacing those already at the same instants. Refuses series_not_found, forecast_values_required, device_retired, run_is_final. Returns the number of rows written.';

create or replace function store_forecast(
  p_series_id uuid,
  p_issued_at timestamptz,
  p_at        timestamptz[],
  p_value     float8[]
)
returns integer
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  n integer;
begin
  if not exists (select 1 from series where id = p_series_id) then
    raise exception 'series_not_found: %', p_series_id using errcode = 'no_data_found';
  end if;
  if cardinality(p_at) <> cardinality(p_value) then
    raise exception 'values_misaligned: as many instants as values' using errcode = 'invalid_parameter_value';
  end if;
  insert into forecast_values (series_id, at, issued_at, value)
  select p_series_id, v.at, p_issued_at, v.value from unnest(p_at, p_value) as v(at, value)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function store_forecast(uuid, timestamptz, timestamptz[], float8[]) is
  'Stores one issue of a forecast: its values with the time it was issued; an issue already stored is kept. Refuses series_not_found, not_a_forecast. Returns the number of rows written.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

call secure_table('series');

alter table series_values enable row level security;
create policy series_values_select on series_values
  for select to authenticated
  using (series_id in (select id from series where can_read_organisation(organisation_id)));
create policy series_values_write on series_values
  for all to authenticated
  using (series_id in (select id from series where can_write_organisation(organisation_id)))
  with check (series_id in (select id from series where can_write_organisation(organisation_id)));
grant select, insert, update, delete on series_values to authenticated, service_role;

alter table forecast_values enable row level security;
create policy forecast_values_select on forecast_values
  for select to authenticated
  using (series_id in (select id from series where can_read_organisation(organisation_id)));
create policy forecast_values_write on forecast_values
  for all to authenticated
  using (series_id in (select id from series where can_write_organisation(organisation_id)))
  with check (series_id in (select id from series where can_write_organisation(organisation_id)));
grant select, insert, update, delete on forecast_values to authenticated, service_role;

alter table series_quality_codes enable row level security;
create policy series_quality_codes_read on series_quality_codes for select to authenticated using (true);
grant select on series_quality_codes to authenticated, service_role;

grant execute on function resample(uuid, timestamptz, timestamptz, interval, text, timestamptz), series_time_zone(uuid),
  series_values_partition(date),
  open_series(uuid, text, text, text, interval, uuid, text, text, text, uuid, jsonb, uuid),
  store_values(uuid, timestamptz[], float8[], smallint[]), store_forecast(uuid, timestamptz, timestamptz[], float8[])
  to authenticated, service_role;

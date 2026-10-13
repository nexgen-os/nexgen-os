-- Nexgen OS — core: series and their values.
--
-- Values that change continuously — energy through a meter, temperature in a
-- room, production of a PV system, state of charge of a battery, a setpoint
-- sent to a heat pump — are series of values attached to an object. The
-- shape is the one of OGC SensorThings (Datastream, Observation) and of
-- Brick points: a series says what is observed (an object), which quantity
-- (hence the unit), by what (a sensor), at which step; its values are the
-- timestamped values.
--
-- Measured, simulated and forecast series share the same shape, so a page
-- compares them with one query: a simulated hourly profile is a series of
-- kind `simulated`, usually in a scenario. There is one series store, built
-- for a hundred thousand meters (decision 0007): partitioned by week, no
-- per-row organisation, a two-byte quality, one read function.

set search_path = nexgen, public, extensions;

create table series (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- What is observed: a meter, a device, a building, a site, a participant.
  object_id        uuid not null references objects(id) on delete cascade,
  quantity_code    text not null references quantities(code),
  -- The point that produces the values, when it is described. Null for a
  -- series produced by a computation or read from a data hub.
  sensor_id        uuid references sensors(id) on delete set null,
  name             text,
  -- measured: read from a device or a data hub; simulated: produced by a
  -- model; forecast: about the future; setpoint: a value asked of a device.
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
  created_at       timestamptz not null default now(),
  constraint series_kind check (kind in ('measured', 'simulated', 'forecast', 'setpoint')),
  constraint series_value_kind check (value_kind in ('interval', 'instant', 'cumulative')),
  constraint series_step_positive check (step is null or step > interval '0')
);

comment on table series is
  'One quantity over time for one object — measured, simulated, forecast or asked (OGC SensorThings Datastream, Brick point, Home Assistant state class).';

create index series_object_idx on series (object_id);
create index series_quantity_idx on series (quantity_code);

create trigger series_attach
  before insert or update on series
  for each row execute function attach('object_id');

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
-- with its issue time, everything else to series_values.
create or replace function series_store_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  k text;
begin
  select kind into k from series where id = new.series_id;
  if tg_table_name = 'forecast_values' and k <> 'forecast' then
    raise exception 'not_a_forecast: series % is %, its values go to series_values', new.series_id, k using errcode = 'check_violation';
  elsif tg_table_name <> 'forecast_values' and k = 'forecast' then
    raise exception 'forecast_values_required: series % is a forecast, its values go to forecast_values with their issue time', new.series_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger series_values_store before insert on series_values
  for each row execute function series_store_check();
create trigger forecast_values_store before insert on forecast_values
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
  series_values_partition(date) to authenticated, service_role;

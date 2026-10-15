-- Nexgen OS — module `consumption`: the consumption curve of a site.
--
-- A site's consumption over time is known three ways: measured, by a meter
-- or a data hub, as a series of the core; reconstructed, from the energy of
-- a bill spread over its period by a load profile and the site's activity
-- hours; typical, from an annual consumption and a load profile. This
-- module holds what the last two need — load profiles as data, activity
-- hours of a site — and reads the curve of a site whichever way it is
-- known (`consumption.curve()`).
--
-- A reconstruction is a run of this module (`modules/consumption/curve.ts`):
-- its curve is a `simulated` series of the core on the site, with the
-- source of the energy it was scaled to.
--
-- What a building or a site is used for is the core's vocabulary
-- (`profiles`); a load profile says which use it describes. Standard load
-- profiles a country publishes come with its pack, each with its source.

set search_path = nexgen, public, extensions;

create schema consumption;
grant usage on schema consumption to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- load_profiles — how energy spreads over the days and the year, as data.
-- ---------------------------------------------------------------------------

create table consumption.load_profiles (
  code             text primary key,
  name             text not null,
  -- The use it describes (an office, a school, a dwelling); null for any.
  use_code         text references profiles(code),
  -- day_shapes: the weight of each slot of the day, by day type, as given;
  -- activity_hours: a slot weighs 1 while the site is open, `closed_ratio`
  -- while it is closed, pro rata of the part of the slot that is open.
  method           text not null,
  -- 24 (hours), 48 (half-hours) or 96 (quarter-hours): the step of the
  -- curve it gives.
  slots_per_day    integer not null default 24,
  -- {"weekday": [...], "saturday": [...], "sunday": [...]}, one relative
  -- weight per slot of the local day; a day type left out weighs nothing.
  day_shapes       jsonb,
  -- Weight of a closed slot next to an open one, 0 to 1.
  closed_ratio     double precision,
  -- Relative weight of a day in each month, January first; null: every day
  -- of the year weighs the same.
  monthly_factors  double precision[],
  -- Where the shapes come from: a grid operator's standard profiles, a
  -- measurement campaign.
  source_code      text references sources(code),
  published_by     text not null default 'consumption',
  description      text,
  constraint load_profiles_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint load_profiles_method check (method in ('day_shapes', 'activity_hours')),
  constraint load_profiles_slots check (slots_per_day in (24, 48, 96)),
  constraint load_profiles_day_shapes check (
    method <> 'day_shapes' or (jsonb_typeof(day_shapes) = 'object' and day_shapes <> '{}'::jsonb)
  ),
  constraint load_profiles_closed_ratio check (
    (method = 'activity_hours') = (closed_ratio is not null) and (closed_ratio is null or closed_ratio between 0 and 1)
  ),
  constraint load_profiles_monthly_factors check (
    monthly_factors is null or (cardinality(monthly_factors) = 12 and 0 <= all (monthly_factors))
  )
);

comment on table consumption.load_profiles is
  'How energy spreads over the slots of a day, the day types of a week and the months of a year: by day shapes, or by the site''s activity hours. Vocabulary: read by everyone signed in, written by migrations, modules and packs.';

-- The shapes of a day are of the three day types and carry one weight per
-- slot, none negative.
create or replace function consumption.load_profiles_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  k text;
  w jsonb;
begin
  if new.method = 'day_shapes' then
    for k, w in select * from jsonb_each(new.day_shapes) loop
      if k not in ('weekday', 'saturday', 'sunday') then
        raise exception 'day_type_unknown: % in %; day types are weekday, saturday and sunday', k, new.code using errcode = 'check_violation';
      end if;
      if jsonb_typeof(w) <> 'array' or jsonb_array_length(w) <> new.slots_per_day
         or exists (select 1 from jsonb_array_elements(w) e where jsonb_typeof(e) <> 'number' or (e #>> '{}')::float8 < 0) then
        raise exception 'day_shape_invalid: % of % needs % weights, none negative', k, new.code, new.slots_per_day using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger load_profiles_check
  before insert or update on consumption.load_profiles
  for each row execute function consumption.load_profiles_check();

insert into consumption.load_profiles (code, name, method, slots_per_day, day_shapes, description) values
  ('flat', 'Flat', 'day_shapes', 24,
   jsonb_build_object('weekday', to_jsonb(array_fill(1, array[24])), 'saturday', to_jsonb(array_fill(1, array[24])), 'sunday', to_jsonb(array_fill(1, array[24]))),
   'The same energy every hour of the year: the curve of a constant load, and the one assumption a reconstruction makes when nothing else is known.');

alter table consumption.load_profiles enable row level security;
create policy consumption_load_profiles_read on consumption.load_profiles for select to authenticated using (true);
grant select on consumption.load_profiles to authenticated;
grant select, insert, update, delete on consumption.load_profiles to service_role;

-- ---------------------------------------------------------------------------
-- activity_hours — when a site is open, in its own time zone.
-- ---------------------------------------------------------------------------

create table consumption.activity_hours (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- A site, a building, a space: what is open.
  object_id        uuid not null references objects(id) on delete cascade,
  -- ISO day of the week, 1 Monday to 7 Sunday.
  weekday          smallint not null,
  -- Local wall-clock times of the site; `24:00` closes at midnight. Two
  -- rows on a day for a break at noon.
  opens            time not null,
  closes           time not null,
  -- The dates the hours hold, `valid_to` excluded: a summer timetable, a
  -- school year. Null bounds are open.
  valid_from       date,
  valid_to         date,
  source_code      text references sources(code),
  source           text,
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  constraint activity_hours_weekday check (weekday between 1 and 7),
  constraint activity_hours_order check (closes > opens),
  constraint activity_hours_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table consumption.activity_hours is
  'When a site, a building or a space is open, day of the week by day of the week, in the local time of its site, over a period: what a reconstruction by activity hours reads.';

create index activity_hours_object_idx on consumption.activity_hours (object_id);

create trigger activity_hours_attach
  before insert or update on consumption.activity_hours
  for each row execute function attach('object_id');

call secure_table('consumption.activity_hours');

-- ---------------------------------------------------------------------------
-- curve — the consumption of a site, whichever way it is known.
-- ---------------------------------------------------------------------------

-- The series a site's consumption is read from over a period, in this
-- order: a measured `consumption_energy` series of the site or of anything
-- on it holding values in the period, the one on the site itself first;
-- otherwise the simulated one a consumption run wrote last. Null when
-- there is none. Reads under the caller's row level security.
create or replace function consumption.curve_series(p_site_id uuid, p_from timestamptz, p_to timestamptz, p_scenario_id uuid default null)
returns uuid
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select se.id
    from series se
   where se.quantity_code = 'consumption_energy'
     and (se.object_id = p_site_id or site_of(se.object_id) = p_site_id)
     and se.scenario_id is not distinct from p_scenario_id
     and (
       (se.kind = 'measured' and exists (select 1 from series_values v where v.series_id = se.id and v.at >= p_from and v.at < p_to))
       or (se.kind = 'simulated' and exists (
             select 1 from runs r
              where r.module_code = 'consumption' and r.status = 'succeeded'
                and r.results ->> 'series_id' = se.id::text))
     )
   order by se.kind = 'measured' desc, se.object_id = p_site_id desc,
            (select max(r.finished_at) from runs r where r.module_code = 'consumption' and r.results ->> 'series_id' = se.id::text) desc nulls last,
            se.created_at desc
   limit 1;
$$;

comment on function consumption.curve_series(uuid, timestamptz, timestamptz, uuid) is
  'The series the consumption of a site is read from over a period: measured first, the one on the site itself before those of a meter or a building on it, otherwise the last reconstruction of this module.';

-- The consumption of a site over a period, on a step, as `resample()` gives
-- it, with the series it was read from and whether it was measured or
-- simulated. Nothing when the site has no consumption series.
create or replace function consumption.curve(p_site_id uuid, p_from timestamptz, p_to timestamptz, p_step interval, p_scenario_id uuid default null)
returns table (bucket timestamptz, value double precision, series_id uuid, kind text)
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select r.bucket, r.value, se.id, se.kind
    from series se
    cross join lateral resample(se.id, p_from, p_to, p_step) r
   where se.id = consumption.curve_series(p_site_id, p_from, p_to, p_scenario_id);
$$;

comment on function consumption.curve(uuid, timestamptz, timestamptz, interval, uuid) is
  'The consumption of a site over a period on a step, measured when it is, reconstructed otherwise, with the series read and its kind.';

grant execute on function consumption.curve_series(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function consumption.curve(uuid, timestamptz, timestamptz, interval, uuid) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('consumption', 'Consumption', '0.1.0', 'consumption', '0.1.0',
        'The consumption curve of a site: load profiles as data, activity hours, a curve reconstructed from a bill or an annual consumption as a run, and the curve read measured first.');

-- Nexgen OS — module `consumption`: the consumption curve of a participant.
--
-- A participant's consumption over time is known three ways: measured, by a meter
-- or a data hub, as a series of the core; estimated, from the energy of
-- a bill spread over its period by a load profile and the participant's activity
-- hours; typical, from an annual consumption and a load profile. This
-- module holds what the last two need — load profiles as data, the activity
-- hours of a participant — and reads the curve of a participant whichever way it is
-- known (`consumption.curve()`).
--
-- An estimate is a curve of this module (`consumption.estimates`,
-- `modules/consumption/src/curve.ts`): its curve is a `simulated` series of
-- the core on the participant the estimate is about, with the source of the
-- energy it was scaled to, and the estimate named in its source.
--
-- A load profile says which use it describes, by the code the `building`
-- module gives that use (`building.uses`) when it is installed. The
-- module ships `flat`; an installation adds its own, each with its source.

set search_path = nexgen, extensions;

create schema consumption;
grant usage on schema consumption to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- load_profiles — how energy spreads over the days and the year, as data.
-- ---------------------------------------------------------------------------

create table consumption.load_profiles (
  code             text primary key,
  name             text not null,
  -- The use it describes (an office, a school, a dwelling), by the code
  -- of `building.uses`; null for any.
  use_code         text,
  -- day_shapes: the weight of each slot of the day, by day type, as given;
  -- activity_hours: a slot weighs 1 while the participant is open, `closed_ratio`
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
    (method = 'day_shapes') = (day_shapes is not null)
    and (day_shapes is null or (jsonb_typeof(day_shapes) = 'object' and day_shapes <> '{}'::jsonb))
  ),
  constraint load_profiles_closed_ratio check (
    (method = 'activity_hours') = (closed_ratio is not null) and (closed_ratio is null or closed_ratio between 0 and 1)
  ),
  constraint load_profiles_monthly_factors check (
    monthly_factors is null or (cardinality(monthly_factors) = 12 and 0 <= all (monthly_factors))
  )
);

comment on table consumption.load_profiles is
  'How energy spreads over the slots of a day, the day types of a week and the months of a year: by day shapes, or by the participant''s activity hours. Vocabulary: read by everyone signed in, written by migrations, modules and the installation.';

-- The shapes of a day are of the three day types and carry one weight per
-- slot, none negative.
create or replace function consumption.load_profiles_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k text;
  w jsonb;
begin
  if new.method = 'day_shapes' and jsonb_typeof(new.day_shapes) = 'object' then
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

comment on function consumption.load_profiles_check() is
  'BEFORE INSERT / UPDATE on load_profiles: day shapes are of known day types (day_type_unknown), one weight per slot, none negative (day_shape_invalid).';

create trigger load_profiles_check
  before insert or update on consumption.load_profiles
  for each row execute function consumption.load_profiles_check();

insert into consumption.load_profiles (code, name, method, slots_per_day, day_shapes, description) values
  ('flat', 'Flat', 'day_shapes', 24,
   jsonb_build_object('weekday', to_jsonb(array_fill(1, array[24])), 'saturday', to_jsonb(array_fill(1, array[24])), 'sunday', to_jsonb(array_fill(1, array[24]))),
   'The same energy every hour of the year: the curve of a constant load, and the one assumption an estimate makes when nothing else is known.');

alter table consumption.load_profiles enable row level security;
create policy consumption_load_profiles_read on consumption.load_profiles for select to authenticated using (true);
grant select on consumption.load_profiles to authenticated;
grant select, insert, update, delete on consumption.load_profiles to service_role;

-- ---------------------------------------------------------------------------
-- activity_hours — when a participant is open, in its own time zone.
-- ---------------------------------------------------------------------------

create table consumption.activity_hours (
  id               uuid primary key default gen_random_uuid(),
  -- Copied from what is open by `attach()`.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- A participant, a project: what is open, by its kind and its id.
  object_kind      text not null,
  object_id        uuid not null,
  -- ISO day of the week, 1 Monday to 7 Sunday.
  weekday          smallint not null,
  -- Local wall-clock times of the participant; `24:00` closes at midnight. Two
  -- rows on a day for a break at noon.
  opens            time not null,
  closes           time not null,
  -- The dates the hours hold, `valid_to` excluded: a summer timetable, a
  -- school year. Null bounds are open.
  valid_from       date,
  valid_to         date,
  source_code      text references sources(code),
  source           text,
  created_at       timestamptz not null default now(),
  constraint activity_hours_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint activity_hours_weekday check (weekday between 1 and 7),
  constraint activity_hours_order check (closes > opens),
  constraint activity_hours_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table consumption.activity_hours is
  'When a participant or a project is open, day of the week by day of the week, in the local time of its participant, over a period: what an estimate by activity hours reads.';

create index activity_hours_object_idx on consumption.activity_hours (object_kind, object_id);
create index activity_hours_organisation_idx on consumption.activity_hours (organisation_id);

create trigger activity_hours_attach
  before insert or update on consumption.activity_hours
  for each row execute function attach();

call secure_table('consumption.activity_hours');

-- ---------------------------------------------------------------------------
-- estimates — what the module computed (decision 0004).
-- ---------------------------------------------------------------------------

create table consumption.estimates (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The participant whose consumption was estimated.
  participant_id   uuid not null references participants(id) on delete cascade,
  -- Where it comes from: the program and the version that computed it.
  provenance       text not null,
  inputs           jsonb not null,
  results          jsonb not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table consumption.estimates is
  'The consumption curves the module estimated for a participant: its inputs, its provenance (the program and version that computed it), its results; the series an estimate wrote name it in their source. A new computation adds an estimate or replaces one.';

create index estimates_participant_id_idx on consumption.estimates (participant_id);
create trigger estimates_set_updated_at before update on consumption.estimates
  for each row execute function set_updated_at();
call secure_table('consumption.estimates', null, 'participant_id');

-- ---------------------------------------------------------------------------
-- curve — the consumption of a participant, whichever way it is known.
-- ---------------------------------------------------------------------------

-- The series a participant's consumption is read from over a period: of all the
-- `consumption_energy` series of the participant or of anything of it holding
-- values in the period, a measured one before an estimate of this
-- module, the one on the participant itself before those of a meter or a
-- device of it, then the latest. Null when there is none. Reads under the
-- caller's row level security.
create or replace function consumption.curve_series(p_participant_id uuid, p_from timestamptz, p_to timestamptz)
returns uuid
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select se.id
    from series se
    left join consumption.estimates e on se.source = 'consumption.estimates:' || e.id
   where se.quantity_code = 'consumption_energy'
     and (se.object_id = p_participant_id or participant_of(se.object_kind, se.object_id) = p_participant_id)
     and (se.kind = 'measured' or (se.kind = 'simulated' and e.id is not null))
     and exists (select 1 from series_values v where v.series_id = se.id and v.at >= p_from and v.at < p_to and v.quality <> 3)
   order by se.kind = 'measured' desc, se.object_id = p_participant_id desc, e.updated_at desc nulls last, se.created_at desc
   limit 1;
$$;

comment on function consumption.curve_series(uuid, timestamptz, timestamptz) is
  'The series the consumption of a participant is read from over a period: measured first, the one on the participant itself before those of a meter or a device of it, otherwise the latest estimate of this module holding values in the period.';

-- The consumption of a participant over a period, on a step, as `resample()` gives
-- it, with the series it was read from and whether it was measured or
-- simulated. Nothing when the participant has no consumption series.
create or replace function consumption.curve(p_participant_id uuid, p_from timestamptz, p_to timestamptz, p_step interval)
returns table (bucket timestamptz, value double precision, series_id uuid, kind text)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select r.bucket, r.value, se.id, se.kind
    from series se
    cross join lateral resample(se.id, p_from, p_to, p_step) r
   where se.id = consumption.curve_series(p_participant_id, p_from, p_to);
$$;

comment on function consumption.curve(uuid, timestamptz, timestamptz, interval) is
  'The consumption of a participant over a period on a step, measured when it is, estimated otherwise, with the series read and its kind.';

grant execute on function consumption.curve_series(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function consumption.curve(uuid, timestamptz, timestamptz, interval) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('consumption', 'Consumption', '0.3.0', 'consumption', '0.3.0',
        'The consumption curve of a participant: load profiles as data, activity hours, a curve estimated from a bill or an annual consumption as an estimate, and the curve read measured first.');

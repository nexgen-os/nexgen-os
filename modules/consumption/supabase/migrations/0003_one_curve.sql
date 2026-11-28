-- Nexgen OS — consumption: the curve of a participant is read along the one
-- path of the core.
--
-- `curve_series()` chose one series of the participant or of anything of it,
-- so a device's sub-meter could become the whole curve of its participant,
-- and the indicators chose theirs another way. Both now read
-- `participant_series()` (core): measured first, its own or its meters'
-- (added up), never a device's alone; otherwise the latest estimate, to
-- which the simulated consumption of a planned device is added. The curve is
-- then the sum of the series read, and names each of them with its kind,
-- as `solar.curve()` does for production.

set search_path = nexgen, extensions;

drop function if exists consumption.curve(uuid, timestamptz, timestamptz, interval);
drop function if exists consumption.curve_series(uuid, timestamptz, timestamptz);

-- The series a participant's consumption is read from over a period, with
-- their kind: the measured ones when there are, the simulated ones
-- otherwise, as participant_series() chooses them. Nothing when there is
-- none. Reads under the caller's row level security.
create function consumption.curve_series(p_participant_id uuid, p_from timestamptz, p_to timestamptz)
returns table (series_id uuid, kind text)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with measured as (
    select s from participant_series(p_participant_id, 'consumption_energy', 'measured', p_from, p_to) s
  )
  select s, 'measured' from measured
  union all
  select s, 'simulated' from participant_series(p_participant_id, 'consumption_energy', 'simulated', p_from, p_to) s
   where not exists (select 1 from measured);
$$;

comment on function consumption.curve_series(uuid, timestamptz, timestamptz) is
  'The series the consumption of a participant is read from over a period, with their kind: measured first (its own, else its meters'', added up; never a device''s alone), otherwise the latest estimate with the simulated consumption of its planned devices; participant_series() chooses them.';

-- The consumption of a participant over a period, on a step: the sum of the
-- series curve_series() reads, with each of them and its kind. Nothing when
-- the participant has no consumption series.
create function consumption.curve(p_participant_id uuid, p_from timestamptz, p_to timestamptz, p_step interval)
returns table (bucket timestamptz, value double precision, series jsonb)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with chosen as (select * from consumption.curve_series(p_participant_id, p_from, p_to))
  select r.bucket, sum(r.value), jsonb_object_agg(c.series_id, c.kind)
    from chosen c
    cross join lateral resample(c.series_id, p_from, p_to, p_step) r
   group by r.bucket
   order by r.bucket;
$$;

comment on function consumption.curve(uuid, timestamptz, timestamptz, interval) is
  'The consumption of a participant over a period on a step, measured when it is, estimated otherwise, the sum of the series read with each of them and its kind.';

grant execute on function consumption.curve_series(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function consumption.curve(uuid, timestamptz, timestamptz, interval) to authenticated, service_role;

update nexgen.modules set version = '0.6.0' where code = 'consumption';

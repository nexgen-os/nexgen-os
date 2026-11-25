-- Nexgen OS — core: the curve of an amount of a participant, one path for
-- every reader.
--
-- A value is written once and computed along one path (decision 0065).
-- `participant_series()` chooses the series an amount of a participant is
-- read from; what was still chosen twice is what to do with them: the
-- consumption module (`consumption.curve()`) read the measured series, else
-- the simulated ones, and added them up, while the battery module chose one
-- series of its own — the first measured one of the participant or of
-- anything of it, so a heat pump's sub-meter could become the whole
-- consumption a battery is dispatched against, two meters were read as one,
-- and a planned device's simulated consumption was never seen. Both now
-- read the two functions below, and so does every module that reads
-- `consumption.curve()` (the PV sizing, the sharing of a community):
--
-- - `participant_curve_series()`: the series `participant_series()` reads
--   measured, else the simulated ones (the latest estimate of each object,
--   to which the simulated energy of a planned device adds), each with its
--   kind. A measurement and a simulation are never mixed: once something is
--   measured over the period, a simulated device adds nothing to it.
-- - `participant_curve()`: their sum on a step, each series read as
--   `resample()` reads it, with the series read and their kind.
--
-- Nothing is stored and nothing is refused.

set search_path = nexgen, extensions;

create or replace function participant_curve_series(
  p_participant_id uuid,
  p_quantity       text,
  p_from           timestamptz,
  p_to             timestamptz
)
returns table (series_id uuid, kind text)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with measured as (
    select s from participant_series(p_participant_id, p_quantity, 'measured', p_from, p_to) s
  )
  select s, 'measured' from measured
  union all
  select s, 'simulated' from participant_series(p_participant_id, p_quantity, 'simulated', p_from, p_to) s
   where not exists (select 1 from measured);
$$;

comment on function participant_curve_series(uuid, text, timestamptz, timestamptz) is
  'The series an amount of a participant is read from over a period, with their kind: the measured ones participant_series() reads, else its simulated ones (the latest estimate of each object, the simulated energy of a planned device added). A measurement and a simulation are never mixed. Under the caller''s row level security.';

create or replace function participant_curve(
  p_participant_id uuid,
  p_quantity       text,
  p_from           timestamptz,
  p_to             timestamptz,
  p_step           interval
)
returns table (bucket timestamptz, value double precision, series jsonb)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with chosen as (select * from participant_curve_series(p_participant_id, p_quantity, p_from, p_to))
  select r.bucket, sum(r.value), jsonb_object_agg(c.series_id, c.kind)
    from chosen c
    cross join lateral resample(c.series_id, p_from, p_to, p_step) r
   group by r.bucket
   order by r.bucket;
$$;

comment on function participant_curve(uuid, text, timestamptz, timestamptz, interval) is
  'The amount of a participant over a period on a step, measured when it is, estimated otherwise: the sum of the series participant_curve_series() reads, each as resample() reads it, with each series and its kind. The one path of consumption.curve() and of the battery dispatch. Nothing when there is no series.';

grant execute on function participant_curve_series(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function participant_curve(uuid, text, timestamptz, timestamptz, interval) to authenticated, service_role;

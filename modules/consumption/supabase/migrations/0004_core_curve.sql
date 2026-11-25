-- Nexgen OS — consumption: the curve of a participant is the core's.
--
-- `consumption.curve_series()` and `consumption.curve()` chose the measured
-- series, else the simulated ones, and added them up; the battery module
-- read the consumption of a participant its own way. The choice and the sum
-- now live once, in the core (`participant_curve_series()`,
-- `participant_curve()`), read by every module; the two functions of this
-- module keep their names and their answers, and only name the quantity.

set search_path = nexgen, extensions;

create or replace function consumption.curve_series(p_participant_id uuid, p_from timestamptz, p_to timestamptz)
returns table (series_id uuid, kind text)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select series_id, kind from participant_curve_series(p_participant_id, 'consumption_energy', p_from, p_to);
$$;

comment on function consumption.curve_series(uuid, timestamptz, timestamptz) is
  'The series the consumption of a participant is read from over a period, with their kind: participant_curve_series() of the core for consumption_energy.';

create or replace function consumption.curve(p_participant_id uuid, p_from timestamptz, p_to timestamptz, p_step interval)
returns table (bucket timestamptz, value double precision, series jsonb)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select bucket, value, series from participant_curve(p_participant_id, 'consumption_energy', p_from, p_to, p_step);
$$;

comment on function consumption.curve(uuid, timestamptz, timestamptz, interval) is
  'The consumption of a participant over a period on a step: participant_curve() of the core for consumption_energy, measured when it is, estimated otherwise, with each series read and its kind.';

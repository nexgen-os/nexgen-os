-- Nexgen OS — module `weather`: degree-days read from a temperature series.
--
-- How cold or how warm a day was, against a base temperature, is what the
-- heating and cooling need of a place is read against: the heating
-- degree-days of a day are how far its mean temperature stays below the
-- base, its cooling degree-days how far it rises above it. They are read
-- here, by the mean daily temperature method, from any temperature series
-- (a weather point's or a participant's own sensor), cut in the local days
-- of the series. The base is data the caller gives (a pack, a study, a
-- standard it cites): the module holds no base of its own.

set search_path = nexgen, extensions;

create or replace function weather.degree_days(
  p_series_id uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_base      double precision,
  p_kind      text default 'heating'
)
returns table (day timestamptz, mean_temperature double precision, degree_days double precision, samples int, expected int)
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  q text;
begin
  if p_base is null then
    raise exception 'base_required: a degree-day is counted against a base temperature' using errcode = 'invalid_parameter_value';
  end if;
  if p_kind is null or p_kind not in ('heating', 'cooling') then
    raise exception 'degree_day_kind_unknown: % (heating or cooling)', p_kind using errcode = 'invalid_parameter_value';
  end if;

  -- Read under the caller's row level security: a series they cannot see
  -- is not found.
  select se.quantity_code into q from series se where se.id = p_series_id;
  if not found then
    raise exception 'series_not_found: %', p_series_id using errcode = 'no_data_found';
  end if;
  if q <> 'temperature' then
    raise exception 'temperature_required: series % holds %', p_series_id, q using errcode = 'invalid_parameter_value';
  end if;

  -- The mean of each local day (temperature aggregates by its mean), the
  -- day cut in the time zone of the series or of its weather point.
  return query
    select r.bucket,
           r.value,
           case when r.value is null then null
                when p_kind = 'heating' then greatest(p_base - r.value, 0)
                else greatest(r.value - p_base, 0) end,
           r.samples,
           r.expected
      from resample(p_series_id, p_from, p_to, '1 day', weather.time_zone_of(p_series_id)) r
     order by r.bucket;
end;
$$;

comment on function weather.degree_days(uuid, timestamptz, timestamptz, double precision, text) is
  'Degree-days of each local day of a temperature series, by the mean daily temperature method: heating, max(base - mean, 0); cooling, max(mean - base, 0), in kelvin days. The base is given by the caller, never a default. Days are cut in the time zone of the series (weather.time_zone_of()); a day without values has no degree-days. Returns the mean temperature, samples and expected as resample() does. Refuses base_required, degree_day_kind_unknown, series_not_found, temperature_required, and time_zone_required from resample().';

grant execute on function weather.degree_days(uuid, timestamptz, timestamptz, double precision, text) to authenticated, service_role;

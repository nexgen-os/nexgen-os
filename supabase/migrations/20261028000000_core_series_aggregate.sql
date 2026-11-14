-- Nexgen OS — core: several series added up, bucket by bucket.
--
-- A community, a portfolio or a participant with several meters reads the
-- total of its series on one step: `aggregate()` reads each one through
-- `resample()`, on the same buckets, and adds them up. It adds what adds
-- up — energies and volumes, whose values cover their interval — of one
-- quantity, in one time zone, and says per bucket how many series held a
-- value, so that a caller that needs every series in every bucket sees the
-- ones missing instead of a smaller total. Nothing is written.

set search_path = nexgen, extensions;

create or replace function aggregate(
  p_series_ids uuid[],
  p_from       timestamptz,
  p_to         timestamptz,
  p_step       interval,
  p_time_zone  text default null
)
returns table (bucket timestamptz, value double precision, series int, samples int, expected int, quality smallint)
language plpgsql
stable
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  ids      uuid[] := array(select distinct u from unnest(p_series_ids) u where u is not null order by u);
  id       uuid;
  s        series%rowtype;
  quantity text;
  agg      text;
  zones    text[];
  tz       text := p_time_zone;
begin
  if cardinality(ids) = 0 then
    raise exception 'series_required: aggregate() adds up at least one series' using errcode = 'invalid_parameter_value';
  end if;
  perform series_step_shape(p_step);

  foreach id in array ids loop
    s := series_for_read(id);
    if quantity is null then
      quantity := s.quantity_code;
    elsif s.quantity_code <> quantity then
      raise exception 'quantities_differ: % and %; aggregate() adds up series of one quantity', quantity, s.quantity_code
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  select q.aggregation into agg from quantities q where q.code = quantity;
  if agg <> 'sum' then
    raise exception 'quantity_not_summable: % is combined by its % over time; aggregate() adds up energies and volumes', quantity, agg
      using errcode = 'invalid_parameter_value';
  end if;

  if tz is null then
    zones := array(select distinct z from unnest(ids) i, series_time_zone(i) z where z is not null);
    if cardinality(zones) > 1 then
      raise exception 'time_zone_required: the series are read in % time zones (%); give the one to cut buckets in',
        cardinality(zones), array_to_string(zones, ', ') using errcode = 'invalid_parameter_value';
    end if;
    tz := zones[1];
  end if;

  return query
    select r.bucket,
           sum(r.value),
           count(r.value)::int,
           sum(r.samples)::int,
           sum(r.expected)::int,
           max(r.quality)::smallint
      from unnest(ids) i
      cross join lateral resample(i, p_from, p_to, p_step, tz) r
     group by r.bucket
     order by r.bucket;
end;
$$;

comment on function aggregate(uuid[], timestamptz, timestamptz, interval, text) is
  'Several series of one summable quantity added up on a regular step, each read by resample() on the same buckets: the total, how many series held a value in the bucket, their samples and expected counts, and the worst quality. Refuses series_required, series_not_found, quantities_differ, quantity_not_summable, time_zone_required (series in several time zones and none given), step_unsupported.';

grant execute on function aggregate(uuid[], timestamptz, timestamptz, interval, text) to authenticated, service_role;

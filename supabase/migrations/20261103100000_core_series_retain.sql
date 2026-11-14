-- Nexgen OS — core: raw values kept as long as the place decides, series_retain().
--
-- Decision 0007 says how long raw values are kept is a default of the
-- installation and its pack, that no number lives in the core, and that
-- aggregates outlive the raw values they summarise. This migration gives it
-- a function:
--
--   * the attribute type `series_retention`, an ISO 8601 duration (P3Y), is
--     resolved for a series by parameter_of(): the series, its object, its
--     participant, project and organisation, then the pack of its place;
--   * series_retain() removes, for each series that has one, the raw values
--     older than its retention, floored to the hour in UTC, and leaves its
--     hourly and daily rollups as they were: the months and years it read
--     stay readable through resample();
--   * a series without a retention keeps every value: the core decides no
--     duration of its own.
--
-- Forecast issues (forecast_values) are not touched. The function is for
-- the installation, run by its service role or a pg_cron job; the API roles
-- cannot call it.

set search_path = nexgen, extensions;

insert into attribute_types (code, name, description, datatype, published_by) values
  ('series_retention', 'Retention of raw values',
   'How long the raw values of a series are kept, as an ISO 8601 duration (P3Y), counted back from the day series_retain() runs: an attribute of the series, of an object above it or of the organisation, or a pack''s default for a country or a region. The hourly and daily rollups outlive it. A series with none keeps every value.',
   'text', 'core')
on conflict (code) do nothing;

-- The rollup trigger of 20261012200700_core_series, with one exception: the
-- values series_retain() removes leave their rollups as they were.
create or replace function series_values_refresh_rollups()
returns trigger
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  r record;
begin
  -- Raw values removed by series_retain(): their rollups outlive them.
  if current_setting('nexgen.retaining', true) = 'on' then
    return null;
  end if;
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
  'AFTER statement on series_values: computes again the rollups of the hours the statement touched (and, for a cumulative register, of the hour of the reading before); the values series_retain() removes leave theirs as they were.';

create or replace function series_retain(p_series_ids uuid[] default null, p_at timestamptz default now())
returns table (series_id uuid, retention text, kept_from timestamptz, removed bigint)
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  s         record;
  p         jsonb;
  v_period  interval;
  v_cut     timestamptz;
  n         bigint;
begin
  for s in
    select se.id from series se
     where se.kind <> 'forecast'
       and (p_series_ids is null or se.id = any (p_series_ids))
     order by se.id
  loop
    begin
      p := parameter_of('series', s.id, 'series_retention', p_at);
    exception when no_data_found then
      -- parameter_missing or parameter_not_decided: no retention, every value kept.
      continue;
    end;
    begin
      v_period := (p->>'value')::interval;
    exception when others then
      v_period := null;
    end;
    if p->>'value' !~ '^P' or v_period is null or v_period <= interval '0' then
      raise exception 'retention_invalid: % for series %, an ISO 8601 duration longer than zero is expected (P3Y)', p->>'value', s.id
        using errcode = 'check_violation';
    end if;
    v_cut := date_bin('1 hour', p_at - v_period, timestamptz '2000-01-01 00:00:00+00');
    perform set_config('nexgen.retaining', 'on', true);
    delete from series_values v where v.series_id = s.id and v.at < v_cut;
    get diagnostics n = row_count;
    perform set_config('nexgen.retaining', '', true);
    series_id := s.id;
    retention := p->>'value';
    kept_from := v_cut;
    removed := n;
    return next;
  end loop;
end;
$$;

comment on function series_retain(uuid[], timestamptz) is
  'Removes the raw values of each series (all, or those given) older than its retention, the attribute type series_retention resolved by parameter_of() as an ISO 8601 duration, cut at the hour in UTC; the rollups stay, forecast issues are not touched, a series without a retention keeps every value. One row per series that has a retention: {series_id, retention, kept_from, removed}. Refuses retention_invalid. For the installation (service role, pg_cron), not the API roles.';

revoke execute on function series_retain(uuid[], timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function nexgen.series_retain(uuid[], timestamptz) to service_role';
  end if;
end;
$$;

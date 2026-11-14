-- Nexgen OS — module `weather`: the time zone of a weather point.
--
-- The series of a point are series of the organisation, named by the point
-- (`external_ref` its id): no participant owns them, so the core finds no
-- time zone for them and their days and months were refused as
-- `time_zone_required`. A point now keeps the time zone of the
-- participants that read it, taken from the first one that has one, and
-- `weather.time_zone_of(series)` gives it to whoever cuts its series by day
-- or by month: `resample(s, from, to, '1 day', weather.time_zone_of(s))`.

set search_path = nexgen, extensions;

alter table weather.points add column time_zone text;

comment on column weather.points.time_zone is
  'The IANA time zone the point''s series are cut in by day and by month: that of the first participant with a time zone that reads it, set by point_for(). Null while no participant that reads it has one.';

-- BEFORE INSERT / UPDATE: the time zone is one Postgres knows, as for a
-- participant.
create or replace function weather.points_check_time_zone()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if new.time_zone is not null then
    begin
      perform now() at time zone new.time_zone;
    exception when invalid_parameter_value then
      raise exception 'time_zone_unknown: %', new.time_zone using errcode = 'check_violation';
    end;
  end if;
  return new;
end;
$$;

comment on function weather.points_check_time_zone() is
  'BEFORE INSERT / UPDATE on weather.points: the time zone is an IANA zone Postgres knows (time_zone_unknown).';

create trigger points_check_time_zone before insert or update of time_zone on weather.points
  for each row execute function weather.points_check_time_zone();

-- The points already there take the time zone of the first participant
-- with one that reads them.
update weather.points p
   set time_zone = (
     select s.time_zone
       from weather.participants wp
       join participants s on s.id = wp.participant_id
      where wp.point_id = p.id and s.time_zone is not null
      order by wp.created_at, s.id
      limit 1)
 where p.time_zone is null;

-- ---------------------------------------------------------------------------
-- point_for — the point now carries the participant's time zone.
-- ---------------------------------------------------------------------------

create or replace function weather.point_for(p_participant_id uuid, p_source_code text)
returns uuid
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  s         participants%rowtype;
  m         weather.sources%rowtype;
  position  geometry;
  c         numeric[];
  point_id  uuid;
begin
  select * into s from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  select * into m from weather.sources where source_code = p_source_code;
  if not found then
    raise exception 'weather_source_unknown: % is not a weather source', p_source_code using errcode = 'no_data_found';
  end if;

  position := ST_Centroid(s.geometry);
  if position is null then
    raise exception 'participant_without_position: %', p_participant_id using errcode = 'invalid_parameter_value';
  end if;
  c := weather.cell_of(position, m.grid_deg);

  select p.id into point_id
    from weather.points p
   where p.organisation_id = s.organisation_id
     and p.source_code = m.source_code
     and p.cell_lon = c[1] and p.cell_lat = c[2];

  if point_id is null then
    insert into weather.points (organisation_id, name, source_code, geometry, resolution_m, time_zone)
    values (s.organisation_id,
            (select name from sources where code = m.source_code) || ' ' || c[2] || ', ' || c[1],
            m.source_code,
            -- The cell's centre, or the station itself.
            ST_SetSRID(ST_MakePoint(c[1], c[2]), 4326),
            m.resolution_m,
            s.time_zone)
    returning id into point_id;
  elsif s.time_zone is not null then
    -- A point no participant with a time zone read yet takes this one's;
    -- a point that has one keeps it.
    update weather.points set time_zone = s.time_zone
     where id = point_id and time_zone is null;
  end if;

  insert into weather.participants (participant_id, point_id, organisation_id)
  values (p_participant_id, point_id, s.organisation_id)
  on conflict do nothing;

  return point_id;
end;
$$;

comment on function weather.point_for(uuid, text) is
  'The weather point a participant reads for a source: the organisation''s point in the source''s cell of the participant''s position, created when missing with the participant''s time zone (or given it when it has none), and records that the participant reads it (`weather.participants`). Named error participant_without_position when the participant has no geometry.';

-- ---------------------------------------------------------------------------
-- time_zone_of — the time zone a series is cut in by day and by month.
-- ---------------------------------------------------------------------------

create or replace function weather.time_zone_of(p_series_id uuid)
returns text
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select coalesce(
    series_time_zone(p_series_id),
    (select p.time_zone
       from series se
       join weather.points p
         on p.id::text = se.external_ref
        and p.organisation_id = se.organisation_id
        and p.source_code = se.source_code
      where se.id = p_series_id
        and se.object_kind = 'organisation'));
$$;

comment on function weather.time_zone_of(uuid) is
  'The time zone a series is cut in by day and by month: its participant''s (series_time_zone()), else, for a series of a weather point (a series of the organisation whose external_ref is the point and whose source is the point''s), the point''s. Null when there is none, never a default; pass it to resample() as its time zone.';

grant execute on function weather.time_zone_of(uuid) to authenticated, service_role;
grant execute on function weather.points_check_time_zone() to authenticated, service_role;

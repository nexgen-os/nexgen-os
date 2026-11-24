-- Nexgen OS — core: the series an amount of a participant is read from,
-- one path for every reader.
--
-- A value is written once and read along one path (decision 0065). The
-- consumption module (`consumption.curve()`) and the indicators
-- (`kpis.series_of()`) each chose the series of a participant their own
-- way, and the two could disagree: a heat pump's sub-meter could become the
-- whole consumption of its participant in the one and not in the other, two
-- estimates of one period added up in the other and not in the one, and a
-- planned device's simulated consumption entered neither. Both now read
-- `participant_series()`:
--
-- - **Measured first, the nearest level that has some**: the participant's
--   own series, else those of its meters, else those of its devices; every
--   measured series of that level counts (two meters add up).
-- - **An estimate replaces the one before it**: of the simulated (or
--   forecast) series of one object, only the latest counts.
-- - **A device's consumption is that device's**: a sub-meter or a model of
--   one appliance is a part of what its participant consumes, never the
--   whole — the mirror of `production_on_meter`, a meter's injection never
--   being a production. A participant with no consumption series of its own
--   or of its meters has none.
-- - **A planned device adds to the estimate**: its simulated series of an
--   energy (a quantity aggregated by sum) is not in what the participant's
--   own or its meters' estimate describes — no bill, no reading saw it — so
--   it is added to it. A device in service is already in that estimate.
-- - **A figure is not an input**: a series an indicator wrote back
--   (`<module>.figures:<id>`) is read from what it was computed from, never
--   in its place.
--
-- Given a period, only the series holding values in it count. Nothing is
-- stored and nothing is refused.

set search_path = nexgen, extensions;

create or replace function participant_series(
  p_participant_id uuid,
  p_quantity       text,
  p_kind           text default 'measured',
  p_from           timestamptz default null,
  p_to             timestamptz default null
)
returns setof uuid
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with candidate as (
    select se.id, se.object_id, se.created_at, d.status,
           case se.object_kind when 'participant' then 1 when 'meter' then 2 else 3 end as level
      from series se
      left join meters m on se.object_kind = 'meter' and m.id = se.object_id
      left join devices d on se.object_kind = 'device' and d.id = se.object_id
     where se.quantity_code = p_quantity
       and se.kind = p_kind
       and ((se.object_kind = 'participant' and se.object_id = p_participant_id)
            or m.participant_id = p_participant_id
            or d.participant_id = p_participant_id)
       and coalesce(se.source, '') not like '%.figures:%'
       and (p_from is null or exists (
             select 1 from series_values v
              where v.series_id = se.id and v.at >= p_from and (p_to is null or v.at < p_to) and v.quality <> 3))
  ),
  kept as (
    select c.* from candidate c
     where p_kind = 'measured'
        or c.id = (select c2.id from candidate c2 where c2.object_id = c.object_id order by c2.created_at desc, c2.id desc limit 1)
  ),
  whole as (
    select k.* from kept k where k.level < 3 or p_quantity <> 'consumption_energy'
  ),
  chosen as (
    select min(level) as level from whole
  )
  select w.id from whole w, chosen where w.level = chosen.level
  union
  select k.id from kept k, chosen
   where p_kind <> 'measured' and k.level = 3 and k.status = 'planned' and chosen.level < 3
     and exists (select 1 from quantities q where q.code = p_quantity and q.aggregation = 'sum');
$$;

comment on function participant_series(uuid, text, text, timestamptz, timestamptz) is
  'The series an amount of a participant is read from, for a quantity and a kind, holding values in the period when one is given: its own, else its meters'', else its devices'' — every measured series of that level, the latest simulated one of each object; a device''s consumption is never its participant''s whole; a planned device''s simulated energy adds to an estimate of the participant or its meters; a figure an indicator wrote back is never read. The one path of consumption.curve() and kpis.series_of(). Under the caller''s row level security.';

grant execute on function participant_series(uuid, text, text, timestamptz, timestamptz) to authenticated, service_role;

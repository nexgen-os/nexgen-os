-- Nexgen OS — module `community`: the cap on the power of an operation is
-- read at the places of its participants.
--
-- Where the rules of a country set a different cap by region (in France,
-- 5 MW on the mainland and 0.5 MW in the non-interconnected zones), the
-- cap read for the project alone is its country's: a project has no place
-- of its own. `sharing_max_power_kw` is now resolved by parameter_of() for
-- each participant taking part on the day — the project's own value first,
-- a cap granted by derogation and recorded with its decision as source,
-- then the pack's for the participant's region and the kind of the
-- project — and the smallest applies, as a perimeter holds for the whole
-- operation (check_perimeter() reads its distances the same way). Without
-- a participant taking part, the project's is read. Nothing is stored.

set search_path = nexgen, extensions;

create or replace function community.check_power(p_project_id uuid, p_on date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_at        timestamptz := p_on::timestamptz;
  v_cap       jsonb;
  v_producers jsonb;
  v_installed numeric;
begin
  if not exists (select 1 from projects where id = p_project_id) then
    raise exception 'project_not_found: %', p_project_id using errcode = 'no_data_found';
  end if;
  -- The smallest cap any participant's place gives; a place that decides none is not a cap.
  select c.cap into v_cap
    from participants x
    cross join lateral (select community.parameter_if_decided('participant', x.id, 'sharing_max_power_kw', v_at) cap) c
   where x.project_id = p_project_id
     and (x.join_date is null or x.join_date <= p_on) and (x.leave_date is null or x.leave_date >= p_on)
     and c.cap is not null and c.cap->'value' <> 'null'::jsonb
   order by (c.cap->>'value')::numeric, x.name, x.id
   limit 1;
  if v_cap is null then
    v_cap := community.parameter_if_decided('project', p_project_id, 'sharing_max_power_kw', v_at);
  end if;
  select jsonb_agg(jsonb_build_object('participant_id', x.id, 'name', x.name, 'installed_kw', installed_power(x.id, v_at)) order by x.name, x.id),
         sum(installed_power(x.id, v_at))
    into v_producers, v_installed
    from participants x
   where x.project_id = p_project_id and x.category in ('producer', 'prosumer')
     and (x.join_date is null or x.join_date <= p_on) and (x.leave_date is null or x.leave_date >= p_on);
  return jsonb_build_object(
    'max_kw', (v_cap->>'value')::numeric,
    'installed_kw', v_installed,
    'within', case when v_cap is null or v_cap->'value' = 'null'::jsonb or v_installed is null then null
                   else v_installed <= (v_cap->>'value')::numeric end,
    'producers', coalesce(v_producers, '[]'),
    'value_from', v_cap);
end;
$$;

comment on function community.check_power(uuid, date) is
  'The installed power of an energy sharing operation on a day against the greatest its rules allow: {max_kw, installed_kw, within, producers: [{participant_id, name, installed_kw}], value_from}. The cap is sharing_max_power_kw resolved by parameter_of() for each participant taking part — the project''s own first, then its pack''s for the participant''s region and the kind of the project — the smallest of them, or the project''s where no participant takes part; null where nothing decides it. The power is the sum of installed_power() of the producers and prosumers taking part, null where none carries a power; within is null when either is.';

grant execute on function community.check_power(uuid, date) to authenticated, service_role;

update nexgen.modules set version = '0.7.0' where code = 'community';

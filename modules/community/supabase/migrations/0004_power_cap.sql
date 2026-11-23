-- Nexgen OS — module `community`: the power of an operation against the
-- greatest its rules allow.
--
-- Where the rules of a place cap the installed power of an energy sharing
-- operation, the cap is pack data, the core's attribute type
-- `sharing_max_power_kw`, resolved for the project by parameter_of() (a
-- default for the kind of the project). The power it is read against is
-- never entered: it is the sum of the installed powers of the producers
-- taking part on the day, each computed from its devices by
-- installed_power() (decision 0065). Nothing is stored.

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
  v_cap := community.parameter_if_decided('project', p_project_id, 'sharing_max_power_kw', v_at);
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
  'The installed power of an energy sharing operation on a day against the greatest its rules allow: {max_kw, installed_kw, within, producers: [{participant_id, name, installed_kw}], value_from}. The cap is sharing_max_power_kw resolved for the project by parameter_of(), null where nothing decides it; the power is the sum of installed_power() of the producers and prosumers taking part, null where none carries a power; within is null when either is.';

grant execute on function community.check_power(uuid, date) to authenticated, service_role;

update nexgen.modules set version = '0.5.0' where code = 'community';

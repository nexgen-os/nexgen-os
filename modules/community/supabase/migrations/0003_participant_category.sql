-- Nexgen OS — module `community`: a participant's category (decision 0057).
--
-- What a participant does with energy — producer, consumer, prosumer — is
-- now its `category` in the core (formerly `participants.role`). The
-- perimeter of an operation reads it to find the producers, and returns it
-- under that name; the function is otherwise the one of 0002_sharing.

set search_path = nexgen, extensions;

drop function community.check_perimeter(uuid, date);

-- of which suffices, resolved for each participant by parameter_of() (a
-- default for the kind of the project, its region); its values are the
-- defaults the criteria read (sharing_max_distance_m, sharing_radius_m),
-- resolved for each participant too — for its density class, its
-- municipality — the smallest applying to all, as a perimeter holds for the
-- whole operation. Producers are the participants producing or
-- self-producing. A criterion that cannot be decided (no place, no
-- municipality, no substation said) answers null, never guessed.
create function community.check_perimeter(p_project_id uuid, p_on date)
returns table (participant_id uuid, name text, category text, in_perimeter boolean, criteria jsonb, rule jsonb)
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_at        timestamptz := p_on::timestamptz;
  v_rule      jsonb;
  v_rule_src  jsonb;
  v_other     jsonb;
  v_ids       uuid[];
  v_producers uuid[];
  v_crit      text;
  v_value     jsonb;
  v_val       double precision;
  v_val_from  jsonb;
  v_res       jsonb;
  p           record;
  v_same      jsonb;
  v_has_grid  boolean := to_regprocedure('grid.same_substation(uuid[])') is not null;
  v_ext       jsonb;
  v_in        boolean;
  v_detail    jsonb;
  v_rows      jsonb := '[]';
begin
  if not exists (select 1 from projects where id = p_project_id) then
    raise exception 'project_not_found: %', p_project_id using errcode = 'no_data_found';
  end if;
  select array_agg(x.id order by x.name, x.id), array_agg(x.id) filter (where x.category in ('producer', 'prosumer'))
    into v_ids, v_producers
    from participants x
   where x.project_id = p_project_id and x.country is not null
     and (x.join_date is null or x.join_date <= p_on) and (x.leave_date is null or x.leave_date >= p_on);
  if v_ids is null then
    raise exception 'participants_missing: the project has no participant taking part on %', p_on using errcode = 'no_data_found';
  end if;
  if v_producers is null then
    raise exception 'producer_missing: the project has no producer on %', p_on using errcode = 'no_data_found';
  end if;

  -- One rule for the operation: every participant's place gives the same.
  for p in select unnest(v_ids) id loop
    v_other := parameter_of('participant', p.id, 'sharing_perimeter', v_at);
    if v_rule_src is null then
      v_rule_src := v_other;
    elsif v_other->'value' is distinct from v_rule_src->'value' then
      raise exception 'perimeter_rule_differs: the places of the participants give % and %', v_rule_src->'value', v_other->'value'
        using errcode = 'cardinality_violation';
    end if;
  end loop;
  v_rule := v_rule_src->'value';
  if jsonb_typeof(v_rule) <> 'array' or jsonb_array_length(v_rule) = 0 or exists (
       select 1 from jsonb_array_elements_text(v_rule) c
        where c not in ('max_distance_between_members', 'radius_around_producer', 'same_municipality', 'same_substation', 'same_region')) then
    raise exception 'perimeter_rule_unknown: %', v_rule using errcode = 'invalid_parameter_value';
  end if;


  for v_crit in select jsonb_array_elements_text(v_rule) loop
    v_val := null;
    v_val_from := null;
    if v_crit in ('max_distance_between_members', 'radius_around_producer') then
      -- The value: the smallest the places of the participants give.
      for p in select unnest(v_ids) id loop
        v_value := parameter_of('participant', p.id,
                                case v_crit when 'max_distance_between_members' then 'sharing_max_distance_m' else 'sharing_radius_m' end, v_at);
        if v_val is null or (v_value->>'value')::double precision < v_val then
          v_val := (v_value->>'value')::double precision;
          v_val_from := v_value || jsonb_build_object('participant_id', p.id);
        end if;
      end loop;
    end if;

    for p in
      select x.id, x.geometry, x.municipality, x.region, x.country from participants x where x.id = any (v_ids)
    loop
      if v_crit = 'max_distance_between_members' then
        select max(ST_Distance(ST_Force2D(p.geometry)::geography, ST_Force2D(o.geometry)::geography)) into v_res
          from participants o where o.id = any (v_ids) and o.id <> p.id;
        select case when p.geometry is null or exists (select 1 from participants o where o.id = any (v_ids) and o.geometry is null) then null
                    else coalesce((v_res #>> '{}')::double precision, 0) <= v_val end,
               jsonb_build_object('value_m', v_val, 'distance_m', round(coalesce((v_res #>> '{}')::numeric, 0), 1), 'value_from', v_val_from,
                                  'measured', 'the greatest distance to another participant') into v_in, v_detail;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('participant_id', p.id, 'criterion', v_crit, 'in', v_in) || coalesce(v_detail, '{}'));
      elsif v_crit = 'radius_around_producer' then
        select to_jsonb(min(ST_Distance(ST_Force2D(p.geometry)::geography, ST_Force2D(o.geometry)::geography))) into v_res
          from participants o where o.id = any (v_producers) and o.geometry is not null;
        select case when p.geometry is null or v_res = 'null'::jsonb then null else (v_res #>> '{}')::double precision <= v_val end,
               jsonb_build_object('value_m', v_val, 'distance_m', round((v_res #>> '{}')::numeric, 1), 'value_from', v_val_from,
                                  'measured', 'the distance to the nearest producer') into v_in, v_detail;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('participant_id', p.id, 'criterion', v_crit, 'in', v_in) || coalesce(v_detail, '{}'));
      elsif v_crit = 'same_municipality' then
        v_ext := null;
        if p.municipality is not null and not exists (
             select 1 from participants o where o.id = any (v_producers) and o.municipality = p.municipality) then
          -- A producer of a technology may extend the perimeter to an
          -- adjacent municipality (sharing_municipality_extension_m): the
          -- limits of municipalities are not in the model, so it is said, not decided.
          select jsonb_agg(jsonb_build_object('device_id', d.id, 'value_m', (e.v->>'value')::double precision, 'source_code', e.v->>'source_code', 'reference', e.v->>'reference'))
            into v_ext
            from devices d
            cross join lateral (select community.parameter_if_decided('device', d.id, 'sharing_municipality_extension_m', v_at) v) e
           where d.participant_id = any (v_producers) and d.status <> 'removed' and e.v is not null;
        end if;
        select case when p.municipality is null or exists (select 1 from participants o where o.id = any (v_producers) and o.municipality is null) then null
                    when exists (select 1 from participants o where o.id = any (v_producers) and o.municipality = p.municipality) then true
                    when v_ext is not null then null
                    else false end,
               jsonb_strip_nulls(jsonb_build_object('municipality', p.municipality,
                 'producers', (select jsonb_agg(distinct o.municipality) from participants o where o.id = any (v_producers)),
                 'extension', v_ext)) into v_in, v_detail;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('participant_id', p.id, 'criterion', v_crit, 'in', v_in) || coalesce(v_detail, '{}'));
      elsif v_crit = 'same_substation' then
        if v_has_grid then
          execute 'select grid.same_substation($1)' into v_same using array_append(v_producers, p.id);
        end if;
        select case when v_has_grid then (v_same->>'same')::boolean end,
               case when v_has_grid then jsonb_build_object('substations', v_same->'substations')
                    else jsonb_build_object('note', 'the grid module is not installed') end into v_in, v_detail;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('participant_id', p.id, 'criterion', v_crit, 'in', v_in) || coalesce(v_detail, '{}'));
      elsif v_crit = 'same_region' then
        select case when p.region is null or exists (select 1 from participants o where o.id = any (v_producers) and o.region is null) then null
                    else not exists (select 1 from participants o where o.id = any (v_producers) and o.region <> p.region) end,
               jsonb_build_object('region', p.region) into v_in, v_detail;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('participant_id', p.id, 'criterion', v_crit, 'in', v_in) || coalesce(v_detail, '{}'));
      end if;
    end loop;
  end loop;

  return query
    select x.id, x.name, x.category,
           case when bool_or((r.row->>'in')::boolean) then true
                when count(*) filter (where (r.row->>'in') is null) > 0 then null else false end,
           jsonb_agg(r.row - 'participant_id' order by r.n),
           jsonb_build_object('criteria', v_rule, 'level', v_rule_src->'level', 'region', v_rule_src->'region', 'country', v_rule_src->'country',
                              'conditions', v_rule_src->'conditions', 'source_code', v_rule_src->'source_code', 'reference', v_rule_src->'reference')
      from participants x
      join jsonb_array_elements(v_rows) with ordinality r(row, n) on (r.row->>'participant_id')::uuid = x.id
     group by x.id, x.name, x.category
     order by x.name, x.id;
end;
$$;

comment on function community.check_perimeter(uuid, date) is
  'Whether each participant of a project taking part on a day is within the perimeter of the operation: the rule (sharing_perimeter, criteria any one of which suffices) and its values (sharing_max_distance_m, sharing_radius_m, the smallest any participant''s place gives) are pack data read by parameter_of(); per participant, its category and {in_perimeter, criteria: [{criterion, in, value_m, distance_m, value_from…}], rule: {criteria, level, conditions, source_code, reference}}. A criterion that cannot be decided answers null. Refuses project_not_found, participants_missing, producer_missing, perimeter_rule_differs, perimeter_rule_unknown, parameter_missing.';

grant execute on function community.check_perimeter(uuid, date) to authenticated, service_role;

update nexgen.modules set version = '0.4.0' where code = 'community';

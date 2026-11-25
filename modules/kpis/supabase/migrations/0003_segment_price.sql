-- Nexgen OS — indicators: an energy price chosen by the segment of the
-- participant.
--
-- The savings of self-consumption were two indicators, one at the household
-- price and one at the business price, and the energy community report read
-- the household one for every participant. A parameter variable may now name,
-- by segment, the attribute type a participant of that segment reads in its
-- place (`by_segment`): the most specific segment its own segment refines
-- decides, else the parameter it names. A project reads the choice its
-- participants share; when they differ, the parameter it names, and the
-- figure says so (fallbacks). `self_consumption_savings` reads the household
-- price for a residential participant and the business price for a
-- professional one, and the energy community report reads it. The two
-- indicators by price stay, for whoever compares them.

set search_path = nexgen, extensions;

-- The attribute type a parameter variable reads for an object, chosen by the
-- segment of its participants: for each, the attribute type of the most
-- specific segment of `by_segment` its own segment is or refines, else the
-- parameter of the variable; the one they share; null when they differ. An
-- object without participants (a meter, a device, an empty project) reads
-- the parameter of the variable.
create or replace function kpis.parameter_by_segment(p_kind text, p_id uuid, p_spec jsonb)
returns text
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with read as (
    select pa.segment
      from participants pa
     where (p_kind = 'participant' and pa.id = p_id)
        or (p_kind = 'project' and pa.project_id = p_id)
        or (p_kind = 'meter' and pa.id = (select m.participant_id from meters m where m.id = p_id))
        or (p_kind = 'device' and pa.id = (select d.participant_id from devices d where d.id = p_id))
  ), chosen as (
    select distinct coalesce(
             (select k.value
                from jsonb_each_text(p_spec->'by_segment') k
               where is_a('segments', r.segment, k.key)
               order by (select count(*) from jsonb_object_keys(p_spec->'by_segment') o where is_a('segments', k.key, o)) desc, k.key
               limit 1),
             p_spec->>'parameter') code
      from read r
  )
  select case when count(*) = 0 then p_spec->>'parameter' when count(*) = 1 then min(code) end from chosen;
$$;

comment on function kpis.parameter_by_segment(text, uuid, jsonb) is
  'The attribute type a parameter variable of an indicator reads for an object: for each of its participants, the one by_segment names for the most specific segment its own segment is or refines, else the parameter of the variable; the one they share; null when they differ. An object without participants reads the parameter of the variable. Under the caller''s row level security.';

grant execute on function kpis.parameter_by_segment(text, uuid, jsonb) to authenticated, service_role;

create or replace function kpis.indicators_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k        text;
  v        jsonb;
  resolved text[];
  pending  text[];
begin
  for k, v in select * from jsonb_each(new.variables) loop
    if k !~ '^[a-z][a-z0-9_]*$' or k in ('min', 'max', 'abs', 'neg') then
      raise exception 'variable_invalid: % of % is not a variable name', k, new.code using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v) <> 'object' or ((v ? 'quantity') = (v ? 'parameter')) then
      raise exception 'variable_invalid: % of % reads a quantity or a parameter', k, new.code using errcode = 'check_violation';
    end if;
    if v ? 'parameter' and not exists (select 1 from attribute_types where code = v->>'parameter') then
      raise exception 'attribute_type_unknown: % (variable % of %)', v->>'parameter', k, new.code using errcode = 'foreign_key_violation';
    end if;
    if v ? 'by_segment' then
      if not v ? 'parameter' or jsonb_typeof(v->'by_segment') <> 'object'
         or exists (select 1 from jsonb_each(v->'by_segment') s where jsonb_typeof(s.value) <> 'string') then
        raise exception 'variable_invalid: % of % reads a parameter, and by segment another, {"<segment>": "<attribute type>"}', k, new.code using errcode = 'check_violation';
      end if;
      if exists (select 1 from jsonb_object_keys(v->'by_segment') s where not exists (select 1 from segments where code = s)) then
        raise exception 'segment_unknown: % of % names a segment that is not a segments code', k, new.code using errcode = 'foreign_key_violation';
      end if;
      if exists (select 1 from jsonb_each_text(v->'by_segment') s where not exists (select 1 from attribute_types where code = s.value)) then
        raise exception 'attribute_type_unknown: % of % reads by segment an attribute type that does not exist', k, new.code using errcode = 'foreign_key_violation';
      end if;
    end if;
    if v ? 'combine' and (not v ? 'step' or v->>'combine' not in ('sum', 'mean', 'max', 'min')) then
      raise exception 'variable_invalid: % of % combines by sum, mean, max or min a quantity read on a step', k, new.code using errcode = 'check_violation';
    end if;
    if v ? 'kind' and v->>'kind' not in ('measured', 'simulated', 'forecast') then
      raise exception 'variable_invalid: % of % reads measured, simulated or forecast series', k, new.code using errcode = 'check_violation';
    end if;
    if v ? 'step' then
      perform series_step_shape((v->>'step')::interval);
    end if;
    if v ? 'shift' then
      perform (v->>'shift')::interval;
    end if;
    if v ? 'otherwise' then
      if not v ? 'quantity' or jsonb_typeof(v->'otherwise') <> 'string' then
        raise exception 'variable_invalid: % of % reads a quantity, and otherwise a formula over the other variables', k, new.code using errcode = 'check_violation';
      end if;
      perform kpis.compile(v->>'otherwise', new.variables);
    end if;
    if v ? 'times' and (not v ? 'quantity' or jsonb_typeof(v->'times') <> 'object' or not v->'times' ? 'quantity'
                        or (v->'times' ? 'kind' and v->'times'->>'kind' not in ('measured', 'simulated', 'forecast'))
                        or (v->'times' ? 'zone' and jsonb_typeof(v->'times'->'zone') <> 'boolean')) then
      raise exception 'variable_invalid: % of % weights a quantity by the series of a price, {"quantity": …}', k, new.code using errcode = 'check_violation';
    end if;
    if v ? 'without_times' then
      if not v ? 'times' or jsonb_typeof(v->'without_times') <> 'string' then
        raise exception 'variable_invalid: % of % weights by a series, and without it a formula over the other variables', k, new.code using errcode = 'check_violation';
      end if;
      perform kpis.compile(v->>'without_times', new.variables);
    end if;
  end loop;
  -- A variable computed otherwise never reads itself, through others or not.
  resolved := array(select e.key from jsonb_each(new.variables) e where not (e.value ? 'otherwise' or e.value ? 'without_times'));
  loop
    pending := array(select e.key from jsonb_each(new.variables) e
                      where (e.value ? 'otherwise' or e.value ? 'without_times') and not e.key = any (resolved)
                        and kpis.program_variables(kpis.compile(coalesce(e.value->>'otherwise', '0'), new.variables)) <@ resolved
                        and kpis.program_variables(kpis.compile(coalesce(e.value->>'without_times', '0'), new.variables)) <@ resolved);
    exit when cardinality(pending) = 0;
    resolved := resolved || pending;
  end loop;
  if exists (select 1 from jsonb_object_keys(new.variables) n where not n = any (resolved)) then
    raise exception 'variable_invalid: the otherwise formulas of % read each other in a circle', new.code using errcode = 'check_violation';
  end if;
  new.program := kpis.compile(new.formula, new.variables);
  return new;
end;
$$;

create or replace function kpis.measure(
  p_object_kind  text,
  p_object_id    uuid,
  p_indicator    text,
  p_from         timestamptz,
  p_to           timestamptz,
  p_granularity  interval default null
)
returns jsonb
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  ind       kpis.indicators%rowtype;
  q         quantities%rowtype;
  org       uuid;
  tz        text;
  origin    timestamptz;
  starts    timestamptz[];
  b         timestamptz;
  vname     text;
  spec      jsonb;
  ids       uuid[];
  pids      uuid[];
  skind     text;
  pkind     text;
  read_step interval;
  shift     interval;
  combine   text;
  agg       text;
  vals      jsonb := '{}';
  series    jsonb := '{}';
  params    jsonb := '{}';
  sources   jsonb := '{}';
  prices    jsonb := '{}';
  derived   jsonb := '{}';
  fallbacks jsonb := '{}';
  queue     text[];
  done      text[] := '{}';
  prog      text[];
  answer    jsonb;
  pcode     text;
  answers   jsonb;
  totals    jsonb := '{}';
  buckets   jsonb := '[]';
  bvars     jsonb;
  dvars     jsonb;
  total     double precision;
  additive  boolean;
  progress  boolean;
begin
  select * into ind from kpis.indicators where code = p_indicator;
  if not found then
    raise exception 'indicator_unknown: %', p_indicator using errcode = 'foreign_key_violation';
  end if;
  if not p_object_kind = any (ind.applies_to) then
    raise exception 'indicator_not_applicable: % applies to %, not to a %', p_indicator, array_to_string(ind.applies_to, ', '), p_object_kind
      using errcode = 'invalid_parameter_value';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'period_invalid: a period ends after it starts' using errcode = 'invalid_parameter_value';
  end if;
  org := object_organisation(p_object_kind, p_object_id);
  if not (caller_bypasses_rls() or has_capability(p_object_kind, p_object_id, 'data.read')) then
    raise exception 'object_not_found: % %', p_object_kind, p_object_id using errcode = 'no_data_found';
  end if;
  tz := kpis.time_zone_of(p_object_kind, p_object_id);
  if p_granularity is not null then
    if series_step_shape(p_granularity) <> 'time' and tz is null then
      raise exception 'time_zone_required: a granularity of a day or more needs the time zone of the object''s participants' using errcode = 'invalid_parameter_value';
    end if;
    origin := series_origin(p_from, tz);
    starts := array(select series_bucket_starts(p_from, p_to, p_granularity, tz));
  else
    starts := array[p_from];
  end if;
  select aggregation into agg from quantities where code = ind.quantity_code;
  additive := agg = 'sum';

  -- The variables the formula reads, and those the formula of a variable
  -- without a series reads in its place: a variable nothing needs is not read.
  queue := kpis.program_variables(ind.program);
  while cardinality(queue) > 0 loop
    vname := queue[1];
    queue := queue[2:];
    continue when vname = any (done);
    done := done || vname;
    spec := ind.variables->vname;
    if spec ? 'quantity' then
      select * into q from quantities where code = spec->>'quantity';
      if not found then
        raise exception 'quantity_unknown: % (variable % of %)', spec->>'quantity', vname, p_indicator using errcode = 'foreign_key_violation';
      end if;
      -- The series are those holding values in the period read, shifted as the variable reads it.
      shift := coalesce((spec->>'shift')::interval, interval '0');
      select v.ids, v.kind into ids, skind
        from kpis.variable_series(p_object_kind, p_object_id, q.code, spec->>'kind',
                                  ((p_from at time zone coalesce(tz, 'UTC')) + shift) at time zone coalesce(tz, 'UTC'),
                                  ((p_to at time zone coalesce(tz, 'UTC')) + shift) at time zone coalesce(tz, 'UTC')) v;
      if cardinality(ids) = 0 then
        if spec ? 'otherwise' then
          prog := kpis.compile(spec->>'otherwise', ind.variables);
          derived := derived || jsonb_build_object(vname, to_jsonb(prog));
          sources := sources || jsonb_build_object(vname, 'computed');
          queue := queue || kpis.program_variables(prog);
          continue;
        end if;
        raise exception 'series_not_found: no % series of % on % % (variable % of %)',
          coalesce(spec->>'kind', 'measured or simulated'), q.code, p_object_kind, p_object_id, vname, p_indicator using errcode = 'no_data_found';
      end if;
      series := series || jsonb_build_object(vname, to_jsonb(ids));
      sources := sources || jsonb_build_object(vname, skind);
      read_step := coalesce((spec->>'step')::interval, p_granularity, interval '1 hour');
      combine := coalesce(spec->>'combine', case when q.aggregation = 'sum' or spec ? 'times' then 'sum' else 'mean' end);
      pids := '{}';
      if spec ? 'times' then
        select v.ids, v.kind into pids, pkind
          from kpis.price_series_of(p_object_kind, p_object_id, spec->'times'->>'quantity', spec->'times'->>'kind',
                                    coalesce((spec->'times'->>'zone')::boolean, false)) v;
        if cardinality(pids) = 0 and spec ? 'without_times' then
          -- No series to weight by: the variable from its formula, and the figure says so.
          series := series - vname;
          prog := kpis.compile(spec->>'without_times', ind.variables);
          derived := derived || jsonb_build_object(vname, to_jsonb(prog));
          sources := sources || jsonb_build_object(vname, 'computed');
          fallbacks := fallbacks || jsonb_build_object(vname, jsonb_build_object('without', spec->'times'->>'quantity', 'formula', spec->>'without_times'));
          queue := queue || kpis.program_variables(prog);
          continue;
        end if;
        if cardinality(pids) = 0 then
          raise exception 'prices_required: no % series of % %, its parents or its organisation (variable % of %)',
            spec->'times'->>'quantity', p_object_kind, p_object_id, vname, p_indicator using errcode = 'no_data_found';
        end if;
        prices := prices || jsonb_build_object(vname, jsonb_build_object('quantity', spec->'times'->>'quantity', 'kind', pkind, 'series', to_jsonb(pids)));
      end if;
      -- The amount of each read bucket over the series — weighted by the
      -- price of the bucket when the variable says so, a bucket without a
      -- price leaving its bucket without a value — combined into the
      -- buckets of the granularity.
      with e as (
        select * from kpis.read_amounts(ids, q.aggregation, p_from, p_to, read_step, tz, shift)
      ), pr as (
        select * from kpis.read_amounts(pids, 'mean', p_from, p_to, read_step, tz, shift)
      ), per_read as (
        select e.at, case when spec ? 'times' then e.v * pr.v else e.v end v
          from e left join pr on pr.at = e.at
      ), per_bucket as (
        select case when p_granularity is null then p_from else series_bucket(pr.at, p_granularity, origin, tz) end bucket,
               case when bool_or(pr.v is null) then null
                    else case combine when 'sum' then sum(pr.v) when 'mean' then avg(pr.v) when 'max' then max(pr.v) else min(pr.v) end end v
          from per_read pr group by 1
      )
      select coalesce(jsonb_object_agg(pb.bucket::text, pb.v), '{}') into bvars from per_bucket pb;
      vals := vals || jsonb_build_object(vname, bvars);
      -- The period: the values of the buckets combined the same way.
      totals := totals || jsonb_build_object(vname, (
        select case when bool_or(e.value = 'null') then null
                    else case combine when 'sum' then sum(e.value::text::float8) when 'mean' then avg(e.value::text::float8)
                                      when 'max' then max(e.value::text::float8) else min(e.value::text::float8) end end
          from jsonb_each(bvars) e
         where e.key::timestamptz = any (starts)));
    else
      bvars := '{}';
      answers := '[]';
      -- A parameter chosen by the segment of the object's participants.
      pcode := spec->>'parameter';
      if spec ? 'by_segment' then
        pcode := kpis.parameter_by_segment(p_object_kind, p_object_id, spec);
        if pcode is null then
          pcode := spec->>'parameter';
          fallbacks := fallbacks || jsonb_build_object(vname, jsonb_build_object('segments', 'mixed', 'parameter', pcode));
        end if;
      end if;
      foreach b in array starts loop
        answer := parameter_of(p_object_kind, p_object_id, pcode, greatest(b, p_from));
        bvars := bvars || jsonb_build_object(b::text, answer->'value');
        if not answers @> jsonb_build_array(answer) then
          answers := answers || jsonb_build_array(answer);
        end if;
      end loop;
      vals := vals || jsonb_build_object(vname, bvars);
      params := params || jsonb_build_object(vname, answers);
      totals := totals || jsonb_build_object(vname, bvars->(p_from::text));
      if totals->vname is null or jsonb_typeof(totals->vname) = 'null' then
        totals := totals || jsonb_build_object(vname, bvars->(starts[1]::text));
      end if;
    end if;
  end loop;

  -- A variable without a series, from the formula it names, bucket by
  -- bucket and over the period, once the variables it reads are had.
  loop
    progress := false;
    for vname, spec in select * from jsonb_each(derived) loop
      continue when vals ? vname;
      prog := array(select jsonb_array_elements_text(spec));
      continue when exists (select 1 from unnest(kpis.program_variables(prog)) n where not vals ? n);
      dvars := '{}';
      foreach b in array starts loop
        bvars := (select coalesce(jsonb_object_agg(v.key, v.value->(b::text)), '{}') from jsonb_each(vals) v);
        dvars := dvars || jsonb_build_object(b::text, kpis.evaluate(prog, bvars));
      end loop;
      vals := vals || jsonb_build_object(vname, dvars);
      totals := totals || jsonb_build_object(vname, kpis.evaluate(prog, totals));
      progress := true;
    end loop;
    exit when not progress;
  end loop;

  -- Each bucket, then the period: the sum of the buckets for an additive
  -- figure, the formula over the period's amounts for a rate.
  foreach b in array starts loop
    bvars := (select coalesce(jsonb_object_agg(v.key, v.value->(b::text)), '{}') from jsonb_each(vals) v);
    buckets := buckets || jsonb_build_array(jsonb_build_object(
      'at', b, 'value', kpis.evaluate(ind.program, bvars), 'variables', bvars));
  end loop;
  if additive and p_granularity is not null then
    select sum((e->>'value')::float8) into total from jsonb_array_elements(buckets) e;
  else
    total := kpis.evaluate(ind.program, totals);
  end if;

  return jsonb_build_object(
    'indicator', p_indicator,
    'object_kind', p_object_kind,
    'object_id', p_object_id,
    'from', p_from,
    'to', p_to,
    'granularity', p_granularity,
    'time_zone', tz,
    'quantity_code', ind.quantity_code,
    'buckets', buckets,
    'total', jsonb_build_object('value', total, 'variables', totals),
    'series', series,
    'read', sources,
    'prices', prices,
    'fallbacks', fallbacks,
    'parameters', params);
end;
$$;

comment on function kpis.measure(text, uuid, text, timestamptz, timestamptz, interval) is
  'An indicator for an object over a period, by buckets of a granularity (null: the period), computed and written nowhere: the value and variables of each bucket and of the period, the series, prices and parameters read, and how each quantity variable was had (measured, simulated, or computed from its otherwise formula when the object has no series of it; fallbacks: a variable weighted by a series computed from its without_times formula when there is none, the hourly emission factor of its zone giving way to the monthly default, a parameter chosen by segment read as the variable names it when the participants of a project differ in segment). A parameter variable naming by_segment reads the attribute type parameter_by_segment() chooses. Refuses indicator_unknown, indicator_not_applicable, period_invalid, object_not_found, time_zone_required, quantity_unknown, series_not_found, prices_required, and what parameter_of() and resample() refuse.';

-- One savings indicator, at the price of the participant's segment.
insert into kpis.indicators (code, name, quantity_code, display_unit, applies_to, better, formula, variables, reference, description) values
  ('self_consumption_savings', 'Savings by self-consumption', 'amount', null, '{participant,project}', 'higher',
   '(direct + discharge) * (energy_price + grid_fees) / 1000',
   '{"direct": {"quantity": "self_consumption_energy", "otherwise": "production - injection - charge"}, "production": {"quantity": "production_energy"}, "injection": {"quantity": "injection_energy"}, "charge": {"quantity": "battery_charge_energy", "otherwise": "0"}, "discharge": {"quantity": "battery_discharge_energy", "otherwise": "0"}, "energy_price": {"parameter": "energy_price_household", "by_segment": {"professional": "energy_price_business"}}, "grid_fees": {"parameter": "grid_fees_and_taxes"}}', null,
   'What the energy consumed on the spot would have cost from the grid, at the energy price of the participant''s segment (the household price for a residential participant, the business price for a professional one) and the grid fees and taxes of the place (prices per MWh), unless the object, its parents or its organisation set their own; for a project whose participants differ in segment, at the household price, and the figure says so; in the currency of the place.');

update kpis.templates
   set layout = jsonb_set(layout, '{sheets,1,sections,1,indicators,0}', '"self_consumption_savings"')
 where code = 'energy_community_report'
   and layout #>> '{sheets,1,sections,1,indicators,0}' = 'self_consumption_savings_household';


-- Nexgen OS — module `kpis`: a peak at the step the meters keep.
--
-- `peak_offtake_power` read the energy taken from the grid by hour and kept
-- the heaviest: on a meter read every quarter of an hour, a peak of 10 kW
-- over 15 minutes in an hour of 3.25 kWh came out at 3.25 kW, where a
-- capacity tariff (Flanders) or the peaks of a supply contract read 10 kW.
-- Read by quarter-hours instead, an hourly series put its hour whole in one
-- quarter, 13 kW for the same 3.25 kWh.
--
-- A variable that names a step now reads its series on that step or on the
-- coarsest step they are kept at, whichever is coarser
-- (`kpis.own_step()`: each series' step, or for an irregular series the
-- smallest gap between two of its readings), and the figure says the step
-- read (`steps`). A variable may read its amount `per` a duration: the
-- energy of each read bucket over its length, a mean power. The peak reads
-- the offtake by quarter-hours per hour: 10 kW on a quarter-hour meter,
-- 3.25 kW on an hourly one, the same quarter or hour for all the
-- participants of a project.

set search_path = nexgen, extensions;

-- The coarsest step a set of series is kept at, under a day: each one's
-- step, or for an irregular series the smallest gap between two of its
-- readings in the period. Null when none says. A series kept by days or
-- months is read as before.
create or replace function kpis.own_step(p_ids uuid[], p_from timestamptz, p_to timestamptz)
returns interval
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  sid       uuid;
  st        interval;
  coarsest  interval;
begin
  foreach sid in array p_ids loop
    select se.step into st from series se where se.id = sid;
    if st is null then
      select min(w.at - w.before) into st
        from (select x.at, lag(x.at) over (order by x.at) before from "window"(sid, p_from, p_to, 10000) x) w
       where w.before is not null;
    end if;
    if st is not null and series_step_shape(st) = 'time' and (coarsest is null or st > coarsest) then
      coarsest := st;
    end if;
  end loop;
  return coarsest;
end;
$$;

comment on function kpis.own_step(uuid[], timestamptz, timestamptz) is
  'The coarsest step under a day a set of series is kept at: each one''s step, or for an irregular series the smallest gap between two of its readings in the period; null when none says.';

grant execute on function kpis.own_step(uuid[], timestamptz, timestamptz) to authenticated, service_role;

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
    if v ? 'combine' and (not v ? 'step' or v->>'combine' not in ('sum', 'mean', 'max', 'min')) then
      raise exception 'variable_invalid: % of % combines by sum, mean, max or min a quantity read on a step', k, new.code using errcode = 'check_violation';
    end if;
    if v ? 'per' and (not v ? 'step' or series_step_shape((v->>'per')::interval) <> 'time'
                      or series_step_shape((v->>'step')::interval) <> 'time') then
      raise exception 'variable_invalid: % of % reads an amount per a duration under a day, on a step under a day', k, new.code using errcode = 'check_violation';
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

comment on function kpis.indicators_check() is
  'BEFORE INSERT / UPDATE on indicators: each variable reads a quantity or a known parameter (variable_invalid, attribute_type_unknown), a variable read per a duration names its step (variable_invalid), and the formula compiles into the program (formula_invalid, function_unknown, variable_unknown).';

-- An indicator measured for an object over a period, written nowhere: the
-- value and the variables of every bucket and of the period, the series
-- and the parameters read, and how each variable was had (measured,
-- simulated, or computed from the others when the object has no series of
-- its quantity). A bucket is a step of the granularity, cut in the
-- object's time zone for days and months; a null granularity gives one
-- bucket, the period. Refuses indicator_unknown, indicator_not_applicable,
-- period_invalid, object_not_found, time_zone_required, quantity_unknown,
-- series_not_found, prices_required, and what parameter_of() and
-- resample() refuse.
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
  own       interval;
  per_div   double precision;
  steps     jsonb := '{}';
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
      select v.ids, v.kind into ids, skind from kpis.variable_series(p_object_kind, p_object_id, q.code, spec->>'kind') v;
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
      -- A step is the finest a variable reads, never finer than its series
      -- are kept: an hourly series read by quarter-hours would put its hour
      -- whole in one of them. The coarsest of the series' own steps, and
      -- the figure says the step read.
      if spec ? 'step' then
        own := kpis.own_step(ids, p_from, p_to);
        if own > read_step then
          read_step := own;
        end if;
        steps := steps || jsonb_build_object(vname, read_step);
      end if;
      -- An amount per a duration: the energy of each read bucket over its
      -- length, a mean power in kW per hour.
      per_div := case when spec ? 'per' then extract(epoch from read_step) / extract(epoch from (spec->>'per')::interval) else 1 end;
      shift := coalesce((spec->>'shift')::interval, interval '0');
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
        select e.at, (case when spec ? 'times' then e.v * pr.v else e.v end) / per_div v
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
      foreach b in array starts loop
        answer := parameter_of(p_object_kind, p_object_id, spec->>'parameter', greatest(b, p_from));
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
    'steps', steps,
    'parameters', params);
end;
$$;

comment on function kpis.measure(text, uuid, text, timestamptz, timestamptz, interval) is
  'An indicator for an object over a period, by buckets of a granularity (null: the period), computed and written nowhere: the value and variables of each bucket and of the period, the series, prices and parameters read, and how each quantity variable was had (measured, simulated, or computed from its otherwise formula when the object has no series of it; steps: the step each variable that names one was read on, never finer than its series are kept; fallbacks: a variable weighted by a series computed from its without_times formula when there is none, the hourly emission factor of its zone giving way to the monthly default). Refuses indicator_unknown, indicator_not_applicable, period_invalid, object_not_found, time_zone_required, quantity_unknown, series_not_found, prices_required, and what parameter_of() and resample() refuse.';

-- ---------------------------------------------------------------------------
-- compute — a figure of the module, and its series.
-- ---------------------------------------------------------------------------

create or replace function kpis.compute(
  p_object_kind  text,
  p_object_id    uuid,
  p_indicator    text,
  p_from         timestamptz,
  p_to           timestamptz,
  p_granularity  interval default null
)
returns uuid
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  m     jsonb := kpis.measure(p_object_kind, p_object_id, p_indicator, p_from, p_to, p_granularity);
  ind   kpis.indicators%rowtype;
  fid   uuid;
  sid   uuid;
  ats   timestamptz[];
  vs    float8[];
  qs    smallint[];
begin
  select * into ind from kpis.indicators where code = p_indicator;
  insert into kpis.figures (object_kind, object_id, indicator_code, period_from, period_to, granularity, provenance, inputs, results)
  values (p_object_kind, p_object_id, p_indicator, p_from, p_to, p_granularity, 'kpis-0.3.0',
          jsonb_build_object(
            'indicator', jsonb_build_object('code', ind.code, 'quantity_code', ind.quantity_code, 'formula', ind.formula,
                                            'variables', ind.variables, 'published_by', ind.published_by),
            'time_zone', m->'time_zone', 'series', m->'series', 'read', m->'read', 'prices', m->'prices',
            'fallbacks', m->'fallbacks', 'steps', m->'steps', 'parameters', m->'parameters'),
          jsonb_build_object('buckets', m->'buckets', 'total', m->'total'))
  on conflict (object_kind, object_id, indicator_code, period_from, period_to, granularity)
  do update set provenance = excluded.provenance, inputs = excluded.inputs, results = excluded.results
  returning id into fid;

  select array_agg((e->>'at')::timestamptz order by (e->>'at')::timestamptz),
         array_agg((e->>'value')::float8 order by (e->>'at')::timestamptz),
         array_agg(case when e->>'value' is null then 3 else 0 end::smallint order by (e->>'at')::timestamptz)
    into ats, vs, qs
    from jsonb_array_elements(m->'buckets') e;
  select s.series_id into sid
    from store(null, ats, vs, qs, null, null, jsonb_build_object(
      'object_kind', p_object_kind, 'object_id', p_object_id, 'quantity_code', ind.quantity_code, 'kind', 'simulated',
      'value_kind', 'interval', 'step', p_granularity, 'name', p_indicator, 'source', 'kpis.figures:' || fid)) s;
  update kpis.figures set series_id = sid where id = fid;
  return fid;
end;
$$;

comment on function kpis.compute(text, uuid, text, timestamptz, timestamptz, interval) is
  'Computes an indicator for an object over a period (kpis.measure()), keeps it as a figure with its inputs and provenance, and writes the value of each bucket as a simulated series of the object named after the indicator, through store(); the same indicator, object, period and granularity computed again replaces the figure. Returns the figure.';

update kpis.indicators
   set name = 'Peak offtake power',
       variables = '{"offtake": {"quantity": "offtake_energy", "step": "15 minutes", "per": "1 hour", "combine": "max"}}',
       description = 'The highest mean power taken from the grid over the step its meters keep: a quarter of an hour for a meter read every 15 minutes, as a capacity tariff or the peaks of a supply contract read it; an hour for an hourly series, never finer than the series. For a project, the same quarter of an hour or hour for all its participants, the coarsest any of them keeps.'
 where code = 'peak_offtake_power';

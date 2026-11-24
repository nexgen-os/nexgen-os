-- Nexgen OS — indicators: the series of a participant are read along the
-- one path of the core.
--
-- `series_of()` chose the series of a participant its own way — its own,
-- else its meters', else its devices' — beside `consumption.curve_series()`,
-- and the two could disagree: a device's sub-meter read as the whole
-- consumption of its participant, two estimates of one period added up, a
-- planned device's simulated consumption read nowhere. For a participant
-- (and so for each participant of a project) it now reads
-- `participant_series()` (core), the path the consumption curve reads too,
-- and only the series holding values in the period a variable is read over
-- count: an object whose measured series stop before the period is read
-- from its estimate, as the consumption curve is.

set search_path = nexgen, extensions;

drop function if exists kpis.variable_series(text, uuid, text, text);
drop function if exists kpis.series_of(text, uuid, text, text);

-- The series of a quantity an object's amount is read from: for a
-- participant, those participant_series() reads (its own, else its meters',
-- else its devices', never a device's consumption alone; the latest
-- estimate of each object, a planned device's added); for a project, those
-- of each of its participants; for a meter or a device, its own. Given a
-- period, only the series holding values in it. Under the caller's row
-- level security.
create function kpis.series_of(
  p_kind        text,
  p_id          uuid,
  p_quantity    text,
  p_series_kind text default 'measured',
  p_from        timestamptz default null,
  p_to          timestamptz default null
)
returns setof uuid
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  p uuid;
begin
  if p_kind = 'project' then
    for p in select id from participants where project_id = p_id order by id loop
      return query select kpis.series_of('participant', p, p_quantity, p_series_kind, p_from, p_to);
    end loop;
    return;
  end if;
  if p_kind = 'participant' then
    return query select s from participant_series(p_id, p_quantity, p_series_kind, p_from, p_to) s order by s;
    return;
  end if;
  return query select se.id from series se
    where se.object_kind = p_kind and se.object_id = p_id and se.quantity_code = p_quantity and se.kind = p_series_kind
      and (p_from is null or exists (
            select 1 from series_values v
             where v.series_id = se.id and v.at >= p_from and (p_to is null or v.at < p_to) and v.quality <> 3))
    order by se.id;
end;
$$;

comment on function kpis.series_of(text, uuid, text, text, timestamptz, timestamptz) is
  'The series of a quantity and kind an object''s amount is read from, holding values in the period when one is given: for a participant, participant_series(); for a project, each participant''s; for a meter or a device, its own.';

-- The series of a variable over the period it is read: of its kind when it
-- names one; otherwise the measured series, and the simulated ones when the
-- object has none in the period (a study). Never the figures this module
-- wrote back.
create function kpis.variable_series(p_kind text, p_id uuid, p_quantity text, p_series_kind text,
                                     p_from timestamptz default null, p_to timestamptz default null)
returns table (ids uuid[], kind text)
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k text;
begin
  foreach k in array case when p_series_kind is not null then array[p_series_kind] else array['measured', 'simulated'] end loop
    ids := array(select s from kpis.series_of(p_kind, p_id, p_quantity, k, p_from, p_to) s
                  where not exists (select 1 from series se where se.id = s and se.source like 'kpis.figures:%'));
    kind := k;
    if cardinality(ids) > 0 then
      return next;
      return;
    end if;
  end loop;
  ids := '{}';
  kind := null;
  return next;
end;
$$;

-- The indicator of an object: unchanged but for the series of a variable,
-- read over the period it is read (variable_series()).
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
    'parameters', params);
end;
$$;

comment on function kpis.measure(text, uuid, text, timestamptz, timestamptz, interval) is
  'An indicator for an object over a period, by buckets of a granularity (null: the period), computed and written nowhere: the value and variables of each bucket and of the period, the series, prices and parameters read, and how each quantity variable was had (measured, simulated, or computed from its otherwise formula when the object has no series of it; fallbacks: a variable weighted by a series computed from its without_times formula when there is none, the hourly emission factor of its zone giving way to the monthly default). Refuses indicator_unknown, indicator_not_applicable, period_invalid, object_not_found, time_zone_required, quantity_unknown, series_not_found, prices_required, and what parameter_of() and resample() refuse.';

grant execute on function kpis.series_of(text, uuid, text, text, timestamptz, timestamptz),
  kpis.variable_series(text, uuid, text, text, timestamptz, timestamptz) to authenticated, service_role;

-- Nexgen OS — module `kpis`: indicators of a participant, a project, a meter
-- or a device, as data.
--
-- An indicator is a row (`kpis.indicators`): a formula over named variables,
-- each variable the amount of a quantity in the object's series over a
-- bucket, or a parameter resolved by parameter_of() for the object; the
-- quantity its figure is in; the kinds of object it applies to; whether
-- higher or lower is better. Nothing of an indicator is code: a pack, a
-- module or an installation adds one with an insert, and the formula is
-- read by one evaluator that knows four operators, three functions,
-- numbers and the variables the row declares — never SQL.
--
-- `kpis.compute()` evaluates an indicator for an object over a period, on a
-- granularity (a month, a day, an hour) or as one figure, and keeps what it
-- computed as a figure of the module (`kpis.figures`, decision 0004): the
-- series and the parameters it read, the value of each bucket and of the
-- period. The values of the buckets are a `simulated` series of the core on
-- the object, written by store() and read like any other through
-- resample(). `kpis.of()` reads the figures of an object with the targets
-- they meet; `kpis.portfolio()` aggregates an indicator over the projects
-- the caller may read, with no table of its own; an export template
-- (`kpis.templates`) is a set of indicators in sheets and sections, read
-- back by `kpis.report()` from the figures already computed.

set search_path = nexgen, extensions;

create schema kpis;
grant usage on schema kpis to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The evaluator: a formula compiled once into a program, the program run on
-- the values of its variables.
-- ---------------------------------------------------------------------------

-- A formula is numbers, variables, `+ - * /`, a unary minus, parentheses
-- and `min(a, b)`, `max(a, b)`, `abs(a)`. It compiles into its reverse
-- Polish program (shunting-yard), checked for the variables it names and
-- for its arity. Refuses formula_invalid, function_unknown,
-- variable_unknown.
create or replace function kpis.compile(p_formula text, p_variables jsonb)
returns text[]
language plpgsql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  toks    text[];
  n       integer;
  i       integer;
  t       text;
  top     text;
  output  text[] := '{}';
  ops     text[] := '{}';
  prec    jsonb := '{"+": 1, "-": 1, "*": 2, "/": 2, "neg": 3}';
  depth   integer := 0;
begin
  if p_formula is null or btrim(p_formula) = '' then
    raise exception 'formula_invalid: a formula is required' using errcode = 'check_violation';
  end if;
  toks := array(
    select m.t[1]
      from regexp_matches(p_formula, '([0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?|[a-z][a-z0-9_]*|[-+*/(),]|[^[:space:]])', 'g') with ordinality m(t, k)
     order by m.k);
  n := cardinality(toks);
  for i in 1 .. n loop
    t := toks[i];
    if t ~ '^[0-9]' then
      output := output || t;
    elsif t ~ '^[a-z]' then
      if i < n and toks[i + 1] = '(' then
        if t not in ('min', 'max', 'abs') then
          raise exception 'function_unknown: % in %; a formula knows min, max and abs', t, p_formula using errcode = 'check_violation';
        end if;
        ops := ops || t;
      else
        if p_variables is null or not p_variables ? t then
          raise exception 'variable_unknown: % in %; declare it in variables', t, p_formula using errcode = 'check_violation';
        end if;
        output := output || t;
      end if;
    elsif t = '(' then
      ops := ops || t;
    elsif t in (',', ')') then
      loop
        if cardinality(ops) = 0 then
          raise exception 'formula_invalid: % has an unbalanced %', p_formula, t using errcode = 'check_violation';
        end if;
        top := ops[cardinality(ops)];
        exit when top = '(';
        output := output || top;
        ops := ops[1:cardinality(ops) - 1];
      end loop;
      if t = ')' then
        ops := ops[1:cardinality(ops) - 1];
        if cardinality(ops) > 0 and ops[cardinality(ops)] in ('min', 'max', 'abs') then
          output := output || ops[cardinality(ops)];
          ops := ops[1:cardinality(ops) - 1];
        end if;
      end if;
    elsif t in ('+', '-', '*', '/') then
      if t = '-' and (i = 1 or toks[i - 1] in ('(', ',', '+', '-', '*', '/')) then
        t := 'neg';
      end if;
      while cardinality(ops) > 0 loop
        top := ops[cardinality(ops)];
        exit when top = '(' or top in ('min', 'max', 'abs');
        exit when not ((prec->>top)::int > (prec->>t)::int or ((prec->>top)::int = (prec->>t)::int and t <> 'neg'));
        output := output || top;
        ops := ops[1:cardinality(ops) - 1];
      end loop;
      ops := ops || t;
    else
      raise exception 'formula_invalid: % is not part of a formula (%)', t, p_formula using errcode = 'check_violation';
    end if;
  end loop;
  while cardinality(ops) > 0 loop
    top := ops[cardinality(ops)];
    if top = '(' then
      raise exception 'formula_invalid: % has an unbalanced (', p_formula using errcode = 'check_violation';
    end if;
    output := output || top;
    ops := ops[1:cardinality(ops) - 1];
  end loop;
  -- Every operator finds its operands, and one value is left.
  foreach t in array output loop
    if t in ('+', '-', '*', '/', 'min', 'max') then
      depth := depth - 1;
      if depth < 1 then
        raise exception 'formula_invalid: % misses an operand', p_formula using errcode = 'check_violation';
      end if;
    elsif t in ('neg', 'abs') then
      if depth < 1 then
        raise exception 'formula_invalid: % misses an operand', p_formula using errcode = 'check_violation';
      end if;
    else
      depth := depth + 1;
    end if;
  end loop;
  if depth <> 1 then
    raise exception 'formula_invalid: % leaves % values', p_formula, depth using errcode = 'check_violation';
  end if;
  return output;
end;
$$;

comment on function kpis.compile(text, jsonb) is
  'A formula (numbers, declared variables, + - * /, unary minus, parentheses, min, max, abs) compiled into its reverse Polish program. Refuses formula_invalid, function_unknown, variable_unknown.';

-- The value of a program on the values of its variables (a JSON object, a
-- null for a variable with no value). A missing value makes the result
-- null, as does a division by zero: an indicator with nothing to divide by
-- has no value, never zero.
create or replace function kpis.evaluate(p_program text[], p_values jsonb)
returns double precision
language plpgsql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  st  double precision[] := '{}';
  a   double precision;
  b   double precision;
  r   double precision;
  t   text;
  n   integer;
begin
  foreach t in array p_program loop
    n := cardinality(st);
    if t ~ '^[0-9]' then
      st := st || t::double precision;
    elsif t in ('+', '-', '*', '/', 'min', 'max') then
      a := st[n - 1];
      b := st[n];
      r := case
             when a is null or b is null then null
             when t = '+' then a + b
             when t = '-' then a - b
             when t = '*' then a * b
             when t = '/' then case when b = 0 then null else a / b end
             when t = 'min' then least(a, b)
             else greatest(a, b)
           end;
      st := st[1:n - 2] || r;
    elsif t in ('neg', 'abs') then
      a := st[n];
      st := st[1:n - 1] || case when t = 'neg' then -a else abs(a) end;
    else
      if p_values is null or not p_values ? t then
        raise exception 'variable_missing: %', t using errcode = 'invalid_parameter_value';
      end if;
      st := st || (p_values->>t)::double precision;
    end if;
  end loop;
  return st[1];
end;
$$;

comment on function kpis.evaluate(text[], jsonb) is
  'The value of a compiled formula on the values of its variables; null when a value is missing or a divisor is zero. Refuses variable_missing.';

-- ---------------------------------------------------------------------------
-- indicators — what can be computed, as data.
-- ---------------------------------------------------------------------------

create table kpis.indicators (
  code            text primary key,
  name            text not null,
  description     text,
  -- The quantity of its figure, hence the unit it is stored in, and how
  -- the figures of its buckets add up over a period: by sum for an energy,
  -- an emission or an amount; by the formula over the whole period
  -- otherwise (a rate is the ratio of the totals, never a mean of rates).
  quantity_code   text not null references quantities(code),
  -- The unit a page shows it in (a rate stored 0 to 1 is shown in %).
  display_unit    text references units(code),
  -- The kinds of object it is computed for.
  applies_to      text[] not null,
  -- Which way is better, for a target: higher or lower; null when neither.
  better          text,
  -- The formula, over the variables it declares.
  formula         text not null,
  -- What each variable reads, by its name:
  --   {"quantity": "production_energy"}  the amount of the object's series
  --       of that quantity in a bucket, as resample() gives it, the series
  --       of several meters or devices summed (a mean quantity averaged);
  --       with "kind" (measured by default); with "step" (an interval) and
  --       "combine" (sum, mean, max or min) to read it on a finer step and
  --       combine those values into the bucket — the peak of an hour, the
  --       irradiation of hours; with "shift" (an interval) to read the
  --       same bucket shifted, a year before; with "otherwise" (a
  --       formula over the other variables) for an object with no series
  --       of the quantity; with "times" ({"quantity": "energy_price"}) to
  --       weight each read bucket by the price of that bucket, or by any
  --       series read the same way (an hourly emission factor), with
  --       "zone": true to read only the series naming the bidding zone of
  --       the object (its bidding_zone attribute); with "without_times" (a
  --       formula over the other variables) for an object with no such
  --       series — the hourly factor when it exists, the monthly default
  --       otherwise, and the figure says which;
  --   {"parameter": "grid_co2_factor"}   parameter_of() of the object at
  --       the start of each bucket: its own attribute, its parents', its
  --       organisation's, its pack's.
  variables       jsonb not null,
  -- The formula compiled by kpis.compile(), written by the trigger.
  program         text[] not null,
  -- Where the definition comes from: a standard, a publication.
  source_code     text references sources(code),
  reference       text,
  published_by    text not null default 'kpis',
  constraint indicators_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint indicators_applies_to check (cardinality(applies_to) > 0 and applies_to <@ array['participant', 'project', 'meter', 'device']),
  constraint indicators_better check (better is null or better in ('higher', 'lower')),
  constraint indicators_variables check (jsonb_typeof(variables) = 'object')
);

comment on table kpis.indicators is
  'Indicators as data: a formula over variables (amounts of quantities in the series of an object, parameters resolved by parameter_of()), the quantity of the figure, the kinds of object it applies to, which way is better. Vocabulary: read by everyone signed in, written by migrations, modules, packs and the installation.';

-- Every variable reads a quantity or a parameter, and the formula compiles.
-- The quantity is checked when the indicator is computed (quantity_unknown):
-- a module installed later publishes it.
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
  'BEFORE INSERT / UPDATE on indicators: each variable reads a quantity or a known parameter (variable_invalid, attribute_type_unknown), and the formula compiles into the program (formula_invalid, function_unknown, variable_unknown).';

create trigger indicators_check
  before insert or update on kpis.indicators
  for each row execute function kpis.indicators_check();

alter table kpis.indicators enable row level security;
create policy kpis_indicators_read on kpis.indicators for select to authenticated using (true);
grant select on kpis.indicators to authenticated;
grant select, insert, update, delete on kpis.indicators to service_role;

-- ---------------------------------------------------------------------------
-- targets — what an object aims at, period by period.
-- ---------------------------------------------------------------------------

create table kpis.targets (
  id               uuid primary key default gen_random_uuid(),
  -- Copied from the object by `attach()`.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  object_kind      text not null,
  object_id        uuid not null,
  indicator_code   text not null references kpis.indicators(code) on delete cascade,
  -- The period the target holds, valid_to excluded; a trajectory is one
  -- row per period. Null bounds are open.
  valid_from       timestamptz,
  valid_to         timestamptz,
  -- In the unit of the indicator's quantity.
  value            double precision not null,
  source_code      text references sources(code),
  source           text,
  created_at       timestamptz not null default now(),
  constraint targets_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint targets_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table kpis.targets is
  'A target of an object for an indicator over a period, in the unit of the indicator''s quantity; successive periods make a trajectory.';

create index targets_object_idx on kpis.targets (object_kind, object_id, indicator_code);
create index targets_organisation_idx on kpis.targets (organisation_id);
create trigger targets_attach
  before insert or update on kpis.targets
  for each row execute function attach('object');
call secure_table('kpis.targets');

-- ---------------------------------------------------------------------------
-- figures — what the module computed (decision 0004).
-- ---------------------------------------------------------------------------

create table kpis.figures (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The object the indicator was computed for.
  object_kind      text not null,
  object_id        uuid not null,
  indicator_code   text not null references kpis.indicators(code) on delete cascade,
  period_from      timestamptz not null,
  period_to        timestamptz not null,
  -- The step of its buckets; null for one figure over the period.
  granularity      interval,
  -- The series its buckets were written to.
  series_id        uuid references series(id) on delete set null,
  -- Where it comes from: the program and the version that computed it.
  provenance       text not null,
  -- The indicator as it was, the series and the parameters read.
  inputs           jsonb not null,
  -- The value and the variables of each bucket and of the period.
  results          jsonb not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint figures_object_kind check (object_kind in ('organisation', 'project', 'participant', 'meter', 'device', 'series')),
  constraint figures_period check (period_to > period_from)
);

comment on table kpis.figures is
  'The indicators the module computed for an object over a period: its inputs (the indicator, the series and the parameters read), its provenance, its results (each bucket and the period); the series it wrote names it in its source. Computing the same indicator, object, period and granularity again replaces it.';

create unique index figures_natural_key on kpis.figures
  (object_kind, object_id, indicator_code, period_from, period_to, granularity) nulls not distinct;
create index figures_organisation_idx on kpis.figures (organisation_id);
create trigger figures_attach
  before insert or update on kpis.figures
  for each row execute function attach('object');
create trigger figures_set_updated_at before update on kpis.figures
  for each row execute function set_updated_at();
call secure_table('kpis.figures');

-- ---------------------------------------------------------------------------
-- Reading the variables of an object.
-- ---------------------------------------------------------------------------

-- The time zone calendar buckets of an object are cut in: its participant's;
-- for a project, the one its participants share. Null otherwise.
create or replace function kpis.time_zone_of(p_kind text, p_id uuid)
returns text
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select case
    when p_kind = 'project' then
      (select case when count(distinct p.time_zone) = 1 then min(p.time_zone) end
         from participants p where p.project_id = p_id and p.time_zone is not null)
    else (select p.time_zone from participants p where p.id = participant_of(p_kind, p_id))
  end;
$$;

comment on function kpis.time_zone_of(text, uuid) is
  'The time zone of the participant of an object, or the one the participants of a project share; null when there is none or they differ.';

-- The series of a quantity an object's amount is read from: its own; for a
-- participant with none, those of its meters, else those of its devices,
-- so that a production read by a meter and by its inverter counts once;
-- for a project, those of each of its participants. Under the caller's row
-- level security.
create or replace function kpis.series_of(p_kind text, p_id uuid, p_quantity text, p_series_kind text default 'measured')
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
      return query select kpis.series_of('participant', p, p_quantity, p_series_kind);
    end loop;
    return;
  end if;
  return query select se.id from series se
    where se.object_kind = p_kind and se.object_id = p_id and se.quantity_code = p_quantity and se.kind = p_series_kind
    order by se.id;
  if found or p_kind <> 'participant' then
    return;
  end if;
  return query select se.id from series se join meters m on se.object_kind = 'meter' and se.object_id = m.id
    where m.participant_id = p_id and se.quantity_code = p_quantity and se.kind = p_series_kind
    order by se.id;
  if found then
    return;
  end if;
  return query select se.id from series se join devices d on se.object_kind = 'device' and se.object_id = d.id
    where d.participant_id = p_id and se.quantity_code = p_quantity and se.kind = p_series_kind
    order by se.id;
end;
$$;

comment on function kpis.series_of(text, uuid, text, text) is
  'The series of a quantity and kind an object''s amount is read from: its own; for a participant with none, its meters'', else its devices''; for a project, each participant''s.';

-- The amount of a set of series over each read bucket of a period (summed,
-- or averaged for a mean quantity), the period read shifted and the buckets
-- shifted back: the one read of the series of a variable, and of the price
-- an energy is weighted by.
create or replace function kpis.read_amounts(
  p_ids        uuid[],
  p_aggregation text,
  p_from       timestamptz,
  p_to         timestamptz,
  p_step       interval,
  p_tz         text,
  p_shift      interval
)
returns table (at timestamptz, v double precision)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with r as (
    select ((x.bucket at time zone coalesce(p_tz, 'UTC')) - p_shift) at time zone coalesce(p_tz, 'UTC') at, x.value
      from unnest(p_ids) sid
      cross join lateral resample(sid, ((p_from at time zone coalesce(p_tz, 'UTC')) + p_shift) at time zone coalesce(p_tz, 'UTC'),
                                  ((p_to at time zone coalesce(p_tz, 'UTC')) + p_shift) at time zone coalesce(p_tz, 'UTC'), p_step, p_tz) x
     where x.value is not null and x.value <> 'NaN'::float8
  )
  select r.at, case when p_aggregation = 'sum' then sum(r.value) else avg(r.value) end from r group by r.at;
$$;

comment on function kpis.read_amounts(uuid[], text, timestamptz, timestamptz, interval, text, interval) is
  'The amount of a set of series in each read bucket of a period, summed (or averaged for a mean quantity), read shifted and dated back; buckets without a value are absent.';

-- The variables a program reads, in its order.
create or replace function kpis.program_variables(p_program text[])
returns text[]
language sql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
  select coalesce(array_agg(x.t order by x.k), '{}') from (
    select t, min(k) k from unnest(p_program) with ordinality u(t, k)
     where t ~ '^[a-z]' and t not in ('neg', 'abs', 'min', 'max') group by t) x;
$$;

-- The series of a variable: of its kind when it names one; otherwise the
-- measured series, and the simulated ones when the object has no measured
-- one (a study). Never the figures this module wrote back.
create or replace function kpis.variable_series(p_kind text, p_id uuid, p_quantity text, p_series_kind text)
returns table (ids uuid[], kind text)
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k text;
begin
  foreach k in array case when p_series_kind is not null then array[p_series_kind] else array['measured', 'simulated'] end loop
    ids := array(select s from kpis.series_of(p_kind, p_id, p_quantity, k) s
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

-- The series of a price an energy is weighted by: the object's own, then its
-- parents' nearest first (parents_of), then its organisation's, each its
-- own series, measured first. Given a zone, only the series naming the
-- bidding zone of the object: a market price, a grid carbon intensity.
create or replace function kpis.price_series_of(p_kind text, p_id uuid, p_quantity text, p_series_kind text, p_zone boolean default false)
returns table (ids uuid[], kind text)
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  o       record;
  v_zone  jsonb;
begin
  if p_zone then
    begin
      v_zone := parameter_of(p_kind, p_id, 'bidding_zone')->'value';
    exception when no_data_found then
      v_zone := null;
    end;
    if v_zone is null or v_zone = 'null'::jsonb then
      ids := '{}';
      kind := null;
      return next;
      return;
    end if;
  end if;
  for o in
    select 0 n, p_kind k, p_id i
    union all select row_number() over (), x.kind, x.object_id from parents_of(p_kind, p_id) x
    union all select 1000, 'organisation', object_organisation(p_kind, p_id)
    order by 1
  loop
    foreach kind in array case when p_series_kind is not null then array[p_series_kind] else array['measured', 'simulated'] end loop
      ids := array(select se.id from series se
                    where se.object_kind = o.k and se.object_id = o.i and se.quantity_code = p_quantity and se.kind = price_series_of.kind
                      and (not p_zone or exists (select 1 from attributes a where a.object_kind = 'series' and a.object_id = se.id
                                                   and a.attribute_type = 'bidding_zone' and a.value = v_zone))
                    order by se.id);
      if cardinality(ids) > 0 then
        return next;
        return;
      end if;
    end loop;
  end loop;
  ids := '{}';
  kind := null;
  return next;
end;
$$;

comment on function kpis.price_series_of(text, uuid, text, text, boolean) is
  'The price series an energy of an object is weighted by: the object''s, its parents'' nearest first, its organisation''s; measured first unless a kind is named; given a zone, only the series whose bidding_zone attribute is the object''s bidding zone (none when the object has no zone).';

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
            'fallbacks', m->'fallbacks', 'parameters', m->'parameters'),
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

-- ---------------------------------------------------------------------------
-- Reading: an object's indicators, a portfolio.
-- ---------------------------------------------------------------------------

-- The latest figure of each indicator and granularity of an object whose
-- period lies in the one asked, with the target that holds over it and
-- whether it is met.
create or replace function kpis.of(p_object_kind text, p_object_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  indicator_code text, name text, quantity_code text, unit text, display_unit text, granularity interval,
  period_from timestamptz, period_to timestamptz, value double precision, target double precision, met boolean,
  figure_id uuid, series_id uuid)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select distinct on (f.indicator_code, f.granularity)
         f.indicator_code, i.name, i.quantity_code, q.unit, i.display_unit, f.granularity,
         f.period_from, f.period_to, (f.results->'total'->>'value')::float8, t.value,
         case when t.value is null or f.results->'total'->>'value' is null or i.better is null then null
              when i.better = 'higher' then (f.results->'total'->>'value')::float8 >= t.value
              else (f.results->'total'->>'value')::float8 <= t.value end,
         f.id, f.series_id
    from kpis.figures f
    join kpis.indicators i on i.code = f.indicator_code
    join quantities q on q.code = i.quantity_code
    left join lateral (
      select tg.value from kpis.targets tg
       where tg.object_kind = f.object_kind and tg.object_id = f.object_id and tg.indicator_code = f.indicator_code
         and (tg.valid_from is null or tg.valid_from <= f.period_from) and (tg.valid_to is null or tg.valid_to >= f.period_to)
       order by tg.valid_from desc nulls last limit 1) t on true
   where f.object_kind = p_object_kind and f.object_id = p_object_id
     and f.period_from >= p_from and f.period_to <= p_to
   order by f.indicator_code, f.granularity, f.period_to desc, f.updated_at desc;
$$;

comment on function kpis.of(text, uuid, timestamptz, timestamptz) is
  'The indicators of an object over a period: the latest figure of each indicator and granularity within it, its value over its period, the target holding over it and whether it is met.';

-- An indicator over every project the caller may read, without a table:
-- the sum of the projects' figures for an additive indicator; otherwise
-- the formula over the amounts of the projects added up (summed, or
-- averaged for a mean, the peak of the peaks). Amounts of money are added
-- by currency, never across. A project the indicator cannot be measured
-- on is listed with the refusal it met.
create or replace function kpis.portfolio(p_indicator text, p_from timestamptz, p_to timestamptz)
returns table (currency char(3), projects integer, value double precision, variables jsonb, skipped jsonb)
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  ind      kpis.indicators%rowtype;
  agg      text;
  p        record;
  m        jsonb;
  cur      char(3);
  groups   jsonb := '{}';
  missed   jsonb := '[]';
  g        jsonb;
  k        text;
  tv       jsonb;
  key      text;
  spec     jsonb;
  how      text;
  merged   jsonb;
  qagg     text;
begin
  select * into ind from kpis.indicators where code = p_indicator;
  if not found then
    raise exception 'indicator_unknown: %', p_indicator using errcode = 'foreign_key_violation';
  end if;
  if not 'project' = any (ind.applies_to) then
    raise exception 'indicator_not_applicable: % is not computed for a project', p_indicator using errcode = 'invalid_parameter_value';
  end if;
  select aggregation into agg from quantities where code = ind.quantity_code;
  for p in select pr.id, pr.country from projects pr order by pr.id loop
    begin
      m := kpis.measure('project', p.id, p_indicator, p_from, p_to, null);
    exception when others then
      missed := missed || jsonb_build_array(jsonb_build_object('project_id', p.id, 'refusal', sqlerrm));
      continue;
    end;
    cur := case when quantity_priced(ind.quantity_code) then (select c.currency from countries c where c.code = p.country) end;
    key := coalesce(cur::text, '');
    g := coalesce(groups->key, jsonb_build_object('projects', 0, 'value', null, 'variables', '{}'::jsonb));
    merged := g->'variables';
    for k, tv in select * from jsonb_each(m->'total'->'variables') loop
      spec := ind.variables->k;
      qagg := (select aggregation from quantities where code = spec->>'quantity');
      how := coalesce(spec->>'combine', case when spec ? 'parameter' or qagg = 'sum' then 'sum' else 'mean' end);
      merged := merged || jsonb_build_object(k, case
        when merged->k is null or jsonb_typeof(merged->k) = 'null' then tv
        when tv is null or jsonb_typeof(tv) = 'null' then merged->k
        when how = 'max' then to_jsonb(greatest((merged->>k)::float8, tv::text::float8))
        when how = 'min' then to_jsonb(least((merged->>k)::float8, tv::text::float8))
        -- a mean: the running mean over the projects added so far
        when how = 'mean' then to_jsonb(((merged->>k)::float8 * (g->>'projects')::int + tv::text::float8) / ((g->>'projects')::int + 1))
        else to_jsonb((merged->>k)::float8 + tv::text::float8) end);
    end loop;
    g := jsonb_build_object(
      'projects', (g->>'projects')::int + 1,
      'value', case when agg = 'sum' then to_jsonb(coalesce((g->>'value')::float8, 0) + coalesce((m->'total'->>'value')::float8, 0)) else 'null'::jsonb end,
      'variables', merged);
    groups := groups || jsonb_build_object(key, g);
  end loop;
  if groups = '{}' then
    currency := null; projects := 0; value := null; variables := '{}'; skipped := missed;
    return next;
    return;
  end if;
  for key, g in select * from jsonb_each(groups) order by 1 loop
    currency := nullif(key, '');
    projects := (g->>'projects')::int;
    variables := g->'variables';
    value := case when agg = 'sum' then (g->>'value')::float8 else kpis.evaluate(ind.program, g->'variables') end;
    skipped := missed;
    return next;
  end loop;
end;
$$;

comment on function kpis.portfolio(text, timestamptz, timestamptz) is
  'An indicator over the projects the caller may read, without a table: the projects'' figures added for an additive indicator, the formula over their added amounts for a rate; amounts of money by currency. Lists the projects it could not measure with their refusal.';

-- ---------------------------------------------------------------------------
-- templates — a set of indicators to export, as data.
-- ---------------------------------------------------------------------------

create table kpis.templates (
  code          text primary key,
  name          text not null,
  description   text,
  -- The granularity of its figures; null for one figure over the period.
  granularity   interval,
  -- {"sheets": [{"name": …, "sections": [{"name": …, "indicators": [code…]}]}]}
  layout        jsonb not null,
  published_by  text not null default 'kpis',
  constraint templates_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint templates_layout check (jsonb_typeof(layout->'sheets') = 'array')
);

comment on table kpis.templates is
  'An export of indicators as data: sheets of sections of indicators and the granularity of their figures; read by kpis.report(), which computes nothing. Vocabulary: read by everyone signed in, written by migrations, modules, packs and the installation.';

create or replace function kpis.templates_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  c text;
begin
  for c in
    select ic.value #>> '{}'
      from jsonb_array_elements(new.layout->'sheets') s
      cross join lateral jsonb_array_elements(coalesce(s->'sections', '[]')) sec
      cross join lateral jsonb_array_elements(coalesce(sec->'indicators', '[]')) ic
  loop
    if not exists (select 1 from kpis.indicators where code = c) then
      raise exception 'indicator_unknown: % (template %)', c, new.code using errcode = 'foreign_key_violation';
    end if;
  end loop;
  return new;
end;
$$;

comment on function kpis.templates_check() is
  'BEFORE INSERT / UPDATE on templates: every indicator of the layout exists (indicator_unknown).';

create trigger templates_check
  before insert or update on kpis.templates
  for each row execute function kpis.templates_check();

alter table kpis.templates enable row level security;
create policy kpis_templates_read on kpis.templates for select to authenticated using (true);
grant select on kpis.templates to authenticated;
grant select, insert, update, delete on kpis.templates to service_role;

-- The rows of a template for an object over a period, in its order, from
-- the figures already computed at its granularity. An indicator with no
-- figure is `not_computed` with no value: an empty cell, never a zero.
create or replace function kpis.report(p_template text, p_object_kind text, p_object_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  sheet text, section text, "position" integer, indicator_code text, name text, unit text, display_unit text,
  value double precision, target double precision, met boolean, status text, figure_id uuid)
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  tp kpis.templates%rowtype;
begin
  select * into tp from kpis.templates where code = p_template;
  if not found then
    raise exception 'template_unknown: %', p_template using errcode = 'foreign_key_violation';
  end if;
  return query
    with rows as (
      select s0.s->>'name' sheet, sec0.sec->>'name' section, ic0.value #>> '{}' code,
             (row_number() over (order by s0.si, sec0.ci, ic0.ii))::int pos
        from jsonb_array_elements(tp.layout->'sheets') with ordinality s0(s, si)
        cross join lateral jsonb_array_elements(coalesce(s0.s->'sections', '[]')) with ordinality sec0(sec, ci)
        cross join lateral jsonb_array_elements(coalesce(sec0.sec->'indicators', '[]')) with ordinality ic0(value, ii)
    )
    select r.sheet, r.section, r.pos, r.code, i.name, q.unit, i.display_unit, o.value, o.target, o.met,
           case when o.figure_id is null then 'not_computed' else 'computed' end, o.figure_id
      from rows r
      join kpis.indicators i on i.code = r.code
      join quantities q on q.code = i.quantity_code
      left join kpis.of(p_object_kind, p_object_id, p_from, p_to) o
        on o.indicator_code = r.code and o.granularity is not distinct from tp.granularity
     order by r.pos;
end;
$$;

comment on function kpis.report(text, text, uuid, timestamptz, timestamptz) is
  'The rows of an export template for an object over a period, from the figures already computed at its granularity; not_computed, with no value, when an indicator has none. Refuses template_unknown.';

grant execute on all functions in schema kpis to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The generic indicators.
-- ---------------------------------------------------------------------------

-- The balance of a participant: what it consumed of its own production
-- directly is the self-consumption a series measures, else what it
-- produced and neither injected nor stored (`otherwise`); a battery gives
-- back what it stored, less its losses, and with no battery series both
-- are zero. Which of the two was read is in the figure's inputs (`read`).
insert into kpis.indicators (code, name, quantity_code, display_unit, applies_to, better, formula, variables, reference, description) values
  ('self_consumed_energy', 'Self-consumed energy', 'energy', null, '{participant,project}', 'higher',
   'direct + discharge',
   '{"direct": {"quantity": "self_consumption_energy", "otherwise": "production - injection - charge"}, "production": {"quantity": "production_energy"}, "injection": {"quantity": "injection_energy"}, "charge": {"quantity": "battery_charge_energy", "otherwise": "0"}, "discharge": {"quantity": "battery_discharge_energy", "otherwise": "0"}}', null,
   'The energy produced and consumed on the spot, directly or through a battery: the self-consumption a series measures, else what was produced and neither injected nor stored, and what the batteries gave back.'),
  ('self_consumption_rate', 'Self-consumption rate', 'ratio', 'PERCENT', '{participant,project}', 'higher',
   '(direct + charge) / production',
   '{"direct": {"quantity": "self_consumption_energy", "otherwise": "production - injection - charge"}, "production": {"quantity": "production_energy"}, "injection": {"quantity": "injection_energy"}, "charge": {"quantity": "battery_charge_energy", "otherwise": "0"}, "discharge": {"quantity": "battery_discharge_energy", "otherwise": "0"}}', null,
   'The part of the energy produced that is not injected: consumed on the spot or stored.'),
  ('self_sufficiency_rate', 'Self-sufficiency rate', 'ratio', 'PERCENT', '{participant,project}', 'higher',
   '(direct + discharge) / (offtake + direct + discharge)',
   '{"direct": {"quantity": "self_consumption_energy", "otherwise": "production - injection - charge"}, "production": {"quantity": "production_energy"}, "injection": {"quantity": "injection_energy"}, "charge": {"quantity": "battery_charge_energy", "otherwise": "0"}, "discharge": {"quantity": "battery_discharge_energy", "otherwise": "0"}, "offtake": {"quantity": "offtake_energy"}}', null,
   'The part of the energy consumed that is covered by the energy produced on the spot, directly or through a battery.'),
  ('coverage_rate', 'Coverage rate', 'ratio', 'PERCENT', '{participant,project}', 'higher',
   'production / (offtake + direct + discharge)',
   '{"direct": {"quantity": "self_consumption_energy", "otherwise": "production - injection - charge"}, "production": {"quantity": "production_energy"}, "injection": {"quantity": "injection_energy"}, "charge": {"quantity": "battery_charge_energy", "otherwise": "0"}, "discharge": {"quantity": "battery_discharge_energy", "otherwise": "0"}, "offtake": {"quantity": "offtake_energy"}}', null,
   'The energy produced over the energy consumed, whenever each was: above 1, the place produces more than it consumes over the period.'),
  ('shared_rate', 'Shared rate', 'ratio', 'PERCENT', '{participant,project}', 'higher',
   'shared_injection / production',
   '{"production": {"quantity": "production_energy"}, "shared_injection": {"quantity": "shared_injection_energy"}}', null,
   'The part of the energy produced that is consumed by other participants of the project through energy sharing; for a project, its collective self-consumption rate. Reads the volumes of a sharing (the `community` module).'),
  ('shared_coverage_rate', 'Shared coverage rate', 'ratio', 'PERCENT', '{participant,project}', 'higher',
   'shared_offtake / (offtake + direct + discharge)',
   '{"direct": {"quantity": "self_consumption_energy", "otherwise": "production - injection - charge"}, "production": {"quantity": "production_energy"}, "injection": {"quantity": "injection_energy"}, "charge": {"quantity": "battery_charge_energy", "otherwise": "0"}, "discharge": {"quantity": "battery_discharge_energy", "otherwise": "0"}, "offtake": {"quantity": "offtake_energy"}, "shared_offtake": {"quantity": "shared_offtake_energy"}}', null,
   'The part of the energy consumed that is covered by energy shared within the project: how much less the place depends on the grid than without the sharing. Reads the volumes of a sharing (the `community` module).'),
  ('residual_offtake_energy', 'Residual offtake', 'energy', null, '{participant,project}', 'lower',
   'offtake - shared_offtake',
   '{"offtake": {"quantity": "offtake_energy"}, "shared_offtake": {"quantity": "shared_offtake_energy"}}', null,
   'The energy taken from the grid that no sharing within the project covered: what the place buys from its supplier.'),
  ('peak_offtake_power', 'Peak hourly offtake power', 'power', null, '{participant,project,meter}', 'lower',
   'offtake',
   '{"offtake": {"quantity": "offtake_energy", "step": "1 hour", "combine": "max"}}', null,
   'The highest mean power taken from the grid over an hour: the energy of the heaviest hour, in kW. For a project, the hour is the same for all its participants.'),
  ('specific_yield', 'Specific yield', 'specific_yield', null, '{participant,project}', 'higher',
   'production / installed_power',
   '{"production": {"quantity": "production_energy"}, "installed_power": {"parameter": "installed_power"}}', 'IEC 61724-1, final yield',
   'The energy produced per kW installed (kWh/kWp): the final yield of IEC 61724-1, and the full-load hours of any generator, in hours.'),
  ('performance_ratio', 'Performance ratio', 'ratio', 'PERCENT', '{participant,project}', 'higher',
   'production / (installed_power * irradiation / 1000)',
   '{"production": {"quantity": "production_energy"}, "installed_power": {"parameter": "installed_power"}, "irradiation": {"quantity": "poa_irradiance", "step": "1 hour", "combine": "sum"}}', 'IEC 61724-1, performance ratio',
   'The final yield over the reference yield (the in-plane irradiation over 1 kW/m²) of IEC 61724-1, from the plane-of-array irradiance of the `solar` module. The solar module''s own indicators of a PV system count only the hours where every series has a value.'),
  ('co2_avoided', 'CO2 avoided by self-consumption', 'emissions', null, '{participant,project}', 'higher',
   'direct_co2 + discharge_co2',
   '{"direct_co2": {"quantity": "self_consumption_energy", "step": "1 hour", "times": {"quantity": "emission_factor", "zone": true}, "without_times": "direct * factor", "otherwise": "production_co2 - injection_co2 - charge_co2"}, "production_co2": {"quantity": "production_energy", "step": "1 hour", "times": {"quantity": "emission_factor", "zone": true}, "without_times": "production * factor"}, "injection_co2": {"quantity": "injection_energy", "step": "1 hour", "times": {"quantity": "emission_factor", "zone": true}, "without_times": "injection * factor"}, "charge_co2": {"quantity": "battery_charge_energy", "step": "1 hour", "times": {"quantity": "emission_factor", "zone": true}, "without_times": "charge * factor", "otherwise": "0"}, "discharge_co2": {"quantity": "battery_discharge_energy", "step": "1 hour", "times": {"quantity": "emission_factor", "zone": true}, "without_times": "discharge * factor", "otherwise": "0"}, "direct": {"quantity": "self_consumption_energy", "otherwise": "production - injection - charge"}, "production": {"quantity": "production_energy"}, "injection": {"quantity": "injection_energy"}, "charge": {"quantity": "battery_charge_energy", "otherwise": "0"}, "discharge": {"quantity": "battery_discharge_energy", "otherwise": "0"}, "factor": {"parameter": "grid_co2_factor"}}', 'GHG Protocol Scope 2 Guidance, location-based method',
   'The greenhouse gas the grid would have emitted for the energy consumed on the spot: hour by hour at the carbon intensity series of the bidding zone of the place when the organisation holds one (an emission_factor series naming its zone), otherwise at the emission factor of grid electricity of the place, month by month as the factor holds. The figure says which (fallbacks).'),
  ('scope2_location_based', 'Scope 2 emissions, location-based', 'emissions', null, '{participant,project}', 'lower',
   'offtake_co2',
   '{"offtake_co2": {"quantity": "offtake_energy", "step": "1 hour", "times": {"quantity": "emission_factor", "zone": true}, "without_times": "offtake * factor"}, "offtake": {"quantity": "offtake_energy"}, "factor": {"parameter": "grid_co2_factor"}}', 'GHG Protocol Scope 2 Guidance, location-based method',
   'The emissions of the electricity taken from the grid at the average intensity of the grid where it is consumed: hour by hour at the carbon intensity series of the bidding zone when the organisation holds one, otherwise month by month at the emission factor of grid electricity of the place. The figure says which (fallbacks).'),
  ('scope2_market_based', 'Scope 2 emissions, market-based', 'emissions', null, '{participant,project}', 'lower',
   'offtake * factor',
   '{"offtake": {"quantity": "offtake_energy"}, "factor": {"parameter": "market_co2_factor"}}', 'GHG Protocol Scope 2 Guidance, market-based method',
   'The emissions of the electricity taken from the grid at the factor of what was bought: the supplier''s disclosed mix when the contract gives it (a market_co2_factor attribute of the meter, the participant or the organisation, over the contract''s period), otherwise the residual mix of the country (its pack''s market_co2_factor). The parameters read say which, by their level and source.'),
  ('self_consumption_savings_household', 'Savings by self-consumption, household price', 'amount', null, '{participant,project}', 'higher',
   '(direct + discharge) * (energy_price + grid_fees) / 1000',
   '{"direct": {"quantity": "self_consumption_energy", "otherwise": "production - injection - charge"}, "production": {"quantity": "production_energy"}, "injection": {"quantity": "injection_energy"}, "charge": {"quantity": "battery_charge_energy", "otherwise": "0"}, "discharge": {"quantity": "battery_discharge_energy", "otherwise": "0"}, "energy_price": {"parameter": "energy_price_household"}, "grid_fees": {"parameter": "grid_fees_and_taxes"}}', null,
   'What the energy consumed on the spot would have cost from the grid, at the household energy price and the grid fees and taxes of the place (prices per MWh), unless the object, its parents or its organisation set their own; in the currency of the place.'),
  ('self_consumption_savings_business', 'Savings by self-consumption, business price', 'amount', null, '{participant,project}', 'higher',
   '(direct + discharge) * (energy_price + grid_fees) / 1000',
   '{"direct": {"quantity": "self_consumption_energy", "otherwise": "production - injection - charge"}, "production": {"quantity": "production_energy"}, "injection": {"quantity": "injection_energy"}, "charge": {"quantity": "battery_charge_energy", "otherwise": "0"}, "discharge": {"quantity": "battery_discharge_energy", "otherwise": "0"}, "energy_price": {"parameter": "energy_price_business"}, "grid_fees": {"parameter": "grid_fees_and_taxes"}}', null,
   'What the energy consumed on the spot would have cost from the grid, at the business energy price and the grid fees and taxes of the place (prices per MWh), unless the object, its parents or its organisation set their own; in the currency of the place.'),
  ('injection_value', 'Value of the energy injected', 'amount', null, '{participant,project}', 'higher',
   'injection * price / 1000',
   '{"injection": {"quantity": "injection_energy"}, "price": {"parameter": "injection_price_reference"}}', null,
   'The energy injected into the grid at the reference price of injected energy of the place (per MWh); in the currency of the place.'),
  ('offtake_change_rate', 'Offtake against the year before', 'ratio', 'PERCENT', '{participant,project,meter}', 'lower',
   'offtake / offtake_year_before',
   '{"offtake": {"quantity": "offtake_energy"}, "offtake_year_before": {"quantity": "offtake_energy", "shift": "-1 year"}}', null,
   'The energy taken from the grid over the energy taken over the same calendar period a year before: below 1, the place saves; above, it rebounds.'),
  ('battery_charged_energy', 'Energy charged into batteries', 'energy', null, '{participant,project,device}', null,
   'charge',
   '{"charge": {"quantity": "battery_charge_energy"}}', null,
   'The energy put into the batteries of the object: a battery, those of a participant, those of the participants of a project.'),
  ('battery_discharged_energy', 'Energy discharged from batteries', 'energy', null, '{participant,project,device}', 'higher',
   'discharge',
   '{"discharge": {"quantity": "battery_discharge_energy"}}', null,
   'The energy the batteries of the object gave back: a battery, those of a participant, those of the participants of a project.'),
  ('battery_boost_rate', 'Self-consumption added by batteries', 'ratio', 'PERCENT', '{participant,project}', 'higher',
   'charge / production',
   '{"production": {"quantity": "production_energy"}, "charge": {"quantity": "battery_charge_energy"}}', null,
   'The points of self-consumption rate the batteries add: the energy they stored, which would have been injected without them, over the energy produced. For a project, every battery of its participants, a community battery among them: the boost of the collective self-consumption. A battery charged from the grid counts that charge too.'),
  ('injection_day_ahead_value', 'Day-ahead value of the energy injected', 'amount', null, '{participant,project,meter}', 'higher',
   'injection / 1000',
   '{"injection": {"quantity": "injection_energy", "step": "1 hour", "times": {"quantity": "energy_price"}}}', null,
   'The energy injected, hour by hour, at the price of that hour (per MWh): the nearest energy_price series of the object, its parents or its organisation, a day-ahead price of its bidding zone; in the currency of the place.'),
  ('shared_day_ahead_value', 'Day-ahead value of the energy shared', 'amount', null, '{participant,project}', 'higher',
   'shared_injection / 1000',
   '{"shared_injection": {"quantity": "shared_injection_energy", "step": "1 hour", "times": {"quantity": "energy_price"}}}', null,
   'The energy shared within the project, hour by hour, at the price of that hour (per MWh), the nearest energy_price series; in the currency of the place. Reads the volumes of a sharing (the `community` module).'),
  ('residual_day_ahead_value', 'Day-ahead value of the residual offtake', 'amount', null, '{participant,project}', 'lower',
   '(offtake - shared_offtake) / 1000',
   '{"offtake": {"quantity": "offtake_energy", "step": "1 hour", "times": {"quantity": "energy_price"}}, "shared_offtake": {"quantity": "shared_offtake_energy", "step": "1 hour", "times": {"quantity": "energy_price"}}}', null,
   'The energy taken from the grid that no sharing covered, hour by hour, at the price of that hour (per MWh), the nearest energy_price series; in the currency of the place.');

insert into kpis.templates (code, name, granularity, layout, description) values
  ('energy_community_report', 'Energy community report', '1 month',
   '{"sheets": [
      {"name": "Energy", "sections": [
        {"name": "Flows", "indicators": ["self_consumed_energy", "residual_offtake_energy", "peak_offtake_power"]},
        {"name": "Storage", "indicators": ["battery_charged_energy", "battery_discharged_energy", "battery_boost_rate"]},
        {"name": "Rates", "indicators": ["self_consumption_rate", "self_sufficiency_rate", "coverage_rate", "shared_rate", "shared_coverage_rate"]}]},
      {"name": "Impact", "sections": [
        {"name": "Environment", "indicators": ["co2_avoided"]},
        {"name": "Economy", "indicators": ["self_consumption_savings_household", "injection_value", "shared_day_ahead_value", "residual_day_ahead_value"]},
        {"name": "Savings", "indicators": ["offtake_change_rate"]}]}]}',
   'The indicators of an energy community, month by month: its flows, its rates of self-consumption and sharing, what it avoided and saved.'),
  ('pv_performance', 'PV performance', '1 month',
   '{"sheets": [{"name": "Performance", "sections": [
      {"name": "Yield", "indicators": ["specific_yield", "performance_ratio"]},
      {"name": "Use", "indicators": ["self_consumption_rate", "self_sufficiency_rate"]}]}]}',
   'How the PV of a participant or a project yields and how much of it is used on the spot, month by month.');

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('kpis', 'Indicators', '0.3.0', 'kpis', '0.3.0',
        'Indicators as data: formulas over the series and parameters of a participant, a project, a meter or a device, their targets, the figures computed and written back as series, and export templates.');

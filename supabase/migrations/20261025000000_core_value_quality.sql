-- Nexgen OS — core: a value says its quality (decision 0057).
--
-- What kind of value a value is had two names: `quality` on a value of a
-- series (a two-byte code) and `status` on an attribute and a default of a
-- pack (a word of the table `value_statuses`), and `status` also named the
-- lifecycle of a project, a participant, a device and a connector. It is
-- now `quality` everywhere, and `status` is the lifecycle only:
--
--   * the four words are one domain, `value_quality` — published, measured,
--     estimated, assumed — carried by every column that holds one, in place
--     of the table `value_statuses` that nobody extended;
--   * `attributes.status` and `defaults.status` become `quality`, and the
--     conventional value a study starts from, formerly `default`, is
--     `assumed`, so that a row of `defaults` is not "a default" twice;
--   * `set_attribute()` takes `p_quality`, and `parameter_of()` returns the
--     word under the key `quality`;
--   * a value `store()` writes in a simulated series without a quality is
--     estimated (1), not measured (0): a computation measures nothing.
--
-- It also closes the list of the presets `role_capabilities` resolves
-- (owner, editor, viewer, participant), formerly any word of a given shape.
--
-- Nothing is lost on the way: every row keeps its word, `default` read as
-- `assumed`. A module that kept the same word on a row of its own
-- converts it in a migration of its own (solar: estimate_losses).

set search_path = nexgen, extensions;

-- ---------------------------------------------------------------------------
-- value_quality — what kind of value a value is.
-- ---------------------------------------------------------------------------

-- The words of a value kept outside a series. A value of a series says the
-- same with its code (series_values.quality): measured is 0, estimated is 1;
-- published and assumed have no code, a series' substituted (2) and
-- missing (3) have no word here.
create domain value_quality as text
  constraint value_quality_word check (value in ('published', 'measured', 'estimated', 'assumed'));

comment on domain value_quality is
  'What kind of value a value kept outside a series is: published (read in a text that decides it: a law, a regulated tariff, a register, a datasheet), measured (on the object itself; series quality 0), estimated (computed or estimated from other values; series quality 1), assumed (a conventional value a study starts from when nothing better is known). Decision 0057.';

grant usage on domain value_quality to authenticated, service_role;

-- The table goes, and with it the foreign keys that pointed at it — the
-- core's two and, where the solar module is installed, the one of
-- solar.estimate_losses, which that module's own migration then converts.
drop table value_statuses cascade;

alter table attributes rename column status to quality;
alter table attributes alter column quality drop default;
alter table attributes alter column quality type value_quality
  using (case quality when 'default' then 'assumed' else quality end);
alter table attributes alter column quality set default 'estimated';

comment on column attributes.quality is
  'What kind of value it is (value_quality): published, measured, estimated or assumed. A value nobody qualified is estimated: never claimed measured or published without saying so.';

alter table defaults rename column status to quality;
alter table defaults alter column quality drop default;
alter table defaults alter column quality type value_quality
  using (case quality when 'default' then 'assumed' else quality end);
alter table defaults alter column quality set default 'published';

comment on column defaults.quality is
  'What kind of value it is (value_quality): published when the source decides it (a law, a regulated tariff), estimated when it is a statistic or a model, assumed when it is a conventional value.';

comment on column series_values.quality is
  'What kind of value it is, as a two-byte code: 0 measured, 1 estimated, 2 substituted, 3 missing, from 100 up a pack''s code of a data hub. The words measured and estimated of value_quality mean codes 0 and 1. store() writes 0 for a value without a quality, 1 in a simulated series.';

-- ---------------------------------------------------------------------------
-- set_attribute() — takes the quality.
-- ---------------------------------------------------------------------------

-- A parameter is renamed by dropping the function: callers that pass it by
-- position are unchanged.
drop function set_attribute(text, uuid, text, jsonb, timestamptz, text, text, text);

create function set_attribute(
  p_object_kind   text,
  p_object_id     uuid,
  p_attribute_type text,
  p_value         jsonb,
  p_from          timestamptz default null,
  p_source_code   text default null,
  p_source        text default null,
  p_quality       text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform object_organisation(p_object_kind, p_object_id);
  if p_from is not null then
    update attributes set valid_to = p_from
     where object_kind = p_object_kind and object_id = p_object_id and attribute_type = p_attribute_type
       and (valid_from is null or valid_from < p_from)
       and (valid_to is null or valid_to > p_from);
  end if;
  insert into attributes (id, object_kind, object_id, attribute_type, value, valid_from, source_code, source, quality)
  values (v_id, p_object_kind, p_object_id, p_attribute_type, p_value, p_from, p_source_code, p_source, coalesce(p_quality, 'estimated'));
  return v_id;
end;
$$;

comment on function set_attribute(text, uuid, text, jsonb, timestamptz, text, text, text) is
  'Sets an attribute of an object (its kind and id) from a moment on, with its source and its quality (value_quality; estimated when not given): the value holding then is closed there, the new one opens. Refuses kind_unknown, object_not_found, attribute_type_not_applicable, invalid_value, overlapping_value. Returns its id.';

grant execute on function set_attribute(text, uuid, text, jsonb, timestamptz, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- parameter_of() — returns the quality.
-- ---------------------------------------------------------------------------

create or replace function parameter_of(
  p_kind          text,
  p_object_id     uuid,
  p_attribute_type text,
  p_at            timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  a          attributes%rowtype;
  d          defaults%rowtype;
  v_org      uuid;
  anc        record;
  v_place    participants%rowtype;
  v_start    text;
  v_region   text;
  v_climbed  text[] := '{}';
  v_day      date := p_at::date;
  reached    text := 'object';
  v_facts    jsonb;
  v_level    text;
  v_country  text;
begin
  if not exists (select 1 from attribute_types where code = p_attribute_type) then
    raise exception 'attribute_type_unknown: %', p_attribute_type using errcode = 'foreign_key_violation';
  end if;
  v_org := object_organisation(p_kind, p_object_id);

  -- 1. The object itself.
  a := attribute_at(p_object_id, p_attribute_type, p_at);
  if a.id is not null then
    return jsonb_build_object('value', a.value, 'level', 'object', 'object_id', p_object_id,
                              'source_code', a.source_code, 'reference', a.source, 'quality', a.quality, 'valid_from', a.valid_from);
  end if;

  -- 2. Its parents, nearest first.
  for anc in select * from parents_of(p_kind, p_object_id) loop
    reached := anc.kind;
    a := attribute_at(anc.object_id, p_attribute_type, p_at);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', anc.kind, 'object_id', anc.object_id,
                                'source_code', a.source_code, 'reference', a.source, 'quality', a.quality, 'valid_from', a.valid_from);
    end if;
  end loop;

  -- 3. Its organisation: an object like any other, whose defaults are its attributes.
  reached := 'organisation';
  if p_kind <> 'organisation' then
    a := attribute_at(v_org, p_attribute_type, p_at);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', 'organisation', 'object_id', v_org,
                                'source_code', a.source_code, 'reference', a.source, 'quality', a.quality, 'valid_from', a.valid_from);
    end if;
  end if;

  -- 4. The municipality, the region, then the country of its participant's
  -- place: the pack's, for the condition the object meets. A project has
  -- no place of its own: its country, the one whose rules apply to it.
  select * into v_place from participants where id = participant_of(p_kind, p_object_id) and country is not null;
  v_country := coalesce(v_place.country, case when p_kind = 'project' then (select pr.country from projects pr where pr.id = p_object_id) end);
  if v_country is not null then
    v_facts := condition_facts(p_kind, p_object_id, p_at);
  end if;
  if v_place.id is not null then
    v_start := coalesce(municipality_of(v_place.id), v_place.region);

    -- The municipality, the region, then the regions it is part of, up to
    -- the top of the levels its pack lists: a value decided above holds below it.
    v_region := v_start;
    while v_region is not null and not v_region = any (v_climbed) loop
      select case r.kind when 'municipality' then 'municipality' else 'region' end into v_level from regions r where r.code = v_region;
      reached := coalesce(v_level, 'region');
      v_climbed := v_climbed || v_region;
      d := pack_value(p_attribute_type, v_place.country, v_region, v_day, v_facts);
      if d.id is not null then
        if d.value is null then
          raise exception 'parameter_not_decided: % in %: %', p_attribute_type, v_region, coalesce(d.reference, 'no single value')
            using errcode = 'no_data_found';
        end if;
        return jsonb_build_object('value', d.value, 'level', reached, 'region', v_region, 'conditions', d.condition,
                                  'source_code', d.source_code, 'reference', d.reference, 'quality', d.quality, 'valid_from', d.valid_from);
      end if;
      select r.parent into v_region from regions r where r.code = v_region;
    end loop;
  end if;
  if v_country is not null then
    reached := 'country';
    d := pack_value(p_attribute_type, v_country, null, v_day, v_facts);
    if d.id is not null then
      if d.value is null then
        raise exception 'parameter_not_decided: % in %: %', p_attribute_type, v_country, coalesce(d.reference, 'no single value')
          using errcode = 'no_data_found';
      end if;
      return jsonb_build_object('value', d.value, 'level', 'country', 'country', v_country, 'conditions', d.condition,
                                'source_code', d.source_code, 'reference', d.reference, 'quality', d.quality, 'valid_from', d.valid_from);
    end if;
  end if;

  -- 5. A technology figure a module publishes for every country, with its
  -- cited source: below every place, so that any level above wins.
  if v_facts is null then
    v_facts := condition_facts(p_kind, p_object_id, p_at);
  end if;
  d := pack_value(p_attribute_type, null, null, v_day, v_facts);
  if d.id is not null and d.value is not null then
    return jsonb_build_object('value', d.value, 'level', 'generic', 'conditions', d.condition, 'published_by', d.published_by,
                              'source_code', d.source_code, 'reference', d.reference, 'quality', d.quality, 'valid_from', d.valid_from);
  end if;

  raise exception 'parameter_missing: % for %, reached %', p_attribute_type, p_object_id,
    case reached when 'country' then 'country ' || v_country when 'region' then 'region ' || v_place.region
                 when 'municipality' then 'municipality ' || v_start else reached end
    using errcode = 'no_data_found';
end;
$$;

comment on function parameter_of(text, uuid, text, timestamptz) is
  'The value of a parameter for an object (its kind and id) at a moment: its own attribute, its parents'' nearest first along the foreign keys (parents_of), its organisation''s, then the pack''s for the municipality of its participant''s place (municipality_of), its region, its parent regions nearest first, and the country (a project''s own country when it has no participant''s place), then the generic level a module publishes for a technology figure (a null country, decision 0053) — at each level of the pack the most specific row whose condition the object meets (the kind of its project, the segment of its participant, its device''s type, the density class of its municipality, an attribute: condition_facts, condition_matches, pack_value). {value, level, region or country, conditions, source_code, reference, quality (value_quality), valid_from}. No value chosen by the core for every country: parameter_missing names the attribute type and the level reached; parameter_not_decided gives the reference of a place that decides no single value; parameter_ambiguous names two rows as specific as each other.';

-- ---------------------------------------------------------------------------
-- store() — a simulated value is estimated unless said otherwise.
-- ---------------------------------------------------------------------------

-- The one way values are written (decision 0031), as 0.3.0 wrote it but for
-- the quality of a value given none: 0 measured as the source delivered it,
-- and 1 estimated in a simulated series, which a computation writes. A
-- forecast keeps its values without a quality (forecast_values): it is an
-- estimate by what it is. A command and a setpoint are what was asked,
-- delivered as such: 0.

create or replace function store(
  p_series_id uuid,
  p_at        timestamptz[],
  p_value     float8[],
  p_quality   smallint[] default null,
  p_unit      text default null,
  p_issued_at timestamptz default null,
  p_series    jsonb default null,
  out series_id uuid,
  out changed   integer
)
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  s        series%rowtype;
  q        quantities%rowtype;
  org      uuid;
  f_from   units%rowtype;
  f_to     units%rowtype;
  converting boolean := false;
  anchor   timestamptz;
  removed  date;
  tz       text;
begin
  -- The series: by id, or ensured from its identity.
  if p_series_id is null then
    if p_series is null or p_series->>'object_kind' is null or p_series->>'object_id' is null or p_series->>'quantity_code' is null then
      raise exception 'series_required: name a series by its id, or by its object (kind and id) and quantity' using errcode = 'invalid_parameter_value';
    end if;
    org := object_organisation(p_series->>'object_kind', (p_series->>'object_id')::uuid);
    if not (caller_bypasses_rls() or row_has_capability(org, project_of(p_series->>'object_kind', (p_series->>'object_id')::uuid), participant_of(p_series->>'object_kind', (p_series->>'object_id')::uuid), 'data.write')) then
      raise exception 'object_not_found: %', p_series->>'object_id' using errcode = 'no_data_found';
    end if;
    p_series_id := series_ensure(
      p_series->>'object_kind', (p_series->>'object_id')::uuid, p_series->>'quantity_code', coalesce(p_series->>'kind', 'measured'),
      coalesce(p_series->>'value_kind', 'interval'), (p_series->>'step')::interval, (p_series->>'device_id')::uuid,
      p_series->>'external_ref', p_series->>'source_code', p_series->>'name',
      coalesce(p_series->'metadata', '{}'::jsonb), p_series->>'source');
  end if;
  select * into s from series se where se.id = p_series_id;
  if not found or not (caller_bypasses_rls() or row_has_capability(s.organisation_id, project_of(s.object_kind, s.object_id), participant_of(s.object_kind, s.object_id), 'data.read')) then
    raise exception 'series_not_found: %', p_series_id using errcode = 'no_data_found';
  end if;
  if not (caller_bypasses_rls() or row_has_capability(s.organisation_id, project_of(s.object_kind, s.object_id), participant_of(s.object_kind, s.object_id), 'data.write')) then
    raise exception 'series_read_only: the caller reads series % but does not write it', p_series_id using errcode = 'insufficient_privilege';
  end if;
  series_id := s.id;
  changed := 0;
  if s.kind = 'forecast' and p_issued_at is null then
    raise exception 'issued_at_required: a forecast is stored with the time it was issued' using errcode = 'invalid_parameter_value';
  end if;

  -- The values: aligned, dated once each.
  if coalesce(cardinality(p_at), 0) <> coalesce(cardinality(p_value), 0)
     or (p_quality is not null and cardinality(p_quality) <> coalesce(cardinality(p_at), 0)) then
    raise exception 'values_misaligned: as many instants, values and qualities' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(cardinality(p_at), 0) = 0 then
    return;
  end if;
  if exists (select 1 from unnest(p_at) a where a is null) then
    raise exception 'instant_required: every value is dated' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(distinct a) from unnest(p_at) a) <> cardinality(p_at) then
    raise exception 'values_duplicated: an instant is given twice in one write' using errcode = 'invalid_parameter_value';
  end if;
  if p_quality is not null and exists (
       select 1 from unnest(p_quality) c where c is not null and not (c in (0, 1, 2, 3) or c >= 100)) then
    raise exception 'quality_unknown: a quality is 0 measured, 1 estimated, 2 substituted, 3 missing, or a pack''s code from 100 up' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(p_value, coalesce(p_quality, array_fill(null::smallint, array[cardinality(p_at)]))) v(value, quality)
              where v.value is null and coalesce(v.quality, 0) <> 3) then
    raise exception 'value_required: a value is given, or its quality says missing (3)' using errcode = 'invalid_parameter_value';
  end if;

  if s.kind = 'simulated' and s.source is null and s.source_code is null then
    raise exception 'series_calculation_required: a simulated series is written by a computation, or comes from a named source' using errcode = 'check_violation';
  end if;

  -- The unit: converted on the way in, refused when it measures something
  -- else. A price series without a currency (an organisation's) takes the
  -- one of the unit its first write names.
  select * into q from quantities where code = s.quantity_code;
  if quantity_priced(q.code) and s.currency is null then
    if p_unit is null or coalesce((select u.currency from units u where u.code = unit_code(p_unit)), 'XXX') = 'XXX' then
      raise exception 'currency_required: series % holds a price; name its unit in a currency (EUR-PER-MegaW-HR)', s.id
        using errcode = 'invalid_parameter_value';
    end if;
    update series set currency = (select u.currency from units u where u.code = unit_code(p_unit)) where id = s.id
      returning * into s;
  end if;
  q.unit := quantity_unit(q.code, s.currency);
  if p_unit is not null and unit_code(p_unit) <> q.unit then
    select * into f_from from units where code = unit_code(p_unit);
    select * into f_to from units where code = q.unit;
    if f_to.code is null or f_from.quantity_kind <> f_to.quantity_kind or f_from.currency is distinct from f_to.currency then
      raise exception 'series_unit_mismatch: % is not a unit of % (stored in %)', p_unit, q.code, q.unit using errcode = 'check_violation';
    end if;
    converting := true;
  end if;

  -- The step: a regular series takes instants on its grid only.
  if s.step is not null and series_step_shape(s.step) = 'time' then
    select v.at into anchor from series_values v where v.series_id = s.id order by v.at desc limit 1;
    anchor := coalesce(anchor, (select min(a) from unnest(p_at) a));
    if exists (select 1 from unnest(p_at) a where (extract(epoch from a - anchor)::numeric % extract(epoch from s.step)::numeric) <> 0) then
      raise exception 'series_step_mismatch: series % takes a value every %; an instant falls between', s.id, s.step using errcode = 'check_violation';
    end if;
  end if;

  -- The device: a series whose device was removed takes no value after the removal day.
  if s.device_id is not null then
    select d.removal_date into removed from devices d where d.id = s.device_id;
    if removed is not null then
      tz := coalesce(series_time_zone(s.id), 'UTC');
      if exists (select 1 from unnest(p_at) a where (a at time zone tz)::date > removed) then
        raise exception 'device_retired: the device of series % was removed on %', s.id, removed using errcode = 'check_violation';
      end if;
    end if;
  end if;

  perform set_config('nexgen.store_series', s.id::text, true);

  if s.kind = 'forecast' then
    insert into forecast_values (series_id, at, issued_at, value)
    select s.id, v.at, p_issued_at,
           case when converting then (v.value * f_from.factor + f_from."offset" - f_to."offset") / f_to.factor else v.value end
      from unnest(p_at, p_value) as v(at, value)
     where v.value is not null
     order by v.at
    on conflict do nothing;
    get diagnostics changed = row_count;
    perform set_config('nexgen.store_series', '', true);
    return;
  end if;
  if p_issued_at is not null then
    raise exception 'not_a_forecast: series % is %, its values have no issue time', s.id, s.kind using errcode = 'invalid_parameter_value';
  end if;

  insert into series_values as sv (series_id, at, value, quality)
  select s.id, v.at,
         case when v.value is null then 'NaN'::float8
              when converting then (v.value * f_from.factor + f_from."offset" - f_to."offset") / f_to.factor
              else v.value end,
         case when v.value is null then 3 else coalesce(v.quality, case when s.kind = 'simulated' then 1 else 0 end) end
    from unnest(p_at, p_value, coalesce(p_quality, array_fill(null::smallint, array[cardinality(p_at)]))) as v(at, value, quality)
   order by v.at
  on conflict (series_id, at) do update set value = excluded.value, quality = excluded.quality
   where (sv.value, sv.quality) is distinct from (excluded.value, excluded.quality);
  get diagnostics changed = row_count;

  perform set_config('nexgen.store_series', '', true);
end;
$$;

comment on function store(uuid, timestamptz[], float8[], smallint[], text, timestamptz, jsonb) is
  'The one way values are written: the series by id or by identity (series_ensure()), values converted from p_unit to the quantity''s unit (for a price, in the series'' currency, which a first write in a currency unit sets for a series that has none), qualities checked (none given: 0, or 1 in a simulated series), a forecast stored with its issue time, equal values left untouched, the rollups of the hours written refreshed. Refuses series_required, object_not_found, series_not_found, series_read_only, values_misaligned, instant_required, values_duplicated, quality_unknown, value_required, series_calculation_required, unit_unknown, currency_required, series_unit_mismatch, series_step_mismatch, device_retired, issued_at_required, not_a_forecast. Returns the series and the rows changed.';

-- ---------------------------------------------------------------------------
-- role_capabilities — the presets, one closed list.
-- ---------------------------------------------------------------------------

-- A preset is one of the roles a person holds towards an object:
-- organisation_members.role (owner, editor, viewer), project_shares.role
-- (editor, viewer) and the account of a participant. A row for any other
-- word would never be resolved.
alter table role_capabilities drop constraint role_capabilities_role_format;
alter table role_capabilities add constraint role_capabilities_role
  check (role in ('owner', 'editor', 'viewer', 'participant'));

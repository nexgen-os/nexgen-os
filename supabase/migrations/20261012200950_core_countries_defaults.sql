-- Nexgen OS — core: countries, their regions, and the defaults a study
-- starts from.
--
-- The core names no country. What a country decides that a function of the
-- model reads is published by its pack (packs/<cc>): who the country is
-- (`countries`: currency, languages, time zones, the level its regions are
-- listed at, the pack's version and checksum), its regions
-- (`regions`: its ISO 3166-2 subdivisions, each with its time zone, and its
-- municipalities under them, decision 0009), and the values a study starts
-- from (`defaults`), each with its period, the condition it holds for (a
-- kind of project, a customer segment, a technology, a density class) and
-- the source it was read from, in the unit of its attribute type's quantity. An organisation is an
-- object: its own defaults are its attributes, not rows of this table.
--
-- `parameter_of()` is the one resolution of a parameter, in one order for
-- every attribute type: the object's own attribute, then its parents' nearest
-- first along the foreign keys of the core (`parents_of()`), then its
-- organisation, then the municipality of its participant's place, its
-- region and the regions it is part of (`regions.parent`), then the
-- country — and nothing else: device → participant → project →
-- organisation → municipality → region → its parent region(s) → country.
-- At each level of the pack, the most specific row whose conditions the
-- object meets answers. A value a region decides holds in every
-- region listed under it, without a copy. A module resolves its own objects
-- first (a building through its spaces), then asks the core from the
-- participant.
-- There is no global level: a value nobody decided is refused by name
-- (`parameter_missing`), never guessed.

set search_path = nexgen, extensions;

-- ---------------------------------------------------------------------------
-- countries — the identity a pack publishes.
-- ---------------------------------------------------------------------------

create table countries (
  -- ISO 3166-1 alpha-2.
  code                 char(2) primary key,
  name                 text not null,
  -- ISO 4217, a row of `currencies`.
  currency             char(3) not null references currencies(code),
  -- BCP 47, the first is the one a document is written in by default.
  languages            text[] not null default '{}',
  -- IANA, the first is the default of a place that names none.
  time_zones           text[] not null default '{}',
  -- The level the pack lists its regions at (a region, a province, a
  -- department), in the words of ISO 3166-2 for that country.
  region_level         text not null,
  -- The pattern its postal codes follow, and the identifier scheme of its
  -- municipality codes.
  postal_code_pattern  text,
  municipality_scheme  text references identifier_schemes(code),
  -- The box a map opens on: west, south, east, north, in degrees (WGS 84).
  bbox                 double precision[],
  -- The pack that published the row: its version (semver), the checksum of
  -- its seed, and how far it was checked — community, maintained, or
  -- reviewed by a named professional on a day.
  pack_version         text,
  pack_checksum        text,
  published_by         text not null,
  constraint countries_code_format check (code ~ '^[A-Z]{2}$'),
  constraint countries_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint countries_pack_version_format check (pack_version is null or pack_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint countries_checksum_format check (pack_checksum is null or pack_checksum ~ '^sha256:[0-9a-f]{64}$'),
  constraint countries_bbox check (bbox is null or (cardinality(bbox) = 4 and bbox[1] between -180 and 180 and bbox[3] between -180 and 180
                                                   and bbox[2] between -90 and 90 and bbox[4] between -90 and 90 and bbox[2] < bbox[4]))
);

comment on table countries is
  'What a country pack says a country is — currency, languages, time zones, region level, postal code pattern, municipality scheme — and which version of the pack, with its checksum, the installation holds. Written by packs.';

-- The units of a currency, copied from the pattern the core seed writes in
-- XXX (ISO 4217 "no currency"): EUR-PER-MegaW-HR, EUR/MWh. A country
-- declaring a currency brings its units; nothing names a currency in code.
create or replace function currency_units(p_currency text)
returns integer
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  n integer;
begin
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' or p_currency = 'XXX' then
    raise exception 'currency_invalid: % is not an ISO 4217 currency', p_currency using errcode = 'invalid_parameter_value';
  end if;
  insert into units (code, name, symbol, quantity_kind, factor, "offset", currency, published_by)
  select p_currency || substr(u.code, 4), replace(u.name, 'Currency', p_currency), replace(u.symbol, '¤', p_currency),
         u.quantity_kind, u.factor, u."offset", p_currency, 'core'
    from units u
   where u.currency = 'XXX'
  on conflict (code) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function currency_units(text) is
  'Copies the currency pattern of the units vocabulary (XXX-PER-MegaW-HR, ¤/MWh) for a currency (EUR-PER-MegaW-HR, EUR/MWh); written for every currency a country declares. Returns the units added. Refuses currency_invalid.';

create or replace function countries_currency_units()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  perform currency_units(new.currency);
  return new;
end;
$$;

comment on function countries_currency_units() is
  'AFTER INSERT / UPDATE of currency on countries: the units of the currency (currency_units()).';

create trigger countries_currency_units after insert or update of currency on countries
  for each row execute function countries_currency_units();

-- The currency an object's values of a price are kept in: the currency of
-- its participant's country, or of its project's; null for an
-- organisation, which names its currency in the unit of its first write.
create or replace function currency_of(p_kind text, p_id uuid)
returns char(3)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select c.currency from countries c
   where c.code = coalesce(country_of(p_kind, p_id),
                           case p_kind when 'project' then (select pr.country from projects pr where pr.id = p_id) end);
$$;

comment on function currency_of(text, uuid) is
  'The currency of the country of an object (its participant''s place, or its project''s country); null for an organisation or a country no pack declares.';

-- ---------------------------------------------------------------------------
-- regions — the subdivisions of a country, at the level its pack lists, and
-- its municipalities.
-- ---------------------------------------------------------------------------

create table regions (
  -- ISO 3166-2 for a subdivision; the country, a hyphen and the country's
  -- own code for a municipality (FR-75056, BE-21004), its value under the
  -- country's municipality scheme.
  code          text primary key,
  country       char(2) not null references countries(code) on delete cascade,
  name          text not null,
  -- subdivision: an ISO 3166-2 code; municipality: the smallest unit
  -- that decides, under the subdivision its pack names as its parent.
  kind          text not null default 'subdivision',
  -- The region it is part of, when the pack lists two levels or more.
  parent        text references regions(code),
  -- IANA, when it differs from the country's first.
  time_zone     text,
  -- Its name in the languages of the country and others, by BCP 47 tag
  -- ({"nl": "Brussel", "de": "Brüssel"}); `name` is the one the pack uses.
  names         jsonb not null default '{}',
  -- Other names it is written under (an old name, an abbreviation), and the
  -- first characters of the postal codes inside it, for a search.
  aliases       text[] not null default '{}',
  postal_prefixes text[] not null default '{}',
  published_by  text not null,
  constraint regions_kind check (kind in ('subdivision', 'municipality')),
  constraint regions_code_format check (
    (kind = 'subdivision' and code ~ ('^' || country || '-[A-Z0-9]{1,3}$'))
    or (kind = 'municipality' and code ~ ('^' || country || '-[0-9A-Za-z]+$') and parent is not null)),
  constraint regions_not_own_parent check (parent is distinct from code),
  constraint regions_names_object check (jsonb_typeof(names) = 'object')
);

comment on table regions is
  'The ISO 3166-2 subdivisions of a country at the level its pack lists them, with their parent and time zone, and its municipalities (kind municipality, under their subdivision) where its pack lists them: a value decided for a municipality (its density class, a local rule) is a defaults row of that region. A participant''s place names a subdivision as its region and its municipality by the country''s code (municipality_of()). Written by packs.';

-- A municipality's code is the country's own: its value matches the
-- country's municipality scheme.
create or replace function regions_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_scheme text;
begin
  if new.kind = 'municipality' then
    select c.municipality_scheme into v_scheme from countries c where c.code = new.country;
    if v_scheme is null then
      raise exception 'municipality_scheme_required: % lists municipalities and declares no municipality scheme', new.country
        using errcode = 'check_violation';
    end if;
    if not identifier_valid(v_scheme, substr(new.code, 4)) then
      raise exception 'invalid_identifier: % is not a valid %', substr(new.code, 4), v_scheme using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

comment on function regions_check() is
  'BEFORE INSERT / UPDATE on regions: a municipality''s code is the country''s municipality scheme (municipality_scheme_required, invalid_identifier).';

create trigger regions_check before insert or update of code, kind, country on regions
  for each row execute function regions_check();

create index regions_country_idx on regions (country);

-- A place names a region its country's pack lists, when the pack lists any.
create or replace function participants_region_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  -- A region of another country is refused by the format check of participants.
  if new.region is not null and new.region like new.country || '-%'
     and exists (select 1 from regions r where r.country = new.country and r.kind = 'subdivision')
     and not exists (select 1 from regions r where r.code = new.region and r.kind = 'subdivision') then
    raise exception 'region_unknown: % is not a region the % pack lists', new.region, new.country
      using errcode = 'check_violation';
  end if;
  if new.municipality is not null
     and not identifier_valid((select c.municipality_scheme from countries c where c.code = new.country), new.municipality) then
    raise exception 'invalid_identifier: % is not a municipality code of %', new.municipality, new.country
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function participants_region_check() is
  'BEFORE INSERT / UPDATE on participants: the region is one the country''s pack lists, when it lists any (region_unknown); the municipality is a value of the country''s municipality scheme (invalid_identifier).';

create trigger participants_region_check before insert or update of region, municipality, country on participants
  for each row execute function participants_region_check();

-- The municipality of a participant's place, as the regions row its pack
-- lists for it.
create or replace function municipality_of(p_participant_id uuid)
returns text
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select r.code
    from participants p
    join regions r on r.code = p.country || '-' || p.municipality and r.kind = 'municipality'
   where p.id = p_participant_id;
$$;

comment on function municipality_of(uuid) is
  'The municipality of a participant''s place as a regions row (FR-75056), when the country''s pack lists it; null otherwise.';

-- ---------------------------------------------------------------------------
-- conditions — when a value or a template applies, in one shape.
-- ---------------------------------------------------------------------------

-- A condition is a JSON object whose keys are all optional: the kind of
-- the project (and the kinds refining it), the segment of the participant
-- (and the segments refining it), the type of the device (and the types
-- refining it), the density class of the municipality of the place, and
-- one attribute compared with a number. {} holds for every object. A
-- default of a pack and a template of the actions module say when they
-- apply in this shape, checked here and matched by condition_matches().
create or replace function condition_check(p_condition jsonb)
returns jsonb
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k text;
  a jsonb := p_condition->'attribute';
begin
  if p_condition is null or jsonb_typeof(p_condition) <> 'object' then
    raise exception 'condition_invalid: a condition is a JSON object' using errcode = 'check_violation';
  end if;
  for k in select jsonb_object_keys(p_condition) loop
    if k not in ('project_kind', 'segment', 'device_type', 'density_class', 'attribute') then
      raise exception 'condition_invalid: % is not a key of a condition (project_kind, segment, device_type, density_class, attribute)', k
        using errcode = 'check_violation';
    end if;
    if k <> 'attribute' and jsonb_typeof(p_condition->k) <> 'string' then
      raise exception 'condition_invalid: % is a code', k using errcode = 'check_violation';
    end if;
  end loop;
  if p_condition ? 'project_kind' and not exists (select 1 from project_kinds where code = p_condition->>'project_kind') then
    raise exception 'condition_invalid: % is not a project_kinds code', p_condition->>'project_kind' using errcode = 'check_violation';
  end if;
  if p_condition ? 'segment' and not exists (select 1 from segments where code = p_condition->>'segment') then
    raise exception 'condition_invalid: % is not a segments code', p_condition->>'segment' using errcode = 'check_violation';
  end if;
  if p_condition ? 'device_type' and not exists (select 1 from device_types where code = p_condition->>'device_type') then
    raise exception 'condition_invalid: % is not a device_types code', p_condition->>'device_type' using errcode = 'check_violation';
  end if;
  if p_condition ? 'density_class' and p_condition->>'density_class' !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'condition_invalid: % is not a density class code', p_condition->>'density_class' using errcode = 'check_violation';
  end if;
  if a is not null and not (
       jsonb_typeof(a) = 'object' and a ?& array['attribute_type', 'op', 'value'] and (select count(*) from jsonb_object_keys(a)) = 3
       and a->>'op' in ('=', '<>', '<', '<=', '>', '>=') and jsonb_typeof(a->'value') = 'number'
       and exists (select 1 from attribute_types t where t.code = a->>'attribute_type')) then
    raise exception 'condition_invalid: an attribute condition is {"attribute_type": <an attribute_types code>, "op": "=, <>, <, <=, > or >=", "value": <a number>}'
      using errcode = 'check_violation';
  end if;
  return p_condition;
end;
$$;

comment on function condition_check(jsonb) is
  'Returns a condition in its one shape — {project_kind, segment, device_type, density_class, attribute: {attribute_type, op, value}}, every key optional — or refuses condition_invalid, naming what is wrong. Read by defaults and by the action templates.';

-- How specific a condition is: the number of its criteria.
create or replace function condition_specificity(p_condition jsonb)
returns integer
language sql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
  select count(*)::integer from jsonb_object_keys(p_condition);
$$;

-- What a condition is matched against, for an object of the core at a
-- moment: its kind and id, the kind of its project, the segment of its
-- participant, the type of its device, the density class of its
-- municipality (the `density_class` default of the municipality of its
-- participant's place or a region above it).
create or replace function condition_facts(p_kind text, p_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_place    participants%rowtype;
  v_project  uuid;
  v_kind     text;
  v_device   text;
  v_density  text;
  v_region   text;
  v_climbed  text[] := '{}';
begin
  select * into v_place from participants where id = participant_of(p_kind, p_id);
  v_project := case when p_kind = 'project' then p_id else v_place.project_id end;
  select pr.kind into v_kind from projects pr where pr.id = v_project;
  v_device := case p_kind
                when 'device' then (select dv.device_type from devices dv where dv.id = p_id)
                when 'series' then (select dv.device_type from series se join devices dv on dv.id = se.device_id where se.id = p_id)
              end;
  if v_place.country is not null then
    v_region := coalesce(municipality_of(v_place.id), v_place.region);
    while v_region is not null and v_density is null and not v_region = any (v_climbed) loop
      v_climbed := v_climbed || v_region;
      v_density := (pack_value('density_class', v_place.country, v_region, p_at::date)).value #>> '{}';
      select r.parent into v_region from regions r where r.code = v_region;
    end loop;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('object_kind', p_kind, 'object_id', p_id, 'at', p_at,
    'project_kind', v_kind, 'segment', v_place.segment, 'device_type', v_device, 'density_class', v_density));
end;
$$;

comment on function condition_facts(text, uuid, timestamptz) is
  'What a condition is matched against for an object of the core at a moment: {object_kind, object_id, at, project_kind, segment, device_type, density_class}, each when the object has it.';

-- Whether an object, by its facts, meets a condition: every criterion
-- given holds (a kind, a segment or a type matching its refinements too).
-- Null when the condition compares an attribute the object does not have:
-- nothing decided in the dark.
create or replace function condition_matches(p_condition jsonb, p_facts jsonb)
returns boolean
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  a        jsonb := p_condition->'attribute';
  v_value  jsonb;
  v        numeric;
  w        numeric;
begin
  if p_condition ? 'project_kind' and not coalesce(is_a('project_kinds', p_facts->>'project_kind', p_condition->>'project_kind'), false) then
    return false;
  end if;
  if p_condition ? 'segment' and not coalesce(is_a('segments', p_facts->>'segment', p_condition->>'segment'), false) then
    return false;
  end if;
  if p_condition ? 'device_type' and not coalesce(device_type_is_a(p_facts->>'device_type', p_condition->>'device_type'), false) then
    return false;
  end if;
  if p_condition ? 'density_class' and (p_facts->>'density_class') is distinct from (p_condition->>'density_class') then
    return false;
  end if;
  if a is null then
    return true;
  end if;
  v_value := (attribute_at((p_facts->>'object_id')::uuid, a->>'attribute_type', coalesce((p_facts->>'at')::timestamptz, now()))).value;
  if v_value is null or jsonb_typeof(v_value) <> 'number' then
    return null;
  end if;
  v := (v_value #>> '{}')::numeric;
  w := (a->>'value')::numeric;
  return case a->>'op' when '=' then v = w when '<>' then v <> w when '<' then v < w
                       when '<=' then v <= w when '>' then v > w when '>=' then v >= w end;
end;
$$;

comment on function condition_matches(jsonb, jsonb) is
  'Whether an object meets a condition, by its facts (condition_facts()): every criterion given holds, a kind, a segment or a device type matching its refinements too; an attribute criterion reads the object''s own attribute at the moment of the facts, and answers null when the object has none. One matcher for parameter_of() and actions.plan().';

-- ---------------------------------------------------------------------------
-- defaults — the values a study starts from.
-- ---------------------------------------------------------------------------

create table defaults (
  id               uuid primary key default gen_random_uuid(),
  attribute_type   text not null references attribute_types(code),
  -- The country of the pack, and the region when the value holds in part
  -- of the country only: a subdivision, or a municipality. Null for a
  -- technology figure a module publishes, the same in every country (the
  -- C-rate of a representative battery), with its cited source: the last
  -- level of parameter_of(), below every place (decision 0053).
  country          char(2) references countries(code) on delete cascade,
  region           text references regions(code) on delete cascade,
  -- The condition the value holds for, when it holds for some objects of
  -- the place only, in the one shape of a condition (condition_check()):
  -- {"project_kind", "segment", "device_type", "density_class",
  -- "attribute": {"attribute_type", "op", "value"}}, every key optional;
  -- {} matches every object. A value of a legal frame holds for a kind of
  -- project (and the kinds refining it), a tax for a customer segment (and
  -- the segments refining it), a rule for a technology (a device type, and
  -- the types refining it), a perimeter for the density class of the
  -- municipality (the `density_class` default of the municipality).
  condition        jsonb not null default '{}',
  -- The value, in the unit of the attribute type's quantity; null when the
  -- country gives no single answer (it depends on a contract, a company, an
  -- option), with the reference that says so.
  value            jsonb,
  valid_from       date,
  valid_to         date,
  -- Where the value was read: a source of the vocabulary (a law, a
  -- statistic, an operator's page) and the place in it (an article, a
  -- table, a page).
  source_code      text not null references sources(code),
  reference        text,
  -- What kind of value it is (value_statuses): published when the source
  -- decides it (a law, a regulated tariff), estimated when it is a
  -- statistic or a model, default when it is a conventional assumption.
  status           text not null default 'published' references value_statuses(code),
  published_by     text not null,
  created_at       timestamptz not null default now(),
  constraint defaults_region_in_country check (region is null or region like country || '-%'),
  constraint defaults_generic_has_no_region check (country is not null or region is null),
  -- What a pack publishes is its country's; only a module publishes for
  -- every country.
  constraint defaults_country_of_a_pack check (country is not null or published_by not like 'pack:%'),
  constraint defaults_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table defaults is
  'The values a country, one of its regions or one of its municipalities decides, by attribute type and for the condition they hold for (a kind of project, a segment, a technology, a density class), each with its source and reference: the last levels of parameter_of(), a region''s holding in the regions listed under it. Published by packs; dated, never edited — a new value is a new row and a valid_to on the old one.';

-- The natural key a pack upserts by.
create unique index defaults_natural_key on defaults
  (country, region, attribute_type, condition, valid_from) nulls not distinct;

create or replace function defaults_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (new.value is distinct from old.value or new.attribute_type <> old.attribute_type
       or new.country <> old.country or new.region is distinct from old.region or new.valid_from is distinct from old.valid_from
       or new.condition <> old.condition) then
    raise exception 'value_edited: % from % holds %; close it with valid_to and add a row',
      old.attribute_type, coalesce(old.valid_from::text, 'the start'), coalesce(old.value::text, 'null')
      using errcode = 'check_violation';
  end if;
  if new.value is not null then
    perform attribute_value_check(new.attribute_type, new.value);
  end if;
  perform condition_check(new.condition);
  if exists (
    select 1 from defaults d
     where d.attribute_type = new.attribute_type
       and d.country = new.country and d.region is not distinct from new.region and d.id <> new.id
       and d.condition = new.condition
       -- the same day is the natural key's, an upsert's to resolve
       and d.valid_from is distinct from new.valid_from
       and daterange(d.valid_from, d.valid_to) && daterange(new.valid_from, new.valid_to)
  ) then
    raise exception 'overlapping_value: % already has a default over that period', new.attribute_type
      using errcode = 'exclusion_violation';
  end if;
  return new;
end;
$$;

comment on function defaults_check() is
  'BEFORE INSERT / UPDATE on defaults: the value fits its attribute type (invalid_value), the condition has the one shape of a condition (condition_invalid), periods never overlap at one level and one condition (overlapping_value), and a row only ever gets its period closed, its source, its reference or its status corrected (value_edited).';

create trigger defaults_check
  before insert or update on defaults
  for each row execute function defaults_check();

-- ---------------------------------------------------------------------------
-- parameter_of — the one resolution of a parameter.
-- ---------------------------------------------------------------------------

-- The attribute of one object holding at a moment.
create or replace function attribute_at(p_object_id uuid, p_attribute_type text, p_at timestamptz)
returns attributes
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select a.*
    from attributes a
   where a.object_id = p_object_id and a.attribute_type = p_attribute_type
     and (a.valid_from is null or a.valid_from <= p_at)
     and (a.valid_to is null or a.valid_to > p_at)
   limit 1;
$$;

comment on function attribute_at(uuid, text, timestamptz) is
  'The attribute row of one object and attribute type holding at a moment; null when none.';

-- The parents of an object of the core, nearest first, through its foreign
-- keys: a participant is in its group, then in its project; a meter and a
-- device are their participant's, then its parents. A series is its
-- object's, then its parents.
create or replace function parents_of(p_kind text, p_id uuid)
returns table (kind text, object_id uuid)
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k   text;
  id  uuid;
begin
  if p_kind = 'series' then
    select se.object_kind, se.object_id into k, id from series se where se.id = p_id;
  elsif p_kind = 'meter' then
    select 'participant', m.participant_id into k, id from meters m where m.id = p_id;
  elsif p_kind = 'device' then
    select 'participant', d.participant_id into k, id from devices d where d.id = p_id;
  elsif p_kind = 'participant' then
    return query
      select x.kind, x.object_id from (
        select 1 as n, 'participant'::text as kind, p.parent_id as object_id from participants p where p.id = p_id
        union all select 2, 'project', p.project_id from participants p where p.id = p_id
      ) x
      where x.object_id is not null
      order by x.n;
    return;
  end if;
  if k is null then
    return;
  end if;
  kind := k;
  object_id := id;
  return next;
  return query select * from parents_of(k, id);
end;
$$;

comment on function parents_of(text, uuid) is
  'The parents of an object of the core along its foreign keys, nearest first: a participant''s group and project; a meter''s or a device''s participant, then its parents; a series'' object, then its parents.';

-- The pack's value at one level (a country, a region or a municipality)
-- for an object of the given facts: of the rows holding on the day whose
-- condition the object meets, the one with the most criteria. Two rows as
-- specific as each other are a gap of the pack, refused by name. Null when
-- no row matches.
create or replace function pack_value(
  p_attribute_type text,
  p_country        text,
  p_region         text,
  p_day            date,
  p_facts          jsonb default '{}'
)
returns defaults
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  best   defaults%rowtype;
  second defaults%rowtype;
  n      integer := 0;
  d      defaults%rowtype;
begin
  for d in
    select * from defaults x
     where x.attribute_type = p_attribute_type and x.country is not distinct from p_country and x.region is not distinct from p_region
       and (x.valid_from is null or x.valid_from <= p_day) and (x.valid_to is null or x.valid_to > p_day)
       and (x.condition = '{}' or condition_matches(x.condition, p_facts))
     order by condition_specificity(x.condition) desc
     limit 2
  loop
    n := n + 1;
    if n = 1 then best := d; else second := d; end if;
  end loop;
  if n = 2 and condition_specificity(best.condition) = condition_specificity(second.condition) then
    raise exception 'parameter_ambiguous: % in %: two values as specific as each other hold (% and %)',
      p_attribute_type, coalesce(p_region, p_country), best.condition, second.condition
      using errcode = 'cardinality_violation';
  end if;
  return best;
end;
$$;

comment on function pack_value(text, text, text, date, jsonb) is
  'The defaults row of a pack at one level (country, region or municipality; the generic level for a null country) holding on a day for an object of the given facts (condition_facts()): of the rows whose condition it meets (condition_matches()), the most specific. Null when none; parameter_ambiguous when two are as specific as each other.';

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
                              'source_code', a.source_code, 'reference', a.source, 'status', a.status, 'valid_from', a.valid_from);
  end if;

  -- 2. Its parents, nearest first.
  for anc in select * from parents_of(p_kind, p_object_id) loop
    reached := anc.kind;
    a := attribute_at(anc.object_id, p_attribute_type, p_at);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', anc.kind, 'object_id', anc.object_id,
                                'source_code', a.source_code, 'reference', a.source, 'status', a.status, 'valid_from', a.valid_from);
    end if;
  end loop;

  -- 3. Its organisation: an object like any other, whose defaults are its attributes.
  reached := 'organisation';
  if p_kind <> 'organisation' then
    a := attribute_at(v_org, p_attribute_type, p_at);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', 'organisation', 'object_id', v_org,
                                'source_code', a.source_code, 'reference', a.source, 'status', a.status, 'valid_from', a.valid_from);
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
                                  'source_code', d.source_code, 'reference', d.reference, 'status', d.status, 'valid_from', d.valid_from);
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
                                'source_code', d.source_code, 'reference', d.reference, 'status', d.status, 'valid_from', d.valid_from);
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
                              'source_code', d.source_code, 'reference', d.reference, 'status', d.status, 'valid_from', d.valid_from);
  end if;

  raise exception 'parameter_missing: % for %, reached %', p_attribute_type, p_object_id,
    case reached when 'country' then 'country ' || v_country when 'region' then 'region ' || v_place.region
                 when 'municipality' then 'municipality ' || v_start else reached end
    using errcode = 'no_data_found';
end;
$$;

comment on function parameter_of(text, uuid, text, timestamptz) is
  'The value of a parameter for an object (its kind and id) at a moment: its own attribute, its parents'' nearest first along the foreign keys (parents_of), its organisation''s, then the pack''s for the municipality of its participant''s place (municipality_of), its region, its parent regions nearest first, and the country (a project''s own country when it has no participant''s place), then the generic level a module publishes for a technology figure (a null country, decision 0053) — at each level of the pack the most specific row whose condition the object meets (the kind of its project, the segment of its participant, its device''s type, the density class of its municipality, an attribute: condition_facts, condition_matches, pack_value). {value, level, region or country, conditions, source_code, reference, status (value_statuses), valid_from}. No value chosen by the core for every country: parameter_missing names the attribute type and the level reached; parameter_not_decided gives the reference of a place that decides no single value; parameter_ambiguous names two rows as specific as each other.';

-- ---------------------------------------------------------------------------
-- Row level security: countries, regions and defaults are what packs
-- publish, read by everyone signed in and written by the installation.
-- ---------------------------------------------------------------------------

alter table countries enable row level security;
create policy countries_read on countries for select to authenticated using (true);
grant select on countries to authenticated;
grant select, insert, update, delete on countries to service_role;

alter table regions enable row level security;
create policy regions_read on regions for select to authenticated using (true);
grant select on regions to authenticated;
grant select, insert, update, delete on regions to service_role;

alter table defaults enable row level security;
create policy defaults_read on defaults for select to authenticated using (true);
grant select on defaults to authenticated;
grant select, insert, update, delete on defaults to service_role;

grant execute on function attribute_at(uuid, text, timestamptz), parents_of(text, uuid), parameter_of(text, uuid, text, timestamptz),
  pack_value(text, text, text, date, jsonb), currency_of(text, uuid), municipality_of(uuid),
  condition_check(jsonb), condition_specificity(jsonb), condition_facts(text, uuid, timestamptz), condition_matches(jsonb, jsonb)
  to authenticated, service_role;

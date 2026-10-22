-- Nexgen OS — core: countries, their regions, and the defaults a study
-- starts from.
--
-- The core names no country. What a country decides that a function of the
-- model reads is published by its pack (packs/<cc>): who the country is
-- (`countries`: currency, languages, time zones, the level its regions are
-- listed at, the pack's version and checksum), its regions
-- (`regions`, ISO 3166-2, each with its time zone), and the values a study
-- starts from (`defaults`), each with its period and the source it was
-- read from, in the unit of its property's quantity. An organisation is an
-- object: its own defaults are its attributes, not rows of this table.
--
-- `parameter_of()` is the one resolution of a parameter, in one order for
-- every property: the object's own attribute, then its parents' nearest
-- first along the foreign keys of the core (`parents_of()`), then its
-- organisation, then the region of its participant's place and the
-- regions it is part of (`regions.parent`), then the country — and nothing
-- else: device → participant → project → organisation → region → its
-- parent region(s) → country. A value a region decides holds in every
-- region listed under it, without a copy. A module resolves its own objects
-- first (a building through its spaces), then asks the core from the
-- participant.
-- There is no global level: a value nobody decided is refused by name
-- (`parameter_missing`), never guessed.

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- countries — the identity a pack publishes.
-- ---------------------------------------------------------------------------

create table countries (
  -- ISO 3166-1 alpha-2.
  code                 char(2) primary key,
  name                 text not null,
  -- ISO 4217.
  currency             char(3) not null,
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
  municipality_scheme  text references id_schemes(code),
  -- The pack that published the row: its version (semver), the checksum of
  -- its seed, and how far it was checked — community, maintained, or
  -- reviewed by a named professional on a day.
  pack_version         text,
  pack_checksum        text,
  published_by         text not null,
  constraint countries_code_format check (code ~ '^[A-Z]{2}$'),
  constraint countries_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint countries_pack_version_format check (pack_version is null or pack_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint countries_checksum_format check (pack_checksum is null or pack_checksum ~ '^sha256:[0-9a-f]{64}$')
);

comment on table countries is
  'What a country pack says a country is — currency, languages, time zones, region level, postal code pattern, municipality scheme — and which version of the pack, with its checksum, the installation holds. Written by packs.';

-- ---------------------------------------------------------------------------
-- regions — the subdivisions of a country, at the level its pack lists.
-- ---------------------------------------------------------------------------

create table regions (
  -- ISO 3166-2.
  code          text primary key,
  country       char(2) not null references countries(code) on delete cascade,
  name          text not null,
  -- The region it is part of, when the pack lists two levels.
  parent        text references regions(code),
  -- IANA, when it differs from the country's first.
  time_zone     text,
  published_by  text not null,
  constraint regions_code_format check (code ~ ('^' || country || '-[A-Z0-9]{1,3}$')),
  constraint regions_not_own_parent check (parent is distinct from code)
);

comment on table regions is
  'The ISO 3166-2 subdivisions of a country at the level its pack lists them, with their parent and time zone. A participant''s place names one; a default may hold in one only. Written by packs.';

create index regions_country_idx on regions (country);

-- A place names a region its country's pack lists, when the pack lists any.
create or replace function participants_region_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  -- A region of another country is refused by the format check of participants.
  if new.region is not null and new.region like new.country || '-%'
     and exists (select 1 from regions r where r.country = new.country)
     and not exists (select 1 from regions r where r.code = new.region) then
    raise exception 'region_unknown: % is not a region the % pack lists', new.region, new.country
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function participants_region_check() is
  'BEFORE INSERT / UPDATE on participants: the region is one the country''s pack lists, when it lists any (region_unknown).';

create trigger participants_region_check before insert or update of region, country on participants
  for each row execute function participants_region_check();

-- ---------------------------------------------------------------------------
-- defaults — the values a study starts from.
-- ---------------------------------------------------------------------------

create table defaults (
  id               uuid primary key default gen_random_uuid(),
  attribute_type   text not null references attribute_types(code),
  -- The country of the pack, and the region when the value holds in part
  -- of the country only.
  country          char(2) not null references countries(code) on delete cascade,
  region           text references regions(code) on delete cascade,
  -- The value, in the unit of the property's quantity; null when the
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
  published_by     text not null,
  created_at       timestamptz not null default now(),
  constraint defaults_region_in_country check (region is null or region like country || '-%'),
  constraint defaults_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table defaults is
  'The values a country or one of its regions decides, by property, each with its source and reference: the last levels of parameter_of(), a region''s holding in the regions listed under it. Published by packs; dated, never edited — a new value is a new row and a valid_to on the old one.';

-- The natural key a pack upserts by.
create unique index defaults_natural_key on defaults
  (country, region, attribute_type, valid_from) nulls not distinct;

create or replace function defaults_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (new.value is distinct from old.value or new.attribute_type <> old.attribute_type
       or new.country <> old.country or new.region is distinct from old.region or new.valid_from is distinct from old.valid_from) then
    raise exception 'value_edited: % from % holds %; close it with valid_to and add a row',
      old.attribute_type, coalesce(old.valid_from::text, 'the start'), coalesce(old.value::text, 'null')
      using errcode = 'check_violation';
  end if;
  if new.value is not null then
    perform attribute_value_check(new.attribute_type, new.value);
  end if;
  if exists (
    select 1 from defaults d
     where d.attribute_type = new.attribute_type
       and d.country = new.country and d.region is not distinct from new.region and d.id <> new.id
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
  'BEFORE INSERT / UPDATE on defaults: the value fits its property (invalid_value), periods never overlap at one level (overlapping_value), and a row only ever gets its period closed, its source or its reference corrected (value_edited).';

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
set search_path = nexgen, public, extensions, pg_temp
as $$
  select a.*
    from attributes a
   where a.object_id = p_object_id and a.attribute_type = p_attribute_type
     and (a.valid_from is null or a.valid_from <= p_at)
     and (a.valid_to is null or a.valid_to > p_at)
   limit 1;
$$;

comment on function attribute_at(uuid, text, timestamptz) is
  'The attribute row of one object and property holding at a moment; null when none.';

-- The parents of an object of the core, nearest first, through its foreign
-- keys: a participant is in its group, then in its project; a meter and a
-- device are their participant's, then its parents. A series is its
-- object's, then its parents.
create or replace function parents_of(p_kind text, p_id uuid)
returns table (kind text, object_id uuid)
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
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

create or replace function parameter_of(
  p_kind          text,
  p_object_id     uuid,
  p_attribute_type text,
  p_at            timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  a          attributes%rowtype;
  d          defaults%rowtype;
  v_org      uuid;
  anc        record;
  v_place    participants%rowtype;
  v_region   text;
  v_climbed  text[] := '{}';
  v_day      date := p_at::date;
  reached    text := 'object';
begin
  if not exists (select 1 from attribute_types where code = p_attribute_type) then
    raise exception 'attribute_type_unknown: %', p_attribute_type using errcode = 'foreign_key_violation';
  end if;
  v_org := object_organisation(p_kind, p_object_id);

  -- 1. The object itself.
  a := attribute_at(p_object_id, p_attribute_type, p_at);
  if a.id is not null then
    return jsonb_build_object('value', a.value, 'level', 'object', 'object_id', p_object_id,
                              'source_code', a.source_code, 'reference', a.source, 'valid_from', a.valid_from);
  end if;

  -- 2. Its parents, nearest first.
  for anc in select * from parents_of(p_kind, p_object_id) loop
    reached := anc.kind;
    a := attribute_at(anc.object_id, p_attribute_type, p_at);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', anc.kind, 'object_id', anc.object_id,
                                'source_code', a.source_code, 'reference', a.source, 'valid_from', a.valid_from);
    end if;
  end loop;

  -- 3. Its organisation: an object like any other, whose defaults are its attributes.
  reached := 'organisation';
  if p_kind <> 'organisation' then
    a := attribute_at(v_org, p_attribute_type, p_at);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', 'organisation', 'object_id', v_org,
                                'source_code', a.source_code, 'reference', a.source, 'valid_from', a.valid_from);
    end if;
  end if;

  -- 4. The region, then the country of its participant's place: the pack's.
  select * into v_place from participants where id = participant_of(p_kind, p_object_id) and country is not null;
  if v_place.id is not null then
    -- The region, then the region it is part of, up to the top of the
    -- levels its pack lists: a value decided above holds below it.
    v_region := v_place.region;
    while v_region is not null and not v_region = any (v_climbed) loop
      reached := 'region';
      v_climbed := v_climbed || v_region;
      select * into d from defaults
       where attribute_type = p_attribute_type and country = v_place.country and region = v_region
         and (valid_from is null or valid_from <= v_day) and (valid_to is null or valid_to > v_day);
      if found then
        if d.value is null then
          raise exception 'parameter_not_decided: % in %: %', p_attribute_type, v_region, coalesce(d.reference, 'no single value')
            using errcode = 'no_data_found';
        end if;
        return jsonb_build_object('value', d.value, 'level', 'region', 'region', v_region,
                                  'source_code', d.source_code, 'reference', d.reference, 'valid_from', d.valid_from);
      end if;
      select r.parent into v_region from regions r where r.code = v_region;
    end loop;
    reached := 'country';
    select * into d from defaults
     where attribute_type = p_attribute_type and country = v_place.country and region is null
       and (valid_from is null or valid_from <= v_day) and (valid_to is null or valid_to > v_day);
    if found then
      if d.value is null then
        raise exception 'parameter_not_decided: % in %: %', p_attribute_type, v_place.country, coalesce(d.reference, 'no single value')
          using errcode = 'no_data_found';
      end if;
      return jsonb_build_object('value', d.value, 'level', 'country', 'country', v_place.country,
                                'source_code', d.source_code, 'reference', d.reference, 'valid_from', d.valid_from);
    end if;
  end if;

  raise exception 'parameter_missing: % for %, reached %', p_attribute_type, p_object_id,
    case reached when 'country' then 'country ' || v_place.country when 'region' then 'region ' || v_place.region else reached end
    using errcode = 'no_data_found';
end;
$$;

comment on function parameter_of(text, uuid, text, timestamptz) is
  'The value of a parameter for an object (its kind and id) at a moment: its own attribute, its parents'' nearest first along the foreign keys (parents_of), its organisation''s, then the region''s of its participant''s place, its parent regions'' nearest first, and the country''s — {value, level, source_code, reference, valid_from}. No global level: parameter_missing names the property and the level reached; parameter_not_decided gives the reference of a country that decides no single value.';

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

grant execute on function attribute_at(uuid, text, timestamptz), parents_of(text, uuid), parameter_of(text, uuid, text, timestamptz)
  to authenticated, service_role;

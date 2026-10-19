-- Nexgen OS — core: countries, their regions, and the defaults a study
-- starts from.
--
-- The core names no country. What a country decides that a function of the
-- model reads is published by its pack (packs/<cc>): who the country is
-- (`countries`: currency, languages, time zones, the level its regions are
-- listed at, the pack's version, checksum and certification), its regions
-- (`regions`, ISO 3166-2, each with its time zone), and the values a study
-- starts from (`defaults`), each with its period and the source it was
-- read from, in the unit of its property's quantity. An organisation is an
-- object: its own defaults are its attributes, not rows of this table.
--
-- `parameter_of()` is the one resolution of a parameter, in one order for
-- every property: the object's own attribute, then its parents' nearest
-- first, then its organisation, then its region, then its country — and
-- nothing else. There is no global level: a value nobody decided is refused
-- by name (`parameter_missing`), never guessed.

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
  -- IANA, the first is the default of a site that names none.
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
  certification        text,
  certified_by         text,
  certified_on         date,
  published_by         text not null,
  constraint countries_code_format check (code ~ '^[A-Z]{2}$'),
  constraint countries_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint countries_pack_version_format check (pack_version is null or pack_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint countries_checksum_format check (pack_checksum is null or pack_checksum ~ '^sha256:[0-9a-f]{64}$'),
  constraint countries_certification check (certification is null or certification in ('community', 'maintained', 'reviewed')),
  constraint countries_reviewed check (certification is distinct from 'reviewed' or (certified_by is not null and certified_on is not null))
);

comment on table countries is
  'What a country pack says a country is — currency, languages, time zones, region level, postal code pattern, municipality scheme — and which version of the pack, with its checksum and certification, the installation holds. Written by packs.';

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
  'The ISO 3166-2 subdivisions of a country at the level its pack lists them, with their parent and time zone. A site names one; a default may hold in one only. Written by packs.';

create index regions_country_idx on regions (country);

-- A site names a region its country's pack lists, when the pack lists any.
create or replace function sites_region_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  -- A region of another country is refused by the format check of sites.
  if new.region is not null and new.region like new.country || '-%'
     and exists (select 1 from regions r where r.country = new.country)
     and not exists (select 1 from regions r where r.code = new.region) then
    raise exception 'region_unknown: % is not a region the % pack lists', new.region, new.country
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function sites_region_check() is
  'BEFORE INSERT / UPDATE on sites: the region is one the country''s pack lists, when it lists any (region_unknown).';

create trigger sites_region_check before insert or update of region, country on sites
  for each row execute function sites_region_check();

-- ---------------------------------------------------------------------------
-- defaults — the values a study starts from.
-- ---------------------------------------------------------------------------

create table defaults (
  id               uuid primary key default gen_random_uuid(),
  property_code    text not null references property_defs(code),
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
  'The values a country or one of its regions decides, by property, each with its source and reference: the two last levels of parameter_of(). Published by packs; dated, never edited — a new value is a new row and a valid_to on the old one.';

-- The natural key a pack upserts by.
create unique index defaults_natural_key on defaults
  (country, region, property_code, valid_from) nulls not distinct;

create or replace function defaults_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (new.value is distinct from old.value or new.property_code <> old.property_code
       or new.country <> old.country or new.region is distinct from old.region or new.valid_from is distinct from old.valid_from) then
    raise exception 'value_edited: % from % holds %; close it with valid_to and add a row',
      old.property_code, coalesce(old.valid_from::text, 'the start'), coalesce(old.value::text, 'null')
      using errcode = 'check_violation';
  end if;
  if new.value is not null then
    perform property_value_check(new.property_code, new.value);
  end if;
  if exists (
    select 1 from defaults d
     where d.property_code = new.property_code
       and d.country = new.country and d.region is not distinct from new.region and d.id <> new.id
       -- the same day is the natural key's, an upsert's to resolve
       and d.valid_from is distinct from new.valid_from
       and daterange(d.valid_from, d.valid_to) && daterange(new.valid_from, new.valid_to)
  ) then
    raise exception 'overlapping_value: % already has a default over that period', new.property_code
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

-- The attribute of one object holding at a moment, in a scenario or the
-- scenarios it builds on, else in reality.
create or replace function attribute_at(p_object_id uuid, p_property_code text, p_at timestamptz, p_scenario_id uuid)
returns attributes
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive chain as (
    select s.id, s.parent_id, 1 as rank from scenarios s where s.id = p_scenario_id
    union all
    select s.id, s.parent_id, chain.rank + 1 from scenarios s join chain on s.id = chain.parent_id
  )
  select a.*
    from attributes a
    left join chain on chain.id = a.scenario_id
   where a.object_id = p_object_id and a.property_code = p_property_code
     and (a.valid_from is null or a.valid_from <= p_at)
     and (a.valid_to is null or a.valid_to > p_at)
     and (a.scenario_id is null or chain.id is not null)
   order by coalesce(chain.rank, 1000000)
   limit 1;
$$;

comment on function attribute_at(uuid, text, timestamptz, uuid) is
  'The attribute row of one object and property holding at a moment, the scenario''s own before reality''s; null when none.';

create or replace function parameter_of(
  p_object_id     uuid,
  p_property_code text,
  p_at            timestamptz default now(),
  p_scenario_id   uuid default null
)
returns jsonb
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  a        attributes%rowtype;
  d        defaults%rowtype;
  o        objects%rowtype;
  anc      record;
  v_site   sites%rowtype;
  v_day    date := p_at::date;
  reached  text := 'object';
begin
  if not exists (select 1 from property_defs where code = p_property_code) then
    raise exception 'property_unknown: %', p_property_code using errcode = 'foreign_key_violation';
  end if;
  select * into o from objects where id = p_object_id;
  if not found then
    raise exception 'object_not_found: %', p_object_id using errcode = 'no_data_found';
  end if;

  -- 1. The object itself.
  a := attribute_at(p_object_id, p_property_code, p_at, p_scenario_id);
  if a.id is not null then
    return jsonb_build_object('value', a.value, 'level', 'object', 'object_id', p_object_id,
                              'source_code', a.source_code, 'reference', a.source, 'valid_from', a.valid_from);
  end if;

  -- 2. Its parents, nearest first.
  for anc in select * from ancestors_of(p_object_id) order by depth loop
    reached := anc.kind;
    a := attribute_at(anc.object_id, p_property_code, p_at, p_scenario_id);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', anc.kind, 'object_id', anc.object_id,
                                'source_code', a.source_code, 'reference', a.source, 'valid_from', a.valid_from);
    end if;
  end loop;

  -- 3. Its organisation: an object like any other, whose defaults are its attributes.
  reached := 'organisation';
  if o.kind <> 'organisation' then
    a := attribute_at(o.organisation_id, p_property_code, p_at, p_scenario_id);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', 'organisation', 'object_id', o.organisation_id,
                                'source_code', a.source_code, 'reference', a.source, 'valid_from', a.valid_from);
    end if;
  end if;

  -- 4. Its region, then its country: the pack's.
  select * into v_site from sites where id = site_of(p_object_id);
  if v_site.id is not null then
    if v_site.region is not null then
      reached := 'region';
      select * into d from defaults
       where property_code = p_property_code and country = v_site.country and region = v_site.region
         and (valid_from is null or valid_from <= v_day) and (valid_to is null or valid_to > v_day);
      if found then
        if d.value is null then
          raise exception 'parameter_not_decided: % in %: %', p_property_code, v_site.region, coalesce(d.reference, 'no single value')
            using errcode = 'no_data_found';
        end if;
        return jsonb_build_object('value', d.value, 'level', 'region', 'region', v_site.region,
                                  'source_code', d.source_code, 'reference', d.reference, 'valid_from', d.valid_from);
      end if;
    end if;
    reached := 'country';
    select * into d from defaults
     where property_code = p_property_code and country = v_site.country and region is null
       and (valid_from is null or valid_from <= v_day) and (valid_to is null or valid_to > v_day);
    if found then
      if d.value is null then
        raise exception 'parameter_not_decided: % in %: %', p_property_code, v_site.country, coalesce(d.reference, 'no single value')
          using errcode = 'no_data_found';
      end if;
      return jsonb_build_object('value', d.value, 'level', 'country', 'country', v_site.country,
                                'source_code', d.source_code, 'reference', d.reference, 'valid_from', d.valid_from);
    end if;
  end if;

  raise exception 'parameter_missing: % for %, reached %', p_property_code, p_object_id,
    case reached when 'country' then 'country ' || v_site.country when 'region' then 'region ' || v_site.region else reached end
    using errcode = 'no_data_found';
end;
$$;

comment on function parameter_of(uuid, text, timestamptz, uuid) is
  'The value of a parameter for an object at a moment: its own attribute, its parents'' nearest first, its organisation''s, its region''s, its country''s — {value, level, source_code, reference, valid_from}. No global level: parameter_missing names the property and the level reached; parameter_not_decided gives the reference of a country that decides no single value.';

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

grant execute on function attribute_at(uuid, text, timestamptz, uuid), parameter_of(uuid, text, timestamptz, uuid)
  to authenticated, service_role;

-- Nexgen OS — core: scenarios, the object registry, and the places.
--
-- The core names its objects: an organisation, a project, a participant, a
-- site, a meter, a device. Each is a table with the columns it always has. What every object
-- shares — an id, an organisation, a scenario — is kept once in `objects`,
-- the registry every attachment (attributes, identifiers, links, documents,
-- series, runs) points to. The registry is plumbing: a page reads
-- `from sites`, never `from objects`.
--
-- The place of the core is the site: an address, a point or a parcel, a
-- time zone, geolocated but not described. What a place physically is —
-- its buildings, their floors, rooms and units, their roof faces and
-- facades, where a device sits among them — is the description of a
-- building, the `building` module's (decision 0008), which declares its own kinds
-- of object with `declare_object()` and is found by `site_of()` like any
-- other.
--
-- Geometry is stored in WGS 84 (EPSG:4326), always three-dimensional, Z in
-- metres above sea level. Any CRS is accepted on the way in. Metric
-- computations project on the fly to the UTM zone of the geometry
-- (`metric_srid`), which works anywhere on earth without a national grid.

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- scenarios — the reality, and the variants people design against it.
-- ---------------------------------------------------------------------------

create table scenarios (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- A scenario may build on another one (variant B of the extension).
  parent_id        uuid references scenarios(id) on delete restrict,
  name             text not null,
  description      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint scenarios_name_not_blank check (btrim(name) <> '')
);

comment on table scenarios is
  'A design variant. Rows with scenario_id null describe what exists; rows with a scenario_id exist only in that variant (a new building, a PV system, a heat pump, a simulated series).';

create index scenarios_organisation_idx on scenarios (organisation_id);

create trigger scenarios_set_updated_at
  before update on scenarios
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- objects — the registry.
-- ---------------------------------------------------------------------------

create table objects (
  id               uuid primary key,
  -- organisation, project, participant, site, meter, device — and the
  -- kinds modules register (building, space, surface, pv_array, task…).
  kind             text not null,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now()
);

comment on table objects is
  'One row per object of any kind, with what every attachment needs: its organisation and its scenario. Maintained by the triggers of the named tables; never written by hand.';

create index objects_organisation_idx on objects (organisation_id);

-- What every kind of object is: its table, and the columns that lead to its
-- parents, in order of preference. Written by `declare_object()` for the core
-- kinds and the modules' alike, so that `site_of()` finds its way from any
-- object to its site without a module ever rewriting it.
create table object_kinds (
  kind            text primary key,
  table_name      text not null,
  parent_columns  text[] not null default '{}',
  published_by    text not null default 'core'
);

comment on table object_kinds is
  'One row per kind of object: the table that holds it and the columns leading to its parents, in order of preference. Filled by declare_object().';

-- Parents a module gives to a kind it does not own, through a table of its
-- own keyed by the object's id: where on its site a device is placed, for
-- one. Read before the kind's own columns, the finest place first, so that
-- `site_of()`, `ancestor_of()` and the cascade of `parameter_of()` walk
-- through it without the core knowing the module.
create table object_parent_tables (
  kind            text not null references object_kinds(kind) on delete cascade,
  table_name      text not null,
  key_column      text not null,
  parent_columns  text[] not null,
  published_by    text not null,
  primary key (kind, table_name)
);

comment on table object_parent_tables is
  'Parents a module gives to a kind of object it does not own: the module table keyed by the object''s id and its columns leading to the parents, in order of preference, read before the kind''s own. Filled by declare_parents().';

-- BEFORE INSERT / UPDATE / AFTER DELETE on every named table. tg_argv[0] is
-- the kind. Registers the row, keeps organisation fixed and scenario in sync.
create or replace function register_object()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into objects (id, kind, organisation_id, scenario_id)
    values (new.id, tg_argv[0], new.organisation_id, new.scenario_id);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.organisation_id <> old.organisation_id then
      raise exception 'object_organisation_is_final' using errcode = 'check_violation';
    end if;
    if new.scenario_id is distinct from old.scenario_id then
      update objects set scenario_id = new.scenario_id where id = new.id;
    end if;
    return new;
  else
    delete from objects where id = old.id;
    return old;
  end if;
end;
$$;

comment on function register_object() is
  'Trigger of every named table: registers the row in objects, keeps its organisation final and its scenario in step.';

-- BEFORE INSERT / UPDATE: the parent named by tg_argv[0] (a column holding
-- an object id) is in the same organisation, and a parent that exists only
-- in a scenario only holds children of that scenario.
create or replace function parent_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  col  text := tg_argv[0];
  pid  uuid;
  p    objects%rowtype;
begin
  execute format('select ($1).%I', col) into pid using new;
  if pid is null then
    return new;
  end if;
  select * into p from objects where id = pid;
  if not found then
    raise exception 'parent_not_found: %', pid using errcode = 'foreign_key_violation';
  end if;
  if p.organisation_id <> new.organisation_id then
    raise exception 'parent_in_other_organisation: %', col using errcode = 'check_violation';
  end if;
  if p.scenario_id is not null and p.scenario_id is distinct from new.scenario_id then
    raise exception 'parent_in_other_scenario: %', col using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function parent_check() is
  'Trigger of every parent column: the parent is in the same organisation, and in the same scenario when it exists only in one.';

-- Declares a named table as a kind of object: registry, parent checks,
-- updated_at, row level security.
create or replace procedure declare_object(p_table text, p_kind text, p_parents text[] default '{}')
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  n   text := replace(p_table, '.', '_');
  col text;
  v_by text := 'core';
begin
  -- A kind of a module's schema is published by the module that owns it,
  -- under its code, which may differ from the schema's name (`building` owns
  -- `building`); `modules` is created after this function, hence the
  -- dynamic query.
  if position('.' in p_table) > 0 then
    execute 'select code from modules where schema_name = $1' into v_by using split_part(p_table, '.', 1);
    v_by := coalesce(v_by, split_part(p_table, '.', 1));
  end if;
  insert into object_kinds (kind, table_name, parent_columns, published_by)
  values (p_kind, p_table, p_parents, v_by)
  on conflict (kind) do update set table_name = excluded.table_name, parent_columns = excluded.parent_columns, published_by = excluded.published_by;
  execute format('create trigger %I before insert or update on %s for each row execute function register_object(%L)',
                 n || '_register', p_table, p_kind);
  execute format('create trigger %I after delete on %s for each row execute function register_object(%L)',
                 n || '_unregister', p_table, p_kind);
  foreach col in array p_parents loop
    execute format('create trigger %I before insert or update of %I, scenario_id on %s for each row execute function parent_check(%L)',
                   n || '_' || col || '_check', col, p_table, col);
  end loop;
  execute format('create trigger %I before update on %s for each row execute function set_updated_at()',
                 n || '_set_updated_at', p_table);
  execute format('create index %I on %s (organisation_id)', n || '_organisation_idx', p_table);
  call secure_table(p_table);
end;
$$;

comment on procedure declare_object(text, text, text[]) is
  'Declares a named table as a kind of object, with its parent columns in order of preference: `call declare_object(''solar.pv_arrays'', ''pv_array'', ''{pv_system_id}'')`. A kind declared by a module is published by the module that owns the schema.';

create or replace procedure declare_parents(p_table text, p_kind text, p_key text, p_parents text[])
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_by text;
begin
  execute 'select code from modules where schema_name = $1' into v_by using split_part(p_table, '.', 1);
  insert into object_parent_tables (kind, table_name, key_column, parent_columns, published_by)
  values (p_kind, p_table, p_key, p_parents, coalesce(v_by, split_part(p_table, '.', 1)))
  on conflict (kind, table_name) do update set key_column = excluded.key_column, parent_columns = excluded.parent_columns;
end;
$$;

comment on procedure declare_parents(text, text, text, text[]) is
  'Declares a module table, keyed by the id of an object of a kind the module does not own, as giving that object parents: `call declare_parents(''<schema>.placements'', ''device'', ''device_id'', ''{<finest>,<coarsest>}'')`, the parents in order of preference.';

-- The parents of an object, in order of preference: those the modules give
-- it, then its own columns.
create or replace function parents_of(p_object_id uuid)
returns table (parent_id uuid)
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  k    text;
  r    record;
  col  text;
  p    uuid;
begin
  select o.kind into k from objects o where o.id = p_object_id;
  for r in
    select x.table_name, x.key_column, x.parent_columns from object_parent_tables x where x.kind = k
     order by x.table_name
  loop
    foreach col in array r.parent_columns loop
      execute format('select %I from %s where %I = $1', col, r.table_name, r.key_column) into p using p_object_id;
      if p is not null and p <> p_object_id then
        parent_id := p;
        return next;
      end if;
    end loop;
  end loop;
  for r in select ok.table_name, ok.parent_columns from object_kinds ok where ok.kind = k loop
    foreach col in array r.parent_columns loop
      execute format('select %I from %s where id = $1', col, r.table_name) into p using p_object_id;
      if p is not null and p <> p_object_id then
        parent_id := p;
        return next;
      end if;
    end loop;
  end loop;
end;
$$;

comment on function parents_of(uuid) is
  'The direct parents of an object, in order of preference: those module tables give it (object_parent_tables), then its own parent columns (object_kinds).';

-- ---------------------------------------------------------------------------
-- Geometry helpers
-- ---------------------------------------------------------------------------

create or replace function metric_srid(p_geom geometry)
returns integer
language sql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
  -- UTM zone of the centroid: 326xx north, 327xx south.
  select case
           when p_geom is null then null
           else (case when ST_Y(ST_Centroid(p_geom)) >= 0 then 32600 else 32700 end)
                + least(60, greatest(1, floor((ST_X(ST_Centroid(p_geom)) + 180) / 6)::int + 1))
         end;
$$;

comment on function metric_srid(geometry) is
  'EPSG code of the UTM zone a WGS 84 geometry falls in, for areas, lengths and distances in metres anywhere.';

create or replace function area_m2(p_geom geometry)
returns numeric
language sql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select round(ST_Area(ST_Transform(ST_Force2D(p_geom), metric_srid(p_geom)))::numeric, 2);
$$;

comment on function area_m2(geometry) is
  'Horizontal (plan) area in square metres of a WGS 84 polygon.';

create or replace function to_core_geometry(p_geom geometry)
returns geometry
language plpgsql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  g geometry := p_geom;
begin
  if g is null then
    return null;
  end if;
  if ST_SRID(g) = 0 then
    g := ST_SetSRID(g, 4326);
  elsif ST_SRID(g) <> 4326 then
    g := ST_Transform(g, 4326);
  end if;
  -- Polyhedral surfaces and TINs are 3D solids and surfaces whose validity
  -- needs SFCGAL. The others are checked in the plane they lie in: a flat
  -- polygon on its plan projection, a vertical one — a facade, a gable —
  -- on a side projection, where its plan projection would be a line. A
  -- planar polygon that is valid in its own plane is valid in at least one
  -- of the three; an invalid one is invalid in all three.
  if GeometryType(g) not in ('POLYHEDRALSURFACE', 'TIN', 'TRIANGLE')
     and not (ST_IsValid(ST_Force2D(g))
              or ST_IsValid(ST_Force2D(ST_RotateX(g, pi() / 2)))
              or ST_IsValid(ST_Force2D(ST_RotateY(g, pi() / 2)))) then
    raise exception 'invalid_geometry: %', ST_IsValidReason(ST_Force2D(g))
      using errcode = 'check_violation';
  end if;
  return ST_Force3D(g);
end;
$$;

comment on function to_core_geometry(geometry) is
  'Any geometry, in any CRS, comes out valid, in EPSG:4326 and three-dimensional. Every geometry column of the core goes through it.';

-- BEFORE INSERT / UPDATE: normalises the geometry column named by tg_argv[0].
create or replace function normalize_geometry()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  col text := tg_argv[0];
  g   geometry;
begin
  execute format('select ($1).%I', col) into g using new;
  g := to_core_geometry(g);
  -- geometry::text is hex EWKB, which the geometry input reads back as is.
  new := jsonb_populate_record(new, jsonb_build_object(col, g::text));
  return new;
end;
$$;

comment on function normalize_geometry() is
  'Trigger of every geometry column: the value goes through to_core_geometry().';

-- ---------------------------------------------------------------------------
-- sites — a place with an address.
-- ---------------------------------------------------------------------------

create table sites (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  name             text not null,
  -- The place, in its one standard shape (`place_of()`, docs/model.md
  -- "Where"): the address in the fields every country has (the postal
  -- address of schema.org) — the street with its number, a second line for
  -- the building, floor or unit, the postal code, the city, the ISO 3166-2
  -- region, the ISO 3166-1 alpha-2 country; how a country lays them out is
  -- its pack's business. The municipality, in the country's own code, is an
  -- identifier of the site under a scheme its pack publishes.
  country          char(2) not null,
  street           text,
  address_extra    text,
  postal_code      text,
  city             text,
  region           text,
  -- IANA time zone. Daily and monthly readings of the site's series are cut
  -- in it; a site without one has no daily readings.
  time_zone        text,
  -- The parcel or the plot as a polygon, or just a point.
  geometry         geometry,
  -- How close the geometry is to the real place, and who placed it: a
  -- geocoder (a source), a GPS reading, a person on a map. `rooftop` is the
  -- building itself, `parcel` its plot, then the street, the postal code
  -- area, the city, the region. Null when nobody said.
  location_precision   text,
  location_source_code text references sources(code),
  profile          text references profiles(code),
  tags             text[] not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sites_name_not_blank check (btrim(name) <> ''),
  constraint sites_country_format check (country ~ '^[A-Z]{2}$'),
  constraint sites_region_format check (region is null or region ~ ('^' || country || '-[A-Z0-9]{1,3}$')),
  constraint sites_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint sites_location_precision check (location_precision is null or location_precision in ('rooftop', 'parcel', 'street', 'postal_code', 'city', 'region')),
  constraint sites_tags_known check (tags_known(tags))
);

comment on table sites is
  'A place with an address and a parcel: a house and its garden, a farm, a factory, a school, a field with panels. The unit a person owns, rents or operates. Its address, point, precision and source are the one standard shape of a place (place_of()).';

create index sites_geometry_idx on sites using gist (geometry);
create trigger sites_normalize before insert or update of geometry on sites
  for each row execute function normalize_geometry('geometry');

-- A time zone is one Postgres knows: a misspelt zone would cut days wrong.
create or replace function sites_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if new.time_zone is not null then
    begin
      perform now() at time zone new.time_zone;
    exception when invalid_parameter_value then
      raise exception 'time_zone_unknown: %', new.time_zone using errcode = 'check_violation';
    end;
  end if;
  return new;
end;
$$;

comment on function sites_check() is
  'BEFORE INSERT / UPDATE on sites: the time zone is an IANA zone Postgres knows (time_zone_unknown).';

create trigger sites_check before insert or update of time_zone on sites
  for each row execute function sites_check();
call declare_object('sites', 'site');

-- ---------------------------------------------------------------------------
-- Where an object is.
-- ---------------------------------------------------------------------------

-- The nearest object of a kind above an object: from any object, follow the
-- parent columns `object_kinds` names for its kind, in order of preference,
-- and keep the first path that reaches that kind. A module never rewrites
-- this function: declaring its objects is enough.
create or replace function ancestor_of(p_object_id uuid, p_kind text)
returns uuid
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  k       text;
  parent  uuid;
  found   uuid;
begin
  if p_object_id is null then
    return null;
  end if;
  select o.kind into k from objects o where o.id = p_object_id;
  if k is null then
    return null;
  elsif k = p_kind then
    return p_object_id;
  end if;
  for parent in select parent_id from parents_of(p_object_id) loop
    found := ancestor_of(parent, p_kind);
    if found is not null then
      return found;
    end if;
  end loop;
  return null;
end;
$$;

comment on function ancestor_of(uuid, text) is
  'The object itself when it is of the kind asked, else the nearest object of that kind above it along its parents (parents_of); null when none.';

-- Every object above an object, nearest first: the parents named by its
-- parent columns, then theirs. `parameter_of()` walks it.
create or replace function ancestors_of(p_object_id uuid)
returns table (object_id uuid, kind text, depth integer)
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  frontier  uuid[] := array[p_object_id];
  upcoming  uuid[];
  seen      uuid[] := array[p_object_id];
  d         integer := 0;
  o         uuid;
  parent    uuid;
begin
  while cardinality(frontier) > 0 loop
    d := d + 1;
    upcoming := '{}';
    foreach o in array frontier loop
      for parent in select parent_id from parents_of(o) loop
        if not parent = any (seen) then
          seen := seen || parent;
          upcoming := upcoming || parent;
          object_id := parent;
          kind := (select ob.kind from objects ob where ob.id = parent);
          depth := d;
          return next;
        end if;
      end loop;
    end loop;
    frontier := upcoming;
  end loop;
end;
$$;

comment on function ancestors_of(uuid) is
  'Every object above an object along its parents (parents_of), nearest first, each once, with its kind and its depth.';

create or replace function site_of(p_object_id uuid)
returns uuid
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select ancestor_of(p_object_id, 'site');
$$;

comment on function site_of(uuid) is
  'The site an object is on, whatever its kind. Null for an object that is not somewhere (an organisation, a weather point).';

create or replace function country_of(p_object_id uuid)
returns char(2)
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select country from sites where id = site_of(p_object_id);
$$;

comment on function country_of(uuid) is
  'The country of the site an object is on. Selects the country packs and the country level of parameter_of().';

-- ---------------------------------------------------------------------------
-- The one standard shape of a place.
--
-- Every geocoder, every importer and the command line produce it; `sites`
-- stores it; `place_of()` gives it back. Its keys are the columns of
-- `sites`, plus the identifiers the place is known by (a municipality code
-- under its pack's scheme, a geocoder's own id):
--
--   { "street": "…", "address_extra": null, "postal_code": "…",
--     "city": "…", "region": "<ISO 3166-2>", "country": "<ISO 3166-1>",
--     "geometry": { "type": "Point", "coordinates": [lon, lat, z] },
--     "location_precision": "rooftop", "location_source_code": "<source>",
--     "identifiers": [ { "scheme": "<id_schemes.code>", "value": "…" } ] }
--
-- GeoJSON is the geometry's one interchange form; it is stored in WGS 84 3D.
-- ---------------------------------------------------------------------------

create or replace function place_check(p_place jsonb)
returns jsonb
language plpgsql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  k text;
begin
  if p_place is null or jsonb_typeof(p_place) <> 'object' then
    raise exception 'place_invalid: a place is a JSON object' using errcode = 'invalid_parameter_value';
  end if;
  for k in select jsonb_object_keys(p_place) loop
    if k not in ('street', 'address_extra', 'postal_code', 'city', 'region', 'country', 'geometry',
                 'location_precision', 'location_source_code', 'identifiers') then
      raise exception 'place_key_unknown: %', k using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if p_place ? 'identifiers' and jsonb_typeof(p_place->'identifiers') <> 'array' then
    raise exception 'place_invalid: identifiers is an array of {scheme, value}' using errcode = 'invalid_parameter_value';
  end if;
  return p_place;
end;
$$;

comment on function place_check(jsonb) is
  'Returns the place when it is the standard shape (the keys of place_of()), else refuses by name: place_invalid, place_key_unknown.';

-- PL/pgSQL so that it may name `external_ids`, created with the attachments.
create or replace function place_of(p_site_id uuid)
returns jsonb
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  return (select jsonb_build_object(
    'street', s.street, 'address_extra', s.address_extra, 'postal_code', s.postal_code, 'city', s.city,
    'region', s.region, 'country', s.country,
    'geometry', ST_AsGeoJSON(s.geometry)::jsonb,
    'location_precision', s.location_precision, 'location_source_code', s.location_source_code,
    'identifiers', coalesce((select jsonb_agg(jsonb_build_object('scheme', e.scheme, 'value', e.value) order by e.scheme, e.value)
                               from external_ids e where e.object_id = s.id), '[]'::jsonb))
    from sites s where s.id = p_site_id);
end;
$$;

comment on function place_of(uuid) is
  'A site''s place in the one standard shape: address, country, region, GeoJSON geometry, precision, source and identifiers.';

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

create or replace function create_scenario(p_organisation_id uuid, p_name text, p_parent_id uuid default null, p_description text default null)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_parent_id is not null and not exists (select 1 from scenarios where id = p_parent_id and organisation_id = p_organisation_id) then
    raise exception 'scenario_not_found: %', p_parent_id using errcode = 'no_data_found';
  end if;
  insert into scenarios (id, organisation_id, parent_id, name, description)
  values (v_id, p_organisation_id, p_parent_id, p_name, p_description);
  return v_id;
end;
$$;

comment on function create_scenario(uuid, text, uuid, text) is
  'Creates a design variant of an organisation, on top of another one when a parent is given. Returns its id.';

-- A site from a place in the standard shape. Without a time zone given,
-- the site takes its region's, else the first of its country's — both from
-- the country pack, when one is installed; never a zone of another country.
create or replace function create_site(
  p_organisation_id uuid,
  p_name            text,
  p_place           jsonb,
  p_time_zone       text default null,
  p_profile         text default null,
  p_scenario_id     uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id      uuid := gen_random_uuid();
  v_place   jsonb := place_check(p_place);
  v_country text := upper(v_place->>'country');
  v_region  text := v_place->>'region';
  v_zone    text := p_time_zone;
  i         jsonb;
begin
  if v_country is null then
    raise exception 'country_required: a place names its country' using errcode = 'invalid_parameter_value';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'country_invalid: % is not an ISO 3166-1 alpha-2 code', v_country using errcode = 'invalid_parameter_value';
  end if;
  if v_zone is null then
    v_zone := coalesce((select r.time_zone from regions r where r.code = v_region),
                       (select c.time_zones[1] from countries c where c.code = v_country));
  end if;
  insert into sites (id, organisation_id, name, country, street, address_extra, postal_code, city, region, time_zone,
                     geometry, location_precision, location_source_code, profile, scenario_id)
  values (v_id, p_organisation_id, p_name, v_country, v_place->>'street', v_place->>'address_extra', v_place->>'postal_code',
          v_place->>'city', v_region, v_zone,
          case when jsonb_typeof(v_place->'geometry') = 'object' then ST_GeomFromGeoJSON(v_place->'geometry') end,
          v_place->>'location_precision', v_place->>'location_source_code', p_profile, p_scenario_id);
  for i in select * from jsonb_array_elements(coalesce(v_place->'identifiers', '[]'::jsonb)) loop
    insert into external_ids (object_id, scheme, value, scenario_id) values (v_id, i->>'scheme', i->>'value', p_scenario_id);
  end loop;
  return v_id;
end;
$$;

comment on function create_site(uuid, text, jsonb, text, text, uuid) is
  'Creates a site from a place in the standard shape; the time zone defaults to the region''s, else the country''s first, from the country pack. Refuses country_required, country_invalid, time_zone_unknown, region_unknown, invalid_geometry, place_key_unknown. Returns its id.';

-- A site placed again: by a geocoder, a GPS reading, a person on a map. The
-- keys the place gives replace the site's; the keys it leaves out are kept.
create or replace function locate_site(p_site_id uuid, p_place jsonb)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_place jsonb := place_check(p_place);
  s       sites%rowtype;
  i       jsonb;
begin
  select * into s from sites where id = p_site_id;
  if not found then
    raise exception 'site_not_found: %', p_site_id using errcode = 'no_data_found';
  end if;
  if v_place ? 'country' and upper(v_place->>'country') is distinct from s.country then
    raise exception 'country_is_final: a site does not move to another country; create the site there' using errcode = 'check_violation';
  end if;
  update sites set
    street               = case when v_place ? 'street' then v_place->>'street' else street end,
    address_extra        = case when v_place ? 'address_extra' then v_place->>'address_extra' else address_extra end,
    postal_code          = case when v_place ? 'postal_code' then v_place->>'postal_code' else postal_code end,
    city                 = case when v_place ? 'city' then v_place->>'city' else city end,
    region               = case when v_place ? 'region' then v_place->>'region' else region end,
    geometry             = case when v_place ? 'geometry'
                                then case when jsonb_typeof(v_place->'geometry') = 'object' then ST_GeomFromGeoJSON(v_place->'geometry') end
                                else geometry end,
    location_precision   = case when v_place ? 'location_precision' then v_place->>'location_precision' else location_precision end,
    location_source_code = case when v_place ? 'location_source_code' then v_place->>'location_source_code' else location_source_code end
   where id = p_site_id;
  for i in select * from jsonb_array_elements(coalesce(v_place->'identifiers', '[]'::jsonb)) loop
    insert into external_ids (object_id, scheme, value, scenario_id) values (p_site_id, i->>'scheme', i->>'value', s.scenario_id)
    on conflict do nothing;
  end loop;
end;
$$;

comment on function locate_site(uuid, jsonb) is
  'Places a site again from a place in the standard shape: the keys given replace, the others are kept, identifiers are added. Refuses country_is_final, invalid_geometry.';

-- ---------------------------------------------------------------------------
-- Row level security of what is not an object
-- ---------------------------------------------------------------------------

call secure_table('scenarios');

alter table objects enable row level security;
create policy objects_select on objects
  for select to authenticated using (can_read_organisation(organisation_id));
create policy objects_write on objects
  for all to authenticated
  using (can_write_organisation(organisation_id))
  with check (can_write_organisation(organisation_id));
grant select, insert, update, delete on objects to authenticated, service_role;

grant execute on function metric_srid(geometry), area_m2(geometry), to_core_geometry(geometry),
  parents_of(uuid), ancestor_of(uuid, text), ancestors_of(uuid), site_of(uuid), country_of(uuid),
  place_check(jsonb), place_of(uuid),
  create_scenario(uuid, text, uuid, text), create_site(uuid, text, jsonb, text, text, uuid), locate_site(uuid, jsonb)
  to authenticated, service_role;

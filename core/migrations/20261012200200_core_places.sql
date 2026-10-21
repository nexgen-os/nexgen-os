-- Nexgen OS — core: scenarios, what every kind of object shares, and the
-- places.
--
-- The core names its objects: an organisation, a project, a participant, a
-- site, a meter, a device. Each is a table with the columns it always has,
-- and its hierarchy is its foreign keys: a participant belongs to a
-- project, a meter to a site and a participant, a device to a site and a
-- meter. An attachment (an attribute, an identifier, a link, a document, a
-- series, a run) names its object by its kind and its id; `kinds` says
-- which table holds a kind, and `object_organisation()` reads an object's
-- organisation there. There is no registry (decision 0044).
--
-- The place of the core is the site: an address, a point or a parcel, a
-- time zone, geolocated but not described. What a place physically is —
-- its buildings, their floors, rooms and units, their roof faces and
-- facades, where a device sits among them — is the description of a
-- building, the `building` module's (decision 0008), which publishes its own
-- kinds of object in `kinds` and answers `site_of()` for them.
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
-- What every kind of object shares.
-- ---------------------------------------------------------------------------

-- The organisation of an object named by its kind and its id, read in the
-- table `kinds` gives for the kind: one dynamic query. An organisation is
-- its own. Under row level security an object of an organisation the caller
-- does not read is not found.
create or replace function object_organisation(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  t    text;
  org  uuid;
begin
  select k.table_name into t from kinds k where k.kind = p_kind;
  if t is null then
    raise exception 'kind_unknown: %', p_kind using errcode = 'foreign_key_violation';
  end if;
  execute format('select %I from %s where id = $1', case when p_kind = 'organisation' then 'id' else 'organisation_id' end, t)
    into org using p_id;
  if org is null then
    raise exception 'object_not_found: % %', p_kind, p_id using errcode = 'no_data_found';
  end if;
  return org;
end;
$$;

comment on function object_organisation(text, uuid) is
  'The organisation of an object named by its kind and its id, read in the table of its kind. Refuses kind_unknown, object_not_found.';

-- The scenario an object exists only in; null for what exists (and for an
-- organisation, which belongs to none).
create or replace function object_scenario(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  t    text;
  scn  uuid;
begin
  if p_kind = 'organisation' then
    return null;
  end if;
  select k.table_name into t from kinds k where k.kind = p_kind;
  if t is null then
    raise exception 'kind_unknown: %', p_kind using errcode = 'foreign_key_violation';
  end if;
  execute format('select scenario_id from %s where id = $1', t) into scn using p_id;
  return scn;
end;
$$;

comment on function object_scenario(text, uuid) is
  'The scenario an object named by its kind and its id exists only in; null when it exists in reality. Refuses kind_unknown.';

-- BEFORE INSERT / UPDATE: the parent named by the foreign key tg_argv[0],
-- a row of the table tg_argv[1], is in the same organisation, and a parent
-- that exists only in a scenario only holds children of that scenario.
create or replace function parent_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  col  text := tg_argv[0];
  pid  uuid;
  org  uuid;
  scn  uuid;
begin
  execute format('select ($1).%I', col) into pid using new;
  if pid is null then
    return new;
  end if;
  execute format('select organisation_id, scenario_id from %s where id = $1', tg_argv[1]) into org, scn using pid;
  if org is null then
    raise exception 'parent_not_found: %', pid using errcode = 'foreign_key_violation';
  end if;
  if org <> new.organisation_id then
    raise exception 'parent_in_other_organisation: %', col using errcode = 'check_violation';
  end if;
  if scn is not null and scn is distinct from new.scenario_id then
    raise exception 'parent_in_other_scenario: %', col using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function parent_check() is
  'Trigger of a foreign key to a parent (its column, then the parent''s table): the parent is in the same organisation, and in the same scenario when it exists only in one.';

-- AFTER DELETE on the table of a kind, tg_argv[0] being the kind: what was
-- attached to the row goes with it. An attachment is a table carrying an
-- `object_kind` and `object_id` pair (or `subject_kind` and `subject_id`):
-- the core's, and those of a module that attach to an object of any kind.
create or replace function drop_attachments()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  t record;
begin
  for t in
    select format('%I.%I', n.nspname, c.relname) as table_name, left(a.attname, -5) as side
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where a.attname in ('object_kind', 'subject_kind') and a.attnum > 0 and not a.attisdropped
       and c.relkind in ('r', 'p') and not c.relispartition
  loop
    execute format('delete from %s where %I = $1 and %I = $2', t.table_name, t.side || '_kind', t.side || '_id')
      using tg_argv[0], old.id;
  end loop;
  return old;
end;
$$;

comment on function drop_attachments() is
  'AFTER DELETE on the table of a kind: deletes what was attached to the row, in every table carrying an object_kind / object_id (or subject_kind / subject_id) pair.';

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
  id               uuid primary key default gen_random_uuid(),
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
create trigger sites_set_updated_at before update on sites
  for each row execute function set_updated_at();
create index sites_organisation_idx on sites (organisation_id);
create trigger sites_drop_attachments after delete on sites
  for each row execute function drop_attachments('site');

-- ---------------------------------------------------------------------------
-- Where an object is.
-- ---------------------------------------------------------------------------

-- The site of an object, through the foreign keys of the core's kinds: a
-- site is its own, a participant, a meter and a device name theirs, a series
-- and a run are where their object is. A kind a module publishes is the
-- module's to answer, with `<schema>.site_of(kind, id)`: the core hands it
-- over without knowing the module. Null for what is not somewhere (an
-- organisation, a project, a weather point).
create or replace function site_of(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_schema  text;
  v_site    uuid;
begin
  if p_id is null then
    return null;
  end if;
  case p_kind
    when 'site' then
      return (select id from sites where id = p_id);
    when 'participant' then
      return (select site_id from participants where id = p_id);
    when 'meter' then
      return (select site_id from meters where id = p_id);
    when 'device' then
      return (select site_id from devices where id = p_id);
    when 'series' then
      return (select site_of(object_kind, object_id) from series where id = p_id);
    when 'run' then
      return (select site_of(subject_kind, subject_id) from runs where id = p_id);
    when 'organisation', 'project' then
      return null;
    else
      select m.schema_name into v_schema from kinds k join modules m on m.code = k.published_by where k.kind = p_kind;
      if v_schema is null or to_regprocedure(format('%I.site_of(text, uuid)', v_schema)) is null then
        return null;
      end if;
      execute format('select %I.site_of($1, $2)', v_schema) into v_site using p_kind, p_id;
      return v_site;
  end case;
end;
$$;

comment on function site_of(text, uuid) is
  'The site an object named by its kind and its id is on: its own foreign key for the core''s kinds, its object''s for a series or a run, the publishing module''s <schema>.site_of(kind, id) for a module''s kind. Null for an object that is not somewhere (an organisation, a project, a weather point).';

create or replace function country_of(p_kind text, p_id uuid)
returns char(2)
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select country from sites where id = site_of(p_kind, p_id);
$$;

comment on function country_of(text, uuid) is
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
                               from external_ids e where e.object_kind = 'site' and e.object_id = s.id), '[]'::jsonb))
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
    insert into external_ids (object_kind, object_id, scheme, value, scenario_id) values ('site', v_id, i->>'scheme', i->>'value', p_scenario_id);
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
    insert into external_ids (object_kind, object_id, scheme, value, scenario_id) values ('site', p_site_id, i->>'scheme', i->>'value', s.scenario_id)
    on conflict do nothing;
  end loop;
end;
$$;

comment on function locate_site(uuid, jsonb) is
  'Places a site again from a place in the standard shape: the keys given replace, the others are kept, identifiers are added. Refuses country_is_final, invalid_geometry.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

call secure_table('scenarios');
call secure_table('sites');

grant execute on function object_organisation(text, uuid), object_scenario(text, uuid),
  metric_srid(geometry), area_m2(geometry), to_core_geometry(geometry), site_of(text, uuid), country_of(text, uuid),
  place_check(jsonb), place_of(uuid),
  create_scenario(uuid, text, uuid, text), create_site(uuid, text, jsonb, text, text, uuid), locate_site(uuid, jsonb)
  to authenticated, service_role;

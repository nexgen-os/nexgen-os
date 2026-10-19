-- Nexgen OS — core: scenarios, the object registry, and the places.
--
-- The core names its objects: a site, a building, a space, a surface, a
-- device. Each is a table with the columns it always has. What every object
-- shares — an id, an organisation, a scenario — is kept once in `objects`,
-- the registry every attachment (attributes, identifiers, links, documents,
-- series, runs) points to. The registry is plumbing: a page reads
-- `from buildings`, never `from objects`.
--
-- The places are the 3D skeleton the rest hangs on:
--
--   sites       a place with an address, a point or a parcel, a time zone
--   buildings   a footprint, an elevation, a height
--   spaces      floors, rooms, zones and units of a building, one tree
--   surfaces    roof faces, facades, ground areas, carports
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
  -- organisation, site, building, space, surface, device — and the kinds
  -- modules register (meter, project, participant, pv_array, task…).
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
begin
  insert into object_kinds (kind, table_name, parent_columns, published_by)
  values (p_kind, p_table, p_parents, case when position('.' in p_table) > 0 then split_part(p_table, '.', 1) else 'core' end)
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
  'Declares a named table as a kind of object, with its parent columns in order of preference: `call declare_object(''solar.pv_arrays'', ''pv_array'', ''{pv_system_id,surface_id}'')`.';

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

-- Vertical faces of a footprint between two heights, plus floor and roof:
-- the level-of-detail 1 block. Derived, never stored.
create or replace function footprint_volume(p_footprint geometry, p_base numeric, p_top numeric)
returns geometry
language plpgsql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  ring   geometry;
  faces  text[] := '{}';
  pts    geometry[];
  i      int;
  a      geometry;
  b      geometry;
begin
  if p_footprint is null or p_top is null or GeometryType(ST_Force2D(p_footprint)) <> 'POLYGON' then
    return null;
  end if;
  ring := ST_ExteriorRing(ST_ForceRHR(ST_Force2D(p_footprint)));
  select array_agg(d.geom order by d.path) into pts from ST_DumpPoints(ring) d;
  faces := faces || format('((%s))', (
    select string_agg(format('%s %s %s', ST_X(p), ST_Y(p), p_base), ',') from unnest(pts) p
  ));
  faces := faces || format('((%s))', (
    select string_agg(format('%s %s %s', ST_X(p), ST_Y(p), p_top), ',' order by ord desc)
      from unnest(pts) with ordinality as u(p, ord)
  ));
  for i in 1 .. array_length(pts, 1) - 1 loop
    a := pts[i];
    b := pts[i + 1];
    faces := faces || format('((%s %s %s,%s %s %s,%s %s %s,%s %s %s,%s %s %s))',
      ST_X(a), ST_Y(a), p_base, ST_X(a), ST_Y(a), p_top, ST_X(b), ST_Y(b), p_top,
      ST_X(b), ST_Y(b), p_base, ST_X(a), ST_Y(a), p_base);
  end loop;
  return ST_SetSRID(ST_GeomFromText('POLYHEDRALSURFACE Z (' || array_to_string(faces, ',') || ')'), 4326);
end;
$$;

comment on function footprint_volume(geometry, numeric, numeric) is
  'The level-of-detail 1 block of a footprint between two heights, as a polyhedral surface.';

-- The orientation of a planar face from its 3D polygon: the normal of its
-- outer ring (Newell's method) in the UTM zone it falls in, turned to face
-- up; tilt from horizontal, azimuth clockwise from true north, measured on
-- the ellipsoid between the face's centre and a point down its slope. Null
-- when the polygon has no height, and the azimuth of a flat face is null.
create or replace function surface_orientation(p_geom geometry, out azimuth_deg numeric, out tilt_deg numeric)
language plpgsql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  srid  int;
  m     geometry;
  pts   geometry[];
  nx    float8 := 0;
  ny    float8 := 0;
  nz    float8 := 0;
  h     float8;
  c     geometry;
  i     int;
begin
  if p_geom is null or not ST_HasZ(p_geom) or GeometryType(p_geom) not in ('POLYGON', 'MULTIPOLYGON') then
    return;
  end if;
  srid := metric_srid(p_geom);
  m := ST_Transform(ST_GeometryN(p_geom, 1), srid);
  select array_agg(d.geom order by d.path) into pts from ST_DumpPoints(ST_ExteriorRing(m)) d;
  for i in 1 .. array_length(pts, 1) - 1 loop
    nx := nx + (ST_Y(pts[i]) - ST_Y(pts[i + 1])) * (ST_Z(pts[i]) + ST_Z(pts[i + 1]));
    ny := ny + (ST_Z(pts[i]) - ST_Z(pts[i + 1])) * (ST_X(pts[i]) + ST_X(pts[i + 1]));
    nz := nz + (ST_X(pts[i]) - ST_X(pts[i + 1])) * (ST_Y(pts[i]) + ST_Y(pts[i + 1]));
  end loop;
  if nx = 0 and ny = 0 and nz = 0 then
    return;
  end if;
  if nz < 0 then
    nx := -nx; ny := -ny; nz := -nz;
  end if;
  h := sqrt(nx * nx + ny * ny);
  tilt_deg := round(degrees(atan2(h, nz))::numeric, 2);
  if tilt_deg < 1 then
    return;
  end if;
  c := ST_Centroid(ST_Force2D(m));
  azimuth_deg := round(degrees(ST_Azimuth(
    ST_Transform(c, 4326)::geography,
    ST_Transform(ST_Translate(c, 10 * nx / h, 10 * ny / h), 4326)::geography))::numeric, 2);
  if azimuth_deg >= 360 then
    azimuth_deg := azimuth_deg - 360;
  end if;
end;
$$;

comment on function surface_orientation(geometry) is
  'Azimuth (degrees clockwise from true north) and tilt (degrees from horizontal) of a planar 3D polygon. Null when the polygon has no height; the azimuth of a flat face is null.';

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
-- buildings
-- ---------------------------------------------------------------------------

create table buildings (
  id                   uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id      uuid not null references organisations(id) on delete cascade,
  site_id              uuid not null references sites(id) on delete cascade,
  name                 text not null,
  profile              text references profiles(code),
  -- The outline on the ground. With elevation and height it gives the
  -- level-of-detail 1 block (`building_volume`).
  footprint            geometry,
  elevation_m          numeric(9, 3),
  height_m             numeric(9, 3),
  -- Where the description comes from (a cadastre, a 3D city model, a
  -- survey), and what that source said beyond these columns. The year of
  -- construction and the number of floors are attributes, with their
  -- period and their source; described floors are spaces.
  source_code          text references sources(code),
  metadata             jsonb not null default '{}',
  status               text not null default 'in_service',
  tags                 text[] not null default '{}',
  scenario_id          uuid references scenarios(id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint buildings_name_not_blank check (btrim(name) <> ''),
  constraint buildings_height_positive check (height_m is null or height_m >= 0),
  constraint buildings_status check (status in ('planned', 'under_construction', 'in_service', 'out_of_service', 'demolished')),
  constraint buildings_footprint_core check (footprint is null or (ST_SRID(footprint) = 4326 and ST_NDims(footprint) = 3)),
  constraint buildings_tags_known check (tags_known(tags))
);

comment on table buildings is
  'A building on a site: footprint, elevation, height, use, lifecycle (CityGML Building, IfcBuilding). Its floors, rooms, zones and units are spaces; its 3D files are the 3d module''s.';

create index buildings_site_idx on buildings (site_id);
create index buildings_footprint_idx on buildings using gist (footprint);
create trigger buildings_normalize before insert or update of footprint on buildings
  for each row execute function normalize_geometry('footprint');
call declare_object('buildings', 'building', '{site_id}');

create or replace function building_volume(p_building_id uuid)
returns geometry
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select footprint_volume(b.footprint, coalesce(b.elevation_m, 0), coalesce(b.elevation_m, 0) + b.height_m)
    from buildings b where b.id = p_building_id;
$$;

comment on function building_volume(uuid) is
  'Level-of-detail 1 block of a building: its footprint extruded from its elevation by its height. Derived, never stored.';

-- ---------------------------------------------------------------------------
-- spaces — the inside of a building, one tree.
-- ---------------------------------------------------------------------------

create table spaces (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  building_id      uuid not null references buildings(id) on delete cascade,
  -- The space it is part of: a room on a floor, a room in a zone, a unit
  -- on a floor. Null for a floor, and for a space that spans floors or
  -- whose floor is not described (an atrium, a duplex, a hall).
  parent_id        uuid references spaces(id) on delete cascade,
  -- floor: a storey; room: a bounded room; zone: a grouping (a thermal
  -- zone, a fire compartment); unit: a flat, a shop, an office let whole.
  kind             text not null,
  name             text not null,
  -- For a floor: 0 is the ground floor, negative below ground.
  level            integer,
  elevation_m      numeric(9, 3),
  height_m         numeric(9, 3),
  -- Plan outline, when known.
  geometry         geometry,
  source_code      text references sources(code),
  metadata         jsonb not null default '{}',
  tags             text[] not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint spaces_name_not_blank check (btrim(name) <> ''),
  constraint spaces_kind check (kind in ('floor', 'room', 'zone', 'unit')),
  constraint spaces_level_for_floors check ((kind = 'floor') = (level is not null)),
  constraint spaces_floor_at_top check (kind <> 'floor' or parent_id is null),
  constraint spaces_not_own_parent check (parent_id is distinct from id),
  constraint spaces_height_positive check (height_m is null or height_m >= 0),
  constraint spaces_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint spaces_tags_known check (tags_known(tags))
);

comment on table spaces is
  'The spatial structure inside a building, one tree: floors (IfcBuildingStorey, CityGML Storey), rooms (IfcSpace, CityGML BuildingRoom, Brick Room), zones and units. A device is placed in a space; a series observes one.';

create unique index spaces_one_floor_per_level on spaces (building_id, level, scenario_id) nulls not distinct where kind = 'floor';
create index spaces_building_idx on spaces (building_id);
create index spaces_parent_idx on spaces (parent_id);
create index spaces_geometry_idx on spaces using gist (geometry);
create trigger spaces_normalize before insert or update of geometry on spaces
  for each row execute function normalize_geometry('geometry');

-- A space and the space it is part of are in the same building, and the
-- tree has no loop.
create or replace function spaces_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  p spaces%rowtype;
begin
  if new.parent_id is null then
    return new;
  end if;
  select * into p from spaces where id = new.parent_id;
  if found and p.building_id <> new.building_id then
    raise exception 'space_outside_building: % is in another building than %', new.name, p.name
      using errcode = 'check_violation';
  end if;
  if exists (
    with recursive up as (
      select s.id, s.parent_id from spaces s where s.id = new.parent_id
      union
      select s.id, s.parent_id from spaces s join up on s.id = up.parent_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'space_cycle: % would contain itself', new.name using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function spaces_check() is
  'BEFORE INSERT / UPDATE on spaces: the parent is in the same building (space_outside_building) and the tree has no loop (space_cycle).';

create trigger spaces_check before insert or update of parent_id, building_id on spaces
  for each row execute function spaces_check();
call declare_object('spaces', 'space', '{parent_id,building_id}');

-- ---------------------------------------------------------------------------
-- surfaces — the planar things something is mounted on.
-- ---------------------------------------------------------------------------

create table surfaces (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- On a building (a roof face, a facade) or straight on a site (a ground
  -- area, a car park).
  building_id      uuid references buildings(id) on delete cascade,
  site_id          uuid references sites(id) on delete cascade,
  name             text not null,
  kind             text not null,
  -- The face itself, as a 3D polygon when it is known, or its plan outline.
  geometry         geometry,
  -- Orientation in degrees: azimuth clockwise from true north (180 = facing
  -- south), tilt from horizontal (0 = flat). The material is an attribute.
  azimuth_deg      numeric(6, 2),
  tilt_deg         numeric(5, 2),
  source_code      text references sources(code),
  metadata         jsonb not null default '{}',
  tags             text[] not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint surfaces_name_not_blank check (btrim(name) <> ''),
  constraint surfaces_kind check (kind in ('roof', 'facade', 'ground', 'carport')),
  constraint surfaces_one_host check ((building_id is null) <> (site_id is null)),
  constraint surfaces_azimuth_range check (azimuth_deg is null or (azimuth_deg >= 0 and azimuth_deg < 360)),
  constraint surfaces_tilt_range check (tilt_deg is null or (tilt_deg >= 0 and tilt_deg <= 180)),
  constraint surfaces_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint surfaces_tags_known check (tags_known(tags))
);

comment on table surfaces is
  'A roof face, a facade, a ground area or a carport: the planar thing a device is mounted on, with its azimuth and tilt (CityGML RoofSurface / WallSurface).';

create index surfaces_building_idx on surfaces (building_id);
create index surfaces_site_idx on surfaces (site_id);
create index surfaces_geometry_idx on surfaces using gist (geometry);
create trigger surfaces_normalize before insert or update of geometry on surfaces
  for each row execute function normalize_geometry('geometry');
call declare_object('surfaces', 'surface', '{building_id,site_id}');

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
  t       text;
  cols    text[];
  col     text;
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
  select ok.table_name, ok.parent_columns into t, cols from object_kinds ok where ok.kind = k;
  if t is null then
    return null;
  end if;
  foreach col in array cols loop
    execute format('select %I from %s where id = $1', col, t) into parent using p_object_id;
    if parent is not null and parent <> p_object_id then
      found := ancestor_of(parent, p_kind);
      if found is not null then
        return found;
      end if;
    end if;
  end loop;
  return null;
end;
$$;

comment on function ancestor_of(uuid, text) is
  'The object itself when it is of the kind asked, else the nearest object of that kind above it along its parent columns; null when none.';

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
  k         text;
  t         text;
  cols      text[];
  col       text;
  parent    uuid;
begin
  while cardinality(frontier) > 0 loop
    d := d + 1;
    upcoming := '{}';
    foreach o in array frontier loop
      select ob.kind into k from objects ob where ob.id = o;
      select ok.table_name, ok.parent_columns into t, cols from object_kinds ok where ok.kind = k;
      continue when t is null;
      foreach col in array cols loop
        execute format('select %I from %s where id = $1', col, t) into parent using o;
        if parent is not null and not parent = any (seen) then
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
  'Every object above an object along the parent columns of object_kinds, nearest first, each once, with its kind and its depth.';

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

create or replace function building_of(p_object_id uuid)
returns uuid
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select ancestor_of(p_object_id, 'building');
$$;

comment on function building_of(uuid) is
  'The building an object is in or on — a space, a surface, a device — whatever its kind. Null when it is in none.';

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

create or replace function add_building(
  p_site_id      uuid,
  p_name         text,
  p_footprint    geometry default null,
  p_elevation_m  numeric default null,
  p_height_m     numeric default null,
  p_profile      text default null,
  p_source_code  text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  s    sites%rowtype;
begin
  select * into s from sites where id = p_site_id;
  if not found then
    raise exception 'site_not_found: %', p_site_id using errcode = 'no_data_found';
  end if;
  insert into buildings (id, organisation_id, site_id, name, footprint, elevation_m, height_m, profile, source_code, scenario_id)
  values (v_id, s.organisation_id, p_site_id, p_name, p_footprint, p_elevation_m, p_height_m, p_profile, p_source_code, s.scenario_id);
  return v_id;
end;
$$;

comment on function add_building(uuid, text, geometry, numeric, numeric, text, text) is
  'Describes a building on a site, in the site''s organisation and scenario. Refuses invalid_geometry. Returns its id.';

create or replace function add_space(
  p_building_id  uuid,
  p_kind         text,
  p_name         text,
  p_parent_id    uuid default null,
  p_level        integer default null,
  p_geometry     geometry default null,
  p_elevation_m  numeric default null,
  p_height_m     numeric default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  b    buildings%rowtype;
begin
  select * into b from buildings where id = p_building_id;
  if not found then
    raise exception 'building_not_found: %', p_building_id using errcode = 'no_data_found';
  end if;
  insert into spaces (id, organisation_id, building_id, parent_id, kind, name, level, geometry, elevation_m, height_m, scenario_id)
  values (v_id, b.organisation_id, p_building_id, p_parent_id, p_kind, p_name, p_level, p_geometry, p_elevation_m, p_height_m, b.scenario_id);
  return v_id;
end;
$$;

comment on function add_space(uuid, text, text, uuid, integer, geometry, numeric, numeric) is
  'Describes a floor, a room, a zone or a unit of a building, under another space when a parent is given. Refuses space_outside_building, space_cycle. Returns its id.';

-- A roof face, a facade, a ground area, a carport. Without an orientation
-- given, it is derived from the face's 3D polygon.
create or replace function add_surface(
  p_host_id      uuid,
  p_kind         text,
  p_name         text,
  p_geometry     geometry default null,
  p_azimuth_deg  numeric default null,
  p_tilt_deg     numeric default null,
  p_source_code  text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id    uuid := gen_random_uuid();
  host    objects%rowtype;
  g       geometry := to_core_geometry(p_geometry);
  derived record;
begin
  select * into host from objects where id = p_host_id;
  if not found or host.kind not in ('building', 'site') then
    raise exception 'surface_host_kind: a surface is on a building or a site' using errcode = 'check_violation';
  end if;
  if p_azimuth_deg is null and p_tilt_deg is null and p_kind in ('roof', 'facade') then
    select * into derived from surface_orientation(g);
    if derived.tilt_deg is null then
      raise exception 'orientation_unknown: give an azimuth and a tilt, or a 3D polygon of the face' using errcode = 'invalid_parameter_value';
    end if;
    p_azimuth_deg := derived.azimuth_deg;
    p_tilt_deg := derived.tilt_deg;
  end if;
  insert into surfaces (id, organisation_id, building_id, site_id, name, kind, geometry, azimuth_deg, tilt_deg, source_code, scenario_id)
  values (v_id, host.organisation_id,
          case when host.kind = 'building' then p_host_id end, case when host.kind = 'site' then p_host_id end,
          p_name, p_kind, g, p_azimuth_deg, p_tilt_deg, p_source_code, host.scenario_id);
  return v_id;
end;
$$;

comment on function add_surface(uuid, text, text, geometry, numeric, numeric, text) is
  'Describes a roof face, a facade, a ground area or a carport on a building or a site; a roof or facade without an orientation takes the one of its 3D polygon. Refuses surface_host_kind, orientation_unknown, invalid_geometry. Returns its id.';

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
  footprint_volume(geometry, numeric, numeric), surface_orientation(geometry), building_volume(uuid),
  ancestor_of(uuid, text), ancestors_of(uuid), site_of(uuid), building_of(uuid), country_of(uuid),
  place_check(jsonb), place_of(uuid),
  create_scenario(uuid, text, uuid, text), create_site(uuid, text, jsonb, text, text, uuid), locate_site(uuid, jsonb),
  add_building(uuid, text, geometry, numeric, numeric, text, text),
  add_space(uuid, text, text, uuid, integer, geometry, numeric, numeric),
  add_surface(uuid, text, text, geometry, numeric, numeric, text)
  to authenticated, service_role;

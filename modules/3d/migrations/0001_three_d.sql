-- Nexgen OS — module `3d`: the physical description of a place.
--
-- The core keeps the site: an address, a point or a parcel, a time zone,
-- geolocated but not described. What a place physically is belongs here
-- (decision 0008): its buildings with their footprint and height, the
-- floors, rooms, zones and units inside them as one tree, the roof faces,
-- facades and ground areas devices are mounted on, with their orientation;
-- where a device sits among them; which building, floor or unit a
-- participant of a project occupies. The territory of CityGML and of the
-- spatial structure of IFC.
--
--   three_d.buildings    a footprint, an elevation, a height
--   three_d.spaces       floors, rooms, zones and units of a building, one tree
--   three_d.surfaces     roof faces, facades, ground areas, carports
--   three_d.placements   the building, space and surface a device is in or on
--
-- Buildings, spaces and surfaces are kinds of object declared with
-- `declare_object()`: `site_of()`, `country_of()`, `parameter_of()` and the
-- attachments reach them as they reach any object of the core. A placement
-- is one row per placed device, with the device's id (decision 0042): the
-- core's device knows its site and its meter, this module where on the site
-- it is (decision 0026). Geometry follows the core's frame (decision 0003):
-- WGS 84, three-dimensional, through `to_core_geometry()`.

set search_path = nexgen, public, extensions;

create schema three_d;
grant usage on schema three_d to authenticated, service_role;

-- Registered first: the kinds it declares are published under its code.
insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('3d', '3D', '0.1.0', 'three_d', '0.3.0',
        'The physical description of a place: buildings, their floors, rooms, zones and units, roof faces, facades and ground areas with their orientation, where a device is placed among them, and which of them a participant occupies.');

-- Vertical faces of a footprint between two heights, plus floor and roof:
-- the level-of-detail 1 block. Derived, never stored.
create or replace function three_d.footprint_volume(p_footprint geometry, p_base numeric, p_top numeric)
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

comment on function three_d.footprint_volume(geometry, numeric, numeric) is
  'The level-of-detail 1 block of a footprint between two heights, as a polyhedral surface.';

-- The orientation of a planar face from its 3D polygon: the normal of its
-- outer ring (Newell's method) in the UTM zone it falls in, turned to face
-- up; tilt from horizontal, azimuth clockwise from true north, measured on
-- the ellipsoid between the face's centre and a point down its slope. Null
-- when the polygon has no height, and the azimuth of a flat face is null.
create or replace function three_d.surface_orientation(p_geom geometry, out azimuth_deg numeric, out tilt_deg numeric)
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

comment on function three_d.surface_orientation(geometry) is
  'Azimuth (degrees clockwise from true north) and tilt (degrees from horizontal) of a planar 3D polygon. Null when the polygon has no height; the azimuth of a flat face is null.';

-- ---------------------------------------------------------------------------
-- buildings
-- ---------------------------------------------------------------------------

create table three_d.buildings (
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

comment on table three_d.buildings is
  'A building on a site: footprint, elevation, height, use, lifecycle (CityGML Building, IfcBuilding). Its floors, rooms, zones and units are spaces, its roof faces and facades surfaces.';

create index buildings_site_idx on three_d.buildings (site_id);
create index buildings_footprint_idx on three_d.buildings using gist (footprint);
create trigger buildings_normalize before insert or update of footprint on three_d.buildings
  for each row execute function normalize_geometry('footprint');
call declare_object('three_d.buildings', 'building', '{site_id}');

create or replace function three_d.building_volume(p_building_id uuid)
returns geometry
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select three_d.footprint_volume(b.footprint, coalesce(b.elevation_m, 0), coalesce(b.elevation_m, 0) + b.height_m)
    from three_d.buildings b where b.id = p_building_id;
$$;

comment on function three_d.building_volume(uuid) is
  'Level-of-detail 1 block of a building: its footprint extruded from its elevation by its height. Derived, never stored.';

-- ---------------------------------------------------------------------------
-- spaces — the inside of a building, one tree.
-- ---------------------------------------------------------------------------

create table three_d.spaces (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  building_id      uuid not null references three_d.buildings(id) on delete cascade,
  -- The space it is part of: a room on a floor, a room in a zone, a unit
  -- on a floor. Null for a floor, and for a space that spans floors or
  -- whose floor is not described (an atrium, a duplex, a hall).
  parent_id        uuid references three_d.spaces(id) on delete cascade,
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

comment on table three_d.spaces is
  'The spatial structure inside a building, one tree: floors (IfcBuildingStorey, CityGML Storey), rooms (IfcSpace, CityGML BuildingRoom, Brick Room), zones and units. A device is placed in a space (three_d.placements), a participant occupies one; a series observes one.';

create unique index spaces_one_floor_per_level on three_d.spaces (building_id, level, scenario_id) nulls not distinct where kind = 'floor';
create index spaces_building_idx on three_d.spaces (building_id);
create index spaces_parent_idx on three_d.spaces (parent_id);
create index spaces_geometry_idx on three_d.spaces using gist (geometry);
create trigger spaces_normalize before insert or update of geometry on three_d.spaces
  for each row execute function normalize_geometry('geometry');

-- A space and the space it is part of are in the same building, and the
-- tree has no loop.
create or replace function three_d.spaces_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  p three_d.spaces%rowtype;
begin
  if new.parent_id is null then
    return new;
  end if;
  select * into p from three_d.spaces where id = new.parent_id;
  if found and p.building_id <> new.building_id then
    raise exception 'space_outside_building: % is in another building than %', new.name, p.name
      using errcode = 'check_violation';
  end if;
  if exists (
    with recursive up as (
      select s.id, s.parent_id from three_d.spaces s where s.id = new.parent_id
      union
      select s.id, s.parent_id from three_d.spaces s join up on s.id = up.parent_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'space_cycle: % would contain itself', new.name using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function three_d.spaces_check() is
  'BEFORE INSERT / UPDATE on spaces: the parent is in the same building (space_outside_building) and the tree has no loop (space_cycle).';

create trigger spaces_check before insert or update of parent_id, building_id on three_d.spaces
  for each row execute function three_d.spaces_check();
call declare_object('three_d.spaces', 'space', '{parent_id,building_id}');

-- ---------------------------------------------------------------------------
-- surfaces — the planar things something is mounted on.
-- ---------------------------------------------------------------------------

create table three_d.surfaces (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- On a building (a roof face, a facade) or straight on a site (a ground
  -- area, a car park).
  building_id      uuid references three_d.buildings(id) on delete cascade,
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

comment on table three_d.surfaces is
  'A roof face, a facade, a ground area or a carport: the planar thing a device is mounted on, with its azimuth and tilt (CityGML RoofSurface / WallSurface).';

create index surfaces_building_idx on three_d.surfaces (building_id);
create index surfaces_site_idx on three_d.surfaces (site_id);
create index surfaces_geometry_idx on three_d.surfaces using gist (geometry);
create trigger surfaces_normalize before insert or update of geometry on three_d.surfaces
  for each row execute function normalize_geometry('geometry');
call declare_object('three_d.surfaces', 'surface', '{building_id,site_id}');

create or replace function three_d.add_building(
  p_site_id      uuid,
  p_name         text,
  p_footprint    geometry default null,
  p_elevation_m  numeric default null,
  p_height_m     numeric default null,
  p_profile      text default null,
  p_source_code  text default null,
  p_metadata     jsonb default '{}',
  p_scenario_id  uuid default null
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
  insert into three_d.buildings (id, organisation_id, site_id, name, footprint, elevation_m, height_m, profile, source_code, metadata, scenario_id)
  values (v_id, s.organisation_id, p_site_id, p_name, p_footprint, p_elevation_m, p_height_m, p_profile, p_source_code,
          coalesce(p_metadata, '{}'), coalesce(p_scenario_id, s.scenario_id));
  return v_id;
end;
$$;

comment on function three_d.add_building(uuid, text, geometry, numeric, numeric, text, text, jsonb, uuid) is
  'Describes a building on a site, in the site''s organisation and in its scenario, or in the scenario given (a variant that adds a building to a site as it is). The metadata carry what the file it was read from says and no column holds. Refuses invalid_geometry. Returns its id.';

create or replace function three_d.add_space(
  p_building_id  uuid,
  p_kind         text,
  p_name         text,
  p_parent_id    uuid default null,
  p_level        integer default null,
  p_geometry     geometry default null,
  p_elevation_m  numeric default null,
  p_height_m     numeric default null,
  p_source_code  text default null,
  p_metadata     jsonb default '{}'
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  b    three_d.buildings%rowtype;
begin
  select * into b from three_d.buildings where id = p_building_id;
  if not found then
    raise exception 'building_not_found: %', p_building_id using errcode = 'no_data_found';
  end if;
  insert into three_d.spaces (id, organisation_id, building_id, parent_id, kind, name, level, geometry, elevation_m, height_m,
                      source_code, metadata, scenario_id)
  values (v_id, b.organisation_id, p_building_id, p_parent_id, p_kind, p_name, p_level, p_geometry, p_elevation_m, p_height_m,
          p_source_code, coalesce(p_metadata, '{}'), b.scenario_id);
  return v_id;
end;
$$;

comment on function three_d.add_space(uuid, text, text, uuid, integer, geometry, numeric, numeric, text, jsonb) is
  'Describes a floor, a room, a zone or a unit of a building, under another space when a parent is given, with the source it came from and the metadata of its file. Refuses space_outside_building, space_cycle. Returns its id.';

-- A roof face, a facade, a ground area, a carport. Without an orientation
-- given, it is derived from the face's 3D polygon.
create or replace function three_d.add_surface(
  p_host_id      uuid,
  p_kind         text,
  p_name         text,
  p_geometry     geometry default null,
  p_azimuth_deg  numeric default null,
  p_tilt_deg     numeric default null,
  p_source_code  text default null,
  p_metadata     jsonb default '{}'
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
    select * into derived from three_d.surface_orientation(g);
    if derived.tilt_deg is null then
      raise exception 'orientation_unknown: give an azimuth and a tilt, or a 3D polygon of the face' using errcode = 'invalid_parameter_value';
    end if;
    p_azimuth_deg := derived.azimuth_deg;
    p_tilt_deg := derived.tilt_deg;
  end if;
  insert into three_d.surfaces (id, organisation_id, building_id, site_id, name, kind, geometry, azimuth_deg, tilt_deg, source_code, metadata, scenario_id)
  values (v_id, host.organisation_id,
          case when host.kind = 'building' then p_host_id end, case when host.kind = 'site' then p_host_id end,
          p_name, p_kind, g, p_azimuth_deg, p_tilt_deg, p_source_code, coalesce(p_metadata, '{}'), host.scenario_id);
  return v_id;
end;
$$;

comment on function three_d.add_surface(uuid, text, text, geometry, numeric, numeric, text, jsonb) is
  'Describes a roof face, a facade, a ground area or a carport on a building or a site, in its host''s scenario; a roof or facade without an orientation takes the one of its 3D polygon. Refuses surface_host_kind, orientation_unknown, invalid_geometry. Returns its id.';

-- ---------------------------------------------------------------------------
-- placements — where on its site a device is.
-- ---------------------------------------------------------------------------

create table three_d.placements (
  device_id        uuid primary key references devices(id) on delete cascade,
  -- Copied from the device by trigger.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- From the coarsest to the finest: the building it is in, the space it is
  -- in, the surface it is mounted on. Each names a place of the one above;
  -- the building is filled from the space or the surface.
  building_id      uuid references three_d.buildings(id) on delete set null,
  space_id         uuid references three_d.spaces(id) on delete set null,
  surface_id       uuid references three_d.surfaces(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table three_d.placements is
  'Where on its site a device is: the building it is in, the space it is in, the surface it is mounted on (IfcRelContainedInSpatialStructure), one row per placed device with the device''s id. Written by three_d.place_device() and three_d.move_device().';

create index placements_building_idx on three_d.placements (building_id);
create index placements_space_idx on three_d.placements (space_id);
create index placements_surface_idx on three_d.placements (surface_id);
create index placements_organisation_idx on three_d.placements (organisation_id);

-- The places a placement names fit inside each other and on the device's
-- site: the building on the site, the space in that building, the surface
-- on that building or on the site. A space or a surface given without its
-- building gives the building. A place that exists only in a scenario
-- holds only devices of that scenario.
create or replace function three_d.placements_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  d          devices%rowtype;
  v_building uuid;
  v_site     uuid;
  v_place    uuid;
begin
  select * into d from devices where id = new.device_id;
  if not found then
    raise exception 'device_not_found: %', new.device_id using errcode = 'foreign_key_violation';
  end if;
  new.organisation_id := d.organisation_id;
  if new.surface_id is not null then
    select f.building_id, coalesce(f.site_id, b.site_id) into v_building, v_site
      from three_d.surfaces f left join three_d.buildings b on b.id = f.building_id where f.id = new.surface_id;
    if v_site <> d.site_id then
      raise exception 'device_surface_site_mismatch: the surface is not on the device''s site' using errcode = 'check_violation';
    end if;
    if v_building is not null and new.building_id is null then
      new.building_id := v_building;
    elsif v_building is not null and v_building <> new.building_id then
      raise exception 'device_surface_building_mismatch: the surface is not on the device''s building' using errcode = 'check_violation';
    end if;
  end if;
  if new.space_id is not null then
    select sp.building_id, b.site_id into v_building, v_site
      from three_d.spaces sp join three_d.buildings b on b.id = sp.building_id where sp.id = new.space_id;
    if v_site <> d.site_id then
      raise exception 'device_space_site_mismatch: the space is not on the device''s site' using errcode = 'check_violation';
    end if;
    if new.building_id is null then
      new.building_id := v_building;
    elsif v_building <> new.building_id then
      raise exception 'device_space_building_mismatch: the space is not in the device''s building' using errcode = 'check_violation';
    end if;
  end if;
  if new.building_id is not null and (select site_id from three_d.buildings where id = new.building_id) <> d.site_id then
    raise exception 'device_building_site_mismatch: the building is not on the device''s site' using errcode = 'check_violation';
  end if;
  foreach v_place in array array[new.building_id, new.space_id, new.surface_id] loop
    if v_place is not null and (select o.scenario_id from objects o where o.id = v_place) is not null
       and (select o.scenario_id from objects o where o.id = v_place) is distinct from d.scenario_id then
      raise exception 'parent_in_other_scenario: the place exists only in another scenario than the device' using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

comment on function three_d.placements_check() is
  'BEFORE INSERT / UPDATE on three_d.placements: building on the device''s site, space in the building, surface on the building or the site, a place of a scenario only for a device of it; fills the building from the space or the surface and copies the device''s organisation. Refuses the device_*_mismatch of a placement, parent_in_other_scenario.';

create trigger placements_check before insert or update on three_d.placements
  for each row execute function three_d.placements_check();
create trigger placements_set_updated_at before update on three_d.placements
  for each row execute function set_updated_at();
call secure_table('three_d.placements');
-- A placed device has the finest place it names as its first parents:
-- `site_of()`, `three_d.building_of()` and the cascade of `parameter_of()`
-- go through its surface, its space, its building, then its site.
call declare_parents('three_d.placements', 'device', 'device_id', '{space_id,surface_id,building_id}');

-- The building an object is in or on: a space or a surface by its columns,
-- a device by its placement, an object of a device (a PV array of a system)
-- through the device; else, for an object placed on a surface, through its
-- open `placed_on` link.
create or replace function three_d.building_of(p_object_id uuid)
returns uuid
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select coalesce(
    ancestor_of(p_object_id, 'building'),
    (select f.building_id from links l join three_d.surfaces f on f.id = l.object_id
      where l.subject_id = p_object_id and l.type_code = 'placed_on' and l.valid_to is null and f.building_id is not null
      order by l.valid_from desc nulls last limit 1));
$$;

comment on function three_d.building_of(uuid) is
  'The building an object is in or on — a space, a surface, a device through its placement, a PV array through its system''s placement or the surface it is placed on — whatever its kind. Null when it is in none.';

-- ---------------------------------------------------------------------------
-- Link types: where a device was, what an array sits on, who occupies what.
-- ---------------------------------------------------------------------------

insert into link_types (code, name, inverse_name, subject_kinds, object_kinds, brick_relation, ifc_relation, description, published_by) values
  ('placed_in', 'was placed in', 'held',          '{device}',                    '{site,building,space,surface}', null, 'IfcRelContainedInSpatialStructure',
   'Where a device was before it moved, over the period it was there (three_d.placements holds today''s).', '3d'),
  ('placed_on', 'is placed on',  'carries',       '{pv_array}',                  '{surface}',                     null, 'IfcRelConnectsElements',
   'The roof face, facade or ground area a PV array sits on, over the period it does. The array keeps its own azimuth and tilt.', '3d'),
  ('occupies',  'occupies',      'is occupied by', '{organisation,participant}', '{building,space}',              null, 'IfcRelOccupiesSpaces',
   'The building, floor or unit a participant of a project occupies (a tenant, a resident, an owner who lives there), for a period.', '3d');

-- ---------------------------------------------------------------------------
-- Properties of a building and of its surfaces.
-- ---------------------------------------------------------------------------

insert into property_defs (code, name, datatype, quantity_code, minimum, maximum, allowed_values, applies_to, ifc_pset, ifc_property, published_by) values
  ('floor_area',           'Gross floor area',      'number',  'area',    0,    null, null,                 '{building,space}', 'Qto_BuildingBaseQuantities', 'GrossFloorArea',       '3d'),
  ('energy_label',         'Energy label',          'text',    null,      null, null, '{A+,A,B,C,D,E,F,G}', '{building}',       null,                         null,                   '3d'),
  ('year_built',           'Year of construction',  'integer', null,      1000, 2200, null,                 '{building}',       'Pset_BuildingCommon',        'YearOfConstruction',   '3d'),
  ('floors_above_ground',  'Floors above ground',   'integer', null,      0,    null, null,                 '{building}',       'Pset_BuildingCommon',        'NumberOfStoreys',      '3d'),
  ('floors_below_ground',  'Floors below ground',   'integer', null,      0,    null, null,                 '{building}',       null,                         null,                   '3d'),
  ('roof_area',            'Roof area',             'number',  'area',    0,    null, null,                 '{surface}',        'Qto_RoofBaseQuantities',     'GrossArea',            '3d'),
  ('material',             'Material',              'text',    null,      null, null, null,                 '{surface}',        'Pset_MaterialCommon',        'Name',                 '3d'),
  ('u_value',              'Thermal transmittance', 'number',  'u_value', 0,    null, null,                 '{surface}',        'Pset_WallCommon',            'ThermalTransmittance', '3d'),
  ('is_external',          'Is external',           'boolean', null,      null, null, null,                 '{surface}',        'Pset_WallCommon',            'IsExternal',           '3d');

-- ---------------------------------------------------------------------------
-- Gestures of a placement
-- ---------------------------------------------------------------------------

create or replace function three_d.place_device(
  p_device_id    uuid,
  p_building_id  uuid default null,
  p_space_id     uuid default null,
  p_surface_id   uuid default null
)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if not exists (select 1 from devices where id = p_device_id) then
    raise exception 'device_not_found: %', p_device_id using errcode = 'no_data_found';
  end if;
  if p_building_id is null and p_space_id is null and p_surface_id is null then
    delete from three_d.placements where device_id = p_device_id;
    return;
  end if;
  insert into three_d.placements (device_id, organisation_id, building_id, space_id, surface_id)
  values (p_device_id, (select organisation_id from devices where id = p_device_id), p_building_id, p_space_id, p_surface_id)
  on conflict (device_id) do update set building_id = excluded.building_id, space_id = excluded.space_id, surface_id = excluded.surface_id;
end;
$$;

comment on function three_d.place_device(uuid, uuid, uuid, uuid) is
  'Says where on its site a device is: in a building, in a space, on a surface (a space or a surface gives the building); all null takes the placement away. Refuses device_not_found and the device_*_mismatch of a placement. To keep where it was, move it instead (three_d.move_device).';

-- The place a device leaves is kept as a dated `placed_in` link to the
-- finest place it had, so where it was stays readable.
create or replace function three_d.move_device(
  p_device_id    uuid,
  p_building_id  uuid default null,
  p_space_id     uuid default null,
  p_surface_id   uuid default null,
  p_at           timestamptz default now()
)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  d    devices%rowtype;
  p    three_d.placements%rowtype;
begin
  select * into d from devices where id = p_device_id;
  if not found then
    raise exception 'device_not_found: %', p_device_id using errcode = 'no_data_found';
  end if;
  if d.status = 'removed' then
    raise exception 'device_retired: % was removed on %', d.name, d.removal_date using errcode = 'check_violation';
  end if;
  select * into p from three_d.placements where device_id = p_device_id;
  insert into links (subject_id, type_code, object_id, valid_from, valid_to, scenario_id)
  values (p_device_id, 'placed_in', coalesce(p.space_id, p.surface_id, p.building_id, d.site_id), d.installation_date, p_at, d.scenario_id)
  on conflict do nothing;
  perform three_d.place_device(p_device_id, p_building_id, p_space_id, p_surface_id);
end;
$$;

comment on function three_d.move_device(uuid, uuid, uuid, uuid, timestamptz) is
  'Moves a device on its site to a new building, space or surface; the place it leaves is kept as a placed_in link ending at that moment. Refuses device_retired and the device_*_mismatch of a placement.';

-- A PV array of the `solar` module sits on a surface: a dated `placed_on`
-- link, the array keeping its own azimuth and tilt, filled from the surface
-- when it has none. Needs the `solar` module installed.
create or replace function three_d.place_array(p_array_id uuid, p_surface_id uuid, p_on timestamptz default now())
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  f   three_d.surfaces%rowtype;
begin
  if to_regclass('solar.pv_arrays') is null then
    raise exception 'module_required: solar' using errcode = 'undefined_table';
  end if;
  if (select kind from objects where id = p_array_id) is distinct from 'pv_array' then
    raise exception 'array_not_found: %', p_array_id using errcode = 'no_data_found';
  end if;
  select * into f from three_d.surfaces where id = p_surface_id;
  if not found then
    raise exception 'surface_not_found: %', p_surface_id using errcode = 'no_data_found';
  end if;
  if site_of(p_surface_id) is distinct from site_of(p_array_id) then
    raise exception 'array_outside_system_site' using errcode = 'check_violation';
  end if;
  -- The surface it sat on until now is left from that moment.
  update links set valid_to = p_on
   where subject_id = p_array_id and type_code = 'placed_on' and valid_to is null and object_id <> p_surface_id;
  if not exists (select 1 from links where subject_id = p_array_id and type_code = 'placed_on' and object_id = p_surface_id and valid_to is null) then
    insert into links (subject_id, type_code, object_id, valid_from, scenario_id)
    values (p_array_id, 'placed_on', p_surface_id, p_on, (select scenario_id from objects where id = p_array_id));
  end if;
  execute 'update solar.pv_arrays set azimuth_deg = coalesce(azimuth_deg, $2), tilt_deg = coalesce(tilt_deg, $3) where id = $1'
    using p_array_id, f.azimuth_deg, f.tilt_deg;
end;
$$;

comment on function three_d.place_array(uuid, uuid, timestamptz) is
  'Puts a PV array of the solar module on a roof face, facade or ground area of its site from a moment, as a placed_on link (the surface it leaves ends there), and fills its azimuth and tilt from the surface when it has none. Refuses module_required, array_not_found, surface_not_found, array_outside_system_site.';

grant execute on function three_d.footprint_volume(geometry, numeric, numeric), three_d.surface_orientation(geometry),
  three_d.building_volume(uuid), three_d.building_of(uuid),
  three_d.add_building(uuid, text, geometry, numeric, numeric, text, text, jsonb, uuid),
  three_d.add_space(uuid, text, text, uuid, integer, geometry, numeric, numeric, text, jsonb),
  three_d.add_surface(uuid, text, text, geometry, numeric, numeric, text, jsonb),
  three_d.place_device(uuid, uuid, uuid, uuid), three_d.move_device(uuid, uuid, uuid, uuid, timestamptz),
  three_d.place_array(uuid, uuid, timestamptz)
  to authenticated, service_role;

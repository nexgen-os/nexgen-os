-- Nexgen OS — module `building`: the physical description of a place.
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
--   building.buildings    a footprint, an elevation, a height
--   building.spaces       floors, rooms, zones and units of a building, one tree
--   building.surfaces     roof faces, facades, ground areas, carports
--   building.devices   the building, space and surface a device is in or on
--
-- Buildings, spaces and surfaces are kinds of object, published in `kinds`:
-- attributes, identifiers, links, documents and series name them by kind
-- and id as they name any object of the core, and `site_of()` asks this
-- module's `building.site_of()` where they are. A placement is one row per
-- placed device, with the device's id (decision 0042): the core's device
-- knows its site and its meter, this module where on the site it is
-- (decision 0026), and `building.parameter_of()` resolves a parameter
-- through that place before asking the core. Geometry follows the core's frame (decision 0003):
-- WGS 84, three-dimensional, through `to_core_geometry()`.

set search_path = nexgen, public, extensions;

create schema building;
grant usage on schema building to authenticated, service_role;

-- Registered first: the kinds it publishes are published under its code.
insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('building', 'Building', '0.1.0', 'building', '0.3.0',
        'The physical description of a place: buildings, their floors, rooms, zones and units, roof faces, facades and ground areas with their orientation, where a device is placed among them, and which of them a participant occupies.');

insert into kinds (kind, table_name, published_by) values
  ('building', 'building.buildings', 'building'),
  ('space',    'building.spaces',    'building'),
  ('surface',  'building.surfaces',  'building');

-- Vertical faces of a footprint between two heights, plus floor and roof:
-- the level-of-detail 1 block. Derived, never stored.
create or replace function building.footprint_volume(p_footprint geometry, p_base numeric, p_top numeric)
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

comment on function building.footprint_volume(geometry, numeric, numeric) is
  'The level-of-detail 1 block of a footprint between two heights, as a polyhedral surface.';

-- The orientation of a planar face from its 3D polygon: the normal of its
-- outer ring (Newell's method) in the UTM zone it falls in, turned to face
-- up; tilt from horizontal, azimuth clockwise from true north, measured on
-- the ellipsoid between the face's centre and a point down its slope. Null
-- when the polygon has no height, and the azimuth of a flat face is null.
create or replace function building.surface_orientation(p_geom geometry, out azimuth_deg numeric, out tilt_deg numeric)
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

comment on function building.surface_orientation(geometry) is
  'Azimuth (degrees clockwise from true north) and tilt (degrees from horizontal) of a planar 3D polygon. Null when the polygon has no height; the azimuth of a flat face is null.';

-- ---------------------------------------------------------------------------
-- buildings
-- ---------------------------------------------------------------------------

create table building.buildings (
  id                   uuid primary key default gen_random_uuid(),
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

comment on table building.buildings is
  'A building on a site: footprint, elevation, height, use, lifecycle (CityGML Building, IfcBuilding). Its floors, rooms, zones and units are spaces, its roof faces and facades surfaces.';

create index buildings_site_idx on building.buildings (site_id);
create index buildings_footprint_idx on building.buildings using gist (footprint);
create trigger buildings_normalize before insert or update of footprint on building.buildings
  for each row execute function normalize_geometry('footprint');
create trigger buildings_site_id_check before insert or update of site_id, scenario_id on building.buildings
  for each row execute function parent_check('site_id', 'sites');
create trigger buildings_set_updated_at before update on building.buildings
  for each row execute function set_updated_at();
create index buildings_organisation_idx on building.buildings (organisation_id);
create trigger buildings_drop_attachments after delete on building.buildings
  for each row execute function drop_attachments('building');
call secure_table('building.buildings');

create or replace function building.building_volume(p_building_id uuid)
returns geometry
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select building.footprint_volume(b.footprint, coalesce(b.elevation_m, 0), coalesce(b.elevation_m, 0) + b.height_m)
    from building.buildings b where b.id = p_building_id;
$$;

comment on function building.building_volume(uuid) is
  'Level-of-detail 1 block of a building: its footprint extruded from its elevation by its height. Derived, never stored.';

-- ---------------------------------------------------------------------------
-- spaces — the inside of a building, one tree.
-- ---------------------------------------------------------------------------

create table building.spaces (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  building_id      uuid not null references building.buildings(id) on delete cascade,
  -- The space it is part of: a room on a floor, a room in a zone, a unit
  -- on a floor. Null for a floor, and for a space that spans floors or
  -- whose floor is not described (an atrium, a duplex, a hall).
  parent_id        uuid references building.spaces(id) on delete cascade,
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

comment on table building.spaces is
  'The spatial structure inside a building, one tree: floors (IfcBuildingStorey, CityGML Storey), rooms (IfcSpace, CityGML BuildingRoom, Brick Room), zones and units. A device is placed in a space (building.devices), a participant occupies one; a series observes one.';

create unique index spaces_one_floor_per_level on building.spaces (building_id, level, scenario_id) nulls not distinct where kind = 'floor';
create index spaces_building_idx on building.spaces (building_id);
create index spaces_parent_idx on building.spaces (parent_id);
create index spaces_geometry_idx on building.spaces using gist (geometry);
create trigger spaces_normalize before insert or update of geometry on building.spaces
  for each row execute function normalize_geometry('geometry');

-- A space and the space it is part of are in the same building, and the
-- tree has no loop.
create or replace function building.spaces_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  p building.spaces%rowtype;
begin
  if new.parent_id is null then
    return new;
  end if;
  select * into p from building.spaces where id = new.parent_id;
  if found and p.building_id <> new.building_id then
    raise exception 'space_outside_building: % is in another building than %', new.name, p.name
      using errcode = 'check_violation';
  end if;
  if exists (
    with recursive up as (
      select s.id, s.parent_id from building.spaces s where s.id = new.parent_id
      union
      select s.id, s.parent_id from building.spaces s join up on s.id = up.parent_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'space_cycle: % would contain itself', new.name using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function building.spaces_check() is
  'BEFORE INSERT / UPDATE on spaces: the parent is in the same building (space_outside_building) and the tree has no loop (space_cycle).';

create trigger spaces_check before insert or update of parent_id, building_id on building.spaces
  for each row execute function building.spaces_check();
create trigger spaces_parent_id_check before insert or update of parent_id, scenario_id on building.spaces
  for each row execute function parent_check('parent_id', 'building.spaces');
create trigger spaces_building_id_check before insert or update of building_id, scenario_id on building.spaces
  for each row execute function parent_check('building_id', 'building.buildings');
create trigger spaces_set_updated_at before update on building.spaces
  for each row execute function set_updated_at();
create index spaces_organisation_idx on building.spaces (organisation_id);
create trigger spaces_drop_attachments after delete on building.spaces
  for each row execute function drop_attachments('space');
call secure_table('building.spaces');

-- ---------------------------------------------------------------------------
-- surfaces — the planar things something is mounted on.
-- ---------------------------------------------------------------------------

create table building.surfaces (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- On a building (a roof face, a facade) or straight on a site (a ground
  -- area, a car park).
  building_id      uuid references building.buildings(id) on delete cascade,
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

comment on table building.surfaces is
  'A roof face, a facade, a ground area or a carport: the planar thing a device is mounted on, with its azimuth and tilt (CityGML RoofSurface / WallSurface).';

create index surfaces_building_idx on building.surfaces (building_id);
create index surfaces_site_idx on building.surfaces (site_id);
create index surfaces_geometry_idx on building.surfaces using gist (geometry);
create trigger surfaces_normalize before insert or update of geometry on building.surfaces
  for each row execute function normalize_geometry('geometry');
create trigger surfaces_building_id_check before insert or update of building_id, scenario_id on building.surfaces
  for each row execute function parent_check('building_id', 'building.buildings');
create trigger surfaces_site_id_check before insert or update of site_id, scenario_id on building.surfaces
  for each row execute function parent_check('site_id', 'sites');
create trigger surfaces_set_updated_at before update on building.surfaces
  for each row execute function set_updated_at();
create index surfaces_organisation_idx on building.surfaces (organisation_id);
create trigger surfaces_drop_attachments after delete on building.surfaces
  for each row execute function drop_attachments('surface');
call secure_table('building.surfaces');

create or replace function building.add_building(
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
  insert into building.buildings (id, organisation_id, site_id, name, footprint, elevation_m, height_m, profile, source_code, metadata, scenario_id)
  values (v_id, s.organisation_id, p_site_id, p_name, p_footprint, p_elevation_m, p_height_m, p_profile, p_source_code,
          coalesce(p_metadata, '{}'), coalesce(p_scenario_id, s.scenario_id));
  return v_id;
end;
$$;

comment on function building.add_building(uuid, text, geometry, numeric, numeric, text, text, jsonb, uuid) is
  'Describes a building on a site, in the site''s organisation and in its scenario, or in the scenario given (a variant that adds a building to a site as it is). The metadata carry what the file it was read from says and no column holds. Refuses invalid_geometry. Returns its id.';

create or replace function building.add_space(
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
  b    building.buildings%rowtype;
begin
  select * into b from building.buildings where id = p_building_id;
  if not found then
    raise exception 'building_not_found: %', p_building_id using errcode = 'no_data_found';
  end if;
  insert into building.spaces (id, organisation_id, building_id, parent_id, kind, name, level, geometry, elevation_m, height_m,
                      source_code, metadata, scenario_id)
  values (v_id, b.organisation_id, p_building_id, p_parent_id, p_kind, p_name, p_level, p_geometry, p_elevation_m, p_height_m,
          p_source_code, coalesce(p_metadata, '{}'), b.scenario_id);
  return v_id;
end;
$$;

comment on function building.add_space(uuid, text, text, uuid, integer, geometry, numeric, numeric, text, jsonb) is
  'Describes a floor, a room, a zone or a unit of a building, under another space when a parent is given, with the source it came from and the metadata of its file. Refuses space_outside_building, space_cycle. Returns its id.';

-- A roof face, a facade, a ground area, a carport. Without an orientation
-- given, it is derived from the face's 3D polygon.
create or replace function building.add_surface(
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
  host    record;
  g       geometry := to_core_geometry(p_geometry);
  derived record;
begin
  select 'building' as kind, b.organisation_id, b.scenario_id into host from building.buildings b where b.id = p_host_id;
  if not found then
    select 'site' as kind, s.organisation_id, s.scenario_id into host from sites s where s.id = p_host_id;
  end if;
  if host.kind is null then
    raise exception 'surface_host_kind: a surface is on a building or a site' using errcode = 'check_violation';
  end if;
  if p_azimuth_deg is null and p_tilt_deg is null and p_kind in ('roof', 'facade') then
    select * into derived from building.surface_orientation(g);
    if derived.tilt_deg is null then
      raise exception 'orientation_unknown: give an azimuth and a tilt, or a 3D polygon of the face' using errcode = 'invalid_parameter_value';
    end if;
    p_azimuth_deg := derived.azimuth_deg;
    p_tilt_deg := derived.tilt_deg;
  end if;
  insert into building.surfaces (id, organisation_id, building_id, site_id, name, kind, geometry, azimuth_deg, tilt_deg, source_code, metadata, scenario_id)
  values (v_id, host.organisation_id,
          case when host.kind = 'building' then p_host_id end, case when host.kind = 'site' then p_host_id end,
          p_name, p_kind, g, p_azimuth_deg, p_tilt_deg, p_source_code, coalesce(p_metadata, '{}'), host.scenario_id);
  return v_id;
end;
$$;

comment on function building.add_surface(uuid, text, text, geometry, numeric, numeric, text, jsonb) is
  'Describes a roof face, a facade, a ground area or a carport on a building or a site, in its host''s scenario; a roof or facade without an orientation takes the one of its 3D polygon. Refuses surface_host_kind, orientation_unknown, invalid_geometry. Returns its id.';

-- ---------------------------------------------------------------------------
-- devices — the building side of a device of the core: where on its site it is.
-- ---------------------------------------------------------------------------

create table building.devices (
  device_id        uuid primary key references devices(id) on delete cascade,
  -- Copied from the device by trigger.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- From the coarsest to the finest: the building it is in, the space it is
  -- in, the surface it is mounted on. Each names a place of the one above;
  -- the building is filled from the space or the surface.
  building_id      uuid references building.buildings(id) on delete set null,
  space_id         uuid references building.spaces(id) on delete set null,
  surface_id       uuid references building.surfaces(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table building.devices is
  'Where on its site a device is: the building it is in, the space it is in, the surface it is mounted on (IfcRelContainedInSpatialStructure), one row per placed device with the device''s id. Written by building.place_device() and building.move_device().';

create index devices_building_idx on building.devices (building_id);
create index devices_space_idx on building.devices (space_id);
create index devices_surface_idx on building.devices (surface_id);
create index devices_organisation_idx on building.devices (organisation_id);

-- The places a placement names fit inside each other and on the device's
-- site: the building on the site, the space in that building, the surface
-- on that building or on the site. A space or a surface given without its
-- building gives the building. A place that exists only in a scenario
-- holds only devices of that scenario.
create or replace function building.devices_check()
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
      from building.surfaces f left join building.buildings b on b.id = f.building_id where f.id = new.surface_id;
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
      from building.spaces sp join building.buildings b on b.id = sp.building_id where sp.id = new.space_id;
    if v_site <> d.site_id then
      raise exception 'device_space_site_mismatch: the space is not on the device''s site' using errcode = 'check_violation';
    end if;
    if new.building_id is null then
      new.building_id := v_building;
    elsif v_building <> new.building_id then
      raise exception 'device_space_building_mismatch: the space is not in the device''s building' using errcode = 'check_violation';
    end if;
  end if;
  if new.building_id is not null and (select site_id from building.buildings where id = new.building_id) <> d.site_id then
    raise exception 'device_building_site_mismatch: the building is not on the device''s site' using errcode = 'check_violation';
  end if;
  foreach v_place in array array[
    (select scenario_id from building.buildings where id = new.building_id),
    (select scenario_id from building.spaces where id = new.space_id),
    (select scenario_id from building.surfaces where id = new.surface_id)] loop
    if v_place is not null and v_place is distinct from d.scenario_id then
      raise exception 'parent_in_other_scenario: the place exists only in another scenario than the device' using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

comment on function building.devices_check() is
  'BEFORE INSERT / UPDATE on building.devices: building on the device''s site, space in the building, surface on the building or the site, a place of a scenario only for a device of it; fills the building from the space or the surface and copies the device''s organisation. Refuses the device_*_mismatch of a placement, parent_in_other_scenario.';

create trigger devices_check before insert or update on building.devices
  for each row execute function building.devices_check();
create trigger devices_set_updated_at before update on building.devices
  for each row execute function set_updated_at();
call secure_table('building.devices');

-- ---------------------------------------------------------------------------
-- Where an object is, among what is built.
-- ---------------------------------------------------------------------------

-- The site of a building, a space or a surface, through their foreign keys.
-- `site_of()` of the core hands this module its own kinds.
create or replace function building.site_of(p_kind text, p_id uuid)
returns uuid
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select case p_kind
    when 'building' then (select b.site_id from building.buildings b where b.id = p_id)
    when 'space' then (select b.site_id from building.spaces sp join building.buildings b on b.id = sp.building_id where sp.id = p_id)
    when 'surface' then (select coalesce(f.site_id, b.site_id) from building.surfaces f
                           left join building.buildings b on b.id = f.building_id where f.id = p_id)
  end;
$$;

comment on function building.site_of(text, uuid) is
  'The site a building, a space or a surface is on, through their foreign keys; what site_of() of the core answers for the kinds of this module.';

-- What is built above an object, nearest first: for a placed device, the
-- space it is in and the spaces holding it, the surface it is on, its
-- building; for a space, the spaces holding it and its building; for a
-- surface, its building.
create or replace function building.places_of(p_kind text, p_id uuid)
returns table (kind text, object_id uuid)
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive start as (
    select case p_kind when 'device' then (select space_id from building.devices where device_id = p_id)
                       when 'space' then (select parent_id from building.spaces where id = p_id) end as space_id
  ),
  up as (
    select sp.id, sp.parent_id, 1 as depth from building.spaces sp join start on sp.id = start.space_id
    union all
    select sp.id, sp.parent_id, up.depth + 1 from building.spaces sp join up on sp.id = up.parent_id
  ),
  places as (
    select 'space'::text as kind, up.id as object_id, up.depth as n from up
    union all
    select 'surface', d.surface_id, 1000 from building.devices d where p_kind = 'device' and d.device_id = p_id
    union all
    select 'building', case p_kind
                         when 'device' then (select building_id from building.devices where device_id = p_id)
                         when 'space' then (select building_id from building.spaces where id = p_id)
                         when 'surface' then (select building_id from building.surfaces where id = p_id)
                       end, 2000
  )
  select kind, object_id from places where object_id is not null order by n;
$$;

comment on function building.places_of(text, uuid) is
  'What is built above an object, nearest first: a placed device''s spaces, surface and building; a space''s spaces and building; a surface''s building.';

-- The building an object is in or on: itself, a space or a surface by its
-- columns, a device by its placement, a PV array of the `solar` module
-- through its system's placement; else, for an object placed on a surface,
-- through its open `placed_on` link.
create or replace function building.building_of(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_building  uuid;
  v_system    uuid;
begin
  if p_kind = 'building' then
    return (select id from building.buildings where id = p_id);
  end if;
  select object_id into v_building from building.places_of(p_kind, p_id) where kind = 'building';
  if v_building is null and p_kind = 'pv_array' and to_regclass('solar.pv_arrays') is not null then
    execute 'select pv_system_id from solar.pv_arrays where id = $1' into v_system using p_id;
    select building_id into v_building from building.devices where device_id = v_system;
  end if;
  return coalesce(v_building,
    (select f.building_id from links l join building.surfaces f on f.id = l.object_id
      where l.subject_kind = p_kind and l.subject_id = p_id and l.type_code = 'placed_on' and l.object_kind = 'surface'
        and l.valid_to is null and f.building_id is not null
      order by l.valid_from desc nulls last limit 1));
end;
$$;

comment on function building.building_of(text, uuid) is
  'The building an object (its kind and id) is in or on — a space, a surface, a device through its placement, a PV array through its system''s placement or the surface it is placed on. Null when it is in none.';

-- A parameter resolved through what is built: the object's own attribute,
-- then the places above it nearest first (building.places_of), then what
-- the core answers — for a device, the core's cascade from the device; for
-- a building, a space or a surface, the core's from its site, where the
-- site's own value is the site's level.
create or replace function building.parameter_of(
  p_kind          text,
  p_id            uuid,
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
  a    attributes%rowtype;
  anc  record;
  r    jsonb;
begin
  if not exists (select 1 from property_defs where code = p_property_code) then
    raise exception 'property_unknown: %', p_property_code using errcode = 'foreign_key_violation';
  end if;
  perform object_organisation(p_kind, p_id);
  a := attribute_at(p_id, p_property_code, p_at, p_scenario_id);
  if a.id is not null then
    return jsonb_build_object('value', a.value, 'level', 'object', 'object_id', p_id,
                              'source_code', a.source_code, 'reference', a.source, 'valid_from', a.valid_from);
  end if;
  for anc in select * from building.places_of(p_kind, p_id) loop
    a := attribute_at(anc.object_id, p_property_code, p_at, p_scenario_id);
    if a.id is not null then
      return jsonb_build_object('value', a.value, 'level', anc.kind, 'object_id', anc.object_id,
                                'source_code', a.source_code, 'reference', a.source, 'valid_from', a.valid_from);
    end if;
  end loop;
  if p_kind not in ('building', 'space', 'surface') then
    return parameter_of(p_kind, p_id, p_property_code, p_at, p_scenario_id);
  end if;
  r := parameter_of('site', building.site_of(p_kind, p_id), p_property_code, p_at, p_scenario_id);
  if r->>'level' = 'object' then
    r := r || jsonb_build_object('level', 'site');
  end if;
  return r;
end;
$$;

comment on function building.parameter_of(text, uuid, text, timestamptz, uuid) is
  'The value of a parameter for an object, through what is built: its own attribute, the spaces, surface and building above it nearest first, then the core''s parameter_of() — from the device for a device, from the site for a building, a space or a surface.';

-- ---------------------------------------------------------------------------
-- Link types: where a device was, what an array sits on, who occupies what.
-- ---------------------------------------------------------------------------

insert into link_types (code, name, inverse_name, subject_kinds, object_kinds, brick_relation, ifc_relation, description, published_by) values
  ('placed_in', 'was placed in', 'held',          '{device}',                    '{site,building,space,surface}', null, 'IfcRelContainedInSpatialStructure',
   'Where a device was before it moved, over the period it was there (building.devices holds today''s).', 'building'),
  ('placed_on', 'is placed on',  'carries',       '{pv_array}',                  '{surface}',                     null, 'IfcRelConnectsElements',
   'The roof face, facade or ground area a PV array sits on, over the period it does. The array keeps its own azimuth and tilt.', 'building'),
  ('occupies',  'occupies',      'is occupied by', '{organisation,participant}', '{building,space}',              null, 'IfcRelOccupiesSpaces',
   'The building, floor or unit a participant of a project occupies (a tenant, a resident, an owner who lives there), for a period.', 'building');

-- ---------------------------------------------------------------------------
-- Properties of a building and of its surfaces.
-- ---------------------------------------------------------------------------

insert into property_defs (code, name, datatype, quantity_code, minimum, maximum, allowed_values, applies_to, ifc_pset, ifc_property, published_by) values
  ('floor_area',           'Gross floor area',      'number',  'area',    0,    null, null,                 '{building,space}', 'Qto_BuildingBaseQuantities', 'GrossFloorArea',       'building'),
  ('energy_label',         'Energy label',          'text',    null,      null, null, '{A+,A,B,C,D,E,F,G}', '{building}',       null,                         null,                   'building'),
  ('year_built',           'Year of construction',  'integer', null,      1000, 2200, null,                 '{building}',       'Pset_BuildingCommon',        'YearOfConstruction',   'building'),
  ('floors_above_ground',  'Floors above ground',   'integer', null,      0,    null, null,                 '{building}',       'Pset_BuildingCommon',        'NumberOfStoreys',      'building'),
  ('floors_below_ground',  'Floors below ground',   'integer', null,      0,    null, null,                 '{building}',       null,                         null,                   'building'),
  ('roof_area',            'Roof area',             'number',  'area',    0,    null, null,                 '{surface}',        'Qto_RoofBaseQuantities',     'GrossArea',            'building'),
  ('material',             'Material',              'text',    null,      null, null, null,                 '{surface}',        'Pset_MaterialCommon',        'Name',                 'building'),
  ('u_value',              'Thermal transmittance', 'number',  'u_value', 0,    null, null,                 '{surface}',        'Pset_WallCommon',            'ThermalTransmittance', 'building'),
  ('is_external',          'Is external',           'boolean', null,      null, null, null,                 '{surface}',        'Pset_WallCommon',            'IsExternal',           'building');

-- ---------------------------------------------------------------------------
-- Gestures of a placement
-- ---------------------------------------------------------------------------

create or replace function building.place_device(
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
    delete from building.devices where device_id = p_device_id;
    return;
  end if;
  insert into building.devices (device_id, organisation_id, building_id, space_id, surface_id)
  values (p_device_id, (select organisation_id from devices where id = p_device_id), p_building_id, p_space_id, p_surface_id)
  on conflict (device_id) do update set building_id = excluded.building_id, space_id = excluded.space_id, surface_id = excluded.surface_id;
end;
$$;

comment on function building.place_device(uuid, uuid, uuid, uuid) is
  'Says where on its site a device is: in a building, in a space, on a surface (a space or a surface gives the building); all null takes the placement away. Refuses device_not_found and the device_*_mismatch of a placement. To keep where it was, move it instead (building.move_device).';

-- The place a device leaves is kept as a dated `placed_in` link to the
-- finest place it had, so where it was stays readable.
create or replace function building.move_device(
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
  p    building.devices%rowtype;
begin
  select * into d from devices where id = p_device_id;
  if not found then
    raise exception 'device_not_found: %', p_device_id using errcode = 'no_data_found';
  end if;
  if d.status = 'removed' then
    raise exception 'device_retired: % was removed on %', d.name, d.removal_date using errcode = 'check_violation';
  end if;
  select * into p from building.devices where device_id = p_device_id;
  insert into links (subject_kind, subject_id, type_code, object_kind, object_id, valid_from, valid_to, scenario_id)
  values ('device', p_device_id, 'placed_in',
          case when p.space_id is not null then 'space' when p.surface_id is not null then 'surface'
               when p.building_id is not null then 'building' else 'site' end,
          coalesce(p.space_id, p.surface_id, p.building_id, d.site_id), d.installation_date, p_at, d.scenario_id)
  on conflict do nothing;
  perform building.place_device(p_device_id, p_building_id, p_space_id, p_surface_id);
end;
$$;

comment on function building.move_device(uuid, uuid, uuid, uuid, timestamptz) is
  'Moves a device on its site to a new building, space or surface; the place it leaves is kept as a placed_in link ending at that moment. Refuses device_retired and the device_*_mismatch of a placement.';

-- A PV array of the `solar` module sits on a surface: a dated `placed_on`
-- link, the array keeping its own azimuth and tilt, filled from the surface
-- when it has none. Needs the `solar` module installed.
create or replace function building.place_array(p_array_id uuid, p_surface_id uuid, p_on timestamptz default now())
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  f    building.surfaces%rowtype;
  scn  uuid;
begin
  if to_regclass('solar.pv_arrays') is null then
    raise exception 'module_required: solar' using errcode = 'undefined_table';
  end if;
  execute 'select scenario_id from solar.pv_arrays where id = $1' into scn using p_array_id;
  if not found then
    raise exception 'array_not_found: %', p_array_id using errcode = 'no_data_found';
  end if;
  select * into f from building.surfaces where id = p_surface_id;
  if not found then
    raise exception 'surface_not_found: %', p_surface_id using errcode = 'no_data_found';
  end if;
  if site_of('surface', p_surface_id) is distinct from site_of('pv_array', p_array_id) then
    raise exception 'array_outside_system_site' using errcode = 'check_violation';
  end if;
  -- The surface it sat on until now is left from that moment.
  update links set valid_to = p_on
   where subject_kind = 'pv_array' and subject_id = p_array_id and type_code = 'placed_on' and valid_to is null and object_id <> p_surface_id;
  if not exists (select 1 from links where subject_kind = 'pv_array' and subject_id = p_array_id and type_code = 'placed_on'
                    and object_kind = 'surface' and object_id = p_surface_id and valid_to is null) then
    insert into links (subject_kind, subject_id, type_code, object_kind, object_id, valid_from, scenario_id)
    values ('pv_array', p_array_id, 'placed_on', 'surface', p_surface_id, p_on, scn);
  end if;
  execute 'update solar.pv_arrays set azimuth_deg = coalesce(azimuth_deg, $2), tilt_deg = coalesce(tilt_deg, $3) where id = $1'
    using p_array_id, f.azimuth_deg, f.tilt_deg;
end;
$$;

comment on function building.place_array(uuid, uuid, timestamptz) is
  'Puts a PV array of the solar module on a roof face, facade or ground area of its site from a moment, as a placed_on link (the surface it leaves ends there), and fills its azimuth and tilt from the surface when it has none. Refuses module_required, array_not_found, surface_not_found, array_outside_system_site.';

grant execute on function building.footprint_volume(geometry, numeric, numeric), building.surface_orientation(geometry),
  building.building_volume(uuid), building.site_of(text, uuid), building.places_of(text, uuid),
  building.building_of(text, uuid), building.parameter_of(text, uuid, text, timestamptz, uuid),
  building.add_building(uuid, text, geometry, numeric, numeric, text, text, jsonb, uuid),
  building.add_space(uuid, text, text, uuid, integer, geometry, numeric, numeric, text, jsonb),
  building.add_surface(uuid, text, text, geometry, numeric, numeric, text, jsonb),
  building.place_device(uuid, uuid, uuid, uuid), building.move_device(uuid, uuid, uuid, uuid, timestamptz),
  building.place_array(uuid, uuid, timestamptz)
  to authenticated, service_role;

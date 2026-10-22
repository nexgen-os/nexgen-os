-- Nexgen OS — module `building`: the physical description of a place.
--
-- The core keeps the participant and its place: an address, a point, a
-- time zone, geolocated but not described (decision 0043). What the place
-- physically is belongs here (decision 0008), and enriches the participant:
-- its ground with its parcel, its buildings with their footprint and
-- height, the floors, rooms, zones and units inside them as one tree, the
-- roof faces, facades and ground areas with their orientation; which
-- building, floor or unit a participant occupies when it shares one. The
-- territory of CityGML and of the spatial structure of IFC.
--
--   building.profiles     what a building or a place is used for
--   building.sites        the ground of a participant: a parcel, an area, a use
--   building.buildings    a footprint, an elevation, a height, its year,
--                         its floors, its energy label
--   building.spaces       floors, rooms, zones and units of a building, one
--                         tree, with the participant that occupies one
--   building.surfaces     roof faces, facades, ground areas, carports, with
--                         their material and thermal transmittance
--
-- What describes them is their columns, with the source they came from and
-- the identifier their file or register gives them (`global_id`): the
-- attachments of the core name the six objects of the core only. Each
-- belongs to a participant through its foreign keys, which
-- `building.participant_of()` follows. Where a device sits among them is
-- not described for now (decision 0026): a device belongs to its
-- participant, behind its meters. Geometry follows the core's
-- frame (decision 0003): WGS 84, three-dimensional, through
-- `to_core_geometry()`.

set search_path = nexgen, public, extensions;

create schema building;
grant usage on schema building to authenticated, service_role;

-- Registered first: what it publishes is published under its code.
insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('building', 'Building', '0.1.0', 'building', '0.3.0',
        'The physical description of the place of a participant: its ground, its buildings, their floors, rooms, zones and units, roof faces, facades and ground areas with their orientation, and which of them a participant occupies.');

-- ---------------------------------------------------------------------------
-- profiles — what a building or a place is used for.
-- ---------------------------------------------------------------------------

create table building.profiles (
  code             text primary key,
  name             text not null,
  description      text,
  -- building: a use of a building (office, school, dwelling); place: a use of
  -- a place without a building to speak of (a field, a car park, a plant).
  applies_to       text not null default 'building',
  ifc_occupancy    text,
  citygml_function text,
  published_by     text not null default 'building',
  constraint profiles_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint profiles_applies_to check (applies_to in ('building', 'place'))
);

comment on table building.profiles is
  'The use of a building or a place: residential, office, school, factory, farm, car park… A pack or a module adds its own rows.';

alter table building.profiles enable row level security;
create policy profiles_read on building.profiles for select to authenticated using (true);
grant select on building.profiles to authenticated;
grant select, insert, update, delete on building.profiles to service_role;

insert into building.profiles (code, name, applies_to, ifc_occupancy, citygml_function, description) values
  ('residential', 'Residential',        'building', 'Residential',  'residential', 'Dwellings: a house, a flat, a block.'),
  ('office',      'Office',             'building', 'Office',       'office',      'Office space.'),
  ('school',      'School',             'building', 'Education',    'school',      'A school, a nursery, a training centre.'),
  ('retail',      'Retail',             'building', 'Retail',       'retail',      'A shop, a supermarket.'),
  ('industrial',  'Industrial',         'building', 'Industrial',   'industry',    'A factory, a workshop.'),
  ('warehouse',   'Warehouse',          'building', 'Storage',      'warehouse',   'A storage or logistics hall.'),
  ('agricultural','Agricultural',       'building', 'Agricultural', 'agriculture', 'A barn, a stable, a greenhouse.'),
  ('public',      'Public building',    'building', 'Public',       'public',      'A town hall, a library, a sports hall.'),
  ('healthcare',  'Healthcare',         'building', 'Healthcare',   'hospital',    'A hospital, a care home.'),
  ('hospitality', 'Hospitality',        'building', 'Hotel',        'hotel',       'A hotel, a restaurant.'),
  ('mixed',       'Mixed use',          'building', 'Mixed',        'mixed',       'Several uses in one building.'),
  ('plant',       'Production site',    'place',    null,           'industry',    'A place whose purpose is a plant: a PV field, a wind farm.'),
  ('car_park',    'Car park',           'place',    null,           'parking',     'An open car park.'),
  ('land',        'Land',               'place',    null,           'agriculture', 'A field, a meadow, a wood.');

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
-- sites — the ground of a participant.
-- ---------------------------------------------------------------------------

create table building.sites (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The participant whose ground it is; its address and point are the
  -- participant's (place_of()).
  participant_id   uuid not null references participants(id) on delete cascade,
  name             text not null,
  -- The parcel or the plot as a polygon.
  geometry         geometry,
  -- The area a register or a deed gives, when the outline is not known
  -- (`area_m2(geometry)` measures the outline).
  area_m2          numeric(14, 2),
  -- What the ground is used for, when it is not a building's use.
  profile          text references building.profiles(code),
  source_code      text references sources(code),
  -- The identifier its register gives it: a cadastral parcel.
  global_id        text,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sites_name_not_blank check (btrim(name) <> ''),
  constraint sites_area_positive check (area_m2 is null or area_m2 >= 0),
  constraint sites_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3))
);

comment on table building.sites is
  'The ground of a participant: a parcel or a plot with its outline, its area and its use (a garden, a field, a car park). Its buildings and its ground surfaces are on it; its address and point are the participant''s.';

create index sites_participant_idx on building.sites (participant_id);
create index sites_geometry_idx on building.sites using gist (geometry);
create trigger sites_normalize before insert or update of geometry on building.sites
  for each row execute function normalize_geometry('geometry');
create trigger sites_participant_id_check before insert or update of participant_id on building.sites
  for each row execute function parent_check('participant_id', 'participants');
create trigger sites_set_updated_at before update on building.sites
  for each row execute function set_updated_at();
create index sites_organisation_idx on building.sites (organisation_id);
-- One identifier names one site of an organisation: a file is imported once.
create unique index sites_one_global_id on building.sites (organisation_id, global_id);
call secure_table('building.sites');

-- ---------------------------------------------------------------------------
-- buildings
-- ---------------------------------------------------------------------------

create table building.buildings (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references organisations(id) on delete cascade,
  -- The participant whose building it is, and the ground it stands on when
  -- that ground is described.
  participant_id       uuid not null references participants(id) on delete cascade,
  site_id              uuid references building.sites(id) on delete set null,
  name                 text not null,
  profile              text references building.profiles(code),
  -- The outline on the ground. With elevation and height it gives the
  -- level-of-detail 1 block (`building_volume`).
  footprint            geometry,
  elevation_m          numeric(9, 3),
  height_m             numeric(9, 3),
  -- What a register, a model or an audit says of it (CityGML Building,
  -- IFC Pset_BuildingCommon): the year of construction, the number of
  -- floors above and below ground, the gross floor area in m², the energy
  -- label. Described floors are spaces.
  year_built           integer,
  floors_above_ground  integer,
  floors_below_ground  integer,
  floor_area_m2        numeric(14, 2),
  energy_label         text,
  -- Where the description comes from (a cadastre, a 3D city model, a
  -- survey), the identifier it gives the building (a CityJSON object id,
  -- an IFC GlobalId, an OpenStreetMap element), and what that source said
  -- beyond these columns.
  source_code          text references sources(code),
  global_id            text,
  metadata             jsonb not null default '{}',
  status               text not null default 'in_service',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint buildings_name_not_blank check (btrim(name) <> ''),
  constraint buildings_height_positive check (height_m is null or height_m >= 0),
  constraint buildings_status check (status in ('planned', 'under_construction', 'in_service', 'out_of_service', 'demolished')),
  constraint buildings_footprint_core check (footprint is null or (ST_SRID(footprint) = 4326 and ST_NDims(footprint) = 3)),
  constraint buildings_year_built check (year_built is null or year_built between 1000 and 2200),
  constraint buildings_floors_positive check (coalesce(floors_above_ground, 0) >= 0 and coalesce(floors_below_ground, 0) >= 0),
  constraint buildings_floor_area_positive check (floor_area_m2 is null or floor_area_m2 >= 0),
  constraint buildings_energy_label check (energy_label is null or energy_label in ('A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G'))
);

comment on table building.buildings is
  'A building of a participant, on its ground when that is described: footprint, elevation, height, use, lifecycle (CityGML Building, IfcBuilding). Its floors, rooms, zones and units are spaces, its roof faces and facades surfaces.';

create index buildings_participant_idx on building.buildings (participant_id);
create index buildings_site_idx on building.buildings (site_id);
create index buildings_footprint_idx on building.buildings using gist (footprint);
create trigger buildings_normalize before insert or update of footprint on building.buildings
  for each row execute function normalize_geometry('footprint');
create trigger buildings_participant_id_check before insert or update of participant_id on building.buildings
  for each row execute function parent_check('participant_id', 'participants');
create trigger buildings_site_id_check before insert or update of site_id on building.buildings
  for each row execute function parent_check('site_id', 'building.sites');

-- The ground a building stands on is its participant's.
create or replace function building.buildings_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if new.site_id is not null and (select participant_id from building.sites where id = new.site_id) <> new.participant_id then
    raise exception 'building_site_of_other_participant: the ground is another participant''s' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function building.buildings_check() is
  'BEFORE INSERT / UPDATE on buildings: the ground it stands on is its participant''s (building_site_of_other_participant).';

create trigger buildings_check before insert or update of site_id, participant_id on building.buildings
  for each row execute function building.buildings_check();
create trigger buildings_set_updated_at before update on building.buildings
  for each row execute function set_updated_at();
create index buildings_organisation_idx on building.buildings (organisation_id);
-- One identifier names one building of an organisation: a file is imported once.
create unique index buildings_one_global_id on building.buildings (organisation_id, global_id);
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
  -- Plan outline, when known, and the gross floor area in m².
  geometry         geometry,
  floor_area_m2    numeric(14, 2),
  -- The participant of a project that occupies it (a tenant, a resident,
  -- an owner who lives there): a unit or a floor of a shared building.
  occupant_id      uuid references participants(id) on delete set null,
  source_code      text references sources(code),
  -- The identifier its file gives it: an IFC GlobalId.
  global_id        text,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint spaces_name_not_blank check (btrim(name) <> ''),
  constraint spaces_kind check (kind in ('floor', 'room', 'zone', 'unit')),
  constraint spaces_level_for_floors check ((kind = 'floor') = (level is not null)),
  constraint spaces_floor_at_top check (kind <> 'floor' or parent_id is null),
  constraint spaces_not_own_parent check (parent_id is distinct from id),
  constraint spaces_height_positive check (height_m is null or height_m >= 0),
  constraint spaces_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint spaces_floor_area_positive check (floor_area_m2 is null or floor_area_m2 >= 0)
);

comment on table building.spaces is
  'The spatial structure inside a building, one tree: floors (IfcBuildingStorey, CityGML Storey), rooms (IfcSpace, CityGML BuildingRoom, Brick Room), zones and units, with the participant that occupies one.';

create unique index spaces_one_floor_per_level on building.spaces (building_id, level) where kind = 'floor';
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
create trigger spaces_parent_id_check before insert or update of parent_id on building.spaces
  for each row execute function parent_check('parent_id', 'building.spaces');
create trigger spaces_building_id_check before insert or update of building_id on building.spaces
  for each row execute function parent_check('building_id', 'building.buildings');
create trigger spaces_occupant_id_check before insert or update of occupant_id on building.spaces
  for each row execute function parent_check('occupant_id', 'participants');
create trigger spaces_set_updated_at before update on building.spaces
  for each row execute function set_updated_at();
create index spaces_organisation_idx on building.spaces (organisation_id);
-- One identifier names one space of an organisation: a file is imported once.
create unique index spaces_one_global_id on building.spaces (organisation_id, global_id);
create index spaces_occupant_idx on building.spaces (occupant_id);
call secure_table('building.spaces');

-- ---------------------------------------------------------------------------
-- surfaces — the planar things something is mounted on.
-- ---------------------------------------------------------------------------

create table building.surfaces (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- On a building (a roof face, a facade) or straight on the ground (a
  -- ground area, a car park).
  building_id      uuid references building.buildings(id) on delete cascade,
  site_id          uuid references building.sites(id) on delete cascade,
  name             text not null,
  kind             text not null,
  -- The face itself, as a 3D polygon when it is known, or its plan outline.
  geometry         geometry,
  -- Orientation in degrees: azimuth clockwise from true north (180 = facing
  -- south), tilt from horizontal (0 = flat).
  azimuth_deg      numeric(6, 2),
  tilt_deg         numeric(5, 2),
  -- What a survey or an audit says of it (IFC Qto_RoofBaseQuantities,
  -- Pset_WallCommon): its area in m² when measured, its material, its
  -- thermal transmittance in W/(m²·K), whether it faces outside.
  area_m2          numeric(14, 2),
  material         text,
  u_value          numeric(8, 3),
  is_external      boolean,
  source_code      text references sources(code),
  -- The identifier its file gives it: an IFC GlobalId.
  global_id        text,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint surfaces_name_not_blank check (btrim(name) <> ''),
  constraint surfaces_kind check (kind in ('roof', 'facade', 'ground', 'carport')),
  constraint surfaces_one_host check ((building_id is null) <> (site_id is null)),
  constraint surfaces_azimuth_range check (azimuth_deg is null or (azimuth_deg >= 0 and azimuth_deg < 360)),
  constraint surfaces_tilt_range check (tilt_deg is null or (tilt_deg >= 0 and tilt_deg <= 180)),
  constraint surfaces_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint surfaces_area_positive check (area_m2 is null or area_m2 >= 0),
  constraint surfaces_u_value_positive check (u_value is null or u_value >= 0)
);

comment on table building.surfaces is
  'A roof face, a facade, a ground area or a carport: a planar face of a building or of the ground, with its azimuth and tilt (CityGML RoofSurface / WallSurface).';

create index surfaces_building_idx on building.surfaces (building_id);
create index surfaces_site_idx on building.surfaces (site_id);
create index surfaces_geometry_idx on building.surfaces using gist (geometry);
create trigger surfaces_normalize before insert or update of geometry on building.surfaces
  for each row execute function normalize_geometry('geometry');
create trigger surfaces_building_id_check before insert or update of building_id on building.surfaces
  for each row execute function parent_check('building_id', 'building.buildings');
create trigger surfaces_site_id_check before insert or update of site_id on building.surfaces
  for each row execute function parent_check('site_id', 'building.sites');
create trigger surfaces_set_updated_at before update on building.surfaces
  for each row execute function set_updated_at();
create index surfaces_organisation_idx on building.surfaces (organisation_id);
-- One identifier names one surface of an organisation: a file is imported once.
create unique index surfaces_one_global_id on building.surfaces (organisation_id, global_id);
call secure_table('building.surfaces');

create or replace function building.add_site(
  p_participant_id uuid,
  p_name           text,
  p_geometry       geometry default null,
  p_area_m2        numeric default null,
  p_profile        text default null,
  p_source_code    text default null,
  p_metadata       jsonb default '{}'
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  p    participants%rowtype;
begin
  select * into p from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  insert into building.sites (id, organisation_id, participant_id, name, geometry, area_m2, profile, source_code, metadata)
  values (v_id, p.organisation_id, p_participant_id, p_name, p_geometry, p_area_m2, p_profile, p_source_code,
          coalesce(p_metadata, '{}'));
  return v_id;
end;
$$;

comment on function building.add_site(uuid, text, geometry, numeric, text, text, jsonb) is
  'Describes the ground of a participant: its parcel, its area, its use, with the source it came from. Refuses participant_not_found, invalid_geometry. Returns its id.';

create or replace function building.add_building(
  p_participant_id uuid,
  p_name           text,
  p_footprint      geometry default null,
  p_elevation_m    numeric default null,
  p_height_m       numeric default null,
  p_profile        text default null,
  p_source_code    text default null,
  p_metadata       jsonb default '{}',
  p_site_id        uuid default null,
  p_global_id      text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  p    participants%rowtype;
begin
  select * into p from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  insert into building.buildings (id, organisation_id, participant_id, site_id, name, footprint, elevation_m, height_m, profile, source_code, metadata, global_id)
  values (v_id, p.organisation_id, p_participant_id, p_site_id, p_name, p_footprint, p_elevation_m, p_height_m, p_profile, p_source_code,
          coalesce(p_metadata, '{}'), p_global_id);
  return v_id;
end;
$$;

comment on function building.add_building(uuid, text, geometry, numeric, numeric, text, text, jsonb, uuid, text) is
  'Describes a building of a participant, on its ground when a site is named, with the identifier its source gives it. The metadata carry what the file it was read from says and no column holds. Refuses participant_not_found, building_site_of_other_participant, invalid_geometry. Returns its id.';

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
  p_metadata     jsonb default '{}',
  p_global_id    text default null
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
                      source_code, metadata, global_id)
  values (v_id, b.organisation_id, p_building_id, p_parent_id, p_kind, p_name, p_level, p_geometry, p_elevation_m, p_height_m,
          p_source_code, coalesce(p_metadata, '{}'), p_global_id);
  return v_id;
end;
$$;

comment on function building.add_space(uuid, text, text, uuid, integer, geometry, numeric, numeric, text, jsonb, text) is
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
  p_metadata     jsonb default '{}',
  p_global_id    text default null
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
  select 'building' as kind, b.organisation_id into host from building.buildings b where b.id = p_host_id;
  if not found then
    select 'site' as kind, s.organisation_id into host from building.sites s where s.id = p_host_id;
  end if;
  if host.kind is null then
    raise exception 'surface_host_kind: a surface is on a building or on the ground (a site)' using errcode = 'check_violation';
  end if;
  if p_azimuth_deg is null and p_tilt_deg is null and p_kind in ('roof', 'facade') then
    select * into derived from building.surface_orientation(g);
    if derived.tilt_deg is null then
      raise exception 'orientation_unknown: give an azimuth and a tilt, or a 3D polygon of the face' using errcode = 'invalid_parameter_value';
    end if;
    p_azimuth_deg := derived.azimuth_deg;
    p_tilt_deg := derived.tilt_deg;
  end if;
  insert into building.surfaces (id, organisation_id, building_id, site_id, name, kind, geometry, azimuth_deg, tilt_deg, source_code, metadata, global_id)
  values (v_id, host.organisation_id,
          case when host.kind = 'building' then p_host_id end, case when host.kind = 'site' then p_host_id end,
          p_name, p_kind, g, p_azimuth_deg, p_tilt_deg, p_source_code, coalesce(p_metadata, '{}'), p_global_id);
  return v_id;
end;
$$;

comment on function building.add_surface(uuid, text, text, geometry, numeric, numeric, text, jsonb, text) is
  'Describes a roof face, a facade, a ground area or a carport on a building or on the ground of a participant (a site); a roof or facade without an orientation takes the one of its 3D polygon. Refuses surface_host_kind, orientation_unknown, invalid_geometry. Returns its id.';

-- ---------------------------------------------------------------------------
-- Whose an object is, and what is built above it.
-- ---------------------------------------------------------------------------

-- The participant of a site, a building, a space or a surface, through
-- their foreign keys.
create or replace function building.participant_of(p_kind text, p_id uuid)
returns uuid
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select case p_kind
    when 'site' then (select s.participant_id from building.sites s where s.id = p_id)
    when 'building' then (select b.participant_id from building.buildings b where b.id = p_id)
    when 'space' then (select b.participant_id from building.spaces sp join building.buildings b on b.id = sp.building_id where sp.id = p_id)
    when 'surface' then (select coalesce(s.participant_id, b.participant_id) from building.surfaces f
                           left join building.buildings b on b.id = f.building_id
                           left join building.sites s on s.id = f.site_id where f.id = p_id)
  end;
$$;

comment on function building.participant_of(text, uuid) is
  'The participant a site, a building, a space or a surface belongs to, through their foreign keys.';

-- What is built above an object, nearest first: for a space, the spaces
-- holding it, its building and its ground; for a surface, its building and
-- its ground; for a building, its ground.
create or replace function building.places_of(p_kind text, p_id uuid)
returns table (kind text, object_id uuid)
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive start as (
    select case p_kind when 'space' then (select parent_id from building.spaces where id = p_id) end as space_id
  ),
  up as (
    select sp.id, sp.parent_id, 1 as depth from building.spaces sp join start on sp.id = start.space_id
    union all
    select sp.id, sp.parent_id, up.depth + 1 from building.spaces sp join up on sp.id = up.parent_id
  ),
  host as (
    select case p_kind
             when 'space' then (select building_id from building.spaces where id = p_id)
             when 'surface' then (select building_id from building.surfaces where id = p_id)
           end as building_id
  ),
  places as (
    select 'space'::text as kind, up.id as object_id, up.depth as n from up
    union all
    select 'building', host.building_id, 2000 from host
    union all
    select 'site', case p_kind
                     when 'building' then (select site_id from building.buildings where id = p_id)
                     when 'surface' then (select coalesce(f.site_id, b.site_id) from building.surfaces f
                                            left join building.buildings b on b.id = f.building_id where f.id = p_id)
                     else (select b.site_id from building.buildings b join host on b.id = host.building_id)
                   end, 3000
  )
  select kind, object_id from places where object_id is not null order by n;
$$;

comment on function building.places_of(text, uuid) is
  'What is built above an object, nearest first: a space''s spaces, building and ground; a surface''s building and ground; a building''s ground.';

-- The building an object is in or on: itself, or a space or a surface by
-- their columns.
create or replace function building.building_of(p_kind text, p_id uuid)
returns uuid
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select case p_kind
    when 'building' then (select id from building.buildings where id = p_id)
    else (select object_id from building.places_of(p_kind, p_id) where kind = 'building')
  end;
$$;

comment on function building.building_of(text, uuid) is
  'The building an object (its kind and id) is in or on — itself, a space, a surface. Null when it is in none.';

-- ---------------------------------------------------------------------------
-- What a file says of a device it describes.
-- ---------------------------------------------------------------------------

-- A device read from a building's file (an IFC model, a Home Assistant
-- home) keeps what the file says of it that no column holds — its key, its
-- room, its position, its description — so that an export gives it back as
-- it came. A device is not placed (decision 0026): this is the file's word,
-- not a placement.
insert into property_defs (code, name, description, datatype, applies_to, published_by) values
  ('file_record', 'File record',
   'What the file a device was read from says of it that no column holds, by format: {"ifc": {…}} or {"ha": {…}}.',
   'json', '{device}', 'building');

grant execute on function building.footprint_volume(geometry, numeric, numeric), building.surface_orientation(geometry),
  building.building_volume(uuid), building.participant_of(text, uuid), building.places_of(text, uuid),
  building.building_of(text, uuid),
  building.add_site(uuid, text, geometry, numeric, text, text, jsonb),
  building.add_building(uuid, text, geometry, numeric, numeric, text, text, jsonb, uuid, text),
  building.add_space(uuid, text, text, uuid, integer, geometry, numeric, numeric, text, jsonb, text),
  building.add_surface(uuid, text, text, geometry, numeric, numeric, text, jsonb, text)
  to authenticated, service_role;

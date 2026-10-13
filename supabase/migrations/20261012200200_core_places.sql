-- Nexgen OS — core: scenarios, the object registry, and the places.
--
-- The core names its objects: a project, a site, a building, a surface, a
-- participant, a meter, a device, a sensor. Each is a table with the columns
-- it always has. What every object shares — an id, an organisation, a
-- scenario — is kept once in `objects`, the registry every attachment
-- (attributes, identifiers, links, documents, series, runs) points to. The
-- registry is plumbing: a page reads `from buildings`, never `from objects`.
--
-- Geometry is stored in WGS 84 (EPSG:4326), always three-dimensional, Z in
-- metres above sea level. Any CRS is accepted on the way in. Metric
-- computations project on the fly to the UTM zone of the geometry
-- (`metric_srid`), which works anywhere on earth without a national grid.

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
  -- project, site, building, surface, participant, meter, device, sensor —
  -- and the kinds modules register (floor, space, pv_system…).
  kind             text not null,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now()
);

comment on table objects is
  'One row per object of any kind, with what every attachment needs: its organisation and its scenario. Maintained by the triggers of the named tables; never written by hand.';

create index objects_organisation_idx on objects (organisation_id);

-- BEFORE INSERT / UPDATE / AFTER DELETE on every named table. tg_argv[0] is
-- the kind. Registers the row, keeps organisation fixed and scenario in sync.
create or replace function register_object()
returns trigger
language plpgsql
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

-- BEFORE INSERT / UPDATE: the parent named by tg_argv[1] (a column holding
-- an object id) is in the same organisation, and a parent that exists only
-- in a scenario only holds children of that scenario.
create or replace function parent_check()
returns trigger
language plpgsql
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

-- Declares a named table as a kind of object: registry, parent checks,
-- tags check, updated_at, row level security.
create or replace procedure declare_object(p_table text, p_kind text, p_parents text[] default '{}')
language plpgsql
as $$
declare
  n   text := replace(p_table, '.', '_');
  col text;
begin
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

-- ---------------------------------------------------------------------------
-- Geometry helpers
-- ---------------------------------------------------------------------------

create or replace function metric_srid(p_geom geometry)
returns integer
language sql
immutable
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
as $$
  select round(ST_Area(ST_Transform(ST_Force2D(p_geom), metric_srid(p_geom)))::numeric, 2);
$$;

comment on function area_m2(geometry) is
  'Horizontal (plan) area in square metres of a WGS 84 polygon.';

create or replace function to_core_geometry(p_geom geometry)
returns geometry
language plpgsql
immutable
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
  -- needs SFCGAL; the others are checked on their plan projection.
  if GeometryType(g) not in ('POLYHEDRALSURFACE', 'TIN', 'TRIANGLE') and not ST_IsValid(ST_Force2D(g)) then
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

-- Vertical faces of a footprint between two heights, plus floor and roof:
-- the level-of-detail 1 block. Derived, never stored.
create or replace function footprint_volume(p_footprint geometry, p_base numeric, p_top numeric)
returns geometry
language plpgsql
immutable
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

-- ---------------------------------------------------------------------------
-- projects — a working perimeter.
-- ---------------------------------------------------------------------------

create table projects (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  name             text not null,
  -- What the project is: an energy community, a portfolio, a study, a
  -- construction site, a district plan. Modules refine it.
  kind             text not null default 'study',
  -- ISO 3166-1 alpha-2 of the country whose rules apply. Selects the packs.
  country          char(2) not null,
  -- Perimeter on the map, when it has one.
  geometry         geometry,
  status           text not null default 'simulation',
  start_date       date,
  end_date         date,
  tags             text[] not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint projects_name_not_blank check (btrim(name) <> ''),
  constraint projects_country_format check (country ~ '^[A-Z]{2}$'),
  constraint projects_status check (status in ('simulation', 'creation', 'active', 'inactive', 'archived')),
  constraint projects_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint projects_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint projects_tags_known check (tags_known(tags))
);

comment on table projects is
  'A working perimeter: an energy community, a portfolio, a study, a construction site. Sites take part in it as participants. The same lifecycle as Nexgen: simulation, creation, active, inactive, archived.';

create index projects_geometry_idx on projects using gist (geometry);
create trigger projects_normalize before insert or update of geometry on projects
  for each row execute function normalize_geometry('geometry');
call declare_object('projects', 'project');

-- ---------------------------------------------------------------------------
-- sites — a place with an address.
-- ---------------------------------------------------------------------------

create table sites (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  name             text not null,
  -- ISO 3166-1 alpha-2. Everything on the site inherits it.
  country          char(2) not null,
  -- The address, in the fields every country has (the postal address of
  -- schema.org): the street with its number, a second line for the
  -- building, floor or unit, the postal code, the city. How a country lays
  -- them out on an envelope is the country pack's business.
  street           text,
  address_extra    text,
  postal_code      text,
  city             text,
  -- ISO 3166-2 subdivision, when the country's rules vary by region.
  region           text,
  -- IANA time zone (Europe/Brussels). Daily and monthly readings of the
  -- site's series are cut in it; a site without one has no daily readings.
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
  constraint sites_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint sites_location_precision check (location_precision is null or location_precision in ('rooftop', 'parcel', 'street', 'postal_code', 'city', 'region')),
  constraint sites_tags_known check (tags_known(tags))
);

comment on table sites is
  'A place with an address and a parcel: a house and its garden, a farm, a factory, a school, a field with panels. The unit a person owns, rents or operates, and the thing behind a meter.';

create index sites_geometry_idx on sites using gist (geometry);
create trigger sites_normalize before insert or update of geometry on sites
  for each row execute function normalize_geometry('geometry');
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
  floors_above_ground integer,
  floors_below_ground integer,
  year_of_construction integer,
  status               text not null default 'in_service',
  tags                 text[] not null default '{}',
  scenario_id          uuid references scenarios(id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint buildings_name_not_blank check (btrim(name) <> ''),
  constraint buildings_height_positive check (height_m is null or height_m >= 0),
  constraint buildings_floors check ((floors_above_ground is null or floors_above_ground >= 0) and (floors_below_ground is null or floors_below_ground >= 0)),
  constraint buildings_year check (year_of_construction is null or year_of_construction between 1000 and 2200),
  constraint buildings_status check (status in ('planned', 'under_construction', 'in_service', 'out_of_service', 'demolished')),
  constraint buildings_footprint_core check (footprint is null or (ST_SRID(footprint) = 4326 and ST_NDims(footprint) = 3)),
  constraint buildings_tags_known check (tags_known(tags))
);

comment on table buildings is
  'A building on a site: footprint, elevation, height, floors, use, lifecycle (CityGML Building, IfcBuilding). Floors and spaces come with the architecture module; the 3D files with the 3d module.';

create index buildings_site_idx on buildings (site_id);
create index buildings_footprint_idx on buildings using gist (footprint);
create trigger buildings_normalize before insert or update of footprint on buildings
  for each row execute function normalize_geometry('footprint');
call declare_object('buildings', 'building', '{site_id}');

create or replace function building_volume(p_building_id uuid)
returns geometry
language sql
stable
as $$
  select footprint_volume(b.footprint, coalesce(b.elevation_m, 0), coalesce(b.elevation_m, 0) + b.height_m)
    from buildings b where b.id = p_building_id;
$$;

comment on function building_volume(uuid) is
  'Level-of-detail 1 block of a building: its footprint extruded from its elevation by its height. Derived, never stored.';

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
  -- south), tilt from horizontal (0 = flat).
  azimuth_deg      numeric(6, 2),
  tilt_deg         numeric(5, 2),
  material         text,
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
  'A roof face, a facade, a ground area or a carport: the planar thing a device is mounted on, with its azimuth and tilt (CityGML RoofSurface / WallSurface, Nexgen orientation segments).';

create index surfaces_building_idx on surfaces (building_id);
create index surfaces_site_idx on surfaces (site_id);
create index surfaces_geometry_idx on surfaces using gist (geometry);
create trigger surfaces_normalize before insert or update of geometry on surfaces
  for each row execute function normalize_geometry('geometry');
call declare_object('surfaces', 'surface', '{building_id,site_id}');

-- ---------------------------------------------------------------------------
-- Where an object is, and whose rules apply.
-- ---------------------------------------------------------------------------

-- The site an object belongs to, through its own columns. Modules extend it
-- for the kinds they register by adding a case in their own migration
-- (`create or replace`), always ending in the core kinds.
create or replace function site_of(p_object_id uuid)
returns uuid
language plpgsql
stable
as $$
declare
  k text;
begin
  select kind into k from objects where id = p_object_id;
  return case k
    when 'site'     then p_object_id
    when 'building' then (select site_id from buildings where id = p_object_id)
    when 'surface'  then coalesce((select site_id from surfaces where id = p_object_id),
                                  (select b.site_id from surfaces s join buildings b on b.id = s.building_id where s.id = p_object_id))
    else null
  end;
end;
$$;

comment on function site_of(uuid) is
  'The site an object is on, whatever its kind. Null for an object that is not somewhere (a project).';

create or replace function country_of(p_object_id uuid)
returns char(2)
language sql
stable
as $$
  select coalesce(
    (select country from sites where id = site_of(p_object_id)),
    (select country from projects where id = p_object_id)
  );
$$;

comment on function country_of(uuid) is
  'The country whose rules apply to an object: its site''s, or its own for a project. Selects the country packs.';

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
  footprint_volume(geometry, numeric, numeric), building_volume(uuid), site_of(uuid), country_of(uuid)
  to authenticated, service_role;

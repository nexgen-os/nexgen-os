-- Nexgen OS — core: entities.
--
-- Everything that can be described is an entity: a district, a parcel, a
-- building, a storey, a room, a roof face, a wall, a window, a PV array, an
-- inverter, a heat pump, a charger, a tree, a sensor, a meter, an
-- organisation. What it is comes from `classes`; what is attached to it —
-- values, measurements, tags, identifiers, 3D representations, links to other
-- entities — lives in the tables around it. This is the shape shared by Brick
-- (entity + class + relationships + points), Project Haystack (entity + tags),
-- IFC (IfcObject + property sets + spatial decomposition) and NGSI-LD
-- (entity + properties + relationships).
--
-- Geometry is stored in WGS 84 (EPSG:4326), always three-dimensional, Z in
-- metres above sea level. Any CRS is accepted on the way in. Metric
-- computations project on the fly to the UTM zone of the geometry
-- (`metric_srid`), which works anywhere on earth without a national grid.

-- ---------------------------------------------------------------------------
-- scenarios — the reality, and the variants people design against it.
-- ---------------------------------------------------------------------------

create table scenarios (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  -- A scenario may build on another one (variant B of the extension).
  parent_id     uuid references scenarios(id) on delete restrict,
  name          text not null,
  description   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint scenarios_name_not_blank check (btrim(name) <> '')
);

comment on table scenarios is
  'A design variant. Rows with scenario_id null describe what exists; rows with a scenario_id exist only in that variant (a new building, a PV array, a heat pump, a simulated series).';

create index scenarios_workspace_idx on scenarios (workspace_id);

create trigger scenarios_set_updated_at
  before update on scenarios
  for each row execute function set_updated_at();

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

create or replace function plan_area_m2(p_geom geometry)
returns numeric
language sql
immutable
as $$
  select round(ST_Area(ST_Transform(ST_Force2D(p_geom), metric_srid(p_geom)))::numeric, 2);
$$;

comment on function plan_area_m2(geometry) is
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

-- ---------------------------------------------------------------------------
-- entities
-- ---------------------------------------------------------------------------

create table entities (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  class         text not null references classes(code),
  name          text not null,
  -- Containment: the storey in the building, the room in the storey, the
  -- inverter in the PV system, the sensor in the room. One parent, so the
  -- containment is a tree (IFC spatial decomposition, Brick hasPart). Every
  -- other link is a relationship.
  parent_id     uuid references entities(id) on delete restrict,
  -- ISO 3166-1 alpha-2. Required at the root of a tree of locations,
  -- inherited below it (`entity_country`). Selects the country packs.
  country       char(2),
  -- Main shape: a footprint, a slab, a roof face, a point for a device.
  -- Richer shapes (LoD2 roofs, meshes, BIM models, point clouds, videos)
  -- are representations.
  -- Unconstrained type so that any CRS and any dimension is accepted on the
  -- way in; the trigger normalises and the check below guarantees the result.
  geometry      geometry,
  -- Base altitude above sea level and height above it, in metres. With a
  -- footprint they give a level-of-detail 1 block.
  elevation_m   numeric(9, 3),
  height_m      numeric(9, 3),
  -- Orientation of a planar or oriented thing, in degrees: azimuth clockwise
  -- from true north (180 = facing south), tilt from horizontal (0 = flat).
  azimuth_deg   numeric(6, 2),
  tilt_deg      numeric(5, 2),
  tags          text[] not null default '{}',
  -- Null = as it exists. Set = only in that design scenario.
  scenario_id   uuid references scenarios(id) on delete cascade,
  -- Lifecycle in the real world: planned, under construction, in service,
  -- out of service, demolished. Free of any country meaning.
  status        text not null default 'in_service',
  -- Incremented on every change, for optimistic concurrency and sync.
  revision      integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint entities_name_not_blank check (btrim(name) <> ''),
  constraint entities_not_own_parent check (parent_id is distinct from id),
  constraint entities_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  constraint entities_height_positive check (height_m is null or height_m >= 0),
  constraint entities_azimuth_range check (azimuth_deg is null or (azimuth_deg >= 0 and azimuth_deg < 360)),
  constraint entities_tilt_range check (tilt_deg is null or (tilt_deg >= 0 and tilt_deg <= 180)),
  constraint entities_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint entities_status check (status in ('planned', 'under_construction', 'in_service', 'out_of_service', 'demolished'))
);

comment on table entities is
  'Everything that can be described — places, building elements, equipment, sensors, agents — in one table. What it is comes from classes; what is attached to it lives around it.';
comment on column entities.geometry is
  'Main shape in EPSG:4326, three-dimensional (Z = metres above sea level). Any CRS is accepted on the way in.';

create index entities_workspace_idx on entities (workspace_id);
create index entities_parent_idx on entities (parent_id);
create index entities_class_idx on entities (class);
create index entities_scenario_idx on entities (scenario_id);
create index entities_tags_idx on entities using gin (tags);
create index entities_geometry_idx on entities using gist (geometry);

create trigger entities_set_updated_at
  before update on entities
  for each row execute function set_updated_at();

create or replace function entities_bump_revision()
returns trigger
language plpgsql
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

create trigger entities_bump_revision
  before update on entities
  for each row execute function entities_bump_revision();

-- The containment stays a tree of the same workspace, follows the class
-- rules, does not cross scenarios, and the tags are known.
create or replace function entities_check()
returns trigger
language plpgsql
as $$
declare
  parent      entities%rowtype;
  allowed     text[];
  cursor_id   uuid;
  depth       int := 0;
  unknown_tag text;
begin
  new.geometry := to_core_geometry(new.geometry);

  -- Containment rules come from the nearest class that states some.
  with recursive up as (
    select code, parent_code, allowed_parents, 0 as d from classes where code = new.class
    union all
    select c.code, c.parent_code, c.allowed_parents, up.d + 1
      from classes c join up on c.code = up.parent_code
     where cardinality(up.allowed_parents) = 0
  )
  select allowed_parents into allowed from up where cardinality(allowed_parents) > 0 order by d limit 1;

  if new.parent_id is not null then
    select * into parent from entities where id = new.parent_id;
    if parent.workspace_id <> new.workspace_id then
      raise exception 'entity_parent_other_workspace' using errcode = 'check_violation';
    end if;
    if allowed is not null and not exists (
      select 1 from unnest(allowed) a where a <> '' and class_is_a(parent.class, a)
    ) then
      raise exception 'entity_class_not_allowed_under: a % cannot be contained in a %', new.class, parent.class
        using errcode = 'check_violation';
    end if;
    if parent.scenario_id is not null and parent.scenario_id is distinct from new.scenario_id then
      raise exception 'entity_parent_in_other_scenario' using errcode = 'check_violation';
    end if;
    cursor_id := new.parent_id;
    while cursor_id is not null loop
      if cursor_id = new.id then
        raise exception 'entity_containment_cycle' using errcode = 'check_violation';
      end if;
      depth := depth + 1;
      if depth > 64 then
        raise exception 'entity_tree_too_deep' using errcode = 'check_violation';
      end if;
      select e.parent_id into cursor_id from entities e where e.id = cursor_id;
    end loop;
  elsif allowed is not null and not '' = any (allowed) then
    raise exception 'entity_needs_parent: a % is contained in one of %', new.class, allowed
      using errcode = 'check_violation';
  end if;

  if new.parent_id is null and new.country is null and class_is_a(new.class, 'location') then
    raise exception 'entity_root_location_needs_country' using errcode = 'check_violation';
  end if;

  select t into unknown_tag from unnest(new.tags) t where not exists (select 1 from tags where code = t) limit 1;
  if unknown_tag is not null then
    raise exception 'unknown_tag: %', unknown_tag using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger entities_check
  before insert or update of class, parent_id, workspace_id, scenario_id, country, geometry, tags on entities
  for each row execute function entities_check();

create or replace function entity_country(p_entity_id uuid)
returns char(2)
language sql
stable
as $$
  with recursive up as (
    select id, parent_id, country, 0 as depth from entities where id = p_entity_id
    union all
    select e.id, e.parent_id, e.country, up.depth + 1
      from entities e join up on e.id = up.parent_id
     where up.country is null
  )
  select country from up where country is not null order by depth limit 1;
$$;

comment on function entity_country(uuid) is
  'Country of an entity: its own, or the nearest ancestor''s. Selects the country packs that apply.';

-- Everything an entity contains, at any depth, itself included.
create or replace function entity_subtree(p_entity_id uuid)
returns table (id uuid, depth int)
language sql
stable
as $$
  with recursive down as (
    select e.id, 0 as depth from entities e where e.id = p_entity_id
    union all
    select e.id, down.depth + 1 from entities e join down on e.parent_id = down.id
  )
  select id, depth from down;
$$;

comment on function entity_subtree(uuid) is
  'The entity and everything it contains, at any depth.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table scenarios enable row level security;
alter table entities enable row level security;

create policy scenarios_select on scenarios
  for select to authenticated using (can_read_workspace(workspace_id));
create policy scenarios_write on scenarios
  for all to authenticated
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id));

create policy entities_select on entities
  for select to authenticated using (can_read_workspace(workspace_id));
create policy entities_write on entities
  for all to authenticated
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id));

grant select, insert, update, delete on scenarios, entities to authenticated, service_role;
grant execute on function metric_srid(geometry), plan_area_m2(geometry), to_core_geometry(geometry),
  entity_country(uuid), entity_subtree(uuid) to authenticated, service_role;

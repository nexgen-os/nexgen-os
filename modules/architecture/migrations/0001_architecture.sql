-- Nexgen OS — module `architecture`: the inside of a building.
--
-- Storeys and spaces are the spatial structure of IFC (IfcBuildingStorey,
-- IfcSpace) and CityGML 3.0 (Storey, BuildingRoom). The core stops at the
-- building and its surfaces; this module adds what architects, facility
-- managers and building automation need inside it. Each table registers its
-- rows as objects, so that attributes, sensors, series, documents and runs
-- attach to a storey or a space like to anything else.

create schema architecture;
grant usage on schema architecture to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storeys
-- ---------------------------------------------------------------------------

create table architecture.storeys (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  building_id      uuid not null references buildings(id) on delete cascade,
  name             text not null,
  -- 0 is the ground floor, negative below ground.
  level            integer not null,
  elevation_m      numeric(9, 3),
  height_m         numeric(9, 3),
  tags             text[] not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint storeys_name_not_blank check (btrim(name) <> ''),
  constraint storeys_height_positive check (height_m is null or height_m >= 0),
  constraint storeys_tags_known check (tags_known(tags))
);

comment on table architecture.storeys is
  'A level of a building (IfcBuildingStorey, CityGML Storey).';

create unique index storeys_one_level on architecture.storeys (building_id, level, scenario_id) nulls not distinct;
create index storeys_building_idx on architecture.storeys (building_id);
call declare_object('architecture.storeys', 'storey', '{building_id}');

-- ---------------------------------------------------------------------------
-- spaces
-- ---------------------------------------------------------------------------

create table architecture.spaces (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  storey_id        uuid not null references architecture.storeys(id) on delete cascade,
  name             text not null,
  -- room: a bounded room; zone: a grouping (a thermal zone, a tenant lot,
  -- a fire compartment); unit: a flat, a shop, an office let as a whole.
  kind             text not null default 'room',
  -- Plan outline, when known.
  geometry         geometry,
  area_m2          numeric(10, 2),
  height_m         numeric(9, 3),
  tags             text[] not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint spaces_name_not_blank check (btrim(name) <> ''),
  constraint spaces_kind check (kind in ('room', 'zone', 'unit')),
  constraint spaces_area_positive check (area_m2 is null or area_m2 >= 0),
  constraint spaces_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint spaces_tags_known check (tags_known(tags))
);

comment on table architecture.spaces is
  'A room, a zone or a unit on a storey (IfcSpace, CityGML BuildingRoom, Brick Space).';

create index spaces_storey_idx on architecture.spaces (storey_id);
create index spaces_geometry_idx on architecture.spaces using gist (geometry);
create trigger architecture_spaces_normalize before insert or update of geometry on architecture.spaces
  for each row execute function normalize_geometry('geometry');
call declare_object('architecture.spaces', 'space', '{storey_id}');

-- ---------------------------------------------------------------------------
-- Where a storey or a space is.
-- ---------------------------------------------------------------------------

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
    when 'site'        then p_object_id
    when 'building'    then (select site_id from buildings where id = p_object_id)
    when 'surface'     then coalesce((select site_id from surfaces where id = p_object_id),
                                     (select b.site_id from surfaces s join buildings b on b.id = s.building_id where s.id = p_object_id))
    when 'meter'       then (select site_id from meters where id = p_object_id)
    when 'participant' then (select site_id from participants where id = p_object_id)
    when 'device'      then (select site_id from devices where id = p_object_id)
    when 'sensor'      then site_of((select host_id from sensors where id = p_object_id))
    when 'storey'      then (select b.site_id from architecture.storeys s join buildings b on b.id = s.building_id where s.id = p_object_id)
    when 'space'       then site_of((select storey_id from architecture.spaces where id = p_object_id))
    else null
  end;
end;
$$;

-- The building a storey or a space is in, and the spaces of a building.
create or replace function architecture.building_of(p_object_id uuid)
returns uuid
language sql
stable
as $$
  select coalesce(
    (select building_id from architecture.storeys where id = p_object_id),
    (select s.building_id from architecture.spaces sp join architecture.storeys s on s.id = sp.storey_id where sp.id = p_object_id),
    (select id from buildings where id = p_object_id)
  );
$$;

grant execute on function architecture.building_of(uuid) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('architecture', 'Architecture', '0.1.0', 'architecture', '0.1.0', 'Storeys and spaces inside a building, after IFC and CityGML.');

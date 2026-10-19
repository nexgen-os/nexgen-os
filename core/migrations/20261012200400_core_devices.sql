-- Nexgen OS — core: devices and the products they are instances of.
--
-- A device is a thing installed somewhere: a PV system on a roof face, a
-- battery in a plant room, a charger on a car park, a heat pump, a meter, a
-- thermometer in a classroom. The instrument that measures is a device; the
-- values it reports — or is asked to reach — are series (Brick Equipment and
-- Point, Haystack equip and point, SensorThings Sensor and Datastream). The
-- core keeps what every device has. A module derives the types it owns into
-- its own table, with the same id (`solar.pv_systems`): a page reads
-- `from devices join solar.pv_systems using (id)`.
--
-- A device is placed by four columns, from the coarsest to the finest: its
-- site, the building it is in, the space it is in, the surface it is mounted
-- on. Each names a place of the one above. Where a device is behind a
-- meter, the grid module says so with a link.

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- device_directory — the products a device can be an instance of.
-- ---------------------------------------------------------------------------

create table device_directory (
  id                uuid primary key default gen_random_uuid(),
  -- Null: shared by every organisation (published by a module or a pack).
  organisation_id   uuid references organisations(id) on delete cascade,
  device_type       text not null references device_types(code),
  manufacturer      text not null,
  model_ref         text not null,
  unit_power_kw     numeric(12, 3),
  unit_capacity_kwh numeric(12, 3),
  unit_surface_m2   numeric(10, 3),
  unit_price        numeric(14, 2),
  currency          char(3),
  datasheet_url     text,
  metadata          jsonb not null default '{}',
  published_by      text not null default 'core',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint device_directory_currency check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint device_directory_price_needs_currency check (unit_price is null or currency is not null)
);

comment on table device_directory is
  'Catalogue of products: manufacturer, model, unit power or capacity, price. Shared rows (organisation_id null) come from modules and packs; an organisation adds its own.';

create unique index device_directory_one_model on device_directory (organisation_id, manufacturer, model_ref) nulls not distinct;

create trigger device_directory_set_updated_at
  before update on device_directory
  for each row execute function set_updated_at();

alter table device_directory enable row level security;
create policy device_directory_select on device_directory
  for select to authenticated using (organisation_id is null or can_read_organisation(organisation_id));
create policy device_directory_write on device_directory
  for all to authenticated
  using (organisation_id is not null and can_write_organisation(organisation_id))
  with check (organisation_id is not null and can_write_organisation(organisation_id));
grant select, insert, update, delete on device_directory to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------

create table devices (
  id                uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id   uuid not null references organisations(id) on delete cascade,
  -- Where it is: on a site; in a building of it; in a space of that
  -- building; on a surface of the building or of the site.
  site_id           uuid not null references sites(id) on delete cascade,
  building_id       uuid references buildings(id) on delete set null,
  space_id          uuid references spaces(id) on delete set null,
  surface_id        uuid references surfaces(id) on delete set null,
  name              text not null,
  device_type       text not null references device_types(code),
  directory_id      uuid references device_directory(id) on delete set null,
  manufacturer      text,
  model             text,
  serial_number     text,
  -- Rated power, the one figure every device has. Capacities, efficiencies
  -- and the rest are the module's.
  rated_power_kw    numeric(12, 3),
  unit_count        integer not null default 1,
  -- A point, or the area it covers (a module layout, a ground array).
  geometry          geometry,
  status            text not null default 'in_service',
  installation_date date,
  -- The day it was taken out; its series take no value after it.
  removal_date      date,
  -- Where the description comes from (a model file, a survey, a register).
  source_code       text references sources(code),
  tags              text[] not null default '{}',
  -- What a source knows about it beyond these columns (a Home Assistant
  -- device's identifiers, a connector's handle). Extensions only.
  metadata          jsonb not null default '{}',
  scenario_id       uuid references scenarios(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint devices_name_not_blank check (btrim(name) <> ''),
  constraint devices_power_positive check (rated_power_kw is null or rated_power_kw >= 0),
  constraint devices_unit_count_positive check (unit_count > 0),
  constraint devices_status check (status in ('planned', 'installed', 'in_service', 'out_of_service', 'removed')),
  constraint devices_removed_dated check ((status = 'removed') = (removal_date is not null)),
  constraint devices_dates check (removal_date is null or installation_date is null or removal_date >= installation_date),
  constraint devices_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint devices_tags_known check (tags_known(tags))
);

comment on table devices is
  'A thing installed on a site, in a building, in a space or on a surface: a PV system, a battery, a charger, a heat pump, a meter, a thermometer. The instrument that measures is a device; what it measures is a series. A module derives its own types into a table with the same id.';

create index devices_site_idx on devices (site_id);
create index devices_building_idx on devices (building_id);
create index devices_space_idx on devices (space_id);
create index devices_surface_idx on devices (surface_id);
create index devices_type_idx on devices (device_type);
create index devices_geometry_idx on devices using gist (geometry);

-- The places a device names fit inside each other: the building is on its
-- site, the space in that building, the surface on that building or on the
-- site. A space or a surface given without its building gives the building.
create or replace function devices_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_building uuid;
  v_site     uuid;
begin
  if new.surface_id is not null then
    select f.building_id, coalesce(f.site_id, b.site_id) into v_building, v_site
      from surfaces f left join buildings b on b.id = f.building_id where f.id = new.surface_id;
    if v_site <> new.site_id then
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
      from spaces sp join buildings b on b.id = sp.building_id where sp.id = new.space_id;
    if v_site <> new.site_id then
      raise exception 'device_space_site_mismatch: the space is not on the device''s site' using errcode = 'check_violation';
    end if;
    if new.building_id is null then
      new.building_id := v_building;
    elsif v_building <> new.building_id then
      raise exception 'device_space_building_mismatch: the space is not in the device''s building' using errcode = 'check_violation';
    end if;
  end if;
  if new.building_id is not null and (select site_id from buildings where id = new.building_id) <> new.site_id then
    raise exception 'device_building_site_mismatch: the building is not on the device''s site' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function devices_check() is
  'BEFORE INSERT / UPDATE on devices: building on the site, space in the building, surface on the building or the site; fills the building from the space or the surface.';

create trigger devices_normalize before insert or update of geometry on devices
  for each row execute function normalize_geometry('geometry');
create trigger devices_check before insert or update of site_id, building_id, space_id, surface_id on devices
  for each row execute function devices_check();
call declare_object('devices', 'device', '{space_id,surface_id,building_id,site_id}');

-- A module table that derives devices of a type: same id, one row per
-- device, only for devices of that type (or a refinement of it). Declared by
-- the module's migration; the check and the cascade come with it.
create or replace function derived_device_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  t text;
begin
  select device_type into t from devices where id = new.id;
  if t is null then
    raise exception 'device_not_found: %', new.id using errcode = 'foreign_key_violation';
  end if;
  if not device_type_is_a(t, tg_argv[0]) then
    raise exception 'device_type_mismatch: % is a %, not a %', new.id, t, tg_argv[0]
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function derived_device_check() is
  'Trigger of a module''s derived table: the device exists and is of the type the table derives (device_type_mismatch).';

create or replace procedure derive_devices(p_table text, p_device_type text)
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  execute format('alter table %s add constraint %I foreign key (id) references devices(id) on delete cascade',
                 p_table, replace(p_table, '.', '_') || '_device_fk');
  execute format('create trigger %I before insert or update of id on %s for each row execute function derived_device_check(%L)',
                 replace(p_table, '.', '_') || '_type_check', p_table, p_device_type);
end;
$$;

comment on procedure derive_devices(text, text) is
  'Declares a module table as the derivation of devices of one type: `call derive_devices(''solar.pv_systems'', ''solar'')`.';

-- ---------------------------------------------------------------------------
-- Gestures
--
-- A placement is one JSON object: {"building_id", "space_id", "surface_id",
-- "geometry"} (GeoJSON), each optional; the site is the device's own.
-- ---------------------------------------------------------------------------

create or replace function install_device(
  p_site_id         uuid,
  p_device_type     text,
  p_name            text,
  p_placement       jsonb default '{}',
  p_directory_id    uuid default null,
  p_rated_power_kw  numeric default null,
  p_installed_on    date default null,
  p_source_code     text default null,
  p_unit_count      integer default 1,
  p_scenario_id     uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  s    sites%rowtype;
  p    device_directory%rowtype;
begin
  select * into s from sites where id = p_site_id;
  if not found then
    raise exception 'site_not_found: %', p_site_id using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from device_types where code = p_device_type) then
    raise exception 'device_type_unknown: %', p_device_type using errcode = 'foreign_key_violation';
  end if;
  if p_directory_id is not null then
    select * into p from device_directory where id = p_directory_id;
    if not found then
      raise exception 'product_not_found: %', p_directory_id using errcode = 'no_data_found';
    end if;
  end if;
  insert into devices (id, organisation_id, site_id, building_id, space_id, surface_id, geometry, name, device_type,
                       directory_id, manufacturer, model, rated_power_kw, unit_count, installation_date, source_code,
                       status, scenario_id)
  values (v_id, s.organisation_id, p_site_id,
          (p_placement->>'building_id')::uuid, (p_placement->>'space_id')::uuid, (p_placement->>'surface_id')::uuid,
          case when jsonb_typeof(p_placement->'geometry') = 'object' then ST_GeomFromGeoJSON(p_placement->'geometry') end,
          p_name, p_device_type, p_directory_id, p.manufacturer, p.model_ref,
          coalesce(p_rated_power_kw, p.unit_power_kw * p_unit_count), p_unit_count, p_installed_on, p_source_code,
          case when p_installed_on is null or p_installed_on > current_date then 'planned' else 'in_service' end,
          coalesce(p_scenario_id, s.scenario_id));
  return v_id;
end;
$$;

comment on function install_device(uuid, text, text, jsonb, uuid, numeric, date, text, integer, uuid) is
  'Installs a device on a site, placed in a building, a space or on a surface, as an instance of a product when one is named (its manufacturer, model and power by default). Planned until its installation date. Refuses device_type_unknown and the device_*_mismatch of its placement. Returns its id.';

-- The placement a device leaves is kept as a dated `placed_in` link to the
-- finest place it had, so where it was stays readable.
create or replace function move_device(p_device_id uuid, p_placement jsonb, p_at timestamptz default now())
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  d    devices%rowtype;
  old  uuid;
begin
  select * into d from devices where id = p_device_id;
  if not found then
    raise exception 'device_not_found: %', p_device_id using errcode = 'no_data_found';
  end if;
  if d.status = 'removed' then
    raise exception 'device_retired: % was removed on %', d.name, d.removal_date using errcode = 'check_violation';
  end if;
  old := coalesce(d.space_id, d.surface_id, d.building_id, d.site_id);
  insert into links (subject_id, type_code, object_id, valid_from, valid_to, scenario_id)
  values (p_device_id, 'placed_in', old, d.installation_date, p_at, d.scenario_id)
  on conflict do nothing;
  update devices set
    building_id = (p_placement->>'building_id')::uuid,
    space_id    = (p_placement->>'space_id')::uuid,
    surface_id  = (p_placement->>'surface_id')::uuid,
    geometry    = case when jsonb_typeof(p_placement->'geometry') = 'object' then ST_GeomFromGeoJSON(p_placement->'geometry') else geometry end
   where id = p_device_id;
end;
$$;

comment on function move_device(uuid, jsonb, timestamptz) is
  'Moves a device on its site to a new building, space or surface; the place it leaves is kept as a placed_in link ending at that moment. Refuses device_retired.';

create or replace function retire_device(p_device_id uuid, p_on date default current_date)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  d devices%rowtype;
begin
  select * into d from devices where id = p_device_id;
  if not found then
    raise exception 'device_not_found: %', p_device_id using errcode = 'no_data_found';
  end if;
  if d.status = 'removed' then
    raise exception 'device_retired: % was removed on %', d.name, d.removal_date using errcode = 'check_violation';
  end if;
  update devices set status = 'removed', removal_date = p_on where id = p_device_id;
end;
$$;

comment on function retire_device(uuid, date) is
  'Takes a device out on a day: status removed, removal date set; its series take no value after it. Refuses device_retired.';

-- A meter swapped, an inverter changed: a new device in the same place,
-- linked to the one it replaces, which is retired the same day.
create or replace function replace_device(
  p_device_id      uuid,
  p_on             date default current_date,
  p_directory_id   uuid default null,
  p_name           text default null,
  p_serial_number  text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  d     devices%rowtype;
  p     device_directory%rowtype;
  v_id  uuid := gen_random_uuid();
begin
  select * into d from devices where id = p_device_id;
  if not found then
    raise exception 'device_not_found: %', p_device_id using errcode = 'no_data_found';
  end if;
  if d.status = 'removed' then
    raise exception 'device_retired: % was removed on %', d.name, d.removal_date using errcode = 'check_violation';
  end if;
  if p_directory_id is not null then
    select * into p from device_directory where id = p_directory_id;
  end if;
  insert into devices (id, organisation_id, site_id, building_id, space_id, surface_id, geometry, name, device_type,
                       directory_id, manufacturer, model, serial_number, rated_power_kw, unit_count, installation_date,
                       status, source_code, tags, scenario_id)
  values (v_id, d.organisation_id, d.site_id, d.building_id, d.space_id, d.surface_id, d.geometry, coalesce(p_name, d.name),
          d.device_type, coalesce(p_directory_id, d.directory_id), coalesce(p.manufacturer, d.manufacturer),
          coalesce(p.model_ref, d.model), p_serial_number,
          coalesce(p.unit_power_kw * d.unit_count, d.rated_power_kw), d.unit_count, p_on,
          case when p_on > current_date then 'planned' else 'in_service' end, d.source_code, d.tags, d.scenario_id);
  update devices set status = 'removed', removal_date = p_on where id = p_device_id;
  insert into links (subject_id, type_code, object_id, valid_from, scenario_id)
  values (v_id, 'replaces', p_device_id, p_on, d.scenario_id);
  return v_id;
end;
$$;

comment on function replace_device(uuid, date, uuid, text, text) is
  'Replaces a device on a day: a new device in the same place (of another product when one is named), a replaces link to the old one, which is retired. Refuses device_retired. Returns the new id.';

grant execute on function derived_device_check() to service_role;
grant execute on function install_device(uuid, text, text, jsonb, uuid, numeric, date, text, integer, uuid),
  move_device(uuid, jsonb, timestamptz), retire_device(uuid, date), replace_device(uuid, date, uuid, text, text)
  to authenticated, service_role;

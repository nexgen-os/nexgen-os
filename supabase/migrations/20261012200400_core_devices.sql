-- Nexgen OS — core: devices and sensors.
--
-- A device is a thing installed somewhere: a PV system on a roof face, a
-- battery in a plant room, a charger on a car park, a heat pump, a meter.
-- The core keeps what every device has. A module derives the types it owns
-- into its own table, with the same id (`energy.pv_systems`,
-- `energy.batteries`, `heating.heat_pumps`): a page reads
-- `from devices join energy.pv_systems using (id)`.
--
-- A sensor is a measurable or controllable point of a device, a meter, a
-- building or a site: what it observes, in which unit, read or written
-- (Brick Point, Home Assistant entity). Its values are a series.

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
  site_id           uuid not null references sites(id) on delete cascade,
  -- Where on the site, when known: in a building, on a surface.
  building_id       uuid references buildings(id) on delete set null,
  surface_id        uuid references surfaces(id) on delete set null,
  -- The connection point it is behind. Null for a device off the grid, or
  -- not yet attached.
  meter_id          uuid references meters(id) on delete set null,
  name              text not null,
  device_type       text not null references device_types(code),
  directory_id      uuid references device_directory(id) on delete set null,
  manufacturer      text,
  model             text,
  serial_number     text,
  -- Rated power, the one figure every device has. Capacities, efficiencies
  -- and the rest are the module's.
  power_kw          numeric(12, 3),
  unit_count        integer not null default 1,
  -- A point, or the area it covers (a module layout, a ground array).
  geometry          geometry,
  status            text not null default 'in_service',
  installation_date date,
  tags              text[] not null default '{}',
  scenario_id       uuid references scenarios(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint devices_name_not_blank check (btrim(name) <> ''),
  constraint devices_power_positive check (power_kw is null or power_kw >= 0),
  constraint devices_unit_count_positive check (unit_count > 0),
  constraint devices_status check (status in ('planned', 'installed', 'in_service', 'out_of_service', 'removed')),
  constraint devices_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint devices_tags_known check (tags_known(tags))
);

comment on table devices is
  'A thing installed on a site: a PV system, a battery, a charger, a heat pump, a meter, a sensor box. What every device has; a module derives its own types into a table with the same id.';

create index devices_site_idx on devices (site_id);
create index devices_surface_idx on devices (surface_id);
create index devices_meter_idx on devices (meter_id);
create index devices_type_idx on devices (device_type);
create index devices_geometry_idx on devices using gist (geometry);

-- The building, the surface and the meter a device names are on its site.
create or replace function devices_check()
returns trigger
language plpgsql
as $$
begin
  if new.building_id is not null and site_of(new.building_id) <> new.site_id then
    raise exception 'device_building_site_mismatch' using errcode = 'check_violation';
  end if;
  if new.surface_id is not null and site_of(new.surface_id) <> new.site_id then
    raise exception 'device_surface_site_mismatch' using errcode = 'check_violation';
  end if;
  if new.meter_id is not null and site_of(new.meter_id) <> new.site_id then
    raise exception 'device_meter_site_mismatch' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger devices_normalize before insert or update of geometry on devices
  for each row execute function normalize_geometry('geometry');
create trigger devices_check before insert or update of site_id, building_id, surface_id, meter_id on devices
  for each row execute function devices_check();
call declare_object('devices', 'device', '{site_id,building_id,surface_id,meter_id}');

-- A module table that derives devices of a type: same id, one row per
-- device, only for devices of that type (or a refinement of it). Declared by
-- the module's migration; the check and the cascade come with it.
create or replace function derived_device_check()
returns trigger
language plpgsql
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

create or replace procedure derive_devices(p_table text, p_device_type text)
language plpgsql
as $$
begin
  execute format('alter table %s add constraint %I foreign key (id) references devices(id) on delete cascade',
                 p_table, replace(p_table, '.', '_') || '_device_fk');
  execute format('create trigger %I before insert or update of id on %s for each row execute function derived_device_check(%L)',
                 replace(p_table, '.', '_') || '_type_check', p_table, p_device_type);
end;
$$;

comment on procedure derive_devices(text, text) is
  'Declares a module table as the derivation of devices of one type: `call derive_devices(''energy.pv_systems'', ''solar'')`.';

-- ---------------------------------------------------------------------------
-- sensors — points.
-- ---------------------------------------------------------------------------

create table sensors (
  id               uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- What it is a point of: a device, a meter, a building, a site, or an
  -- object a module registers (a space). Any object.
  host_id          uuid not null references objects(id) on delete cascade,
  name             text not null,
  quantity_code    text not null references quantities(code),
  -- sensor: measures; setpoint: a target asked of a device; command: an
  -- order sent to it. Setpoints and commands are written to.
  kind             text not null default 'sensor',
  -- How a connector finds it: a Modbus register, an MQTT topic, an API path.
  external_ref     text,
  tags             text[] not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sensors_name_not_blank check (btrim(name) <> ''),
  constraint sensors_kind check (kind in ('sensor', 'setpoint', 'command')),
  constraint sensors_tags_known check (tags_known(tags))
);

comment on table sensors is
  'A measurable or controllable point of an object: a temperature in a room, the power of an inverter, the setpoint of a heat pump (Brick Point, Home Assistant entity). Its values are a series.';

create index sensors_host_idx on sensors (host_id);
call declare_object('sensors', 'sensor', '{host_id}');

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
    else null
  end;
end;
$$;

grant execute on function derived_device_check() to service_role;

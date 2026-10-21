-- Nexgen OS — core: devices and the products they are instances of.
--
-- A device is a thing installed on a site: a PV system, a battery, a
-- charger on a car park, a heat pump, a meter, a thermometer. The instrument that measures is a device; the
-- values it reports — or is asked to reach — are series (Brick Equipment and
-- Point, Haystack equip and point, SensorThings Sensor and Datastream). The
-- core keeps what every device has. A module derives the types it owns into
-- its own table, with the same id (`solar.pv_systems`): a page reads
-- `from devices join solar.pv_systems using (id)`.
--
-- The core knows the site a device is on and the connection point it is
-- behind, a meter of its own site; an instrument that measures nothing on
-- the grid side (a weather station) has none. The column is the truth of
-- today: the meter a device leaves is kept as a dated `behind_meter` link.
-- Where on the site it is — the building, the room, the roof face — is the
-- physical description of the place, the `building` module's (decision 0026).

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
  -- The site it is on.
  site_id           uuid not null references sites(id) on delete cascade,
  -- The connection point it is behind, on its site.
  meter_id          uuid references meters(id) on delete set null,
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
  'A thing installed on a site, behind a meter of it: a PV system, a battery, a charger, a heat pump, a meter, a thermometer. The instrument that measures is a device; what it measures is a series. A module derives its own types into a table with the same id; the building module says where on the site it is.';

create index devices_site_idx on devices (site_id);
create index devices_meter_idx on devices (meter_id);
create index devices_type_idx on devices (device_type);
create index devices_geometry_idx on devices using gist (geometry);

-- The meter a device is behind is on its site.
create or replace function devices_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if new.meter_id is not null and (select site_id from meters where id = new.meter_id) <> new.site_id then
    raise exception 'device_meter_site_mismatch: the meter is not on the device''s site' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function devices_check() is
  'BEFORE INSERT / UPDATE on devices: the meter it is behind is on its site (device_meter_site_mismatch).';

create trigger devices_normalize before insert or update of geometry on devices
  for each row execute function normalize_geometry('geometry');
create trigger devices_check before insert or update of site_id, meter_id on devices
  for each row execute function devices_check();
call declare_object('devices', 'device', '{site_id,meter_id}');

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
-- ---------------------------------------------------------------------------

create or replace function install_device(
  p_site_id         uuid,
  p_device_type     text,
  p_name            text,
  -- The point, or the area it covers, as GeoJSON.
  p_geometry        jsonb default null,
  p_directory_id    uuid default null,
  p_rated_power_kw  numeric default null,
  p_installed_on    date default null,
  p_source_code     text default null,
  p_unit_count      integer default 1,
  p_scenario_id     uuid default null,
  p_nameplate       jsonb default '{}',
  p_metadata        jsonb default '{}',
  p_status          text default null,
  p_meter_id        uuid default null
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
  if p_geometry is not null and p_geometry <> '{}'::jsonb and not (jsonb_typeof(p_geometry) = 'object' and p_geometry ? 'type') then
    raise exception 'invalid_geometry: the geometry of a device is a GeoJSON geometry' using errcode = 'invalid_parameter_value';
  end if;
  insert into devices (id, organisation_id, site_id, meter_id, geometry, name, device_type,
                       directory_id, manufacturer, model, serial_number, rated_power_kw, unit_count, installation_date, source_code,
                       status, metadata, scenario_id)
  values (v_id, s.organisation_id, p_site_id, p_meter_id,
          case when p_geometry ? 'type' then ST_GeomFromGeoJSON(p_geometry) end,
          p_name, p_device_type, p_directory_id,
          coalesce(p.manufacturer, p_nameplate->>'manufacturer'), coalesce(p.model_ref, p_nameplate->>'model'), p_nameplate->>'serial_number',
          coalesce(p_rated_power_kw, p.unit_power_kw * p_unit_count), p_unit_count, p_installed_on, p_source_code,
          coalesce(p_status, case when p_installed_on is null or p_installed_on > current_date then 'planned' else 'in_service' end),
          coalesce(p_metadata, '{}'), coalesce(p_scenario_id, s.scenario_id));
  return v_id;
end;
$$;

comment on function install_device(uuid, text, text, jsonb, uuid, numeric, date, text, integer, uuid, jsonb, jsonb, text, uuid) is
  'Installs a device on a site, at a GeoJSON point or area when one is given, behind a meter of the site when one is named, as an instance of a product when one is named (its manufacturer, model and power by default), else with the manufacturer, model and serial number of its nameplate; the metadata carry what the file it was read from says and no column holds. In the status given, else planned until its installation date. Refuses device_type_unknown, invalid_geometry, device_meter_site_mismatch. Returns its id.';

-- The meter a device leaves is kept as a dated `behind_meter` link, so the
-- connection point it was behind stays readable; null disconnects it.
create or replace function connect_device(p_device_id uuid, p_meter_id uuid, p_on date default current_date)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  d       devices%rowtype;
  v_since date;
begin
  select * into d from devices where id = p_device_id;
  if not found then
    raise exception 'device_not_found: %', p_device_id using errcode = 'no_data_found';
  end if;
  if d.status = 'removed' then
    raise exception 'device_retired: % was removed on %', d.name, d.removal_date using errcode = 'check_violation';
  end if;
  if d.meter_id is not distinct from p_meter_id then
    return;
  end if;
  if d.meter_id is not null then
    -- It has been behind that meter since it left the previous one, else
    -- since it was installed.
    select coalesce(max(l.valid_to)::date, d.installation_date) into v_since
      from links l where l.subject_id = p_device_id and l.type_code = 'behind_meter';
    insert into links (subject_id, type_code, object_id, valid_from, valid_to, scenario_id)
    values (p_device_id, 'behind_meter', d.meter_id, case when v_since < p_on then v_since end, p_on, d.scenario_id);
  end if;
  update devices set meter_id = p_meter_id where id = p_device_id;
end;
$$;

comment on function connect_device(uuid, uuid, date) is
  'Puts a device behind a meter of its site from a day, or behind none (null); the meter it leaves is kept as a behind_meter link ending that day. Refuses device_retired, device_meter_site_mismatch.';

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
  insert into devices (id, organisation_id, site_id, meter_id, geometry, name, device_type,
                       directory_id, manufacturer, model, serial_number, rated_power_kw, unit_count, installation_date,
                       status, source_code, tags, scenario_id)
  values (v_id, d.organisation_id, d.site_id, d.meter_id, d.geometry, coalesce(p_name, d.name),
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
  'Replaces a device on a day: a new device on the same site, at the same point and behind the same meter (of another product when one is named), a replaces link to the old one, which is retired. Refuses device_retired. Returns the new id.';

grant execute on function derived_device_check() to service_role;
grant execute on function install_device(uuid, text, text, jsonb, uuid, numeric, date, text, integer, uuid, jsonb, jsonb, text, uuid),
  connect_device(uuid, uuid, date), retire_device(uuid, date), replace_device(uuid, date, uuid, text, text)
  to authenticated, service_role;

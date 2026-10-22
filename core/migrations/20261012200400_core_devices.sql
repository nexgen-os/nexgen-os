-- Nexgen OS — core: devices and the products they are instances of.
--
-- A device is a thing behind the meter of a participant: a PV system, a
-- battery, a charger, a heat pump, a meter, a thermometer. The instrument
-- that measures is a device; the values it reports — or is asked to reach —
-- are series, as many as it measures (Brick Equipment and Point, Haystack
-- equip and point, SensorThings Sensor and Datastream): a weather station is
-- one device with several series. The core keeps what every device has. A
-- module derives the types it owns into its own table, with the same id
-- (`solar.pv_systems`): a page reads
-- `from devices join solar.pv_systems using (id)`.
--
-- A device belongs to a participant (decision 0043), and is behind the
-- meters that participant carries (`participant_meters()`): there is no
-- other path from a device to a meter or to a place. Where it sits among
-- the buildings, rooms and roof faces of the place is not described for
-- now (decision 0026).

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
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  -- The participant it belongs to, behind whose meters it is.
  participant_id    uuid not null references participants(id) on delete cascade,
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
  status            text not null default 'in_service',
  installation_date date,
  -- The day it was taken out; its series take no value after it.
  removal_date      date,
  -- Where the description comes from (a model file, a survey, a register).
  source_code       text references sources(code),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint devices_name_not_blank check (btrim(name) <> ''),
  constraint devices_power_positive check (rated_power_kw is null or rated_power_kw >= 0),
  constraint devices_unit_count_positive check (unit_count > 0),
  constraint devices_status check (status in ('planned', 'installed', 'in_service', 'out_of_service', 'removed')),
  constraint devices_removed_dated check ((status = 'removed') = (removal_date is not null)),
  constraint devices_dates check (removal_date is null or installation_date is null or removal_date >= installation_date)
);

comment on table devices is
  'A thing a participant has behind its meters: a PV system, a battery, a charger, a heat pump, a meter, a thermometer. The instrument that measures is a device; what it measures are its series. A module derives its own types into a table with the same id.';

create index devices_participant_idx on devices (participant_id);
create index devices_type_idx on devices (device_type);

-- A device belongs to a participant that has a place: a group carries none.
create or replace function devices_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if (select country from participants where id = new.participant_id) is null then
    raise exception 'participant_group_carries: a group carries no meter and no device' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function devices_check() is
  'BEFORE INSERT / UPDATE on devices: the participant it belongs to is not a group (participant_group_carries).';

create trigger devices_check before insert or update of participant_id on devices
  for each row execute function devices_check();
create trigger devices_participant_id_check before insert or update of participant_id on devices
  for each row execute function parent_check('participant_id', 'participants');
create trigger devices_set_updated_at before update on devices
  for each row execute function set_updated_at();
create index devices_organisation_idx on devices (organisation_id);
create trigger devices_drop_attachments after delete on devices
  for each row execute function drop_attachments('device');
call secure_table('devices');

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
  p_participant_id  uuid,
  p_device_type     text,
  p_name            text,
  p_directory_id    uuid default null,
  p_rated_power_kw  numeric default null,
  p_installed_on    date default null,
  p_source_code     text default null,
  p_unit_count      integer default 1,
  p_nameplate       jsonb default '{}',
  p_status          text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  s    participants%rowtype;
  p    device_directory%rowtype;
begin
  select * into s from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
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
  insert into devices (id, organisation_id, participant_id, name, device_type,
                       directory_id, manufacturer, model, serial_number, rated_power_kw, unit_count, installation_date, source_code,
                       status)
  values (v_id, s.organisation_id, p_participant_id,
          p_name, p_device_type, p_directory_id,
          coalesce(p.manufacturer, p_nameplate->>'manufacturer'), coalesce(p.model_ref, p_nameplate->>'model'), p_nameplate->>'serial_number',
          coalesce(p_rated_power_kw, p.unit_power_kw * p_unit_count), p_unit_count, p_installed_on, p_source_code,
          coalesce(p_status, case when p_installed_on is null or p_installed_on > current_date then 'planned' else 'in_service' end));
  return v_id;
end;
$$;

comment on function install_device(uuid, text, text, uuid, numeric, date, text, integer, jsonb, text) is
  'Installs a device behind the meters of a participant, as an instance of a product when one is named (its manufacturer, model and power by default), else with the manufacturer, model and serial number of its nameplate. In the status given, else planned until its installation date. Refuses participant_not_found, device_type_unknown, product_not_found, participant_group_carries. Returns its id.';

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

-- A meter swapped, an inverter changed: a new device of the same participant,
-- installed the day the one it replaces is retired.
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
  insert into devices (id, organisation_id, participant_id, name, device_type,
                       directory_id, manufacturer, model, serial_number, rated_power_kw, unit_count, installation_date,
                       status, source_code)
  values (v_id, d.organisation_id, d.participant_id, coalesce(p_name, d.name),
          d.device_type, coalesce(p_directory_id, d.directory_id), coalesce(p.manufacturer, d.manufacturer),
          coalesce(p.model_ref, d.model), p_serial_number,
          coalesce(p.unit_power_kw * d.unit_count, d.rated_power_kw), d.unit_count, p_on,
          case when p_on > current_date then 'planned' else 'in_service' end, d.source_code);
  update devices set status = 'removed', removal_date = p_on where id = p_device_id;
  return v_id;
end;
$$;

comment on function replace_device(uuid, date, uuid, text, text) is
  'Replaces a device on a day: a new device of the same participant (of another product when one is named), installed the day the old one is retired. Refuses device_retired. Returns the new id.';

grant execute on function derived_device_check() to service_role;
grant execute on function install_device(uuid, text, text, uuid, numeric, date, text, integer, jsonb, text),
  retire_device(uuid, date), replace_device(uuid, date, uuid, text, text)
  to authenticated, service_role;

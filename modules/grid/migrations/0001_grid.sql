-- Nexgen OS — module `grid`: the grid side of a connection point.
--
-- The connection point is the core's (`meters`): the identifier its operator
-- knows, carried by a participant, what it can do and when (decision 0042). This module
-- enriches it with what the grid knows. Who runs the grid — distribution and
-- transmission operators, what they cover, where a third party reads meter
-- data — is a vocabulary a country pack fills; how a point is connected —
-- its operator, its voltage level — is one row per meter, with the meter's
-- id.

set search_path = nexgen, public, extensions;

create schema grid;
grant usage on schema grid to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- operators — who runs the grid.
-- ---------------------------------------------------------------------------

create table grid.operators (
  code               text primary key,
  name               text not null,
  -- dso (distribution), tso (transmission), island (a zone not
  -- interconnected).
  kind               text not null,
  country            char(2) not null,
  regions            text[] not null default '{}',
  -- What it covers, in plain words.
  coverage           text,
  website            text,
  -- Where a third party reads meter data with the customer's consent.
  data_hub_url       text,
  -- The scheme of the metering point identifiers it issues.
  identifier_scheme  text references id_schemes(code),
  published_by       text not null default 'grid',
  description        text,
  constraint operators_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint operators_kind check (kind in ('dso', 'tso', 'island')),
  constraint operators_country_format check (country ~ '^[A-Z]{2}$')
);

comment on table grid.operators is
  'The distribution and transmission operators of a country, what they cover, where a third party reads meter data and which metering identifier they issue. A vocabulary: written by migrations and packs, read by everyone signed in.';

alter table grid.operators enable row level security;
create policy grid_operators_read on grid.operators for select to authenticated using (true);
grant select on grid.operators to authenticated;
grant select, insert, update, delete on grid.operators to service_role;

-- ---------------------------------------------------------------------------
-- connections — the grid details of a connection point.
-- ---------------------------------------------------------------------------

create table grid.meters (
  id                uuid primary key references meters(id) on delete cascade,
  -- Copied from the meter by trigger.
  organisation_id   uuid not null references organisations(id) on delete cascade,
  grid_operator     text references grid.operators(code),
  -- The code of a voltage level of the country, as its pack publishes them
  -- (the `voltage_levels` default of the country).
  voltage_level     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint meters_voltage_level_format check (voltage_level is null or voltage_level ~ '^[a-z][a-z0-9_]*$')
);

comment on table grid.meters is
  'The grid side of a connection point of the core, one row per meter that has one, with the meter''s id: the operator that runs it and the voltage level it is connected at. Subscribed power is an attribute of the meter.';

create index meters_operator_idx on grid.meters (grid_operator);

create or replace function grid.meters_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from meters where id = new.id);
  if new.organisation_id is null then
    raise exception 'meter_not_found: %', new.id using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

comment on function grid.meters_check() is
  'BEFORE INSERT / UPDATE on grid.meters: copies the organisation of the meter (meter_not_found).';

create trigger meters_check before insert or update of id, organisation_id on grid.meters
  for each row execute function grid.meters_check();
create trigger meters_set_updated_at before update on grid.meters
  for each row execute function set_updated_at();
call secure_table('grid.meters');

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

create or replace function grid.connect_to_operator(
  p_meter_id       uuid,
  p_operator_code  text,
  p_voltage_level  text default null
)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if not exists (select 1 from meters where id = p_meter_id) then
    raise exception 'meter_not_found: %', p_meter_id using errcode = 'no_data_found';
  end if;
  if p_operator_code is not null and not exists (select 1 from grid.operators where code = p_operator_code) then
    raise exception 'grid_operator_unknown: %', p_operator_code using errcode = 'foreign_key_violation';
  end if;
  insert into grid.meters (id, grid_operator, voltage_level)
  values (p_meter_id, p_operator_code, p_voltage_level)
  on conflict (id) do update set grid_operator = excluded.grid_operator,
                                 voltage_level = coalesce(excluded.voltage_level, grid.meters.voltage_level);
end;
$$;

comment on function grid.connect_to_operator(uuid, text, text) is
  'Says which operator runs a connection point of the core, and at which voltage level it is connected; a second call updates it. Refuses meter_not_found, grid_operator_unknown.';

grant execute on function grid.connect_to_operator(uuid, text, text) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('grid', 'Grid', '0.3.0', 'grid', '0.3.0',
        'The grid side of a connection point of the core: the operators who run the grid, written by the country packs, and for each meter the operator that runs it and the voltage level it is connected at.');

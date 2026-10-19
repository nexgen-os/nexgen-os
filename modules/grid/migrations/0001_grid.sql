-- Nexgen OS — module `grid`: connection points and the operators who run them.
--
-- A meter, in the sense of the grid, is a connection point to a network:
-- the identifier its operator knows, on a site, with what it can do (take,
-- inject, both) and the period that identifier names that point (IEC CIM
-- UsagePoint). The physical meter is a device of the core, of type `meter`,
-- and can be swapped; the devices behind a connection point say so with a
-- `behind_meter` link. Who runs the grid — distribution and transmission
-- operators, what they cover, where a third party reads meter data — is a
-- vocabulary a country pack fills.

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
-- meters — connection points.
-- ---------------------------------------------------------------------------

create table grid.meters (
  id                uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id   uuid not null references organisations(id) on delete cascade,
  site_id           uuid not null references sites(id) on delete cascade,
  name              text,
  -- The metering point identifier and its numbering scheme (a GS1 GSRN, or
  -- a national scheme a pack publishes).
  identifier        text not null,
  scheme            text not null references id_schemes(code),
  resource          text not null default 'electricity',
  -- What the point can do: take from the grid, inject into it, both.
  direction         text not null default 'both',
  grid_operator     text references grid.operators(code),
  -- When this identifier names this point: registers retire and reissue.
  valid_from        date,
  valid_to          date,
  tags              text[] not null default '{}',
  scenario_id       uuid references scenarios(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint meters_resource check (resource in ('electricity', 'gas', 'heat', 'water')),
  constraint meters_direction check (direction in ('offtake', 'injection', 'both')),
  constraint meters_period check (valid_to is null or valid_from is null or valid_to > valid_from),
  constraint meters_tags_known check (tags_known(tags))
);

comment on table grid.meters is
  'A connection point to a network, with the identifier its operator knows (IEC CIM UsagePoint). The physical meter is a device of type meter, and can be swapped; devices behind it are linked with behind_meter.';

create unique index meters_one_identifier on grid.meters (organisation_id, scheme, identifier, scenario_id, valid_from) nulls not distinct;
create index meters_site_idx on grid.meters (site_id);

create or replace function grid.meters_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if not identifier_valid(new.scheme, new.identifier) then
    raise exception 'invalid_identifier: % is not a valid %', new.identifier, new.scheme
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function grid.meters_check() is
  'BEFORE INSERT / UPDATE on grid.meters: the identifier matches its scheme (invalid_identifier).';

create trigger meters_check before insert or update of identifier, scheme on grid.meters
  for each row execute function grid.meters_check();
call declare_object('grid.meters', 'meter', '{site_id}');

-- ---------------------------------------------------------------------------
-- Vocabulary the module publishes
-- ---------------------------------------------------------------------------

insert into link_types (code, name, inverse_name, subject_kinds, object_kinds, ifc_relation, published_by, description) values
  ('behind_meter', 'is behind', 'has behind it', '{device}', '{meter}', null, 'grid',
   'The device is behind the connection point: what it takes or injects goes through that meter.');

insert into property_defs (code, name, datatype, quantity_code, minimum, applies_to, published_by) values
  ('subscribed_power', 'Subscribed power', 'number', 'power', 0, '{meter}', 'grid');

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

create or replace function grid.declare_meter(
  p_site_id        uuid,
  p_identifier     text,
  p_scheme         text,
  p_resource       text default 'electricity',
  p_direction      text default 'both',
  p_grid_operator  text default null,
  p_valid_from     date default null,
  p_name           text default null
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
  if exists (select 1 from grid.meters m
              where m.organisation_id = s.organisation_id and m.scheme = p_scheme and m.identifier = p_identifier
                and m.scenario_id is not distinct from s.scenario_id and m.valid_to is null) then
    raise exception 'meter_already_open: % % names an open connection point', p_scheme, p_identifier
      using errcode = 'unique_violation';
  end if;
  insert into grid.meters (id, organisation_id, site_id, name, identifier, scheme, resource, direction, grid_operator, valid_from, scenario_id)
  values (v_id, s.organisation_id, p_site_id, p_name, p_identifier, p_scheme, p_resource, p_direction, p_grid_operator, p_valid_from, s.scenario_id);
  return v_id;
end;
$$;

comment on function grid.declare_meter(uuid, text, text, text, text, text, date, text) is
  'Declares a connection point on a site under the identifier its operator knows. Refuses invalid_identifier, meter_already_open. Returns its id.';

create or replace function grid.close_meter(p_meter_id uuid, p_on date default current_date)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  update grid.meters set valid_to = p_on where id = p_meter_id and valid_to is null;
  if not found then
    raise exception 'meter_not_open: %', p_meter_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function grid.close_meter(uuid, date) is
  'Ends the period an identifier names a connection point: the register retired it. Refuses meter_not_open.';

grant execute on function grid.declare_meter(uuid, text, text, text, text, text, date, text), grid.close_meter(uuid, date)
  to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('grid', 'Grid', '0.1.0', 'grid', '0.2.0',
        'Connection points to a network and the operators who run them; devices behind a meter as links.');

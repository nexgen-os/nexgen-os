-- Nexgen OS — module `grid`: the grid side of a connection point.
--
-- The connection point is the core's (`meters`): the identifier its operator
-- knows, carried by a participant, what it can do and when (decision 0042). This module
-- enriches it with what the grid knows. Who runs the grid — distribution and
-- transmission operators, what they cover (regions, municipalities, the
-- prefixes of the metering point identifiers they issue), where a third
-- party reads meter data — is a vocabulary a country pack fills; how a point is connected —
-- its operator, its voltage level, the substation it sits downstream of —
-- is one row per meter, with the meter's id. The substations of a grid are
-- a register its packs and connectors write. The permission a third party
-- holds to read a meter at its operator's data hub is a mandate about that
-- meter, held by an organisation, with its periods, its scope and its
-- status; a connector whose source reads under mandate asks
-- `grid.authorise_reading()` before it reads. The market a connection point
-- trades in — its bidding zone, its control area, its transmission
-- operator, its imbalance settlement period — is resolved from its place by
-- `grid.market_of()`, from the pack's defaults; the parties of the market
-- (a balance responsible party, a supplier) are roles an organisation or one
-- of its contacts holds.

set search_path = nexgen, extensions;

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
  -- Where it runs the grid (decision 0009): the subdivisions, and the
  -- municipalities when it serves part of a subdivision only, as `regions`
  -- codes its pack lists.
  regions            text[] not null default '{}',
  municipalities     text[] not null default '{}',
  -- The prefixes of the metering point identifiers it issues, when its
  -- numbering says who issued a point (a GS1 company prefix in a GSRN).
  identifier_prefixes text[] not null default '{}',
  -- What it covers, in plain words.
  coverage           text,
  website            text,
  -- Where a third party reads meter data with the customer's consent.
  data_hub_url       text,
  -- How its hub publishes meter data, as its pack says (never a
  -- connector's code): `time_zone`, the IANA zone its files date their
  -- steps in when they carry no offset; `quality_codes`, its flags mapped
  -- to the codes of series_values.quality (0 to 3, and 100 up for the
  -- flags the core has no word for); `sources`, the sources that read it;
  -- `history_months`, how far back it serves; `steps`, the steps of its
  -- load curves (ISO 8601); `source_code` and `reference`, where that is
  -- published.
  meter_data         jsonb not null default '{}',
  -- The scheme of the metering point identifiers it issues.
  identifier_scheme  text references identifier_schemes(code),
  -- Its Energy Identification Code as a market party (ENTSO-E EIC, an X
  -- code for a party), when it has one: how market data names it.
  eic_code           text,
  published_by       text not null default 'grid',
  description        text,
  constraint operators_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint operators_kind check (kind in ('dso', 'tso', 'island')),
  constraint operators_country_format check (country ~ '^[A-Z]{2}$'),
  constraint operators_eic_format check (eic_code is null or eic_code ~ '^[0-9]{2}[A-Z][A-Z0-9-]{13}$'),
  constraint operators_meter_data_object check (jsonb_typeof(meter_data) = 'object')
);

comment on table grid.operators is
  'The distribution and transmission operators of a country, what they cover, where a third party reads meter data and which metering identifier they issue. A vocabulary: written by migrations and packs, read by everyone signed in.';

alter table grid.operators enable row level security;
create policy grid_operators_read on grid.operators for select to authenticated using (true);
grant select on grid.operators to authenticated;
grant select, insert, update, delete on grid.operators to service_role;

-- ---------------------------------------------------------------------------
-- substations — where a distribution grid is fed from.
-- ---------------------------------------------------------------------------

create table grid.substations (
  id                     uuid primary key default gen_random_uuid(),
  -- The operator that runs it, and its own code for it.
  operator               text not null references grid.operators(code),
  code                   text not null,
  name                   text not null,
  -- Where it stands: a point or the outline of the plot, WGS 84.
  geometry               geometry,
  -- The voltage levels it transforms between, as codes of the country's
  -- `voltage_levels` default, highest first (`{hta, bt}`).
  voltage_levels         text[] not null default '{}',
  -- What the grid can still take there, and what is already reserved, in
  -- MW, as the operator published it on a day.
  hosting_capacity_mw    numeric,
  reserved_capacity_mw   numeric,
  capacity_on            date,
  -- Where the row was read: a source of the vocabulary and the place in it.
  source_code            text references sources(code),
  reference              text,
  published_by           text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint substations_once_per_operator unique (operator, code),
  constraint substations_name_not_blank check (btrim(name) <> ''),
  constraint substations_capacity_positive check (
    (hosting_capacity_mw is null or hosting_capacity_mw >= 0) and (reserved_capacity_mw is null or reserved_capacity_mw >= 0)),
  constraint substations_capacity_dated check (
    (hosting_capacity_mw is null and reserved_capacity_mw is null) or (capacity_on is not null and source_code is not null)),
  constraint substations_geometry_wgs84 check (geometry is null or ST_SRID(geometry) = 4326)
);

comment on table grid.substations is
  'The substations of a grid: the operator that runs it and its code there, where it stands, the voltage levels it transforms between, the hosting capacity left and the capacity reserved with the day and the source they were read from. A register: written by packs and connectors, read by everyone signed in.';

create index substations_geometry_idx on grid.substations using gist (geometry);
create trigger substations_set_updated_at before update on grid.substations
  for each row execute function set_updated_at();

alter table grid.substations enable row level security;
create policy grid_substations_read on grid.substations for select to authenticated using (true);
grant select on grid.substations to authenticated;
grant select, insert, update, delete on grid.substations to service_role;

-- ---------------------------------------------------------------------------
-- meters — the grid details of a connection point.
-- ---------------------------------------------------------------------------

create table grid.meters (
  id                uuid primary key references meters(id) on delete cascade,
  -- Copied from the meter by trigger.
  organisation_id   uuid not null references organisations(id) on delete cascade,
  grid_operator     text references grid.operators(code),
  -- The code of a voltage level of the country, as its pack publishes them
  -- (the `voltage_levels` default of the country).
  voltage_level     text,
  -- The substation the point sits downstream of, when its operator says it.
  substation_id     uuid references grid.substations(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint meters_voltage_level_format check (voltage_level is null or voltage_level ~ '^[a-z][a-z0-9_]*$')
);

comment on table grid.meters is
  'The grid side of a connection point of the core, one row per meter that has one, with the meter''s id: the operator that runs it, the voltage level it is connected at and the substation it sits downstream of. Subscribed power is an attribute of the meter.';

create index meters_operator_idx on grid.meters (grid_operator);
create index meters_substation_idx on grid.meters (substation_id);

create or replace function grid.meters_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
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
call secure_table('grid.meters', 'project_of(''meter'', id)', 'participant_of(''meter'', id)');

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

create or replace function grid.connect_to_operator(
  p_meter_id       uuid,
  p_operator_code  text,
  p_voltage_level  text default null,
  p_substation_id  uuid default null
)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_operator text;
begin
  if not exists (select 1 from meters where id = p_meter_id) then
    raise exception 'meter_not_found: %', p_meter_id using errcode = 'no_data_found';
  end if;
  if p_operator_code is not null and not exists (select 1 from grid.operators where code = p_operator_code) then
    raise exception 'grid_operator_unknown: %', p_operator_code using errcode = 'foreign_key_violation';
  end if;
  if p_substation_id is not null then
    select s.operator into v_operator from grid.substations s where s.id = p_substation_id;
    if v_operator is null then
      raise exception 'substation_not_found: %', p_substation_id using errcode = 'no_data_found';
    end if;
    if p_operator_code is not null and v_operator <> p_operator_code then
      raise exception 'substation_of_other_operator: % is run by %, not %', p_substation_id, v_operator, p_operator_code
        using errcode = 'check_violation';
    end if;
  end if;
  insert into grid.meters (id, grid_operator, voltage_level, substation_id)
  values (p_meter_id, coalesce(p_operator_code, v_operator), p_voltage_level, p_substation_id)
  on conflict (id) do update set grid_operator = excluded.grid_operator,
                                 voltage_level = coalesce(excluded.voltage_level, grid.meters.voltage_level),
                                 substation_id = coalesce(excluded.substation_id, grid.meters.substation_id);
end;
$$;

-- Which operator runs a connection point, resolved from the most precise
-- level up (decision 0009): what the point says itself, then the prefix
-- of its identifier, then the municipality of its participant's place,
-- then its region when one distribution operator alone serves it.
create or replace function grid.operator_of(p_meter_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  m        meters%rowtype;
  p        participants%rowtype;
  v_code   text;
  v_prefix text;
  v_muni   text;
  v_region text;
  v_seen   text[] := '{}';
  n        integer;
begin
  select * into m from meters where id = p_meter_id;
  if not found then
    raise exception 'meter_not_found: %', p_meter_id using errcode = 'no_data_found';
  end if;
  select * into p from participants where id = m.participant_id;

  select gm.grid_operator into v_code from grid.meters gm where gm.id = m.id and gm.grid_operator is not null;
  if v_code is not null then
    return jsonb_build_object('operator', v_code, 'by', 'meter');
  end if;

  select o.code, x.prefix into v_code, v_prefix
    from grid.operators o, unnest(o.identifier_prefixes) x(prefix)
   where o.country = p.country and (o.identifier_scheme is null or o.identifier_scheme = m.scheme)
     and m.identifier like x.prefix || '%'
   order by length(x.prefix) desc, o.code
   limit 1;
  if v_code is not null then
    return jsonb_build_object('operator', v_code, 'by', 'prefix', 'prefix', v_prefix);
  end if;

  v_muni := municipality_of(p.id);
  if v_muni is not null then
    select o.code into v_code from grid.operators o
     where o.country = p.country and o.kind <> 'tso' and v_muni = any (o.municipalities)
     order by o.code limit 1;
    if v_code is not null then
      return jsonb_build_object('operator', v_code, 'by', 'municipality', 'municipality', v_muni);
    end if;
  end if;

  v_region := coalesce(v_muni, p.region);
  while v_region is not null and not v_region = any (v_seen) loop
    v_seen := v_seen || v_region;
    select count(*), min(o.code) into n, v_code from grid.operators o
     where o.country = p.country and o.kind <> 'tso' and v_region = any (o.regions);
    if n = 1 then
      return jsonb_build_object('operator', v_code, 'by', 'region', 'region', v_region);
    end if;
    exit when n > 1;
    select r.parent into v_region from regions r where r.code = v_region;
  end loop;

  raise exception 'grid_operator_not_found: no operator of % says it runs meter % (identifier %, %)', coalesce(p.country, 'its country'),
    m.id, m.identifier, coalesce(v_muni, p.region, 'no region')
    using errcode = 'no_data_found';
end;
$$;

comment on function grid.operator_of(uuid) is
  'The operator that runs a connection point of the core, from the most precise level up: the one named on the point (grid.meters), the longest identifier prefix an operator of its country issues, an operator serving the municipality of its participant''s place, the one distribution operator of its region or of a region above it — {operator, by, and the prefix, municipality or region that decided}. Refuses meter_not_found, grid_operator_not_found.';

grant execute on function grid.operator_of(uuid) to authenticated, service_role;

comment on function grid.connect_to_operator(uuid, text, text, uuid) is
  'Says which operator runs a connection point of the core, at which voltage level it is connected and the substation it sits downstream of; a second call updates it. Refuses meter_not_found, grid_operator_unknown, substation_not_found, substation_of_other_operator.';

grant execute on function grid.connect_to_operator(uuid, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Downstream of one substation.
-- ---------------------------------------------------------------------------

-- The substation a participant sits downstream of, read on the meters it
-- carries (or those of the participants it groups). Null when none says
-- one; two meters downstream of two substations are refused by name.
create or replace function grid.substation_of(p_participant_id uuid)
returns uuid
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if not exists (select 1 from participants where id = p_participant_id) then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  select array_agg(distinct gm.substation_id) into v_ids
    from participant_meters(p_participant_id) pm
    join grid.meters gm on gm.id = pm.meter_id
   where gm.substation_id is not null;
  if coalesce(cardinality(v_ids), 0) > 1 then
    raise exception 'substations_differ: the meters of participant % sit downstream of % substations', p_participant_id, cardinality(v_ids)
      using errcode = 'cardinality_violation';
  end if;
  return v_ids[1];
end;
$$;

comment on function grid.substation_of(uuid) is
  'The substation a participant sits downstream of, read on the meters it carries; null when none says one. Refuses participant_not_found, substations_differ.';

-- Whether participants sit downstream of one substation: true or false when
-- every one of them says its substation, null when one does not (nothing
-- decided in the dark); with the substation of each.
create or replace function grid.same_substation(p_participant_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
  with each as (
    select x.id, grid.substation_of(x.id) substation_id from unnest(p_participant_ids) x(id)
  )
  select jsonb_build_object(
    'same', case when count(*) filter (where substation_id is null) > 0 then null
                 else count(distinct substation_id) <= 1 end,
    'substations', coalesce(jsonb_object_agg(id, substation_id), '{}'::jsonb),
    'unknown', coalesce(jsonb_agg(id) filter (where substation_id is null), '[]'::jsonb))
  from each;
$$;

comment on function grid.same_substation(uuid[]) is
  'Whether participants sit downstream of the same substation: {same, substations: {participant: substation}, unknown: [participants that say none]}; same is null when one of them says none.';

grant execute on function grid.substation_of(uuid), grid.same_substation(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- mandates — the permission to read a meter at its operator's data hub.
-- ---------------------------------------------------------------------------

create table grid.mandates (
  id                  uuid primary key default gen_random_uuid(),
  -- Who holds it: the organisation whose model holds the meter, copied.
  organisation_id     uuid not null references organisations(id) on delete cascade,
  meter_id            uuid not null references meters(id) on delete cascade,
  -- The operator whose hub the data is read at.
  operator            text not null references grid.operators(code),
  -- The finest step of the readings it allows (ISO 8601 duration).
  granularity         text not null,
  -- The readings it covers, and the period it may be used over.
  data_from           date,
  data_to             date,
  valid_from          date not null,
  valid_to            date,
  -- What may be read, and what for.
  scope               text[] not null,
  purpose             text not null,
  status              text not null default 'draft',
  -- The reference the operator gives the consent, and the signed copy (a
  -- document of the meter).
  external_reference  text,
  document_id         uuid references documents(id) on delete set null,
  requested_at        timestamptz,
  decided_at          timestamptz,
  revoked_at          timestamptz,
  reason              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint mandates_granularity check (granularity in ('PT5M', 'PT10M', 'PT15M', 'PT30M', 'PT1H', 'P1D', 'P1M')),
  constraint mandates_scope check (cardinality(scope) > 0 and scope <@ array['load_curve', 'daily_index', 'energy_history', 'technical_data']),
  constraint mandates_purpose check (purpose in ('study', 'sharing_operation', 'energy_management', 'billing', 'other')),
  constraint mandates_status check (status in ('draft', 'sent', 'approved', 'refused', 'expired', 'revoked')),
  constraint mandates_data_period check (data_to is null or data_from is null or data_to > data_from),
  constraint mandates_valid_period check (valid_to is null or valid_to > valid_from),
  constraint mandates_decided check ((status in ('approved', 'refused', 'revoked')) <= (decided_at is not null)),
  constraint mandates_revoked check ((status = 'revoked') = (revoked_at is not null))
);

comment on table grid.mandates is
  'The permission a meter''s customer gives an organisation to read that meter at its operator''s data hub: the operator, the finest step, the readings it covers, the period it may be used over, what may be read and what for, its status (draft, sent, approved, refused, expired, revoked) and the signed copy as a document of the meter. Written by grid.request_mandate(), grid.decide_mandate(), grid.revoke_mandate(), grid.expire_mandates().';

create index mandates_meter_idx on grid.mandates (meter_id);
create index mandates_organisation_idx on grid.mandates (organisation_id);

create or replace function grid.mandates_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from meters where id = new.meter_id);
  if new.organisation_id is null then
    raise exception 'meter_not_found: %', new.meter_id using errcode = 'foreign_key_violation';
  end if;
  if new.document_id is not null and not exists (
       select 1 from documents d where d.id = new.document_id and d.object_kind = 'meter' and d.object_id = new.meter_id) then
    raise exception 'document_of_other_object: the signed copy of a mandate is a document of its meter' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function grid.mandates_check() is
  'BEFORE INSERT / UPDATE on grid.mandates: copies the organisation of the meter (meter_not_found); the signed copy is a document of that meter (document_of_other_object).';

create trigger mandates_check before insert or update of meter_id, organisation_id, document_id on grid.mandates
  for each row execute function grid.mandates_check();
create trigger mandates_set_updated_at before update on grid.mandates
  for each row execute function set_updated_at();
call secure_table('grid.mandates', 'project_of(''meter'', meter_id)', 'participant_of(''meter'', meter_id)');

-- Asks the customer of a meter for a mandate: the row, sent. The operator is
-- the one named, or the one that runs the meter (grid.operator_of()).
create or replace function grid.request_mandate(
  p_meter_id     uuid,
  p_granularity  text,
  p_scope        text[],
  p_purpose      text,
  p_valid_from   date,
  p_valid_to     date default null,
  p_data_from    date default null,
  p_data_to      date default null,
  p_operator     text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from meters where id = p_meter_id) then
    raise exception 'meter_not_found: %', p_meter_id using errcode = 'no_data_found';
  end if;
  insert into grid.mandates (meter_id, operator, granularity, scope, purpose, valid_from, valid_to, data_from, data_to, status, requested_at)
  values (p_meter_id, coalesce(p_operator, grid.operator_of(p_meter_id)->>'operator'), p_granularity, p_scope, p_purpose,
          p_valid_from, p_valid_to, p_data_from, p_data_to, 'sent', now())
  returning id into v_id;
  return v_id;
end;
$$;

comment on function grid.request_mandate(uuid, text, text[], text, date, date, date, date, text) is
  'Asks the customer of a meter for the permission to read it at its operator''s hub: a mandate sent, with its step, scope, purpose and periods; the operator is the one named or grid.operator_of(). Refuses meter_not_found, grid_operator_not_found. Returns its id.';

-- The customer's answer: approved, with the signed copy and the operator's
-- reference, or refused, with the reason.
create or replace function grid.decide_mandate(
  p_mandate_id          uuid,
  p_approved            boolean,
  p_document_id         uuid default null,
  p_external_reference  text default null,
  p_reason              text default null
)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from grid.mandates where id = p_mandate_id for update;
  if v_status is null then
    raise exception 'mandate_not_found: %', p_mandate_id using errcode = 'no_data_found';
  end if;
  if v_status not in ('draft', 'sent') then
    raise exception 'mandate_already_decided: % is %', p_mandate_id, v_status using errcode = 'check_violation';
  end if;
  update grid.mandates
     set status = case when p_approved then 'approved' else 'refused' end,
         decided_at = now(),
         document_id = coalesce(p_document_id, document_id),
         external_reference = coalesce(p_external_reference, external_reference),
         reason = p_reason
   where id = p_mandate_id;
end;
$$;

comment on function grid.decide_mandate(uuid, boolean, uuid, text, text) is
  'Records the customer''s answer to a mandate draft or sent: approved (with the signed copy, a document of the meter, and the operator''s reference) or refused (with the reason). Refuses mandate_not_found, mandate_already_decided, document_of_other_object.';

-- The customer withdraws an approved mandate: it holds no more from now.
create or replace function grid.revoke_mandate(p_mandate_id uuid, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from grid.mandates where id = p_mandate_id for update;
  if v_status is null then
    raise exception 'mandate_not_found: %', p_mandate_id using errcode = 'no_data_found';
  end if;
  if v_status <> 'approved' then
    raise exception 'mandate_not_approved: % is %', p_mandate_id, v_status using errcode = 'check_violation';
  end if;
  update grid.mandates set status = 'revoked', revoked_at = now(), reason = p_reason where id = p_mandate_id;
end;
$$;

comment on function grid.revoke_mandate(uuid, text) is
  'Records that the customer withdrew an approved mandate, with the reason: it allows nothing from now. Refuses mandate_not_found, mandate_not_approved.';

-- The mandates whose period ended before a day: approved ones expire.
create or replace function grid.expire_mandates(p_on date)
returns integer
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  n integer;
begin
  update grid.mandates set status = 'expired' where status = 'approved' and valid_to is not null and valid_to <= p_on;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function grid.expire_mandates(date) is
  'Marks expired the approved mandates whose validity ended on or before a day; returns how many. The day is always given.';

-- What a connector asks before it reads a meter, the one mandate check of
-- the installation: when its source reads under mandate (sources.auth =
-- 'mandate'), the approved mandate its organisation holds on that meter,
-- valid on the day, whose data period covers the readings asked for, whose
-- scope holds what is read and whose granularity is as fine as the step
-- asked. Null when the source needs none. Each refusal says which condition
-- failed: no mandate in force (mandate_missing), only mandates whose
-- validity ended, expired or revoked (mandate_expired), or mandates in force
-- that do not cover the period, the scope or the step (mandate_scope).
create or replace function grid.authorise_reading(
  p_connector_id  uuid,
  p_meter_id      uuid,
  p_from          date,
  p_to            date,
  p_on            date default current_date,
  p_scope         text default 'load_curve',
  p_granularity   text default null
)
returns uuid
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  c      connectors%rowtype;
  v_auth text;
  v_org  uuid;
  v_id   uuid;
  v_step interval;
begin
  select * into c from connectors where id = p_connector_id;
  if c.id is null then
    raise exception 'connector_not_found: %', p_connector_id using errcode = 'no_data_found';
  end if;
  select organisation_id into v_org from meters where id = p_meter_id;
  if v_org is null then
    raise exception 'meter_not_found: %', p_meter_id using errcode = 'no_data_found';
  end if;
  if v_org <> c.organisation_id then
    raise exception 'object_in_other_organisation: meter %', p_meter_id using errcode = 'check_violation';
  end if;
  select s.auth into v_auth from sources s where s.code = c.source_code;
  if v_auth is distinct from 'mandate' then
    return null;
  end if;
  if p_granularity is not null then
    begin
      v_step := p_granularity::interval;
    exception when others then
      raise exception 'invalid_duration: % is not an ISO 8601 duration', p_granularity using errcode = 'invalid_parameter_value';
    end;
  end if;

  select m.id into v_id
    from grid.mandates m
   where m.meter_id = p_meter_id and m.organisation_id = c.organisation_id and m.status = 'approved'
     and m.valid_from <= p_on and (m.valid_to is null or m.valid_to > p_on)
     and (m.data_from is null or m.data_from <= p_from) and (m.data_to is null or m.data_to >= p_to)
     and p_scope = any (m.scope)
     and (v_step is null or m.granularity::interval <= v_step)
   order by m.decided_at desc
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- Why not, from the most telling reason to the plainest.
  if exists (select 1 from grid.mandates m
              where m.meter_id = p_meter_id and m.organisation_id = c.organisation_id and m.status = 'approved'
                and m.valid_from <= p_on and (m.valid_to is null or m.valid_to > p_on)) then
    raise exception 'mandate_scope: the mandates of meter % in force on % do not cover % from % to % at a step of %',
      p_meter_id, p_on, p_scope, p_from, p_to, coalesce(p_granularity, 'any') using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from grid.mandates m
              where m.meter_id = p_meter_id and m.organisation_id = c.organisation_id
                and (m.status in ('expired', 'revoked') or (m.status = 'approved' and m.valid_to is not null and m.valid_to <= p_on))) then
    raise exception 'mandate_expired: % reads under mandate and the mandates of meter % ended, expired or were revoked by %',
      c.source_code, p_meter_id, p_on using errcode = 'insufficient_privilege';
  end if;
  raise exception 'mandate_missing: % reads under mandate and meter % has no approved mandate in force on %',
    c.source_code, p_meter_id, p_on using errcode = 'insufficient_privilege';
end;
$$;

comment on function grid.authorise_reading(uuid, uuid, date, date, date, text, text) is
  'The one mandate check: what a connector asks before reading a meter. When its source reads under mandate (sources.auth = mandate), the approved mandate its organisation holds on the meter, valid on the day, whose data period covers the readings asked for, whose scope holds what is read (load_curve by default) and whose granularity is as fine as the step asked (an ISO 8601 duration) — its id; null when the source needs none. Refuses connector_not_found, meter_not_found, object_in_other_organisation, invalid_duration, mandate_missing, mandate_expired, mandate_scope.';

grant execute on function grid.request_mandate(uuid, text, text[], text, date, date, date, date, text),
  grid.decide_mandate(uuid, boolean, uuid, text, text), grid.revoke_mandate(uuid, text), grid.expire_mandates(date),
  grid.authorise_reading(uuid, uuid, date, date, date, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The market: where a connection point trades, and who answers for it.
-- ---------------------------------------------------------------------------

-- What a connection point, a participant or a project trades in, resolved
-- from its place as every value a country decides: the bidding zone, the
-- control area and the imbalance settlement period are the pack's defaults
-- (parameter_of(), from the municipality up to the country), each with its
-- source; the transmission operator is the operator of kind tso of its
-- country serving its region, or the only one of the country.
create or replace function grid.market_of(p_kind text, p_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_out     jsonb := '{}';
  v_type    text;
  v_country text;
  v_region  text;
  v_tso     grid.operators%rowtype;
  n         integer;
begin
  foreach v_type in array array['bidding_zone', 'control_area', 'imbalance_settlement_period'] loop
    begin
      v_out := v_out || jsonb_build_object(v_type, parameter_of(p_kind, p_id, v_type, p_at));
    exception when no_data_found then
      -- Missing or not decided (a zone not interconnected): said, not guessed.
      v_out := v_out || jsonb_build_object(v_type, jsonb_build_object('value', null, 'refusal', split_part(sqlerrm, ':', 1)));
    end;
  end loop;

  v_country := country_of(p_kind, p_id);
  select p.region into v_region from participants p where p.id = participant_of(p_kind, p_id);
  select count(*) into n from grid.operators o
   where o.country = v_country and o.kind = 'tso'
     and (cardinality(o.regions) = 0 or v_region = any (o.regions) or v_region is null);
  if n = 1 then
    select * into v_tso from grid.operators o
     where o.country = v_country and o.kind = 'tso'
       and (cardinality(o.regions) = 0 or v_region = any (o.regions) or v_region is null);
    v_out := v_out || jsonb_build_object('transmission_operator', jsonb_build_object('operator', v_tso.code, 'eic_code', v_tso.eic_code));
  else
    v_out := v_out || jsonb_build_object('transmission_operator', null);
  end if;
  return v_out || jsonb_build_object('country', v_country);
end;
$$;

comment on function grid.market_of(text, uuid, timestamptz) is
  'The market an object of the core (a meter, a participant, a project…) trades in, from its place: bidding_zone, control_area and imbalance_settlement_period as parameter_of() resolves them from the pack (each with its value, level, source and status; {value: null, refusal} when the place has none or the pack decides none), the transmission_operator of its country serving its region ({operator, eic_code}; null when none or several), and the country.';

-- The market series of an organisation for a bidding zone: the series of a
-- quantity (an energy_price, a carbon_intensity) whose bidding_zone
-- attribute names the zone. A market series names its zone; nothing else
-- ties a price to a place.
create or replace function grid.zone_series(p_organisation_id uuid, p_bidding_zone text, p_quantity text, p_at timestamptz default now())
returns setof uuid
language sql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
  select se.id
    from series se
    join attributes a on a.object_kind = 'series' and a.object_id = se.id and a.attribute_type = 'bidding_zone'
   where se.organisation_id = p_organisation_id and se.quantity_code = p_quantity
     and a.value = to_jsonb(p_bidding_zone)
     and (a.valid_from is null or a.valid_from <= p_at) and (a.valid_to is null or a.valid_to > p_at)
   order by se.created_at, se.id;
$$;

comment on function grid.zone_series(uuid, text, text, timestamptz) is
  'The series of an organisation of one quantity whose bidding_zone attribute names a zone: its day-ahead price, its grid carbon intensity. Oldest first.';

grant execute on function grid.market_of(text, uuid, timestamptz), grid.zone_series(uuid, text, text, timestamptz) to authenticated, service_role;

-- The roles of the market a party holds: a balance responsible party, a
-- balancing service provider, a supplier, an aggregator. One word each,
-- the ENTSO-E role model's.
create table grid.market_roles (
  code          text primary key,
  name          text not null,
  description   text,
  published_by  text not null default 'grid',
  constraint market_roles_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table grid.market_roles is
  'The roles a party holds on the electricity market, in the words of the ENTSO-E harmonised role model: balance responsible party, balancing service provider, supplier, aggregator. A vocabulary.';

insert into grid.market_roles (code, name, description) values
  ('balance_responsible_party', 'Balance responsible party', 'Answers financially for the imbalance of the connection points of its perimeter, settled over the imbalance settlement period of its control area.'),
  ('balancing_service_provider', 'Balancing service provider', 'Offers balancing energy or capacity to the transmission operator.'),
  ('supplier', 'Supplier', 'Sells energy to a connection point under a supply contract.'),
  ('aggregator', 'Aggregator', 'Combines the consumption or production of several connection points to sell it or its flexibility.');

alter table grid.market_roles enable row level security;
create policy grid_market_roles_read on grid.market_roles for select to authenticated using (true);
grant select on grid.market_roles to authenticated;
grant select, insert, update, delete on grid.market_roles to service_role;

-- Who holds a role: the organisation itself, or one of its contacts (the
-- balance responsible party of its supply, a supplier it deals with), with
-- its EIC code, the zone it holds the role in and the period.
create table grid.market_parties (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- Null: the organisation itself holds the role.
  contact_id       uuid references contacts(id) on delete cascade,
  role             text not null references grid.market_roles(code),
  eic_code         text,
  bidding_zone     text,
  valid_from       date,
  valid_to         date,
  source_code      text references sources(code),
  reference        text,
  created_at       timestamptz not null default now(),
  constraint market_parties_eic_format check (eic_code is null or eic_code ~ '^[0-9]{2}[A-Z][A-Z0-9-]{13}$'),
  constraint market_parties_zone_format check (bidding_zone is null or bidding_zone ~ '^[0-9]{2}[A-Z][A-Z0-9-]{13}$'),
  constraint market_parties_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table grid.market_parties is
  'A role of the market (grid.market_roles) held by an organisation or one of its contacts, with its EIC code, the bidding zone it holds it in and its period: the balance responsible party of a perimeter, a supplier.';

create unique index market_parties_once on grid.market_parties (organisation_id, contact_id, role, bidding_zone, valid_from) nulls not distinct;

create or replace function grid.market_parties_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if new.contact_id is not null and not exists (select 1 from contacts c where c.id = new.contact_id and c.organisation_id = new.organisation_id) then
    raise exception 'object_in_other_organisation: contact %', new.contact_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function grid.market_parties_check() is
  'BEFORE INSERT / UPDATE on grid.market_parties: a contact holding a role is one of the organisation''s (object_in_other_organisation).';

create trigger market_parties_check before insert or update on grid.market_parties
  for each row execute function grid.market_parties_check();
call secure_table('grid.market_parties');

-- ---------------------------------------------------------------------------
-- Support schemes: what a producer is paid under, and what it owes back.
-- ---------------------------------------------------------------------------

-- The kinds of support, one word each, and the formula of the payment each
-- kind computes: a feed-in tariff pays a fixed price for the energy
-- injected; a contract for difference (a sliding premium, the
-- remuneration supplement of France) pays the difference between a strike price
-- and the market reference, so that the market revenue and the premium
-- together give the strike; green certificates are granted per MWh
-- produced and sold on their own market; net metering offsets injection
-- against offtake. A tender is how a scheme is awarded, not a kind: it is
-- the allocation of a scheme.
create table grid.support_scheme_kinds (
  code          text primary key,
  name          text not null,
  formula       text not null,
  description   text,
  published_by  text not null default 'grid',
  constraint support_scheme_kinds_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint support_scheme_kinds_formula check (formula in ('fixed_price', 'sliding_premium', 'certificates', 'net_metering'))
);

comment on table grid.support_scheme_kinds is
  'The kinds of support a producer is paid under — feed-in tariff, contract for difference, green certificates, net metering — and the formula of the payment each computes. A vocabulary.';

insert into grid.support_scheme_kinds (code, name, formula, description) values
  ('feed_in_tariff', 'Feed-in tariff', 'fixed_price', 'A fixed price per MWh injected, paid by a buyer the law obliges, over the duration of the contract.'),
  ('contract_for_difference', 'Contract for difference', 'sliding_premium', 'A premium per MWh, the strike price less the market reference price, paid on top of the market revenue; negative when the reference exceeds the strike in a two-sided contract.'),
  ('green_certificates', 'Green certificates', 'certificates', 'Certificates granted per MWh produced, sold on their own market or to the operator at a guaranteed minimum price.'),
  ('net_metering', 'Net metering', 'net_metering', 'Injection offsets offtake on the meter over a period; no price per MWh injected.');

alter table grid.support_scheme_kinds enable row level security;
create policy grid_support_scheme_kinds_read on grid.support_scheme_kinds for select to authenticated using (true);
grant select on grid.support_scheme_kinds to authenticated;
grant select, insert, update, delete on grid.support_scheme_kinds to service_role;

-- The schemes of a country, as its pack publishes them: the kind, how it is
-- awarded, who is eligible (device types and a power range), the duration
-- of a contract, and the obligation to stop at negative prices with its
-- power threshold, dated: a threshold that lowers over time is one more
-- dated rule. The tariff is the contract's (it changes every quarter for
-- new contracts and is fixed for the life of one), never the pack's.
create table grid.support_schemes (
  code               text primary key,
  country            char(2) not null,
  name               text not null,
  kind               text not null references grid.support_scheme_kinds(code),
  -- open_window: any eligible producer may sign; tender: awarded by a call
  -- for tenders, the strike or tariff being the winner's bid.
  allocation         text not null default 'open_window',
  device_types       text[] not null default '{}',
  min_power_kw       numeric,
  max_power_kw       numeric,
  duration_years     integer,
  -- [{threshold_kw, valid_from, valid_to?, source_code?, reference}]: from valid_from, a
  -- producer of threshold_kw or more under the scheme stops (or loses its
  -- support) while the market price is negative.
  negative_price_rules jsonb not null default '[]',
  source_code        text not null references sources(code),
  reference          text not null,
  valid_from         date,
  valid_to           date,
  published_by       text not null,
  constraint support_schemes_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint support_schemes_allocation check (allocation in ('open_window', 'tender')),
  constraint support_schemes_power check (min_power_kw is null or max_power_kw is null or min_power_kw <= max_power_kw),
  constraint support_schemes_duration check (duration_years is null or duration_years > 0),
  constraint support_schemes_rules check (jsonb_typeof(negative_price_rules) = 'array'),
  constraint support_schemes_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table grid.support_schemes is
  'The support schemes of a country as its pack publishes them, each with its legal source: the kind (grid.support_scheme_kinds), the allocation (open window or tender), the device types and power range eligible, the duration of a contract, the dated rules of the obligation to stop at negative prices with their power threshold. Read by everyone signed in.';

alter table grid.support_schemes enable row level security;
create policy grid_support_schemes_read on grid.support_schemes for select to authenticated using (true);
grant select on grid.support_schemes to authenticated;
grant select, insert, update, delete on grid.support_schemes to service_role;

-- The contract of one producing device under a scheme: the device is what is
-- contracted (its type and rated power decide eligibility and the
-- negative-price obligation), whatever its technology, so the contract
-- belongs to the grid side and not to one technology's module. Its energy
-- is read on the injection of its participant's meter.
create table grid.support_contracts (
  id               uuid primary key default gen_random_uuid(),
  -- Copied from the device by trigger.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  device_id        uuid not null references devices(id) on delete cascade,
  scheme           text not null references grid.support_schemes(code),
  -- The contract's own reference at the buyer or the regulator.
  reference        text,
  valid_from       date not null,
  -- The day after its last: valid_from plus the scheme's duration when not given.
  valid_to         date,
  -- The fixed price of a feed-in tariff, the strike of a contract for
  -- difference, in the currency of the device's country per MWh (an
  -- energy_price); null for certificates and net metering.
  tariff           numeric,
  source_code      text references sources(code),
  source           text,
  created_at       timestamptz not null default now(),
  constraint support_contracts_period check (valid_to is null or valid_to > valid_from),
  constraint support_contracts_tariff check (tariff is null or tariff >= 0)
);

comment on table grid.support_contracts is
  'The contract of a producing device under a support scheme of its country: the scheme, the contract reference, its period (the scheme''s duration when no end is given) and its tariff or strike price in the currency of the country per MWh. One device, one contract at a time.';

create index support_contracts_device_idx on grid.support_contracts (device_id, valid_from);

create or replace function grid.support_contracts_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  d   devices%rowtype;
  s   grid.support_schemes%rowtype;
begin
  select * into d from devices where id = new.device_id;
  if d.id is null then
    raise exception 'device_not_found: %', new.device_id using errcode = 'foreign_key_violation';
  end if;
  new.organisation_id := d.organisation_id;
  select * into s from grid.support_schemes where code = new.scheme;
  if s.country is distinct from country_of('device', d.id) then
    raise exception 'support_scheme_of_other_country: % is a scheme of %, the device is in %', s.code, s.country, coalesce(country_of('device', d.id), 'no country')
      using errcode = 'check_violation';
  end if;
  if cardinality(s.device_types) > 0 and not exists (select 1 from unnest(s.device_types) t where device_type_is_a(d.device_type, t)) then
    raise exception 'support_not_eligible: % is a %, % supports %', d.id, d.device_type, s.code, s.device_types using errcode = 'check_violation';
  end if;
  if (s.min_power_kw is not null and coalesce(d.rated_power_kw, 0) < s.min_power_kw)
     or (s.max_power_kw is not null and (d.rated_power_kw is null or d.rated_power_kw > s.max_power_kw)) then
    raise exception 'support_not_eligible: % of % kW, % supports % to % kW', d.id, coalesce(d.rated_power_kw::text, 'unknown'), s.code,
      coalesce(s.min_power_kw::text, '0'), coalesce(s.max_power_kw::text, 'any') using errcode = 'check_violation';
  end if;
  if new.valid_to is null and s.duration_years is not null then
    new.valid_to := (new.valid_from + make_interval(years => s.duration_years))::date;
  end if;
  if exists (select 1 from grid.support_contracts c where c.device_id = new.device_id and c.id <> new.id
               and daterange(c.valid_from, c.valid_to) && daterange(new.valid_from, new.valid_to)) then
    raise exception 'overlapping_value: device % already has a support contract over that period', new.device_id using errcode = 'exclusion_violation';
  end if;
  return new;
end;
$$;

comment on function grid.support_contracts_check() is
  'BEFORE INSERT / UPDATE on grid.support_contracts: copies the organisation of the device; the scheme is of the device''s country (support_scheme_of_other_country), the device of a type and a power it supports (support_not_eligible); the period ends after the scheme''s duration when not given; two contracts of one device never overlap (overlapping_value).';

create trigger support_contracts_check before insert or update on grid.support_contracts
  for each row execute function grid.support_contracts_check();
call secure_table('grid.support_contracts');

-- The support a device is under on a day, and what it owes at negative prices.
create or replace function grid.support_of(p_device_id uuid, p_on date default current_date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  c     grid.support_contracts%rowtype;
  s     grid.support_schemes%rowtype;
  k     grid.support_scheme_kinds%rowtype;
  r     jsonb;
  v_kw  numeric;
begin
  select * into c from grid.support_contracts x
   where x.device_id = p_device_id and x.valid_from <= p_on and (x.valid_to is null or x.valid_to > p_on);
  if c.id is null then
    return null;
  end if;
  select * into s from grid.support_schemes where code = c.scheme;
  select * into k from grid.support_scheme_kinds where code = s.kind;
  select rated_power_kw into v_kw from devices where id = p_device_id;
  select x into r from jsonb_array_elements(s.negative_price_rules) x
   where (x->>'valid_from')::date <= p_on and (x->>'valid_to' is null or (x->>'valid_to')::date > p_on)
   order by (x->>'valid_from')::date desc limit 1;
  return jsonb_build_object(
    'contract_id', c.id, 'scheme', s.code, 'kind', s.kind, 'formula', k.formula, 'allocation', s.allocation,
    'tariff', c.tariff, 'currency', currency_of('device', p_device_id), 'valid_from', c.valid_from, 'valid_to', c.valid_to,
    'reference', c.reference, 'source_code', s.source_code, 'scheme_reference', s.reference,
    'negative_price_stop', case when r is null then jsonb_build_object('required', false)
      else jsonb_build_object('required', coalesce(v_kw, 0) >= (r->>'threshold_kw')::numeric, 'threshold_kw', (r->>'threshold_kw')::numeric,
                              'valid_from', r->>'valid_from', 'reference', r->>'reference', 'source_code', coalesce(r->>'source_code', s.source_code)) end);
end;
$$;

comment on function grid.support_of(uuid, date) is
  'The support contract a device is under on a day: scheme, kind and formula, tariff in the currency of its country, period, references; and negative_price_stop — whether the scheme''s rule holding that day obliges a device of its rated power to stop while the price is negative, with the threshold and its legal reference. Null when the device has no contract that day.';

-- What injection earns under the device's scheme over a period, hour by
-- hour: the energy of each hour of the injection series (kWh) at the
-- contract's tariff (fixed price), or at the strike (a contract for
-- difference: market revenue plus premium). An hour of negative price
-- earns nothing when the scheme obliges the device to stop then, which
-- needs the market price series of its zone. Certificates and net metering
-- have no price per MWh here: refused by name.
create or replace function grid.injection_revenue(
  p_device_id        uuid,
  p_injection_series uuid,
  p_from             timestamptz,
  p_to               timestamptz,
  p_price_series     uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_support  jsonb := grid.support_of(p_device_id, p_from::date);
  v_stop     boolean;
  v_energy   double precision := 0;
  v_paid     double precision := 0;
  v_stopped  double precision := 0;
  h          record;
begin
  if v_support is null then
    raise exception 'support_not_found: device % has no support contract on %', p_device_id, p_from::date using errcode = 'no_data_found';
  end if;
  if v_support->>'formula' not in ('fixed_price', 'sliding_premium') or v_support->'tariff' = 'null'::jsonb then
    raise exception 'support_formula_not_priced: % pays no price per MWh injected', v_support->>'scheme' using errcode = 'feature_not_supported';
  end if;
  v_stop := coalesce((v_support #>> '{negative_price_stop,required}')::boolean, false);
  if v_stop and p_price_series is null then
    raise exception 'price_series_required: % stops at negative prices; give the market price series of its zone', v_support->>'scheme'
      using errcode = 'invalid_parameter_value';
  end if;
  for h in
    select i.bucket, i.value kwh, p.value price
      from resample(p_injection_series, p_from, p_to, interval '1 hour') i
      left join resample(p_price_series, p_from, p_to, interval '1 hour') p on p.bucket = i.bucket
     where i.value is not null and i.value = i.value
  loop
    v_energy := v_energy + h.kwh;
    if v_stop and h.price < 0 then
      v_stopped := v_stopped + h.kwh;
    else
      v_paid := v_paid + h.kwh;
    end if;
  end loop;
  return jsonb_build_object(
    'scheme', v_support->>'scheme', 'formula', v_support->>'formula', 'tariff', v_support->'tariff', 'currency', v_support->>'currency',
    'injected_kwh', v_energy, 'paid_kwh', v_paid, 'stopped_kwh', v_stopped,
    'revenue', round((v_paid / 1000 * (v_support->>'tariff')::double precision)::numeric, 2),
    'negative_price_stop', v_support->'negative_price_stop',
    'provenance', jsonb_build_object('program', 'grid.injection_revenue', 'contract_id', v_support->'contract_id',
                                     'injection_series', p_injection_series, 'price_series', p_price_series, 'step', 'PT1H'));
end;
$$;

comment on function grid.injection_revenue(uuid, uuid, timestamptz, timestamptz, uuid) is
  'The revenue of a device''s injection under its support contract over a period, hour by hour: kWh of each hour (resample of the injection series) at the tariff (feed-in tariff) or the strike (contract for difference: market revenue plus premium), none in an hour of negative price when the scheme obliges it to stop (read from the price series). {injected_kwh, paid_kwh, stopped_kwh, revenue, currency, provenance}. Refuses support_not_found, support_formula_not_priced, price_series_required.';

grant execute on function grid.support_of(uuid, date), grid.injection_revenue(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('grid', 'Grid', '0.3.0', 'grid', '0.3.0',
        'The grid side of a connection point of the core: the operators who run the grid and their substations, written by the country packs and connectors, for each meter the operator that runs it, the voltage level and the substation it is connected at, the mandates that allow reading it at the operator''s hub, the market it trades in (bidding zone, control area, transmission operator, imbalance settlement period) the roles market parties hold, and the support schemes of a country with the contract of a producing device under one.');

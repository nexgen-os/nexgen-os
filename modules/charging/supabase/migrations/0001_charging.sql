-- Nexgen OS — module `charging`: electric vehicle chargers, the sessions
-- they deliver, the limits they are asked to keep, and the sizing of the
-- charge points of a place.
--
-- A charger is a device of type `charger`, derived into `charging.devices`
-- with the same id (decision 0042): the greatest power of the station, its
-- identity in the Open Charge Point Protocol (OCPP: the charge point id it
-- connects with, the version it speaks) and the meter it sits behind. Its
-- EVSEs (the parts that charge one vehicle at a time) and their connectors
-- are rows of `charging.connectors`: standard, current type, phases,
-- greatest power and current.
--
-- A charging session is a row of `charging.sessions`: the EVSE and the
-- connector, its start and end, the energy delivered, the peak power, the
-- id token the station read (personal data, kept as the station gave it),
-- the vehicle when it is known, why it stopped, and where it comes from (a
-- station, a file). `charging.record()` writes it once per transaction of
-- its source, and completes it as later messages arrive. Its power and
-- energy are series of the device, written by `store()`.
--
-- To steer a charger is to ask it for a charging profile (OCPP
-- `SetChargingProfile`: limits by period, a purpose, a stack level). A
-- profile is an action of kind `command` of the `actions` module on the
-- charger (decision 0047): `charging.limit()` creates the command, on a
-- setpoint series of the device, and keeps the schedule in
-- `charging.profiles`; `charging.report()` records what the station
-- answered — accepted, the command is done and every period of the
-- schedule is stored in the setpoint series, which is its effect; refused
-- or unanswered, the command failed and says why.
--
-- What the module computes is an estimate (`charging.estimates`, decision
-- 0004): the number of charge points and their power for a participant or
-- a project, from the arrivals and departures of its vehicles, by a named
-- criterion (decision 0045). The rule is in `modules/charging/src/size.ts`.

set search_path = nexgen, extensions;

create schema charging;
grant usage on schema charging to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Vocabulary: the connector standards, the current a profile limits in, and
-- the criterion of a sizing of charge points.
-- ---------------------------------------------------------------------------

create table charging.connector_standards (
  code          text primary key,
  name          text not null,
  -- ac or dc: what the connector delivers.
  current_type  text not null,
  -- The word OCPP 2.0.1 says it with (ConnectorEnumType), for the mapping
  -- of a station's messages.
  ocpp_code     text,
  description   text,
  published_by  text not null default 'charging',
  constraint connector_standards_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint connector_standards_current check (current_type in ('ac', 'dc'))
);

comment on table charging.connector_standards is
  'The standards a connector of a charger follows, by the name the standard gives them, with the current they deliver and the word OCPP 2.0.1 uses. Vocabulary: read by everyone signed in, written by migrations, modules and packs.';

insert into charging.connector_standards (code, name, current_type, ocpp_code, description) values
  ('iec_62196_type_1', 'IEC 62196 Type 1', 'ac', 'cType1', 'Single-phase AC vehicle connector (SAE J1772).'),
  ('iec_62196_type_2', 'IEC 62196 Type 2', 'ac', 'cType2', 'Single or three-phase AC vehicle connector, as a cable on the station.'),
  ('iec_62196_type_2_socket', 'IEC 62196 Type 2 socket', 'ac', 'sType2', 'Type 2 socket on the station, the vehicle brings its cable.'),
  ('ccs1', 'Combined Charging System 1', 'dc', 'cCCS1', 'DC fast charging on a Type 1 inlet (IEC 62196-3).'),
  ('ccs2', 'Combined Charging System 2', 'dc', 'cCCS2', 'DC fast charging on a Type 2 inlet (IEC 62196-3).'),
  ('chademo', 'CHAdeMO', 'dc', 'cG105', 'DC fast charging by the CHAdeMO protocol (IEC 62196-3 configuration AA).'),
  ('sae_j3400', 'SAE J3400', 'ac', 'cTesla', 'North American Charging Standard connector; AC or DC by the station, AC here unless the EVSE says DC.'),
  ('gb_t_ac', 'GB/T 20234.2', 'ac', 'cGBT', 'AC vehicle connector of the GB/T 20234 standard.'),
  ('gb_t_dc', 'GB/T 20234.3', 'dc', 'cGBT', 'DC vehicle connector of the GB/T 20234 standard.'),
  ('mcs', 'Megawatt Charging System', 'dc', null, 'DC charging of heavy vehicles (IEC 63379).'),
  ('domestic_socket', 'Domestic socket', 'ac', 'sDomestic', 'A household socket; which one is the data of the place.'),
  ('other', 'Other', 'ac', 'Other1PhMax16A', 'A connector of no standard above; the EVSE says its power.');

alter table charging.connector_standards enable row level security;
create policy charging_connector_standards_read on charging.connector_standards for select to authenticated using (true);
grant select on charging.connector_standards to authenticated;
grant select, insert, update, delete on charging.connector_standards to service_role;

-- A profile limits power (W) or current (A); current is a quantity of its
-- own, stored in amperes.
insert into units (code, name, symbol, quantity_kind, factor, "offset", published_by)
values ('A', 'Ampere', 'A', 'ElectricCurrent', 1, 0, 'charging')
on conflict (code) do nothing;
insert into quantities (code, name, unit, aggregation, qudt_quantity_kind, description, published_by)
values ('current', 'Electric current', 'A', 'mean', 'ElectricCurrent',
        'An electric current per phase, as a charging profile limits it.', 'charging')
on conflict (code) do nothing;

insert into sizing_criteria (code, name, aim, description, published_by) values
  ('demand_served', 'Demand served', 'target',
   'The share of the energy the vehicles ask for that is delivered before they leave, aimed at a target between 0 and 1.', 'charging')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- devices — the charger, a device of type charger.
-- ---------------------------------------------------------------------------

create table charging.devices (
  id               uuid primary key,
  -- Copied from the device by trigger, for row level security.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The greatest power the station delivers at once, all EVSEs together;
  -- null: the device's rated power.
  max_power_kw     numeric(12, 3),
  -- Its identity in OCPP: the id it connects to its central system with,
  -- and the version of the protocol it speaks.
  charge_point_id  text,
  ocpp_version     text,
  -- The meter of its participant it sits behind.
  meter_id         uuid references meters(id) on delete set null,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint devices_max_power_positive check (max_power_kw is null or max_power_kw > 0),
  constraint devices_charge_point_id_not_blank check (charge_point_id is null or btrim(charge_point_id) <> ''),
  constraint devices_ocpp_version check (ocpp_version is null or ocpp_version in ('1.6', '2.0.1', '2.1'))
);

comment on table charging.devices is
  'An electric vehicle charger: a device of type charger, with the greatest power of the station, its OCPP identity (charge point id, protocol version) and the meter it sits behind. Its EVSEs and connectors are charging.connectors. Read with `from devices join charging.devices using (id)`.';

call derive_devices('charging.devices', 'charger');

create or replace function charging.devices_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  d devices%rowtype;
begin
  select * into d from devices where id = new.id;
  new.organisation_id := d.organisation_id;
  if new.meter_id is not null and not exists (select 1 from meters m where m.id = new.meter_id and m.participant_id = d.participant_id) then
    raise exception 'meter_of_other_participant: meter % is not a meter of the participant of charger %', new.meter_id, new.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function charging.devices_check() is
  'BEFORE INSERT / UPDATE on charging.devices: copies the organisation of the device; the meter is one of its participant''s (meter_of_other_participant).';

create trigger devices_check before insert or update of id, meter_id on charging.devices
  for each row execute function charging.devices_check();
create trigger devices_set_updated_at before update on charging.devices
  for each row execute function set_updated_at();
create index devices_organisation_idx on charging.devices (organisation_id);
-- A station connects with one id in its organisation.
create unique index devices_charge_point_id on charging.devices (organisation_id, charge_point_id) where charge_point_id is not null;
call secure_table('charging.devices');

-- ---------------------------------------------------------------------------
-- connectors — the EVSEs of a charger and their connectors.
-- ---------------------------------------------------------------------------

create table charging.connectors (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  device_id        uuid not null references charging.devices(id) on delete cascade,
  -- The EVSE, numbered from 1 as OCPP numbers it, and the connector on it,
  -- numbered from 1. OCPP 1.6 knows connectors only: each is its own EVSE,
  -- with the same number.
  evse_id          integer not null,
  connector_id     integer not null default 1,
  standard         text not null references charging.connector_standards(code),
  current_type     text not null,
  -- 1 or 3 for AC; null for DC.
  phases           smallint,
  max_power_kw     numeric(12, 3),
  max_current_a    numeric(8, 2),
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint connectors_numbers check (evse_id > 0 and connector_id > 0),
  constraint connectors_current check (current_type in ('ac', 'dc')),
  constraint connectors_phases check ((current_type = 'ac' and phases in (1, 2, 3)) or (current_type = 'dc' and phases is null)),
  constraint connectors_power check (max_power_kw is null or max_power_kw > 0),
  constraint connectors_current_limit check (max_current_a is null or max_current_a > 0),
  constraint connectors_once unique (device_id, evse_id, connector_id)
);

comment on table charging.connectors is
  'The EVSEs of a charger (numbered from 1, as OCPP numbers them) and their connectors: standard, current type, phases (AC only), greatest power and current.';

create or replace function charging.connectors_organisation()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from charging.devices where id = new.device_id);
  return new;
end;
$$;

create trigger connectors_organisation before insert or update of device_id on charging.connectors
  for each row execute function charging.connectors_organisation();
create trigger connectors_set_updated_at before update on charging.connectors
  for each row execute function set_updated_at();
create index connectors_organisation_idx on charging.connectors (organisation_id);
call secure_table('charging.connectors');

-- ---------------------------------------------------------------------------
-- sessions — what a charger delivered to one vehicle.
-- ---------------------------------------------------------------------------

create table charging.sessions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  device_id        uuid not null references charging.devices(id) on delete cascade,
  evse_id          integer,
  connector_id     integer,
  -- The transaction as its source names it: the transaction id of the
  -- station (OCPP), or of the file a session was read from.
  transaction_id   text not null,
  started_at       timestamptz not null,
  ended_at         timestamptz,
  energy_kwh       double precision,
  peak_power_kw    double precision,
  -- The token that authorised the session (an RFID card, a contract id),
  -- as the station read it, and its type. Personal data: it may name a
  -- person; it is kept as given and never resolved by the module.
  id_token         text,
  id_token_type    text,
  -- The vehicle, when the station or the file says it.
  vehicle          text,
  stop_reason      text,
  -- Where it comes from: a station, through its central system, or a file;
  -- `source_ref` names which (a charge point id, a file name).
  source           text not null default 'station',
  source_ref       text,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sessions_source check (source in ('station', 'file')),
  constraint sessions_transaction_not_blank check (btrim(transaction_id) <> ''),
  constraint sessions_order check (ended_at is null or ended_at >= started_at),
  constraint sessions_energy check (energy_kwh is null or energy_kwh >= 0),
  constraint sessions_peak check (peak_power_kw is null or peak_power_kw >= 0),
  constraint sessions_once unique (device_id, source, transaction_id)
);

comment on table charging.sessions is
  'A charging session of a charger: its EVSE and connector, start and end, energy delivered, peak power, the id token the station read (personal data, kept as given), the vehicle when known, why it stopped, where it comes from (a station, a file) and the transaction id at that source, once per source. Its power and energy are series of the device.';
comment on column charging.sessions.id_token is
  'The token that authorised the session, as the station read it. Personal data: it may identify a person.';

create or replace function charging.sessions_organisation()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from charging.devices where id = new.device_id);
  return new;
end;
$$;

create trigger sessions_organisation before insert or update of device_id on charging.sessions
  for each row execute function charging.sessions_organisation();
create trigger sessions_set_updated_at before update on charging.sessions
  for each row execute function set_updated_at();
create index sessions_organisation_idx on charging.sessions (organisation_id);
create index sessions_device_started_idx on charging.sessions (device_id, started_at);
call secure_table('charging.sessions');

-- Records a session of a charger, once per transaction of its source: the
-- first message creates it, the next ones complete it (a stop adds its end,
-- its energy and why it stopped); a field already known is kept unless the
-- new message says it.
create or replace function charging.record(
  p_device_id   uuid,
  p_session     jsonb,
  p_source      text default 'station',
  p_source_ref  text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_tx   text := nullif(btrim(p_session->>'transaction_id'), '');
  v_id   uuid;
  v_evse integer := (p_session->>'evse_id')::integer;
  v_conn integer := (p_session->>'connector_id')::integer;
begin
  if not exists (select 1 from charging.devices where id = p_device_id) then
    raise exception 'charger_not_described: % has no row in charging.devices', p_device_id using errcode = 'no_data_found';
  end if;
  if v_tx is null then
    raise exception 'transaction_id_required: a session is recorded by the transaction id of its source' using errcode = 'not_null_violation';
  end if;
  if v_evse is not null and exists (select 1 from charging.connectors where device_id = p_device_id)
     and not exists (select 1 from charging.connectors where device_id = p_device_id and evse_id = v_evse
                       and (v_conn is null or connector_id = v_conn)) then
    raise exception 'connector_unknown: charger % has no EVSE % connector %', p_device_id, v_evse, coalesce(v_conn::text, 'any')
      using errcode = 'foreign_key_violation';
  end if;

  select id into v_id from charging.sessions
   where device_id = p_device_id and source = p_source and transaction_id = v_tx;
  if v_id is null then
    if p_session->>'started_at' is null then
      raise exception 'session_start_required: transaction % is not known yet and the message does not say when it started', v_tx
        using errcode = 'not_null_violation';
    end if;
    insert into charging.sessions (device_id, evse_id, connector_id, transaction_id, started_at, ended_at, energy_kwh, peak_power_kw,
                                   id_token, id_token_type, vehicle, stop_reason, source, source_ref, metadata)
    values (p_device_id, v_evse, v_conn, v_tx, (p_session->>'started_at')::timestamptz, (p_session->>'ended_at')::timestamptz,
            (p_session->>'energy_kwh')::double precision, (p_session->>'peak_power_kw')::double precision,
            p_session->>'id_token', p_session->>'id_token_type', p_session->>'vehicle', p_session->>'stop_reason',
            p_source, p_source_ref, coalesce(p_session->'metadata', '{}'))
    returning id into v_id;
  else
    update charging.sessions s set
      evse_id       = coalesce(v_evse, s.evse_id),
      connector_id  = coalesce(v_conn, s.connector_id),
      started_at    = coalesce((p_session->>'started_at')::timestamptz, s.started_at),
      ended_at      = coalesce((p_session->>'ended_at')::timestamptz, s.ended_at),
      energy_kwh    = coalesce((p_session->>'energy_kwh')::double precision, s.energy_kwh),
      peak_power_kw = greatest((p_session->>'peak_power_kw')::double precision, s.peak_power_kw),
      id_token      = coalesce(p_session->>'id_token', s.id_token),
      id_token_type = coalesce(p_session->>'id_token_type', s.id_token_type),
      vehicle       = coalesce(p_session->>'vehicle', s.vehicle),
      stop_reason   = coalesce(p_session->>'stop_reason', s.stop_reason),
      source_ref    = coalesce(p_source_ref, s.source_ref),
      metadata      = s.metadata || coalesce(p_session->'metadata', '{}')
     where s.id = v_id;
  end if;
  return v_id;
end;
$$;

comment on function charging.record(uuid, jsonb, text, text) is
  'Records a charging session of a charger once per (source, transaction id): {transaction_id, evse_id, connector_id, started_at, ended_at, energy_kwh, peak_power_kw, id_token, id_token_type, vehicle, stop_reason, metadata}; a later message of the same transaction completes it. Refuses charger_not_described, transaction_id_required, connector_unknown, session_start_required. Returns its id.';

grant execute on function charging.record(uuid, jsonb, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- profiles — the limits a charger is asked to keep, each a command.
-- ---------------------------------------------------------------------------

create table charging.profiles (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  device_id        uuid not null references charging.devices(id) on delete cascade,
  -- The number the station knows the profile by (chargingProfileId).
  profile_number   integer generated by default as identity,
  -- 0: the whole station; else the EVSE it limits.
  evse_id          integer not null default 0,
  -- What it limits: the whole station, the default of every transaction,
  -- one transaction, or a limit from outside (a grid operator, an energy
  -- manager).
  purpose          text not null,
  stack_level      integer not null default 0,
  -- absolute: from `starts_at`; relative: from the start of the
  -- transaction; recurring: from `starts_at`, every day or week.
  kind             text not null default 'absolute',
  recurrency       text,
  -- W or A, as the station limits; the setpoint series is in kW or A.
  rate_unit        text not null,
  starts_at        timestamptz,
  duration_s       integer,
  valid_from       timestamptz,
  valid_to         timestamptz,
  transaction_id   text,
  -- The periods: [{start_s, limit, phases}], from the start of the
  -- profile, in seconds, the limit in the rate unit.
  periods          jsonb not null,
  -- The setpoint series of the device its effect is stored in, and the
  -- command of the `actions` module that carries it, by id (no foreign key
  -- to another module).
  series_id        uuid not null references series(id) on delete cascade,
  action_id        uuid not null unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint profiles_evse check (evse_id >= 0),
  constraint profiles_purpose check (purpose in ('station_max', 'tx_default', 'tx', 'external_constraints')),
  constraint profiles_stack_level check (stack_level >= 0),
  constraint profiles_kind check (kind in ('absolute', 'relative', 'recurring')),
  constraint profiles_recurrency check ((kind = 'recurring') = (recurrency in ('daily', 'weekly'))),
  constraint profiles_start check (kind = 'relative' or starts_at is not null),
  constraint profiles_rate_unit check (rate_unit in ('W', 'A')),
  constraint profiles_duration check (duration_s is null or duration_s > 0),
  constraint profiles_transaction check ((purpose = 'tx') = (transaction_id is not null)),
  constraint profiles_periods check (jsonb_typeof(periods) = 'array' and jsonb_array_length(periods) > 0)
);

comment on table charging.profiles is
  'A charging profile asked of a charger (OCPP SetChargingProfile): the EVSE (0 for the station), purpose, stack level, kind and recurrency, rate unit (W or A), start, duration, validity, transaction, and its periods [{start_s, limit, phases}]; the setpoint series its effect is stored in and the command action of the actions module that carries it.';

create or replace function charging.profiles_organisation()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from charging.devices where id = new.device_id);
  return new;
end;
$$;

create trigger profiles_organisation before insert or update of device_id on charging.profiles
  for each row execute function charging.profiles_organisation();
create trigger profiles_set_updated_at before update on charging.profiles
  for each row execute function set_updated_at();
create index profiles_organisation_idx on charging.profiles (organisation_id);
create index profiles_device_idx on charging.profiles (device_id);
call secure_table('charging.profiles');

-- Asks a charger to keep a charging profile: the schedule
-- {evse_id, purpose, stack_level, kind, recurrency, rate_unit, starts_at,
-- duration_s, valid_from, valid_to, transaction_id, periods} becomes a
-- command action on the charger, proposed, on its setpoint series of power
-- (kW) or current (A) for that EVSE, with the limit of the first period as
-- its value; the schedule is kept in charging.profiles. Once validated, the
-- central system sends it and charging.report() records the answer.
create or replace function charging.limit(
  p_device_id   uuid,
  p_schedule    jsonb,
  p_source      text default 'person',
  p_source_ref  text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_unit     text := coalesce(p_schedule->>'rate_unit', 'W');
  v_evse     integer := coalesce((p_schedule->>'evse_id')::integer, 0);
  v_periods  jsonb := p_schedule->'periods';
  v_first    double precision;
  v_due      timestamptz;
  v_series   uuid;
  v_action   uuid;
begin
  if not exists (select 1 from charging.devices where id = p_device_id) then
    raise exception 'charger_not_described: % has no row in charging.devices', p_device_id using errcode = 'no_data_found';
  end if;
  if to_regprocedure('actions.command(uuid, double precision, timestamptz, text, text, text, uuid)') is null then
    raise exception 'module_required: a charging profile is a command of the actions module, which is not installed' using errcode = 'undefined_function';
  end if;
  if v_periods is null or jsonb_typeof(v_periods) <> 'array' or jsonb_array_length(v_periods) = 0 then
    raise exception 'schedule_periods_required: a charging profile has at least one period' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from jsonb_array_elements(v_periods) e
              where (e->>'start_s') is null or (e->>'limit') is null or (e->>'start_s')::numeric < 0 or (e->>'limit')::numeric < 0)
     or (v_periods->0->>'start_s')::numeric <> 0
     or exists (select 1 from jsonb_array_elements(v_periods) with ordinality e(p, i)
                  join jsonb_array_elements(v_periods) with ordinality f(p, j) on j = i + 1
                 where (f.p->>'start_s')::numeric <= (e.p->>'start_s')::numeric) then
    raise exception 'schedule_periods_invalid: periods start at 0 s and grow, each with a limit of 0 or more' using errcode = 'invalid_parameter_value';
  end if;
  if v_unit not in ('W', 'A') then
    raise exception 'rate_unit_invalid: a charging profile limits in W or A, not %', v_unit using errcode = 'invalid_parameter_value';
  end if;
  if v_evse > 0 and exists (select 1 from charging.connectors where device_id = p_device_id)
     and not exists (select 1 from charging.connectors where device_id = p_device_id and evse_id = v_evse) then
    raise exception 'connector_unknown: charger % has no EVSE %', p_device_id, v_evse using errcode = 'foreign_key_violation';
  end if;

  v_first := (v_periods->0->>'limit')::double precision;
  v_due := coalesce((p_schedule->>'starts_at')::timestamptz, (p_schedule->>'valid_from')::timestamptz, now());
  v_series := series_ensure('device', p_device_id, case v_unit when 'W' then 'power' else 'current' end, 'setpoint', 'instant',
                            null, p_device_id, null, null, case when v_evse = 0 then 'charging limit, station' else format('charging limit, EVSE %s', v_evse) end);
  v_action := actions.command(v_series, case v_unit when 'W' then v_first / 1000 else v_first end, v_due,
                              format('Charging profile: %s %s from %s', v_first, v_unit, v_due), p_source, p_source_ref);
  insert into charging.profiles (device_id, evse_id, purpose, stack_level, kind, recurrency, rate_unit, starts_at, duration_s,
                                 valid_from, valid_to, transaction_id, periods, series_id, action_id)
  values (p_device_id, v_evse, coalesce(p_schedule->>'purpose', 'tx_default'), coalesce((p_schedule->>'stack_level')::integer, 0),
          coalesce(p_schedule->>'kind', 'absolute'), p_schedule->>'recurrency', v_unit, (p_schedule->>'starts_at')::timestamptz,
          (p_schedule->>'duration_s')::integer, (p_schedule->>'valid_from')::timestamptz, (p_schedule->>'valid_to')::timestamptz,
          p_schedule->>'transaction_id', v_periods, v_series, v_action);
  return v_action;
end;
$$;

comment on function charging.limit(uuid, jsonb, text, text) is
  'Asks a charger to keep a charging profile: {evse_id, purpose (station_max, tx_default, tx, external_constraints), stack_level, kind (absolute, relative, recurring), recurrency, rate_unit (W or A), starts_at, duration_s, valid_from, valid_to, transaction_id, periods [{start_s, limit, phases}]}. Creates the command action on its setpoint series of power or current (actions.command()) and keeps the schedule in charging.profiles. Refuses charger_not_described, module_required, schedule_periods_required, schedule_periods_invalid, rate_unit_invalid, connector_unknown, and what charging.profiles checks. Returns the action id.';

-- What the station answered to a profile, as the central system reports it:
-- accepted at an instant, the command is done (actions.report()) and every
-- period of the schedule still to come is stored in the setpoint series at
-- its start, or at the instant of the answer for the period running then;
-- refused, or not answered in time, the command failed and says why.
create or replace function charging.report(p_action_id uuid, p_at timestamptz, p_failure text default null)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  pr      charging.profiles%rowtype;
  v_start timestamptz;
  v_at    timestamptz[];
  v_val   double precision[];
begin
  select * into pr from charging.profiles where action_id = p_action_id;
  if not found then
    raise exception 'profile_not_found: action % carries no charging profile', p_action_id using errcode = 'no_data_found';
  end if;
  perform actions.report(p_action_id, p_at, p_failure);
  if p_failure is not null then
    return;
  end if;
  -- A relative profile starts when it is accepted; a recurring one is
  -- stored for its first recurrence.
  v_start := case when pr.kind = 'relative' then p_at else pr.starts_at end;
  select array_agg(greatest(t.at, p_at) order by t.at), array_agg(t.value order by t.at)
    into v_at, v_val
    from (select v_start + make_interval(secs => (e->>'start_s')::double precision) as at,
                 lead(v_start + make_interval(secs => (e->>'start_s')::double precision)) over (order by (e->>'start_s')::double precision) as next_at,
                 (e->>'limit')::double precision / case pr.rate_unit when 'W' then 1000 else 1 end as value
            from jsonb_array_elements(pr.periods) e) t
   where t.next_at is null or t.next_at > p_at;
  if v_at is not null then
    perform store(pr.series_id, v_at, v_val);
  end if;
end;
$$;

comment on function charging.report(uuid, timestamptz, text) is
  'What a charger answered to a charging profile: accepted at an instant, its command is done and the periods still to come are stored in its setpoint series (kW or A), the one running at that instant from that instant; with a failure (refused, not supported, timeout), the command failed and says why. Refuses profile_not_found, and what actions.report() refuses.';

grant execute on function charging.limit(uuid, jsonb, text, text), charging.report(uuid, timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- estimates — what the module computed (decision 0004).
-- ---------------------------------------------------------------------------

create table charging.estimates (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- Its subject: the participant or the project the charge points are
  -- sized for.
  participant_id   uuid references participants(id) on delete cascade,
  project_id       uuid references projects(id) on delete cascade,
  criterion        text not null references sizing_criteria(code),
  -- Where it comes from: the program and the version that computed it.
  provenance       text not null,
  -- What it read: the arrivals and departures, the power of the connection
  -- and where it came from, the bounds swept.
  inputs           jsonb not null,
  results          jsonb not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint estimates_one_subject check (num_nonnulls(participant_id, project_id) = 1)
);

comment on table charging.estimates is
  'What the module computed: a sizing of charge points (their number and power) for a participant or a project, by a named criterion, from the arrivals and departures of its vehicles and the power of its connection; its inputs, its provenance (the program and version), its results (the curve and the recommended point). A new computation adds an estimate.';

create index estimates_participant_idx on charging.estimates (participant_id);
create index estimates_project_idx on charging.estimates (project_id);

create or replace function charging.estimates_organisation()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := case
    when new.participant_id is not null then object_organisation('participant', new.participant_id)
    else object_organisation('project', new.project_id)
  end;
  return new;
end;
$$;

create trigger estimates_organisation before insert or update of participant_id, project_id on charging.estimates
  for each row execute function charging.estimates_organisation();
create trigger estimates_set_updated_at before update on charging.estimates
  for each row execute function set_updated_at();
create index estimates_organisation_idx on charging.estimates (organisation_id);
call secure_table('charging.estimates', null, 'participant_id');

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('charging', 'Charging', '0.3.0', 'charging', '0.3.0',
        'Electric vehicle chargers, their EVSEs and connectors, the sessions they deliver, the charging profiles they are asked to keep as commands, and the sizing of charge points, as estimates.');

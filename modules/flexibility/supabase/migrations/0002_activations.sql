-- Nexgen OS — module `flexibility` 0.2.0: an activation is a command
-- (decision 0058).
--
-- An activation is asked by a grid operator, an aggregator or an energy
-- manager: a direction, a start and an end, the power asked. Here it asks
-- one flexible device, outside an offer (offers come with their own
-- migration). It is carried out as a command of the `actions` module on the
-- setpoint series of power of the device, at its start: the person, or an
-- agent the person allowed, validates it, a connector carries it out and
-- reports it. The activation keeps the id of its command, with no foreign
-- key to another module; what the device delivered is never a column of
-- it, it is read from the series of its meter.

set search_path = nexgen, extensions;

create table flexibility.activations (
  id               uuid primary key default gen_random_uuid(),
  -- Copied from the device by trigger, for row level security.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  device_id        uuid not null references flexibility.devices(id) on delete cascade,
  -- up: more injection or less offtake; down: less injection or more
  -- offtake, as the grid sees the device.
  direction        text not null,
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  -- The power asked, kW, a change from the operating point of the device.
  requested_kw     numeric(12, 3) not null,
  -- Who asked, as a contact of the core, and in which market role
  -- (`grid.market_parties` says it when `grid` is installed).
  requested_by     uuid references contacts(id) on delete set null,
  requested_role   text,
  -- The reference the requester gave it.
  external_ref     text,
  -- The command that carries it out (actions.command()), by id.
  command_id       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint activations_direction check (direction in ('up', 'down')),
  constraint activations_period check (end_at > start_at),
  constraint activations_power_positive check (requested_kw > 0)
);

comment on table flexibility.activations is
  'An activation of a flexible device, asked by a grid operator, an aggregator or an energy manager: its direction, start and end (UTC), the power asked (kW), who asked and in which role, their reference, and the id of the command of the actions module that carries it out. What the device delivered is read from the series of its meter.';

create index activations_device_idx on flexibility.activations (device_id, start_at);
create index activations_organisation_idx on flexibility.activations (organisation_id);

create or replace function flexibility.activations_organisation()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from flexibility.devices where id = new.device_id);
  return new;
end;
$$;

comment on function flexibility.activations_organisation() is
  'BEFORE INSERT / UPDATE on activations: copies the organisation of the device.';

create trigger activations_organisation before insert or update of device_id on flexibility.activations
  for each row execute function flexibility.activations_organisation();
create trigger activations_set_updated_at before update on flexibility.activations
  for each row execute function set_updated_at();
call secure_table('flexibility.activations', null, 'participant_of(''device'', device_id)');

-- ---------------------------------------------------------------------------
-- activate — an activation, and the command that carries it out.
-- ---------------------------------------------------------------------------

create or replace function flexibility.activate(
  p_device_id       uuid,
  p_direction       text,
  p_start_at        timestamptz,
  p_end_at          timestamptz,
  p_requested_kw    numeric,
  p_requested_by    uuid default null,
  p_requested_role  text default null,
  p_external_ref    text default null,
  p_source          text default 'person'
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  d         flexibility.devices%rowtype;
  v_cap     numeric;
  v_length  interval := p_end_at - p_start_at;
  v_id      uuid := gen_random_uuid();
  v_series  uuid;
  v_action  uuid;
begin
  select * into d from flexibility.devices where id = p_device_id;
  if not found then
    raise exception 'device_not_flexible: % has no row in flexibility.devices', p_device_id using errcode = 'no_data_found';
  end if;
  if to_regprocedure('actions.command(uuid, double precision, timestamptz, text, text, text, uuid)') is null then
    raise exception 'module_required: an activation is a command of the actions module, which is not installed' using errcode = 'undefined_function';
  end if;
  if p_direction is null or p_direction not in ('up', 'down') then
    raise exception 'direction_invalid: %', p_direction using errcode = 'invalid_parameter_value';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'activation_period_invalid: from % to %', p_start_at, p_end_at using errcode = 'invalid_parameter_value';
  end if;
  if (d.min_duration is not null and v_length < d.min_duration) or (d.max_duration is not null and v_length > d.max_duration) then
    raise exception 'activation_duration_invalid: % outside % to %', v_length, d.min_duration, d.max_duration using errcode = 'check_violation';
  end if;
  v_cap := case p_direction when 'up' then d.power_up_kw else d.power_down_kw end;
  if p_requested_kw is null or p_requested_kw <= 0 or (v_cap is not null and p_requested_kw > v_cap) then
    raise exception 'activation_power_invalid: % kW asked, % kW % at most', p_requested_kw, v_cap, p_direction using errcode = 'check_violation';
  end if;
  if d.min_step_kw is not null and mod(p_requested_kw, d.min_step_kw) <> 0 then
    raise exception 'activation_step_invalid: % kW is not a multiple of % kW', p_requested_kw, d.min_step_kw using errcode = 'check_violation';
  end if;

  insert into flexibility.activations (id, device_id, direction, start_at, end_at, requested_kw, requested_by, requested_role, external_ref)
  values (v_id, p_device_id, p_direction, p_start_at, p_end_at, p_requested_kw, p_requested_by, p_requested_role, p_external_ref);

  v_series := series_ensure('device', p_device_id, 'power', 'setpoint', 'instant',
                            null, p_device_id, null, null, 'flexibility setpoint');
  v_action := actions.command(v_series, p_requested_kw::double precision, p_start_at,
                              format('Flexibility activation: %s kW %s from %s to %s', p_requested_kw, p_direction, p_start_at, p_end_at),
                              p_source, 'flexibility.activations:' || v_id);
  update flexibility.activations set command_id = v_action where id = v_id;
  return v_id;
end;
$$;

comment on function flexibility.activate(uuid, text, timestamptz, timestamptz, numeric, uuid, text, text, text) is
  'An activation of a flexible device: its direction (up or down), its start and end, the power asked (kW), who asked, in which role, with which reference. Checked against what the device declares (power up or down, minimum step, shortest and longest activation), kept in flexibility.activations, and carried out as a command of the actions module on the setpoint series of power of the device at its start (actions.command(), source ref flexibility.activations:<id>). Refuses device_not_flexible, module_required, direction_invalid, activation_period_invalid, activation_duration_invalid, activation_power_invalid, activation_step_invalid, and what actions.command() refuses. Returns its id.';

grant execute on function flexibility.activate(uuid, text, timestamptz, timestamptz, numeric, uuid, text, text, text) to authenticated, service_role;

update modules
   set version = '0.2.0',
       description = 'What a device can be asked upwards and downwards from its operating point, with the same id, the power a generator can give up interval by interval, read from its production series, and the activations asked of it, each carried out as a command.'
 where code = 'flexibility';

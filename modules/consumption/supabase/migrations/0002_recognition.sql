-- Nexgen OS — module `consumption`: a device recognised by disaggregation.
--
-- A disaggregation source — a third-party insights service, a model run by
-- the installation — reads the curve of a meter and recognises the
-- equipment behind it (a heat pump, an electric vehicle, a water heater, a
-- PV system), with how sure it is and the consumption it estimates for it.
-- It fits the objects that exist, with no table of its own:
--
--   * the equipment is a device of the participant, `source_code` = the
--     source that recognised it (a `sources` row the installation names);
--   * its estimated consumption is a series of the device, kind
--     `simulated`, signed by the same source, whose values the source
--     stores with store();
--   * how sure the source is, 0 to 1, is the attribute
--     `recognition_confidence` of the device, with its source;
--   * the question to the end customer — "a heat pump is recognised:
--     confirm?" — is an action of kind `recommendation` on the device,
--     `source = 'detector'`, `source_ref` = the source, resting on the
--     simulated series as its estimate. Validated (actions.decide(), by the
--     account of the participant), the device becomes the customer's
--     declaration (`customer_declaration`); dismissed, the device is
--     retired (`removed` on the day). Its series stays the source's.

set search_path = nexgen, extensions;

create or replace function consumption.recognise_device(
  p_participant_id uuid,
  p_device_type    text,
  p_source_code    text,
  p_confidence     numeric,
  p_name           text default null,
  p_quantity_code  text default 'consumption_energy',
  p_step           interval default interval '1 hour',
  p_at             timestamptz default now()
)
returns table (device_id uuid, series_id uuid, action_id uuid, created boolean)
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  p     participants%rowtype;
  v_device uuid;
  v_series uuid;
  v_action uuid;
  v_type text;
begin
  select * into p from participants where id = p_participant_id;
  if p.id is null then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  select name into v_type from device_types where code = p_device_type;
  if v_type is null then
    raise exception 'device_type_unknown: %', p_device_type using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from sources where code = p_source_code) then
    raise exception 'source_unknown: %', p_source_code using errcode = 'foreign_key_violation';
  end if;
  if p_confidence is null or p_confidence < 0 or p_confidence > 1 then
    raise exception 'invalid_value: a confidence is between 0 and 1, not %', p_confidence using errcode = 'check_violation';
  end if;

  -- Once per participant, device type and source: the recommendation that
  -- asked about it names the source, whatever became of the device since.
  select a.object_id, a.estimate_id, a.id into v_device, v_series, v_action
    from actions.actions a
    join devices d on d.id = a.object_id
   where a.object_kind = 'device' and a.kind = 'recommendation' and a.source = 'detector'
     and a.source_ref = p_source_code and d.participant_id = p_participant_id and d.device_type = p_device_type
   order by a.created_at
   limit 1;
  if v_action is not null then
    -- A later reading of the same source updates how sure it is, while the
    -- device is still its own.
    if exists (select 1 from devices d where d.id = v_device and d.source_code = p_source_code and d.status <> 'removed') then
      perform set_attribute('device', v_device, 'recognition_confidence', to_jsonb(p_confidence), p_at, p_source_code);
    end if;
    return query select v_device, v_series, v_action, false;
    return;
  end if;

  insert into devices (organisation_id, participant_id, name, device_type, status, source_code)
  values (p.organisation_id, p.id, coalesce(p_name, v_type), p_device_type, 'in_service', p_source_code)
  returning id into v_device;
  perform set_attribute('device', v_device, 'recognition_confidence', to_jsonb(p_confidence), p_at, p_source_code);
  v_series := series_ensure('device', v_device, p_quantity_code, 'simulated', 'interval', p_step, v_device,
                            null, p_source_code, null, '{}'::jsonb, null);
  v_action := actions.propose('device', v_device, 'operation', format('%s recognised: confirm?', v_type),
                              'detector', p_source_code, 'nexgen.series', v_series);
  return query select v_device, v_series, v_action, true;
end;
$$;

comment on function consumption.recognise_device(uuid, text, text, numeric, text, text, interval, timestamptz) is
  'Records an equipment a disaggregation source recognised behind the meters of a participant: a device of the participant signed by the source, its confidence (recognition_confidence, 0 to 1), the simulated series of its estimated consumption (consumption_energy on an hourly step unless said otherwise) whose values the source stores, and the recommendation that asks the end customer to confirm it. Once per participant, device type and source: a second call returns what the first created (created = false) and updates the confidence. Refuses participant_not_found, device_type_unknown, source_unknown, invalid_value. Returns (device_id, series_id, action_id, created).';

-- What the end customer answered: validated, the device is its declaration;
-- dismissed, the device is retired on the day.
create or replace function consumption.recognition_decided()
returns trigger
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if new.status = 'validated' then
    update devices set source_code = 'customer_declaration'
     where id = new.object_id and source_code = new.source_ref;
  elsif new.status = 'dismissed' then
    update devices set status = 'removed', removal_date = current_date
     where id = new.object_id and source_code = new.source_ref and status <> 'removed';
  end if;
  return new;
end;
$$;

comment on function consumption.recognition_decided() is
  'AFTER UPDATE OF status on actions.actions, for a recommendation a disaggregation source made about a device (consumption.recognise_device()): validated, the device becomes the customer''s declaration; dismissed, it is retired.';

create trigger recognition_decided
  after update of status on actions.actions
  for each row
  when (new.kind = 'recommendation' and new.source = 'detector' and new.object_kind = 'device'
        and new.estimate_kind = 'nexgen.series' and new.status is distinct from old.status)
  execute function consumption.recognition_decided();

grant execute on function consumption.recognise_device(uuid, text, text, numeric, text, text, interval, timestamptz)
  to authenticated, service_role;

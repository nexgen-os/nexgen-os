-- Nexgen OS — core: a device moves from planned to in service, and back out
-- of service, by named transitions (`set_device_status()`).
--
-- A device carries one status of the core (`planned`, `installed`,
-- `in_service`, `out_of_service`, `removed`): `install_device()` gives the
-- first, `retire_device()` and `replace_device()` the last. What happens in
-- between — the device set in place, commissioned, failing, repaired — is
-- the works and the life of the place, and the one gesture for it is here.
-- What was done to get there (the commissioning test, its report, the
-- photos) is a step of the `commissioning` phase of the `actions` module and
-- the documents of the device: the core keeps where the device stands, the
-- module what was done, and `actions.progress()` reads both.
--
-- | From | To |
-- |---|---|
-- | `planned` | `installed`, `in_service` |
-- | `installed` | `in_service`, `out_of_service` (it failed its commissioning) |
-- | `in_service` | `out_of_service` |
-- | `out_of_service` | `in_service` |
--
-- A device leaves `planned` on the day given, which becomes its installation
-- date. A move to `removed` is `retire_device()`'s, which dates it. The
-- move is made under the rights of the person: one who does not reach the
-- device does not find it, one who only reads it is refused.

set search_path = nexgen, extensions;

create or replace function set_device_status(p_device_id uuid, p_status text, p_on date default current_date)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
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
  if p_status = 'removed' then
    raise exception 'device_status_invalid: a device is removed by retire_device(), which dates its removal' using errcode = 'check_violation';
  end if;
  if p_status is null or p_status not in ('planned', 'installed', 'in_service', 'out_of_service') then
    raise exception 'device_status_invalid: % is not a status of a device (planned, installed, in_service, out_of_service, removed)', p_status
      using errcode = 'check_violation';
  end if;
  if p_on is null or p_on > current_date then
    raise exception 'device_day_invalid: a device moves on a day that has come, not on %', coalesce(p_on::text, 'no day')
      using errcode = 'check_violation';
  end if;
  if not (d.status, p_status) in (
    ('planned', 'installed'), ('planned', 'in_service'),
    ('installed', 'in_service'), ('installed', 'out_of_service'),
    ('in_service', 'out_of_service'),
    ('out_of_service', 'in_service')
  ) then
    raise exception 'device_status_invalid: % is %, and does not move to %', d.name, d.status, p_status using errcode = 'check_violation';
  end if;
  if d.installation_date is not null and p_on < d.installation_date and d.status <> 'planned' then
    raise exception 'device_day_invalid: % was installed on %, before %', d.name, d.installation_date, p_on using errcode = 'check_violation';
  end if;
  update devices
     set status = p_status,
         installation_date = case when d.status = 'planned' then p_on else installation_date end
   where id = p_device_id;
  if not found then
    raise exception 'not_allowed: % is read, not changed, by this person: a device moves under the rights that change it', d.name
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function set_device_status(uuid, text, date) is
  'Moves a device on a day by a named transition: planned to installed or in_service (the day becomes its installation date), installed to in_service or out_of_service, in_service to out_of_service and back. Refuses device_not_found, device_retired, device_status_invalid (another move, or removed, which is retire_device()''s), device_day_invalid (a day to come, or before its installation), not_allowed (a person who reads the device without the right to change it).';

grant execute on function set_device_status(uuid, text, date) to authenticated, service_role;

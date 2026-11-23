-- Nexgen OS — solar: the rated power of a PV system is its peak DC power,
-- one figure (decision 0065).
--
-- A PV system is a device of the core, and its power is the device's
-- `rated_power_kw`. The module describes it further — the system's own
-- `kwp_dc`, or its arrays, each with its own — and until here nothing kept
-- the two equal: a system could say 30 kWp in the core and 36 in its
-- arrays. From here the database carries the figure itself:
--
--   * what the module describes is the power of the device: after any
--     change of the system's `kwp_dc` or of its arrays of reality, the
--     system's `kwp_dc` is the sum of its arrays when they carry a power,
--     and the device's `rated_power_kw` is that sum, else the system's
--     `kwp_dc` (`solar.devices_power()`);
--   * the core's figure of a system the module describes is never written
--     apart from it: an update of `rated_power_kw` to another value is
--     refused, `power_from_arrays`;
--   * a system installed with its rated power and nothing more computes:
--     `solar.system_kwp()` reads the device's rated power last.
--
-- No column goes: `kwp_dc` stays where a package of an earlier release
-- reads it. Systems whose two figures differ take the module's, the more
-- detailed description; the migration says how many.

set search_path = nexgen, extensions;

create or replace function solar.system_kwp(p_device_id uuid, p_variant_id uuid default null)
returns numeric
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select coalesce(
    (select sum(a.kwp_dc) from solar.pv_arrays a
      where a.device_id = p_device_id
        and (a.variant_id is null or a.variant_id in (select variant_id from solar.variant_chain(p_variant_id)))),
    (select kwp_dc from solar.devices where id = p_device_id),
    (select rated_power_kw from devices where id = p_device_id)
  );
$$;

comment on function solar.system_kwp(uuid, uuid) is
  'Peak DC power of a PV system in kWp: the sum of its arrays, or the system''s own kwp_dc when it has no array, or the rated power of its device when the module describes none.';

-- What the module itself says of a system of reality: its arrays, else its
-- own figure. Null when it says nothing.
create or replace function solar.described_kwp(p_device_id uuid)
returns numeric
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select coalesce(
    (select sum(a.kwp_dc) from solar.pv_arrays a where a.device_id = p_device_id and a.variant_id is null),
    (select kwp_dc from solar.devices where id = p_device_id)
  );
$$;

comment on function solar.described_kwp(uuid) is
  'The peak DC power the module describes for a PV system of reality, in kWp: the sum of its arrays outside any variant, else the system''s own kwp_dc; null when it describes none. What devices.rated_power_kw is kept equal to.';

-- Systems described twice with two figures: the arrays win over the
-- system's own figure, and what the module describes over the core's.
do $$
declare
  n integer;
  m integer;
begin
  update solar.devices p
     set kwp_dc = x.kwp
    from (select a.device_id, sum(a.kwp_dc) kwp from solar.pv_arrays a where a.variant_id is null group by a.device_id) x
   where x.device_id = p.id and x.kwp is not null and p.kwp_dc is distinct from x.kwp;
  get diagnostics m = row_count;
  update devices d
     set rated_power_kw = solar.described_kwp(d.id)
   where solar.described_kwp(d.id) is not null
     and d.rated_power_kw is distinct from solar.described_kwp(d.id);
  get diagnostics n = row_count;
  raise notice 'solar: % PV system(s) take the power of their arrays, % device(s) the power their system describes', m, n;
end;
$$;

-- AFTER a change of a system or of one of its arrays: the system's own
-- figure is the sum of its arrays when they carry one, and the device's
-- rated power is what the module describes.
create or replace function solar.devices_power()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  r         jsonb;
  v_id      uuid;
  v_arrays  numeric;
  v         numeric;
begin
  for r in select x from (values (case when tg_op <> 'DELETE' then to_jsonb(new) end),
                                 (case when tg_op <> 'INSERT' then to_jsonb(old) end)) t(x)
            where x is not null loop
    v_id := coalesce(r->>'device_id', r->>'id')::uuid;
    v_arrays := (select sum(a.kwp_dc) from solar.pv_arrays a where a.device_id = v_id and a.variant_id is null);
    if v_arrays is not null then
      if tg_table_name = 'devices' and (to_jsonb(new)->>'kwp_dc')::numeric <> v_arrays then
        raise exception 'power_from_arrays: the power of this PV system is the % kWp of its arrays; change its arrays', v_arrays
          using errcode = 'check_violation';
      end if;
      update solar.devices set kwp_dc = v_arrays where id = v_id and kwp_dc is distinct from v_arrays;
    end if;
    v := solar.described_kwp(v_id);
    if v is not null then
      update devices set rated_power_kw = v where id = v_id and rated_power_kw is distinct from v;
    end if;
  end loop;
  return null;
end;
$$;

comment on function solar.devices_power() is
  'AFTER INSERT / UPDATE / DELETE on solar.devices and solar.pv_arrays: the system''s own kwp_dc is the sum of its arrays of reality when they carry a power (another value is refused, power_from_arrays), and the rated power of the device is the power the module describes (solar.described_kwp()), so the three never differ.';

create trigger devices_power after insert or update of kwp_dc on solar.devices
  for each row execute function solar.devices_power();
create trigger pv_arrays_power after insert or delete or update of kwp_dc, device_id, variant_id on solar.pv_arrays
  for each row execute function solar.devices_power();

-- BEFORE UPDATE of the core's figure: never another value than the module's.
create or replace function solar.devices_power_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v numeric := solar.described_kwp(new.id);
begin
  if v is not null and new.rated_power_kw is distinct from v then
    raise exception 'power_from_arrays: the power of % is the % kWp its PV system describes; change its arrays or its kwp_dc', new.name, v
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function solar.devices_power_check() is
  'BEFORE UPDATE OF rated_power_kw on devices: a device the solar module describes keeps the power its arrays or its kwp_dc give (power_from_arrays).';

create trigger solar_devices_power_check before update of rated_power_kw on devices
  for each row execute function solar.devices_power_check();

grant execute on function solar.described_kwp(uuid) to authenticated, service_role;

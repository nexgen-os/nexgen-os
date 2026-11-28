-- Nexgen OS — solar: the unit of each figure, the tilt of an array, and the
-- power of a system read against its modules and its roof.
--
-- Three things a reader of the model had to guess, said once here:
--
--   * the unit of every figure of a PV system and an array is declared on
--     its column, where the REST API and any reader of the catalogue find
--     it: a name ending in `_pct` holds a percent (0.5 for 0.5 %), a share
--     without that suffix a ratio from 0 to 1 (0.02 for 2 %);
--   * the tilt of an array is from 0 (flat) to 90 (vertical, a façade):
--     modules face the sky, and a tilt past 90 would turn them to the
--     ground. A building's surface keeps 0 to 180, the module `building`
--     describing faces that look down as well. Rows already past 90 are
--     kept as they are (the constraint is not validated against them); a
--     change of such an array asks for its tilt first;
--   * `solar.power_warnings()` names what does not add up in the power of
--     a system: an array whose DC power is not its modules times their unit
--     power (`kwp_not_modules`), a participant whose PV systems carry more
--     than its roof, carport and ground faces do (`kwp_over_roof`). A warning, never a refusal: the
--     figure stated may be the true one, and the person decides.
--
-- No value is written twice (decision 0065): the warnings read the arrays,
-- the products and the roof where they are, and keep nothing.

set search_path = nexgen, extensions;

alter table solar.pv_arrays drop constraint pv_arrays_tilt_range;
alter table solar.pv_arrays add constraint pv_arrays_tilt_range
  check (tilt_deg is null or (tilt_deg >= 0 and tilt_deg <= 90)) not valid;

comment on column solar.devices.kwp_dc is
  'Peak DC power at standard test conditions, in kWp: the sum of the arrays when they carry one (solar.system_kwp()).';
comment on column solar.devices.kva_ac is
  'The AC power the inverters may deliver, in kVA.';
comment on column solar.devices.degradation_pct_per_year is
  'Yearly loss of output from ageing, in percent a year, 0 to 5: 0.5 for 0.5 %/year.';
comment on column solar.devices.first_year_loss_pct is
  'Loss of output of the first months (light-induced degradation), in percent, 0 to 20: 2 for 2 %.';
comment on column solar.pv_arrays.azimuth_deg is
  'Azimuth of the modules in degrees clockwise from true north, 0 to 360: 180 faces south. For a tracker, its axis.';
comment on column solar.pv_arrays.tilt_deg is
  'Tilt of the modules in degrees from horizontal, 0 (flat) to 90 (vertical). For a tracker, its axis.';
comment on column solar.pv_arrays.albedo is
  'Ground reflectance seen by the array, a ratio from 0 to 1: 0.2 for 20 %.';
comment on column solar.pv_arrays.kwp_dc is
  'Peak DC power of the array, in kWp; its module product''s unit power times its module count when not given.';
comment on column solar.pv_arrays.soiling_loss is
  'The fraction of the light dirt takes from this array over a year, a ratio from 0 to 1: 0.02 for 2 %.';

-- What does not add up in the power of a PV system.
create or replace function solar.power_warnings(p_device_id uuid)
returns table (code text, message text, figures jsonb)
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_participant  uuid;
  v_installed    numeric;
  v_roof         numeric;
  v_per_area     jsonb;
begin
  -- Each array of reality whose DC power is not its modules times their unit power, by more than 1 %.
  return query
    select 'kwp_not_modules'::text,
           format('array %s says %s kWp, its %s modules of %s kW make %s kWp', a.name, a.kwp_dc, a.module_count, p.unit_power_kw,
                  round(a.module_count * p.unit_power_kw, 3)),
           jsonb_build_object('array_id', a.id, 'kwp_dc', a.kwp_dc, 'module_count', a.module_count,
                              'unit_power_kw', p.unit_power_kw, 'modules_kwp', round(a.module_count * p.unit_power_kw, 3))
      from solar.pv_arrays a
      join products p on p.id = a.module_product_id
     where a.device_id = p_device_id and a.variant_id is null
       and a.kwp_dc is not null and a.module_count is not null and p.unit_power_kw is not null
       and abs(a.kwp_dc - a.module_count * p.unit_power_kw) > 0.01 * a.module_count * p.unit_power_kw;

  -- The PV systems of the participant against what its roof, carport and ground faces carry.
  select d.participant_id into v_participant from devices d where d.id = p_device_id;
  if v_participant is null or to_regclass('building.surfaces') is null then
    return;
  end if;
  execute
    'select sum(s.area_m2) from building.surfaces s
       left join building.buildings b on b.id = s.building_id
       left join building.sites t on t.id = s.site_id
      where s.kind in (''roof'', ''carport'', ''ground'') and coalesce(b.participant_id, t.participant_id) = $1'
    into v_roof using v_participant;
  if not (v_roof > 0) then
    return;
  end if;
  begin
    v_per_area := parameter_of('participant', v_participant, 'pv_power_per_area');
  exception when others then
    -- Nobody says what a square metre carries (parameter_missing,
    -- parameter_not_decided…): nothing to read the roof against.
    if sqlerrm like 'parameter\_%' then
      return;
    end if;
    raise;
  end;
  select sum(solar.system_kwp(s.id)) into v_installed
    from solar.devices s join devices d on d.id = s.id
   where d.participant_id = v_participant;
  if v_installed > v_roof * (v_per_area->>'value')::numeric then
    return query select 'kwp_over_roof'::text,
      format('the PV systems of this participant carry %s kWp, its %s m² of roof, carport and ground carry %s kWp at %s kWp/m²',
             v_installed, v_roof, round(v_roof * (v_per_area->>'value')::numeric, 3), v_per_area->>'value'),
      jsonb_build_object('participant_id', v_participant, 'installed_kwp', v_installed, 'roof_m2', v_roof,
                         'roof_kwp', round(v_roof * (v_per_area->>'value')::numeric, 3), 'pv_power_per_area', v_per_area);
  end if;
end;
$$;

comment on function solar.power_warnings(uuid) is
  'What does not add up in the power of a PV system, one row a warning {code, message, figures}: kwp_not_modules (an array whose kwp_dc differs by more than 1 % from its module count times its module product''s unit power), kwp_over_roof (the PV systems of its participant carry more than its roof, carport and ground faces times pv_power_per_area). Reads, never refuses.';

grant execute on function solar.power_warnings(uuid) to authenticated, service_role;

update nexgen.modules set version = '0.6.0' where code = 'solar';

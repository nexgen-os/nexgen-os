-- Nexgen OS — module `solar`: the soiling of a place.
--
-- How much light dirt takes from the modules depends on the place — dust
-- from a field or a road, birds, rain, a cleaning routine — not on the
-- modelling choices of a yield profile. A profile names a `soiling` loss
-- (PVsyst's loss diagram, PV*SOL's) or folds it into one aggregate loss
-- (PVGIS, PVWatts); the place says its own value as an attribute of the
-- array, of the PV system or of its site, with its source and its period,
-- and a yield run reads it the nearest first: the array's own, then what
-- `parameter_of()` answers for its system, a device of the core.

set search_path = nexgen, public, extensions;

insert into property_defs (code, name, description, datatype, quantity_code, minimum, maximum, applies_to, published_by) values
  ('soiling_loss', 'Soiling loss',
   'The fraction of the light reaching the modules that dirt takes over a year (0.02 for 2 %), on a PV array, a PV system or every array of a site. It replaces the soiling loss of a yield profile.',
   'number', 'ratio', 0, 1, '{pv_array,device,site}', 'solar');

-- ---------------------------------------------------------------------------
-- soiling_of — the soiling an array or a system is computed with.
-- ---------------------------------------------------------------------------

create or replace function solar.soiling_of(
  p_object_id   uuid,
  p_at          timestamptz default now(),
  p_scenario_id uuid default null
)
returns jsonb
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  a       attributes%rowtype;
  v_sys   uuid;
  r       jsonb;
begin
  -- An array: its own value, then its system's cascade, where the system's
  -- own value is the device's level. A system: the core's cascade.
  select pv_system_id into v_sys from solar.pv_arrays where id = p_object_id;
  if v_sys is null then
    return parameter_of('device', p_object_id, 'soiling_loss', p_at, p_scenario_id);
  end if;
  a := attribute_at(p_object_id, 'soiling_loss', p_at, p_scenario_id);
  if a.id is not null then
    return jsonb_build_object('value', a.value, 'level', 'object', 'object_id', p_object_id,
                              'source_code', a.source_code, 'reference', a.source, 'valid_from', a.valid_from);
  end if;
  r := parameter_of('device', v_sys, 'soiling_loss', p_at, p_scenario_id);
  if r->>'level' = 'object' then
    r := r || jsonb_build_object('level', 'device');
  end if;
  return r;
exception
  when no_data_found then
    -- Nobody said it: the profile's soiling holds. Anything else (a country
    -- that decides no single value, an unknown object) is raised as it is.
    if sqlerrm like 'parameter_missing:%' then
      return null;
    end if;
    raise;
end;
$$;

comment on function solar.soiling_of(uuid, timestamptz, uuid) is
  'The soiling_loss of a PV array or system at a moment — its own, its system''s, its site''s, its organisation''s, its pack''s — as parameter_of() gives it, {value, level, source_code, reference, valid_from}; null when none says it, the yield profile''s soiling then holding.';

grant execute on function solar.soiling_of(uuid, timestamptz, uuid) to authenticated, service_role;

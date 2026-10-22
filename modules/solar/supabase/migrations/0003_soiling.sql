-- Nexgen OS — module `solar`: the soiling of a place.
--
-- How much light dirt takes from the modules depends on the place — dust
-- from a field or a road, birds, rain, a cleaning routine — not on the
-- modelling choices of a yield profile. A profile names a `soiling` loss
-- (PVsyst's loss diagram, PV*SOL's) or folds it into one aggregate loss
-- (PVGIS, PVWatts); the place says its own value on the array
-- (`pv_arrays.soiling_loss`), or as an attribute of the PV system or of its
-- participant, with its source and its period, and a yield estimate reads it the
-- nearest first: the array's own, then what `parameter_of()` answers for
-- its system, a device of the core.

set search_path = nexgen, public, extensions;

insert into attribute_types (code, name, description, datatype, quantity_code, minimum, maximum, applies_to, published_by) values
  ('soiling_loss', 'Soiling loss',
   'The fraction of the light reaching the modules that dirt takes over a year (0.02 for 2 %), on a PV system or every array of a participant. It replaces the soiling loss of a yield profile.',
   'number', 'ratio', 0, 1, '{device,participant}', 'solar');

-- ---------------------------------------------------------------------------
-- soiling_of — the soiling an array or a system is computed with.
-- ---------------------------------------------------------------------------

create or replace function solar.soiling_of(
  p_object_id   uuid,
  p_at          timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_sys   uuid;
  v_own   numeric;
  r       jsonb;
begin
  -- An array: its own value, then its system's cascade, where the system's
  -- own value is the device's level. A system: the core's cascade.
  select device_id, soiling_loss into v_sys, v_own from solar.pv_arrays where id = p_object_id;
  if v_sys is null then
    return parameter_of('device', p_object_id, 'soiling_loss', p_at);
  end if;
  if v_own is not null then
    return jsonb_build_object('value', v_own, 'level', 'object', 'object_id', p_object_id,
                              'source_code', null, 'reference', null, 'valid_from', null);
  end if;
  r := parameter_of('device', v_sys, 'soiling_loss', p_at);
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

comment on function solar.soiling_of(uuid, timestamptz) is
  'The soiling_loss of a PV array or system at a moment — its own, its system''s, its participant''s, its project''s, its organisation''s, its pack''s — as parameter_of() gives it, {value, level, source_code, reference, valid_from}; null when none says it, the yield profile''s soiling then holding.';

grant execute on function solar.soiling_of(uuid, timestamptz) to authenticated, service_role;

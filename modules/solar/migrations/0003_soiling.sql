-- Nexgen OS — module `solar`: the soiling of a place.
--
-- How much light dirt takes from the modules depends on the place — dust
-- from a field or a road, birds, rain, a cleaning routine — not on the
-- modelling choices of a yield profile. A profile names a `soiling` loss
-- (PVsyst's loss diagram, PV*SOL's) or folds it into one aggregate loss
-- (PVGIS, PVWatts); the place says its own value as an attribute of the
-- array, of the PV system or of its site, with its source and its period,
-- and a yield run reads it through `parameter_of()`, the nearest first.

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
begin
  return parameter_of(p_object_id, 'soiling_loss', p_at, p_scenario_id);
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

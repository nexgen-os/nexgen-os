-- Nexgen OS — module `building`: what the envelope of a building loses
-- through its faces, and the heating need it gives over a period.
--
-- The faces of a building already say their area and their thermal
-- transmittance (`area_m2`, `u_value`) and whether they face outside
-- (`is_external`). Two reads are computed from them, nothing is stored
-- (decision 0065, a total is computed by a function):
--
-- - `building.transmission_heat_loss(building)`: the direct transmission
--   heat transfer coefficient of its envelope, H_T = sum of A x U over the
--   faces facing outside, in W/K, the direct term of EN ISO 13789. Thermal
--   bridges, the ground and unheated spaces are not modelled, and the
--   result says so. A face facing outside without its area or its
--   transmittance, or a face whose side is not said, leaves H_T unknown
--   (null) and is named: nothing decided in the dark.
-- - `building.heating_need(building, temperature series, from, to, base)`:
--   the transmission heat need over the period by the degree-day method,
--   H_T x heating degree-days x 24 h, in kWh, the degree-days read by
--   `weather.degree_days()` when the `weather` module is installed. The
--   base is the caller's, never a default; a day without a temperature is
--   counted as missing, never as zero.

set search_path = nexgen, extensions;

create or replace function building.transmission_heat_loss(p_building_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_faces     jsonb;
  v_missing   jsonb;
  v_undecided jsonb;
  v_h         numeric;
  v_area      numeric;
begin
  -- Read under the caller's row level security: a building they cannot see is not found.
  if not exists (select 1 from building.buildings where id = p_building_id) then
    raise exception 'building_not_found: %', p_building_id using errcode = 'no_data_found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('surface_id', s.id, 'name', s.name, 'kind', s.kind, 'area_m2', s.area_m2, 'u_value', s.u_value,
                                               'w_per_k', round(s.area_m2 * s.u_value, 3)) order by s.name, s.id)
                    filter (where s.is_external and s.area_m2 is not null and s.u_value is not null), '[]'),
         coalesce(jsonb_agg(jsonb_build_object('surface_id', s.id, 'name', s.name, 'kind', s.kind,
                                               'lacks', to_jsonb(array_remove(array[case when s.area_m2 is null then 'area_m2' end,
                                                                                    case when s.u_value is null then 'u_value' end], null))) order by s.name, s.id)
                    filter (where s.is_external and (s.area_m2 is null or s.u_value is null)), '[]'),
         coalesce(jsonb_agg(jsonb_build_object('surface_id', s.id, 'name', s.name, 'kind', s.kind) order by s.name, s.id)
                    filter (where s.is_external is null), '[]'),
         sum(s.area_m2 * s.u_value) filter (where s.is_external),
         sum(s.area_m2) filter (where s.is_external)
    into v_faces, v_missing, v_undecided, v_h, v_area
    from building.surfaces s
   where s.building_id = p_building_id;
  return jsonb_build_object(
    'h_t_w_per_k', case when jsonb_array_length(v_faces) = 0 or jsonb_array_length(v_missing) > 0 or jsonb_array_length(v_undecided) > 0 then null
                        else round(v_h, 3) end,
    'area_m2', case when jsonb_array_length(v_missing) = 0 and jsonb_array_length(v_undecided) = 0 then v_area end,
    'faces', v_faces,
    'missing', v_missing,
    'undecided', v_undecided,
    'method', 'EN ISO 13789, direct transmission to the exterior: the sum of area times thermal transmittance over the faces facing outside',
    'not_modelled', jsonb_build_array('thermal_bridges', 'ground', 'unheated_spaces', 'ventilation'));
end;
$$;

comment on function building.transmission_heat_loss(uuid) is
  'The direct transmission heat transfer coefficient of the envelope of a building, H_T in W/K: the sum of area_m2 x u_value over its faces facing outside (is_external), the direct term of EN ISO 13789. {h_t_w_per_k, area_m2, faces: [{surface_id, name, kind, area_m2, u_value, w_per_k}], missing: [{surface_id, name, kind, lacks}], undecided: [{surface_id, name, kind}], method, not_modelled}. h_t_w_per_k is null when a face facing outside lacks its area or its transmittance, when a face does not say which side it faces, or when no face is described. Thermal bridges, the ground, unheated spaces and ventilation are not modelled. Refuses building_not_found.';

grant execute on function building.transmission_heat_loss(uuid) to authenticated, service_role;

create or replace function building.heating_need(
  p_building_id uuid,
  p_series_id   uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_base        double precision
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_loss    jsonb := building.transmission_heat_loss(p_building_id);
  v_h       numeric := (v_loss->>'h_t_w_per_k')::numeric;
  v_dd      double precision;
  v_days    int;
  v_missing int;
  v_tz      text;
begin
  if to_regprocedure('weather.degree_days(uuid, timestamptz, timestamptz, double precision, text)') is null then
    raise exception 'weather_module_required: the degree-days of a heating need are read by the weather module' using errcode = 'feature_not_supported';
  end if;
  execute 'select sum(d.degree_days), count(*) filter (where d.degree_days is not null)::int
             from weather.degree_days($1, $2, $3, $4, ''heating'') d'
     into v_dd, v_days using p_series_id, p_from, p_to, p_base;
  -- The local days of the period, in the time zone degree_days() cut them in:
  -- those without a temperature are missing, whether or not a row says so.
  execute 'select weather.time_zone_of($1)' into v_tz using p_series_id;
  select count(*)::int - v_days into v_missing
    from generate_series((p_from at time zone v_tz)::date, ((p_to at time zone v_tz) - interval '1 microsecond')::date, interval '1 day');
  return jsonb_build_object(
    'kwh', case when v_h is null or v_days = 0 then null else round(v_h * v_dd::numeric * 24 / 1000, 3) end,
    'h_t_w_per_k', v_h,
    'degree_days', v_dd,
    'base', p_base,
    'days', v_days,
    'days_missing', v_missing,
    'series_id', p_series_id,
    'method', 'degree-day method: H_T x heating degree-days x 24 h; degree-days by the mean daily temperature (weather.degree_days)',
    'transmission_heat_loss', v_loss);
end;
$$;

comment on function building.heating_need(uuid, uuid, timestamptz, timestamptz, double precision) is
  'The transmission heat need of a building over [from, to) by the degree-day method, in kWh: H_T (building.transmission_heat_loss) x the heating degree-days of a temperature series against the base the caller gives (weather.degree_days) x 24 h. {kwh, h_t_w_per_k, degree_days, base, days, days_missing, series_id, method, transmission_heat_loss}. kwh is null when H_T is unknown or no day has a temperature; a day without a temperature is counted in days_missing, never as zero. Gains (solar, internal) and ventilation are not modelled. Refuses building_not_found, weather_module_required, and what weather.degree_days() refuses (base_required, series_not_found, temperature_required, time_zone_required).';

grant execute on function building.heating_need(uuid, uuid, timestamptz, timestamptz, double precision) to authenticated, service_role;

update nexgen.modules set version = '0.6.0' where code = 'building';

-- Example 7 — an office building and its heating, in Munich.
--
-- A property company's site, an office block with four facades and their
-- U-values, a gas boiler and a heat pump in service, a gas meter and an
-- electricity meter, the heating setpoints of the building, a winter week of
-- gas consumption, and a scenario replacing the boiler by a second heat pump
-- after the facades are insulated.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000700000001', 'Isar Immobilien GmbH');

insert into sites (id, organisation_id, name, country, street, postal_code, city, region, profile) values
  ('00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000001', 'Rosenheimer Straße 145', 'DE', 'Rosenheimer Straße 145', '81671', 'München', 'DE-BY', 'office');

insert into buildings (id, organisation_id, site_id, name, profile, footprint, elevation_m, height_m, floors_above_ground, floors_below_ground, year_of_construction) values
  ('00000000-0000-4000-8000-000700000020', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', 'Office block', 'office',
   ST_GeomFromText('POLYGON((11.6070 48.1240, 11.6076 48.1240, 11.6076 48.1243, 11.6070 48.1243, 11.6070 48.1240))', 4326), 520, 21, 6, 1, 1979);

insert into surfaces (id, organisation_id, building_id, name, kind, azimuth_deg, tilt_deg, material) values
  ('00000000-0000-4000-8000-000700000031', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'South facade', 'facade', 180, 90, 'concrete, 1979 cladding'),
  ('00000000-0000-4000-8000-000700000032', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'North facade', 'facade', 0, 90, 'concrete, 1979 cladding'),
  ('00000000-0000-4000-8000-000700000033', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'East facade', 'facade', 90, 90, 'concrete, 1979 cladding'),
  ('00000000-0000-4000-8000-000700000034', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'West facade', 'facade', 270, 90, 'concrete, 1979 cladding'),
  ('00000000-0000-4000-8000-000700000035', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'Flat roof', 'roof', 180, 0, 'bitumen, insulated 2015');

-- U-values today, from the 2022 energy audit.
insert into attributes (object_id, property_code, value, source)
select id, 'thermal_transmittance', '1.4', 'energy audit 2022' from surfaces where building_id = '00000000-0000-4000-8000-000700000020' and kind = 'facade';
insert into attributes (object_id, property_code, value, source) values
  ('00000000-0000-4000-8000-000700000035', 'thermal_transmittance', '0.22', 'energy audit 2022'),
  ('00000000-0000-4000-8000-000700000020', 'gross_floor_area', '5400', 'as-built drawings'),
  ('00000000-0000-4000-8000-000700000020', 'energy_label', '"F"', 'energy certificate 2022');

insert into meters (id, organisation_id, site_id, name, identifier, scheme, commodity, direction) values
  ('00000000-0000-4000-8000-000700000041', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', 'Electricity', '400000000000000311', 'gs1_gsrn', 'electricity', 'both'),
  ('00000000-0000-4000-8000-000700000042', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', 'Gas', '400000000000000312', 'gs1_gsrn', 'gas', 'offtake');

insert into devices (id, organisation_id, site_id, building_id, meter_id, name, device_type, manufacturer, model, power_kw, status, installation_date) values
  ('00000000-0000-4000-8000-000700000051', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000020', '00000000-0000-4000-8000-000700000042',
   'Gas condensing boiler', 'boiler', 'Viessmann', 'Vitocrossal 300', 320, 'in_service', '2008-09-15'),
  ('00000000-0000-4000-8000-000700000052', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000020', '00000000-0000-4000-8000-000700000041',
   'Heat pump 1', 'heatpump', 'Viessmann', 'Vitocal 300-A Pro', 120, 'in_service', '2021-11-02'),
  ('00000000-0000-4000-8000-000700000053', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000020', '00000000-0000-4000-8000-000700000041',
   'Air handling unit', 'hvac', 'Trox', 'X-CUBE 25', 18, 'in_service', '2015-05-20');

insert into links (subject_id, type_code, object_id) values
  ('00000000-0000-4000-8000-000700000051', 'serves', '00000000-0000-4000-8000-000700000020'),
  ('00000000-0000-4000-8000-000700000052', 'serves', '00000000-0000-4000-8000-000700000020'),
  ('00000000-0000-4000-8000-000700000053', 'serves', '00000000-0000-4000-8000-000700000020');

insert into sensors (id, organisation_id, host_id, name, quantity_code, kind, external_ref) values
  ('00000000-0000-4000-8000-000700000061', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'Building heating setpoint', 'temperature', 'setpoint', 'bacnet://10.1.0.9/analog-value,1'),
  ('00000000-0000-4000-8000-000700000062', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000051', 'Boiler flow temperature', 'temperature', 'sensor', 'bacnet://10.1.0.9/analog-input,12'),
  ('00000000-0000-4000-8000-000700000063', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000042', 'Gas volume', 'volume', 'sensor', 'mbus://10.1.0.20/1');

-- A winter week of hourly gas consumption, in m³, and the setpoint schedule.
insert into series (id, organisation_id, object_id, quantity_code, sensor_id, kind, value_kind, step, source) values
  ('00000000-0000-4000-8000-000700000071', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000042', 'volume', '00000000-0000-4000-8000-000700000063', 'measured', 'interval', '1 hour', 'gas meter'),
  ('00000000-0000-4000-8000-000700000072', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'temperature', '00000000-0000-4000-8000-000700000061', 'setpoint', 'instant', null, 'building management system');

insert into series_values (series_id, at, value)
select '00000000-0000-4000-8000-000700000071', ts,
       round(((case when extract(isodow from ts) < 6 and extract(hour from ts) between 6 and 18 then 28 else 9 end)
             * (1 + 0.3 * sin(extract(epoch from ts) / 86400 * 2 * pi())))::numeric, 1)
  from generate_series('2026-01-19 00:00+01'::timestamptz, '2026-01-25 23:00+01', '1 hour') ts;

insert into series_values (series_id, at, value)
select '00000000-0000-4000-8000-000700000072', d + t, v
  from generate_series('2026-01-19'::date, '2026-01-25', '1 day') d
  cross join (values (interval '6 hours', 21), (interval '18 hours', 16)) as s(t, v);

-- The scenario: insulate the facades, replace the boiler by a second heat pump.
insert into scenarios (id, organisation_id, name, description) values
  ('00000000-0000-4000-8000-000700000080', '00000000-0000-4000-8000-000700000001', 'Insulation and second heat pump', 'External insulation of the four facades, boiler decommissioned, 160 kW heat pump added.');

insert into attributes (object_id, property_code, value, scenario_id, source)
select id, 'thermal_transmittance', '0.24', '00000000-0000-4000-8000-000700000080', 'insulation design 2026'
  from surfaces where building_id = '00000000-0000-4000-8000-000700000020' and kind = 'facade';

insert into devices (id, organisation_id, site_id, building_id, meter_id, name, device_type, manufacturer, model, power_kw, status, scenario_id) values
  ('00000000-0000-4000-8000-000700000054', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000020', '00000000-0000-4000-8000-000700000041',
   'Heat pump 2', 'heatpump', 'Viessmann', 'Vitocal 300-A Pro', 160, 'planned', '00000000-0000-4000-8000-000700000080');

insert into modules (code, name, version, schema_name, requires_core_min) values
  ('thermal', 'Thermal', '0.1.0', 'thermal', '0.1.0')
on conflict (code) do nothing;

select record_run('thermal', 'heat-loss-0.1.0', '00000000-0000-4000-8000-000700000020', null,
  '{"method": "steady-state", "design_outdoor_c": -14, "indoor_c": 20}', '{"heat_loss_kw": 412, "annual_heating_kwh": 618000}');
select record_run('thermal', 'heat-loss-0.1.0', '00000000-0000-4000-8000-000700000020', '00000000-0000-4000-8000-000700000080',
  '{"method": "steady-state", "design_outdoor_c": -14, "indoor_c": 20}', '{"heat_loss_kw": 236, "annual_heating_kwh": 351000}');

-- Queries a page would run
-- The envelope today and in the scenario:
--   select s.name, attributes_of(s.id)->>'thermal_transmittance' today, attributes_of(s.id, now(), '00000000-0000-4000-8000-000700000080')->>'thermal_transmittance' after
--     from surfaces s where s.building_id = '00000000-0000-4000-8000-000700000020' order by s.name;
-- Daily gas over the week:
--   select bucket::date, value m3 from resample('00000000-0000-4000-8000-000700000071', '2026-01-19', '2026-01-26', '1 day');
-- Heat loss, reality against scenario:
--   select coalesce(s.name, 'as is') variant, r.results->>'heat_loss_kw' kw from runs r left join scenarios s on s.id = r.scenario_id
--    where r.subject_id = '00000000-0000-4000-8000-000700000020' order by 1;

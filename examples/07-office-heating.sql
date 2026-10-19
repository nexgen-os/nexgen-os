-- Example 7 — an office building and its heating, in Munich. Needs the
-- `grid` module.
--
-- A property company's site, an office block with four facades and their
-- U-values, a gas boiler and a heat pump in service, a gas meter and an
-- electricity meter, the heating setpoint of the building, the boiler's flow
-- temperature, a winter week of gas consumption, and a scenario replacing
-- the boiler by a second heat pump after the facades are insulated.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000700000001', 'Isar Immobilien GmbH');

insert into sites (id, organisation_id, name, country, street, postal_code, city, region, profile) values
  ('00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000001', 'Rosenheimer Straße 145', 'DE', 'Rosenheimer Straße 145', '81671', 'München', 'DE-BY', 'office');

insert into buildings (id, organisation_id, site_id, name, profile, footprint, elevation_m, height_m) values
  ('00000000-0000-4000-8000-000700000020', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', 'Office block', 'office',
   ST_GeomFromText('POLYGON((11.6070 48.1240, 11.6076 48.1240, 11.6076 48.1243, 11.6070 48.1243, 11.6070 48.1240))', 4326), 520, 21);

insert into surfaces (id, organisation_id, building_id, name, kind, azimuth_deg, tilt_deg) values
  ('00000000-0000-4000-8000-000700000031', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'South facade', 'facade', 180, 90),
  ('00000000-0000-4000-8000-000700000032', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'North facade', 'facade', 0, 90),
  ('00000000-0000-4000-8000-000700000033', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'East facade', 'facade', 90, 90),
  ('00000000-0000-4000-8000-000700000034', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'West facade', 'facade', 270, 90),
  ('00000000-0000-4000-8000-000700000035', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'Flat roof', 'roof', 180, 0);

-- U-values and materials today, from the 2022 energy audit.
insert into attributes (object_id, property_code, value, source)
select id, 'u_value', '1.4', 'energy audit 2022' from surfaces where building_id = '00000000-0000-4000-8000-000700000020' and kind = 'facade';
insert into attributes (object_id, property_code, value, source)
select id, 'material', '"concrete, 1979 cladding"', 'energy audit 2022' from surfaces where building_id = '00000000-0000-4000-8000-000700000020' and kind = 'facade';
insert into attributes (object_id, property_code, value, source) values
  ('00000000-0000-4000-8000-000700000035', 'material', '"bitumen, insulated 2015"', 'energy audit 2022'),
  ('00000000-0000-4000-8000-000700000020', 'year_built', '1979', 'energy audit 2022'),
  ('00000000-0000-4000-8000-000700000020', 'floors_above_ground', '6', 'energy audit 2022'),
  ('00000000-0000-4000-8000-000700000020', 'floors_below_ground', '1', 'energy audit 2022'),
  ('00000000-0000-4000-8000-000700000035', 'u_value', '0.22', 'energy audit 2022'),
  ('00000000-0000-4000-8000-000700000020', 'floor_area', '5400', 'as-built drawings'),
  ('00000000-0000-4000-8000-000700000020', 'energy_label', '"F"', 'energy certificate 2022');

insert into grid.meters (id, organisation_id, site_id, name, identifier, scheme, resource, direction) values
  ('00000000-0000-4000-8000-000700000041', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', 'Electricity', '400000000000000311', 'gs1_gsrn', 'electricity', 'both'),
  ('00000000-0000-4000-8000-000700000042', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', 'Gas', '400000000000000312', 'gs1_gsrn', 'gas', 'offtake');

insert into devices (id, organisation_id, site_id, building_id, name, device_type, manufacturer, model, rated_power_kw, status, installation_date) values
  ('00000000-0000-4000-8000-000700000051', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000020',
   'Gas condensing boiler', 'boiler', 'Viessmann', 'Vitocrossal 300', 320, 'in_service', '2008-09-15'),
  ('00000000-0000-4000-8000-000700000052', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000020',
   'Heat pump 1', 'heat_pump', 'Viessmann', 'Vitocal 300-A Pro', 120, 'in_service', '2021-11-02'),
  ('00000000-0000-4000-8000-000700000053', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000020',
   'Air handling unit', 'hvac', 'Trox', 'X-CUBE 25', 18, 'in_service', '2015-05-20');

insert into links (subject_id, type_code, object_id) values
  ('00000000-0000-4000-8000-000700000051', 'serves', '00000000-0000-4000-8000-000700000020'),
  ('00000000-0000-4000-8000-000700000052', 'serves', '00000000-0000-4000-8000-000700000020'),
  ('00000000-0000-4000-8000-000700000053', 'serves', '00000000-0000-4000-8000-000700000020'),
  ('00000000-0000-4000-8000-000700000051', 'behind_meter', '00000000-0000-4000-8000-000700000042'),
  ('00000000-0000-4000-8000-000700000052', 'behind_meter', '00000000-0000-4000-8000-000700000041'),
  ('00000000-0000-4000-8000-000700000053', 'behind_meter', '00000000-0000-4000-8000-000700000041');

-- The points the building management system reads and writes, one series
-- each: a winter week of hourly gas consumption at the gas meter, in m³;
-- the heating setpoint of the building and its schedule; the flow
-- temperature the boiler reports, not collected yet.
insert into series (id, organisation_id, object_id, device_id, quantity_code, kind, value_kind, step, external_ref, source) values
  ('00000000-0000-4000-8000-000700000071', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000042', null,
   'volume', 'measured', 'interval', '1 hour', 'mbus://10.1.0.20/1', 'gas meter'),
  ('00000000-0000-4000-8000-000700000072', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', '00000000-0000-4000-8000-000700000051',
   'temperature', 'setpoint', 'instant', null, 'bacnet://10.1.0.9/analog-value,1', 'building management system'),
  ('00000000-0000-4000-8000-000700000073', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000051', '00000000-0000-4000-8000-000700000051',
   'temperature', 'measured', 'instant', null, 'bacnet://10.1.0.9/analog-input,12', 'building management system');

select store('00000000-0000-4000-8000-000700000071', array_agg(ts order by ts),
             array_agg(round(((case when extract(isodow from ts) < 6 and extract(hour from ts) between 6 and 18 then 28 else 9 end)
                       * (1 + 0.3 * sin(extract(epoch from ts) / 86400 * 2 * pi())))::numeric, 1)::float8 order by ts))
  from generate_series('2026-01-19 00:00+01'::timestamptz, '2026-01-25 23:00+01', '1 hour') ts;

select store('00000000-0000-4000-8000-000700000072', array_agg((d + t)::timestamptz order by d + t), array_agg(v::float8 order by d + t))
  from generate_series('2026-01-19'::date, '2026-01-25', '1 day') d
  cross join (values (interval '6 hours', 21), (interval '18 hours', 16)) as s(t, v);

-- The scenario: insulate the facades, replace the boiler by a second heat pump.
insert into scenarios (id, organisation_id, name, description) values
  ('00000000-0000-4000-8000-000700000080', '00000000-0000-4000-8000-000700000001', 'Insulation and second heat pump', 'External insulation of the four facades, boiler decommissioned, 160 kW heat pump added.');

insert into attributes (object_id, property_code, value, scenario_id, source)
select id, 'u_value', '0.24', '00000000-0000-4000-8000-000700000080', 'insulation design 2026'
  from surfaces where building_id = '00000000-0000-4000-8000-000700000020' and kind = 'facade';

insert into devices (id, organisation_id, site_id, building_id, name, device_type, manufacturer, model, rated_power_kw, status, scenario_id) values
  ('00000000-0000-4000-8000-000700000054', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000020',
   'Heat pump 2', 'heat_pump', 'Viessmann', 'Vitocal 300-A Pro', 160, 'planned', '00000000-0000-4000-8000-000700000080');
insert into links (subject_id, type_code, object_id, scenario_id) values
  ('00000000-0000-4000-8000-000700000054', 'behind_meter', '00000000-0000-4000-8000-000700000041', '00000000-0000-4000-8000-000700000080');

insert into modules (code, name, version, schema_name, requires_core_min) values
  ('thermal', 'Thermal', '0.1.0', 'thermal', '0.1.0')
on conflict (code) do nothing;

select record_run('thermal', 'heat-loss-0.1.0', '00000000-0000-4000-8000-000700000020', null,
  '{"method": "steady-state", "design_outdoor_c": -14, "indoor_c": 20}', '{"heat_loss_kw": 412, "annual_heating_kwh": 618000}');
select record_run('thermal', 'heat-loss-0.1.0', '00000000-0000-4000-8000-000700000020', '00000000-0000-4000-8000-000700000080',
  '{"method": "steady-state", "design_outdoor_c": -14, "indoor_c": 20}', '{"heat_loss_kw": 236, "annual_heating_kwh": 351000}');

-- Queries a page would run
-- The envelope today and in the scenario:
--   select s.name, attributes_of(s.id)->>'u_value' today, attributes_of(s.id, now(), '00000000-0000-4000-8000-000700000080')->>'u_value' after
--     from surfaces s where s.building_id = '00000000-0000-4000-8000-000700000020' order by s.name;
-- Daily gas over the week:
--   select bucket::date, value m3 from resample('00000000-0000-4000-8000-000700000071', '2026-01-19', '2026-01-26', '1 day');
-- Heat loss, reality against scenario:
--   select coalesce(s.name, 'as is') variant, r.results->>'heat_loss_kw' kw from runs r left join scenarios s on s.id = r.scenario_id
--    where r.subject_id = '00000000-0000-4000-8000-000700000020' order by 1;

-- Daily readings are cut in the site's time zone.
update sites set time_zone = 'Europe/Berlin' where organisation_id = '00000000-0000-4000-8000-000700000001';

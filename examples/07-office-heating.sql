-- Example 7 — an office building and its heating, in Munich. Needs the
-- `building` module.
--
-- A property company is the participant of its own heating study: it
-- carries the place, a gas meter and an electricity meter, and behind them
-- a gas boiler and a heat pump in service; the `building` module describes
-- the office block with four facades and their U-values; the heating
-- setpoint of the building, the boiler's flow temperature, a winter week of
-- gas consumption, and the second heat pump planned to replace the boiler
-- once the facades are insulated, with the insulation design as a document.
-- A heat loss computed for either envelope would be a figure of a `thermal`
-- module, which does not ship yet.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000700000001', 'Beispiel Immobilien GmbH');

insert into projects (id, organisation_id, name, kind, country, status) values
  ('00000000-0000-4000-8000-000700000005', '00000000-0000-4000-8000-000700000001', 'Heating renewal', 'study', 'DE', 'active');

insert into participants (id, organisation_id, project_id, name, role, country, street, postal_code, city, region) values
  ('00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000005',
   'Beispielstraße 145', 'consumer', 'DE', 'Beispielstraße 145', '81671', 'München', 'DE-BY');

insert into building.buildings (id, organisation_id, participant_id, name, profile, footprint, elevation_m, height_m) values
  ('00000000-0000-4000-8000-000700000020', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', 'Office block', 'office',
   ST_GeomFromText('POLYGON((11.6070 48.1240, 11.6076 48.1240, 11.6076 48.1243, 11.6070 48.1243, 11.6070 48.1240))', 4326), 520, 21);

insert into building.surfaces (id, organisation_id, building_id, name, kind, azimuth_deg, tilt_deg) values
  ('00000000-0000-4000-8000-000700000031', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'South facade', 'facade', 180, 90),
  ('00000000-0000-4000-8000-000700000032', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'North facade', 'facade', 0, 90),
  ('00000000-0000-4000-8000-000700000033', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'East facade', 'facade', 90, 90),
  ('00000000-0000-4000-8000-000700000034', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'West facade', 'facade', 270, 90),
  ('00000000-0000-4000-8000-000700000035', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000020', 'Flat roof', 'roof', 180, 0);

-- What the 2022 energy audit says of the block and its envelope.
update building.buildings set year_built = 1979, floors_above_ground = 6, floors_below_ground = 1, floor_area_m2 = 5400, energy_label = 'F'
 where id = '00000000-0000-4000-8000-000700000020';
update building.surfaces set u_value = 1.4, material = 'concrete, 1979 cladding', is_external = true
 where building_id = '00000000-0000-4000-8000-000700000020' and kind = 'facade';
update building.surfaces set u_value = 0.22, material = 'bitumen, insulated 2015', is_external = true
 where id = '00000000-0000-4000-8000-000700000035';

insert into meters (id, organisation_id, participant_id, name, identifier, scheme, resource, direction) values
  ('00000000-0000-4000-8000-000700000041', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', 'Electricity', '400000000000000311', 'gs1_gsrn', 'electricity', 'both'),
  ('00000000-0000-4000-8000-000700000042', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010', 'Gas', '400000000000000312', 'gs1_gsrn', 'gas', 'offtake');

insert into devices (id, organisation_id, participant_id, name, device_type, manufacturer, model, rated_power_kw, status, installation_date) values
  ('00000000-0000-4000-8000-000700000051', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010',
   'Gas condensing boiler', 'boiler', 'Viessmann', 'Vitocrossal 300', 320, 'in_service', '2008-09-15'),
  ('00000000-0000-4000-8000-000700000052', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010',
   'Heat pump 1', 'heat_pump', 'Viessmann', 'Vitocal 300-A Pro', 120, 'in_service', '2021-11-02'),
  ('00000000-0000-4000-8000-000700000053', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010',
   'Air handling unit', 'hvac', 'Trox', 'X-CUBE 25', 18, 'in_service', '2015-05-20');

-- All three are the company's, behind its two meters.

-- The points the building management system reads and writes, one series
-- each: a winter week of hourly gas consumption at the gas meter, in m³;
-- the heating setpoint of the company's place, asked of the boiler, and its
-- schedule; the flow temperature the boiler reports, not collected yet.
insert into series (id, organisation_id, object_kind, object_id, device_id, quantity_code, kind, value_kind, step, external_ref, source) values
  ('00000000-0000-4000-8000-000700000071', '00000000-0000-4000-8000-000700000001', 'meter', '00000000-0000-4000-8000-000700000042', null,
   'volume', 'measured', 'interval', '1 hour', 'mbus://10.1.0.20/1', 'gas meter'),
  ('00000000-0000-4000-8000-000700000072', '00000000-0000-4000-8000-000700000001', 'participant', '00000000-0000-4000-8000-000700000010', '00000000-0000-4000-8000-000700000051',
   'temperature', 'setpoint', 'instant', null, 'bacnet://10.1.0.9/analog-value,1', 'building management system'),
  ('00000000-0000-4000-8000-000700000073', '00000000-0000-4000-8000-000700000001', 'device', '00000000-0000-4000-8000-000700000051', '00000000-0000-4000-8000-000700000051',
   'temperature', 'measured', 'instant', null, 'bacnet://10.1.0.9/analog-input,12', 'building management system');

select store('00000000-0000-4000-8000-000700000071', array_agg(ts order by ts),
             array_agg(round(((case when extract(isodow from ts) < 6 and extract(hour from ts) between 6 and 18 then 28 else 9 end)
                       * (1 + 0.3 * sin(extract(epoch from ts) / 86400 * 2 * pi())))::numeric, 1)::float8 order by ts))
  from generate_series('2026-01-19 00:00+01'::timestamptz, '2026-01-25 23:00+01', '1 hour') ts;

select store('00000000-0000-4000-8000-000700000072', array_agg((d + t)::timestamptz order by d + t), array_agg(v::float8 order by d + t))
  from generate_series('2026-01-19'::date, '2026-01-25', '1 day') d
  cross join (values (interval '6 hours', 21), (interval '18 hours', 16)) as s(t, v);

-- The renewal the company plans: the facades insulated to the design's
-- U-value, the boiler decommissioned, a 160 kW heat pump added. The heat
-- pump is a device of its own, planned; the design is a document.
insert into devices (id, organisation_id, participant_id, name, device_type, manufacturer, model, rated_power_kw, status) values
  ('00000000-0000-4000-8000-000700000054', '00000000-0000-4000-8000-000700000001', '00000000-0000-4000-8000-000700000010',
   'Heat pump 2', 'heat_pump', 'Viessmann', 'Vitocal 300-A Pro', 160, 'planned');

insert into documents (object_kind, object_id, name, kind, uri, media_type, source) values
  ('participant', '00000000-0000-4000-8000-000700000010', 'Insulation design 2026', 'report', 's3://nexgen-os-examples/office/insulation-design-2026.pdf', 'application/pdf', 'thermal engineer');

-- Queries a page would run
-- The envelope today:
--   select s.name, s.u_value, s.material from building.surfaces s
--    where s.building_id = '00000000-0000-4000-8000-000700000020' order by s.name;
-- Daily gas over the week:
--   select bucket::date, value m3 from resample('00000000-0000-4000-8000-000700000071', '2026-01-19', '2026-01-26', '1 day');
-- What is planned:
--   select name, rated_power_kw from devices where participant_id = '00000000-0000-4000-8000-000700000010' and status = 'planned';

-- Daily readings are cut in the participant's time zone.
update participants set time_zone = 'Europe/Berlin' where organisation_id = '00000000-0000-4000-8000-000700000001';

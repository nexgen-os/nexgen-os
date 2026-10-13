-- Example 1 — a house with a PV system, in Seville.
--
-- A family's site, a house with two roof faces, a connection point, a PV
-- system on the south face behind the meter, an inverter, sensors, a day of
-- quarter-hour production, an energy label that changed after insulation,
-- a drone video and the permit as documents, a battery in a scenario, and a
-- production estimate recorded as a run.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000100000001', 'The Moreno family');

insert into sites (id, organisation_id, name, country, street, postal_code, city, profile, geometry) values
  ('00000000-0000-4000-8000-000100000010', '00000000-0000-4000-8000-000100000001', 'Calle Betis 14', 'ES', 'Calle Betis 14', '41010', 'Sevilla', 'residential',
   ST_GeomFromText('POLYGON((-5.9962 37.3845, -5.9959 37.3845, -5.9959 37.3848, -5.9962 37.3848, -5.9962 37.3845))', 4326));

insert into buildings (id, organisation_id, site_id, name, profile, footprint, elevation_m, height_m, floors_above_ground, year_built) values
  ('00000000-0000-4000-8000-000100000020', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010', 'House', 'residential',
   ST_GeomFromText('POLYGON((-5.99615 37.38455, -5.99595 37.38455, -5.99595 37.38470, -5.99615 37.38470, -5.99615 37.38455))', 4326),
   11, 7.5, 2, 1998);

insert into surfaces (id, organisation_id, building_id, name, kind, azimuth_deg, tilt_deg, material) values
  ('00000000-0000-4000-8000-000100000031', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000020', 'South roof face', 'roof', 180, 30, 'tiles'),
  ('00000000-0000-4000-8000-000100000032', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000020', 'North roof face', 'roof', 0, 30, 'tiles');

insert into meters (id, organisation_id, site_id, name, identifier, scheme, resource, direction) values
  ('00000000-0000-4000-8000-000100000040', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010', 'Supply point', '843000000000000123', 'gs1_gsrn', 'electricity', 'both');

insert into devices (id, organisation_id, site_id, building_id, surface_id, meter_id, name, device_type, manufacturer, model, rated_power_kw, unit_count, installation_date, tags) values
  ('00000000-0000-4000-8000-000100000051', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010', '00000000-0000-4000-8000-000100000020', '00000000-0000-4000-8000-000100000031', '00000000-0000-4000-8000-000100000040',
   'PV system', 'solar', 'Trina', 'Vertex S 425', 3.825, 9, '2024-05-10', '{solar,electric}'),
  ('00000000-0000-4000-8000-000100000052', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010', '00000000-0000-4000-8000-000100000020', null, '00000000-0000-4000-8000-000100000040',
   'Inverter', 'inverter', 'Huawei', 'SUN2000-4KTL', 4, 1, '2024-05-10', '{electric}'),
  ('00000000-0000-4000-8000-000100000053', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010', null, null, '00000000-0000-4000-8000-000100000040',
   'Smart meter', 'meter', 'Sagemcom', 'T211', null, 1, '2020-02-01', '{electric}');

insert into links (subject_id, type_code, object_id) values
  ('00000000-0000-4000-8000-000100000051', 'feeds', '00000000-0000-4000-8000-000100000052'),
  ('00000000-0000-4000-8000-000100000052', 'feeds', '00000000-0000-4000-8000-000100000040');

insert into sensors (id, organisation_id, host_id, name, quantity_code, kind, external_ref) values
  ('00000000-0000-4000-8000-000100000061', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000052', 'AC power', 'power', 'sensor', 'sunspec://192.168.1.20/40083'),
  ('00000000-0000-4000-8000-000100000062', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000040', 'Import register', 'offtake_energy', 'sensor', 'p1://meter/1.8.0'),
  ('00000000-0000-4000-8000-000100000063', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000040', 'Export register', 'injection_energy', 'sensor', 'p1://meter/2.8.0');

-- A sunny day of production, every quarter-hour, in kWh per interval.
insert into series (id, organisation_id, object_id, quantity_code, sensor_id, kind, value_kind, step, source) values
  ('00000000-0000-4000-8000-000100000071', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000051', 'energy', '00000000-0000-4000-8000-000100000061', 'measured', 'interval', '15 minutes', 'inverter');

insert into series_values (series_id, at, value)
select '00000000-0000-4000-8000-000100000071', ts,
       round(greatest(0, 3.6 * sin(pi() * (extract(epoch from ts - '2026-06-21 06:30+02'::timestamptz) / 3600) / 13.5))::numeric / 4, 3)
  from generate_series('2026-06-21 00:00+02'::timestamptz, '2026-06-21 23:45+02', '15 minutes') ts;

-- The offtake register, read daily, as an ever-rising index.
insert into series (id, organisation_id, object_id, quantity_code, sensor_id, kind, value_kind, step, source) values
  ('00000000-0000-4000-8000-000100000072', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000040', 'offtake_energy', '00000000-0000-4000-8000-000100000062', 'measured', 'cumulative', '1 day', 'meter');

insert into series_values (series_id, at, value)
select '00000000-0000-4000-8000-000100000072', d, 48210 + 6.2 * (extract(epoch from d - '2026-06-01'::timestamptz) / 86400)
  from generate_series('2026-06-01'::timestamptz, '2026-06-30', '1 day') d;

-- The energy label, before and after the insulation works of 2025.
insert into attributes (object_id, property_code, value, valid_from, valid_to, source) values
  ('00000000-0000-4000-8000-000100000020', 'energy_label', '"E"', null, '2025-09-01', 'energy performance certificate 2019'),
  ('00000000-0000-4000-8000-000100000020', 'energy_label', '"C"', '2025-09-01', null, 'energy performance certificate 2025'),
  ('00000000-0000-4000-8000-000100000020', 'floor_area', '142', null, null, 'cadastre'),
  ('00000000-0000-4000-8000-000100000031', 'roof_area', '38.5', null, null, 'measured on the drone orthophoto'),
  ('00000000-0000-4000-8000-000100000010', 'annual_consumption', '4300', null, null, 'supplier invoices 2025');

insert into documents (object_id, name, kind, uri, media_type, source, captured_at) values
  ('00000000-0000-4000-8000-000100000020', 'Orbit video', 'video', 's3://nexgen-os-examples/house/orbit.mp4', 'video/mp4', 'drone flight', '2026-03-14'),
  ('00000000-0000-4000-8000-000100000020', 'Building permit 1998', 'permit', 's3://nexgen-os-examples/house/permit-1998.pdf', 'application/pdf', 'town hall', null),
  ('00000000-0000-4000-8000-000100000051', 'Module datasheet', 'datasheet', 'https://static.trinasolar.com/vertex-s-425.pdf', 'application/pdf', 'manufacturer', null);

-- A variant: add a battery. Only visible in the scenario.
insert into scenarios (id, organisation_id, name, description) values
  ('00000000-0000-4000-8000-000100000080', '00000000-0000-4000-8000-000100000001', 'Add a 10 kWh battery', 'Store the midday surplus for the evening.');

insert into devices (id, organisation_id, site_id, building_id, meter_id, name, device_type, manufacturer, model, rated_power_kw, status, scenario_id) values
  ('00000000-0000-4000-8000-000100000054', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010', '00000000-0000-4000-8000-000100000020', '00000000-0000-4000-8000-000100000040',
   'Battery', 'battery', 'BYD', 'HVS 10.2', 5, 'planned', '00000000-0000-4000-8000-000100000080');

insert into attributes (object_id, property_code, value, scenario_id, source) values
  ('00000000-0000-4000-8000-000100000054', 'efficiency', '0.95', '00000000-0000-4000-8000-000100000080', 'datasheet');

-- An estimate from PVGIS, recorded as a run of the energy module.
insert into modules (code, name, version, schema_name, requires_core_min) values
  ('energy', 'Energy', '0.1.0', 'energy', '0.1.0')
on conflict (code) do nothing;

select record_run('energy', 'pvgis-5.3+core-0.1.0', '00000000-0000-4000-8000-000100000051', null,
  '{"source": "pvgis", "peak_kw": 3.825, "tilt": 30, "azimuth": 180, "loss_pct": 14}',
  '{"annual_kwh": 6120, "monthly_kwh": [330, 390, 520, 580, 650, 690, 720, 680, 560, 450, 330, 300]}');

-- Queries a page would run
-- The house as a card:
--   select b.name, b.height_m, area_m2(b.footprint) area, attributes_of(b.id) from buildings b
--    where b.id = '00000000-0000-4000-8000-000100000020';
-- Hourly production on the sunny day:
--   select * from resample('00000000-0000-4000-8000-000100000071', '2026-06-21', '2026-06-22', '1 hour');
-- Daily offtake from the register:
--   select bucket, value - lag(value) over (order by bucket) kwh
--     from resample('00000000-0000-4000-8000-000100000072', '2026-06-01', '2026-07-01', '1 day');
-- What the scenario adds:
--   select name, device_type, status from devices where scenario_id = '00000000-0000-4000-8000-000100000080';

-- Daily readings are cut in the site's time zone.
update sites set time_zone = 'Europe/Madrid' where organisation_id = '00000000-0000-4000-8000-000100000001';

-- Example 1 — a house with a PV system, in Seville. Needs the core only.
--
-- A family is one participant of its own study: it carries the place — the
-- house at its address, its point on the map — and the connection point;
-- behind the meter, its devices: a PV system, an inverter and a smart meter whose
-- readings are series, a day of quarter-hour production, a drone video and
-- the permit as documents, a planned battery, and the monthly production
-- PVGIS published for the orientation it assumed, as a series of that
-- source. A yield computed in the installation is an estimate of the `solar`
-- module (example 04). The house as a building, its roof faces and its
-- energy label are a physical description, the `building` module's
-- (examples 02, 05, 06, 07).

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000100000001', 'A household');

insert into projects (id, organisation_id, name, kind, country, status) values
  ('00000000-0000-4000-8000-000100000005', '00000000-0000-4000-8000-000100000001', 'Solar for the house', 'study', 'ES', 'active');

insert into participants (id, organisation_id, project_id, name, role, country, street, postal_code, city, geometry) values
  ('00000000-0000-4000-8000-000100000010', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000005',
   'Calle del Ejemplo 14', 'prosumer', 'ES', 'Calle del Ejemplo 14', '41010', 'Sevilla',
   ST_GeomFromText('POLYGON((-5.9962 37.3845, -5.9959 37.3845, -5.9959 37.3848, -5.9962 37.3848, -5.9962 37.3845))', 4326));

insert into meters (id, organisation_id, participant_id, name, identifier, scheme, resource, direction) values
  ('00000000-0000-4000-8000-000100000040', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010', 'Supply point', '843000000000000123', 'gs1_gsrn', 'electricity', 'both');

-- The PV system, its inverter and the smart meter: all three devices are
-- the participant's, behind its meter.
insert into devices (id, organisation_id, participant_id, name, device_type, manufacturer, model, rated_power_kw, unit_count, installation_date) values
  ('00000000-0000-4000-8000-000100000051', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010',
   'PV system', 'solar', 'Trina', 'Vertex S 425', 3.825, 9, '2024-05-10'),
  ('00000000-0000-4000-8000-000100000052', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010',
   'Inverter', 'inverter', 'Huawei', 'SUN2000-4KTL', 4, 1, '2024-05-10'),
  ('00000000-0000-4000-8000-000100000053', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010',
   'Smart meter', 'meter', 'Sagemcom', 'T211', null, 1, '2020-02-01');

-- The instruments are devices, the points they read are series: what is
-- observed (the PV system, the connection point), by which device, and
-- where a connector finds it.
-- A sunny day of production, every quarter-hour, in kWh per interval, read
-- from the inverter.
insert into series (id, organisation_id, object_kind, object_id, device_id, quantity_code, kind, value_kind, step, external_ref, source) values
  ('00000000-0000-4000-8000-000100000071', '00000000-0000-4000-8000-000100000001', 'device', '00000000-0000-4000-8000-000100000051', '00000000-0000-4000-8000-000100000052',
   'production_energy', 'measured', 'interval', '15 minutes', 'sunspec://192.168.1.20/40083', 'inverter');

select store('00000000-0000-4000-8000-000100000071', array_agg(ts order by ts),
             array_agg(round(greatest(0, 3.6 * sin(pi() * (extract(epoch from ts - '2026-06-21 06:30+02'::timestamptz) / 3600) / 13.5))::numeric / 4, 3)::float8 order by ts))
  from generate_series('2026-06-21 00:00+02'::timestamptz, '2026-06-21 23:45+02', '15 minutes') ts;

-- The two registers of the smart meter, as ever-rising indexes: offtake
-- read daily, injection not collected yet.
insert into series (id, organisation_id, object_kind, object_id, device_id, quantity_code, kind, value_kind, step, external_ref, source) values
  ('00000000-0000-4000-8000-000100000072', '00000000-0000-4000-8000-000100000001', 'meter', '00000000-0000-4000-8000-000100000040', '00000000-0000-4000-8000-000100000053',
   'offtake_energy', 'measured', 'cumulative', '1 day', 'p1://meter/1.8.0', 'meter'),
  ('00000000-0000-4000-8000-000100000073', '00000000-0000-4000-8000-000100000001', 'meter', '00000000-0000-4000-8000-000100000040', '00000000-0000-4000-8000-000100000053',
   'injection_energy', 'measured', 'cumulative', '1 day', 'p1://meter/2.8.0', 'meter');

select store('00000000-0000-4000-8000-000100000072', array_agg(d order by d),
             array_agg((48210 + 6.2 * (extract(epoch from d - '2026-06-01'::timestamptz) / 86400))::float8 order by d))
  from generate_series('2026-06-01'::timestamptz, '2026-06-30', '1 day') d;

-- What the household takes in a year, from its invoices.
insert into attributes (object_kind, object_id, attribute_type, value, valid_from, valid_to, source) values
  ('participant', '00000000-0000-4000-8000-000100000010', 'annual_consumption', '4300', null, null, 'supplier invoices 2025');

insert into documents (object_kind, object_id, name, kind, uri, media_type, source, captured_at) values
  ('participant', '00000000-0000-4000-8000-000100000010', 'Orbit video', 'video', 's3://nexgen-os-demo/house/orbit.mp4', 'video/mp4', 'drone flight', '2026-03-14'),
  ('participant', '00000000-0000-4000-8000-000100000010', 'Building permit 1998', 'permit', 's3://nexgen-os-demo/house/permit-1998.pdf', 'application/pdf', 'town hall', null),
  ('device', '00000000-0000-4000-8000-000100000051', 'Module datasheet', 'datasheet', 'https://static.trinasolar.com/vertex-s-425.pdf', 'application/pdf', 'manufacturer', null);

-- A battery the family plans: a device of its own, planned until it is
-- installed, with the efficiency its datasheet gives.
insert into devices (id, organisation_id, participant_id, name, device_type, manufacturer, model, rated_power_kw, status) values
  ('00000000-0000-4000-8000-000100000054', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010',
   'Battery', 'battery', 'BYD', 'HVS 10.2', 5, 'planned');

insert into attributes (object_kind, object_id, attribute_type, value, source) values
  ('device', '00000000-0000-4000-8000-000100000054', 'efficiency', '0.95', 'datasheet');

-- The monthly production PVGIS published for the PV system, south, 30°,
-- 14 % of losses: a simulated series whose source is PVGIS, with what it
-- assumed in its metadata.
insert into series (id, organisation_id, object_kind, object_id, quantity_code, kind, value_kind, step, source_code, name, metadata) values
  ('00000000-0000-4000-8000-000100000074', '00000000-0000-4000-8000-000100000001', 'device', '00000000-0000-4000-8000-000100000051',
   'production_energy', 'simulated', 'interval', '1 mon', 'pvgis', 'PVGIS estimate',
   '{"peak_kw": 3.825, "tilt": 30, "azimuth": 180, "loss_pct": 14}');

select store('00000000-0000-4000-8000-000100000074',
             array(select make_timestamptz(2026, m, 1, 0, 0, 0, 'Europe/Madrid') from generate_series(1, 12) m),
             array[330, 390, 520, 580, 650, 690, 720, 680, 560, 450, 330, 300]::float8[]);

-- Queries a page would run
-- The house as a card:
--   select p.name, p.city, area_m2(p.geometry) plot_area, attributes_of(p.id) from participants p
--    where p.id = '00000000-0000-4000-8000-000100000010';
-- What is behind the meter:
--   select m.identifier, d.name from meters m join devices d on d.participant_id = m.participant_id
--    where m.participant_id = '00000000-0000-4000-8000-000100000010' and d.status <> 'planned';
-- Hourly production on the sunny day:
--   select * from resample('00000000-0000-4000-8000-000100000071', '2026-06-21', '2026-06-22', '1 hour');
-- Daily offtake from the register:
--   select bucket, value - lag(value) over (order by bucket) kwh
--     from resample('00000000-0000-4000-8000-000100000072', '2026-06-01', '2026-07-01', '1 day');
-- What the smart meter reads, and where:
--   select s.quantity_code, s.external_ref from series s where s.device_id = '00000000-0000-4000-8000-000100000053';
-- What is planned:
--   select name, device_type, status from devices where status = 'planned';

-- Daily readings are cut in the participant's time zone.
update participants set time_zone = 'Europe/Madrid' where organisation_id = '00000000-0000-4000-8000-000100000001';

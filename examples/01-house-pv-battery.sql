-- Example 1 — a house with a PV system, in Seville. Needs the core only.
--
-- A family's site — the house and its plot, at its address — a connection
-- point, a PV system behind the meter, an inverter and a smart meter whose
-- readings are series, a day of quarter-hour production, a drone video and
-- the permit as documents, a battery in a scenario, and a production
-- estimate recorded as a run with the orientation it assumed. The house as
-- a building, its roof faces and its energy label are a physical
-- description, the `3d` module's (examples 02, 05, 06, 07).

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000100000001', 'The Moreno family');

insert into sites (id, organisation_id, name, country, street, postal_code, city, profile, geometry) values
  ('00000000-0000-4000-8000-000100000010', '00000000-0000-4000-8000-000100000001', 'Calle Betis 14', 'ES', 'Calle Betis 14', '41010', 'Sevilla', 'residential',
   ST_GeomFromText('POLYGON((-5.9962 37.3845, -5.9959 37.3845, -5.9959 37.3848, -5.9962 37.3848, -5.9962 37.3845))', 4326));

insert into meters (id, organisation_id, site_id, name, identifier, scheme, resource, direction) values
  ('00000000-0000-4000-8000-000100000040', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010', 'Supply point', '843000000000000123', 'gs1_gsrn', 'electricity', 'both');

insert into devices (id, organisation_id, site_id, name, device_type, manufacturer, model, rated_power_kw, unit_count, installation_date, tags) values
  ('00000000-0000-4000-8000-000100000051', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010',
   'PV system', 'solar', 'Trina', 'Vertex S 425', 3.825, 9, '2024-05-10', '{solar,electric}'),
  ('00000000-0000-4000-8000-000100000052', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010',
   'Inverter', 'inverter', 'Huawei', 'SUN2000-4KTL', 4, 1, '2024-05-10', '{electric}'),
  ('00000000-0000-4000-8000-000100000053', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010',
   'Smart meter', 'meter', 'Sagemcom', 'T211', null, 1, '2020-02-01', '{electric}');

-- The PV system feeds the inverter, which feeds the connection point; all
-- three devices are behind it.
insert into links (subject_id, type_code, object_id) values
  ('00000000-0000-4000-8000-000100000051', 'feeds', '00000000-0000-4000-8000-000100000052'),
  ('00000000-0000-4000-8000-000100000052', 'feeds', '00000000-0000-4000-8000-000100000040');
select connect_device(d, '00000000-0000-4000-8000-000100000040')
  from unnest(array['00000000-0000-4000-8000-000100000051', '00000000-0000-4000-8000-000100000052',
                    '00000000-0000-4000-8000-000100000053']::uuid[]) d;

-- The instruments are devices, the points they read are series: what is
-- observed (the PV system, the connection point), by which device, and
-- where a connector finds it.
-- A sunny day of production, every quarter-hour, in kWh per interval, read
-- from the inverter.
insert into series (id, organisation_id, object_id, device_id, quantity_code, kind, value_kind, step, external_ref, source) values
  ('00000000-0000-4000-8000-000100000071', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000051', '00000000-0000-4000-8000-000100000052',
   'production_energy', 'measured', 'interval', '15 minutes', 'sunspec://192.168.1.20/40083', 'inverter');

select store('00000000-0000-4000-8000-000100000071', array_agg(ts order by ts),
             array_agg(round(greatest(0, 3.6 * sin(pi() * (extract(epoch from ts - '2026-06-21 06:30+02'::timestamptz) / 3600) / 13.5))::numeric / 4, 3)::float8 order by ts))
  from generate_series('2026-06-21 00:00+02'::timestamptz, '2026-06-21 23:45+02', '15 minutes') ts;

-- The two registers of the smart meter, as ever-rising indexes: offtake
-- read daily, injection not collected yet.
insert into series (id, organisation_id, object_id, device_id, quantity_code, kind, value_kind, step, external_ref, source) values
  ('00000000-0000-4000-8000-000100000072', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000040', '00000000-0000-4000-8000-000100000053',
   'offtake_energy', 'measured', 'cumulative', '1 day', 'p1://meter/1.8.0', 'meter'),
  ('00000000-0000-4000-8000-000100000073', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000040', '00000000-0000-4000-8000-000100000053',
   'injection_energy', 'measured', 'cumulative', '1 day', 'p1://meter/2.8.0', 'meter');

select store('00000000-0000-4000-8000-000100000072', array_agg(d order by d),
             array_agg((48210 + 6.2 * (extract(epoch from d - '2026-06-01'::timestamptz) / 86400))::float8 order by d))
  from generate_series('2026-06-01'::timestamptz, '2026-06-30', '1 day') d;

-- What the household takes in a year, from its invoices.
insert into attributes (object_id, property_code, value, valid_from, valid_to, source) values
  ('00000000-0000-4000-8000-000100000010', 'annual_consumption', '4300', null, null, 'supplier invoices 2025');

insert into documents (object_id, name, kind, uri, media_type, source, captured_at) values
  ('00000000-0000-4000-8000-000100000010', 'Orbit video', 'video', 's3://nexgen-os-examples/house/orbit.mp4', 'video/mp4', 'drone flight', '2026-03-14'),
  ('00000000-0000-4000-8000-000100000010', 'Building permit 1998', 'permit', 's3://nexgen-os-examples/house/permit-1998.pdf', 'application/pdf', 'town hall', null),
  ('00000000-0000-4000-8000-000100000051', 'Module datasheet', 'datasheet', 'https://static.trinasolar.com/vertex-s-425.pdf', 'application/pdf', 'manufacturer', null);

-- A variant: add a battery. Only visible in the scenario.
insert into scenarios (id, organisation_id, name, description) values
  ('00000000-0000-4000-8000-000100000080', '00000000-0000-4000-8000-000100000001', 'Add a 10 kWh battery', 'Store the midday surplus for the evening.');

insert into devices (id, organisation_id, site_id, name, device_type, manufacturer, model, rated_power_kw, status, scenario_id) values
  ('00000000-0000-4000-8000-000100000054', '00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000010',
   'Battery', 'battery', 'BYD', 'HVS 10.2', 5, 'planned', '00000000-0000-4000-8000-000100000080');
select connect_device('00000000-0000-4000-8000-000100000054', '00000000-0000-4000-8000-000100000040');

insert into attributes (object_id, property_code, value, scenario_id, source) values
  ('00000000-0000-4000-8000-000100000054', 'efficiency', '0.95', '00000000-0000-4000-8000-000100000080', 'datasheet');

-- An estimate from PVGIS, recorded as a run of the solar module, with the
-- orientation of the modules it assumed: south, 30° (an array of the
-- `solar` module carries its own azimuth and tilt).
insert into modules (code, name, version, schema_name, requires_core_min) values
  ('solar', 'Solar', '0.1.0', 'solar', '0.1.0')
on conflict (code) do nothing;

select record_run('solar', 'pvgis-5.3+core-0.1.0', '00000000-0000-4000-8000-000100000051', null,
  '{"source": "pvgis", "peak_kw": 3.825, "tilt": 30, "azimuth": 180, "loss_pct": 14}',
  '{"annual_kwh": 6120, "monthly_kwh": [330, 390, 520, 580, 650, 690, 720, 680, 560, 450, 330, 300]}');

-- Queries a page would run
-- The house as a card:
--   select s.name, s.city, area_m2(s.geometry) plot_area, attributes_of(s.id) from sites s
--    where s.id = '00000000-0000-4000-8000-000100000010';
-- Hourly production on the sunny day:
--   select * from resample('00000000-0000-4000-8000-000100000071', '2026-06-21', '2026-06-22', '1 hour');
-- Daily offtake from the register:
--   select bucket, value - lag(value) over (order by bucket) kwh
--     from resample('00000000-0000-4000-8000-000100000072', '2026-06-01', '2026-07-01', '1 day');
-- What the smart meter reads, and where:
--   select s.quantity_code, s.external_ref from series s where s.device_id = '00000000-0000-4000-8000-000100000053';
-- What the scenario adds:
--   select name, device_type, status from devices where scenario_id = '00000000-0000-4000-8000-000100000080';

-- Daily readings are cut in the site's time zone.
update sites set time_zone = 'Europe/Madrid' where organisation_id = '00000000-0000-4000-8000-000100000001';

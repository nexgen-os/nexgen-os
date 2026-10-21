-- Example 4 — a farm with PV on the roof, on the ground and over the car park, in the Nord.
-- Needs the core only.
--
-- A farmer's site, PV on the barn roof, a ground array on the field and a
-- carport on the car park, an offtake meter and an injection meter, the
-- annual consumption known from invoices, the product rows the devices are
-- instances of, and a PVGIS estimate for each array as a run with the
-- orientation it assumed. The barn, the stable and their roof faces are a
-- physical description, the `building` module's; the GeoJSON test adds them.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000400000001', 'GAEC du Mont Noir');

insert into sites (id, organisation_id, name, country, street, postal_code, city, region, profile, geometry) values
  ('00000000-0000-4000-8000-000400000010', '00000000-0000-4000-8000-000400000001', 'Ferme du Mont Noir', 'FR', 'Route de Boeschepe 3', '59270', 'Saint-Jans-Cappel', 'FR-HDF', 'agricultural',
   ST_GeomFromText('POLYGON((2.7210 50.7705, 2.7250 50.7705, 2.7250 50.7730, 2.7210 50.7730, 2.7210 50.7705))', 4326));

insert into meters (id, organisation_id, site_id, name, identifier, scheme, resource, direction) values
  ('00000000-0000-4000-8000-000400000041', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Farm supply', '301000000000000987', 'gs1_gsrn', 'electricity', 'both'),
  ('00000000-0000-4000-8000-000400000042', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Field injection point', '301000000000000988', 'gs1_gsrn', 'electricity', 'injection');

insert into device_directory (id, organisation_id, device_type, manufacturer, model_ref, unit_power_kw, unit_surface_m2, unit_price, currency) values
  ('00000000-0000-4000-8000-000400000090', null, 'solar', 'Longi', 'Hi-MO 6 545', 0.545, 2.56, null, null),
  ('00000000-0000-4000-8000-000400000091', '00000000-0000-4000-8000-000400000001', 'inverter', 'SMA', 'Sunny Tripower X 25', 25, null, 2890, 'EUR');

insert into devices (id, organisation_id, site_id, name, device_type, directory_id, manufacturer, model, rated_power_kw, unit_count, status, installation_date, tags) values
  ('00000000-0000-4000-8000-000400000051', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010',
   'Barn roof array', 'solar', '00000000-0000-4000-8000-000400000090', 'Longi', 'Hi-MO 6 545', 99.19, 182, 'in_service', '2023-06-20', '{solar,electric}'),
  ('00000000-0000-4000-8000-000400000052', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010',
   'Lower field ground array', 'solar', '00000000-0000-4000-8000-000400000090', 'Longi', 'Hi-MO 6 545', 498.6, 915, 'planned', null, '{solar,electric}'),
  ('00000000-0000-4000-8000-000400000053', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010',
   'Car park array', 'solar', '00000000-0000-4000-8000-000400000090', 'Longi', 'Hi-MO 6 545', 36.0, 66, 'planned', null, '{solar,electric}'),
  ('00000000-0000-4000-8000-000400000054', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010',
   'Barn inverters', 'inverter', '00000000-0000-4000-8000-000400000091', 'SMA', 'Sunny Tripower X 25', 100, 4, 'in_service', '2023-06-20', '{electric}'),
  ('00000000-0000-4000-8000-000400000055', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010',
   'Milking parlour cooling', 'hvac', null, 'Packo', 'ICE 5000', 22, 1, 'in_service', '2012-03-01', '{electric}');

-- What is behind which connection point.
select connect_device(d, m)
  from (values ('00000000-0000-4000-8000-000400000051'::uuid, '00000000-0000-4000-8000-000400000041'::uuid),
               ('00000000-0000-4000-8000-000400000052', '00000000-0000-4000-8000-000400000042'),
               ('00000000-0000-4000-8000-000400000053', '00000000-0000-4000-8000-000400000041'),
               ('00000000-0000-4000-8000-000400000054', '00000000-0000-4000-8000-000400000041'),
               ('00000000-0000-4000-8000-000400000055', '00000000-0000-4000-8000-000400000041')) v (d, m);

update devices set geometry = ST_GeomFromText('POLYGON((2.7234 50.7707, 2.7246 50.7707, 2.7246 50.7715, 2.7234 50.7715, 2.7234 50.7707))', 4326)
 where id = '00000000-0000-4000-8000-000400000052';

insert into links (subject_id, type_code, object_id) values
  ('00000000-0000-4000-8000-000400000051', 'feeds', '00000000-0000-4000-8000-000400000054'),
  ('00000000-0000-4000-8000-000400000054', 'feeds', '00000000-0000-4000-8000-000400000041');

insert into attributes (object_id, property_code, value, source) values
  ('00000000-0000-4000-8000-000400000010', 'annual_consumption', '186000', 'supplier invoices 2025'),
  ('00000000-0000-4000-8000-000400000041', 'subscribed_power', '160', 'supply contract');

insert into documents (object_id, name, kind, uri, media_type, source) values
  ('00000000-0000-4000-8000-000400000010', 'Electricity invoices 2025', 'document', 's3://nexgen-os-examples/farm/invoices-2025.pdf', 'application/pdf', 'supplier'),
  ('00000000-0000-4000-8000-000400000052', 'Ground array layout', 'plan', 's3://nexgen-os-examples/farm/field-layout.geojson', 'application/geo+json', 'installer');

insert into modules (code, name, version, schema_name, requires_core_min) values
  ('solar', 'Solar', '0.1.0', 'solar', '0.1.0')
on conflict (code) do nothing;

-- The orientation each estimate assumed: the barn roof faces south-south-east
-- at 15°, the ground array south on flat ground, the carport south at 10°.
select record_run('solar', 'pvgis-5.3+core-0.1.0', d.id, null,
  jsonb_build_object('source', 'pvgis', 'peak_kw', d.rated_power_kw, 'tilt', o.tilt_deg, 'azimuth', o.azimuth_deg, 'loss_pct', 14),
  jsonb_build_object('annual_kwh', round(d.rated_power_kw * o.specific_yield)))
  from devices d
  join (values ('00000000-0000-4000-8000-000400000051'::uuid, 175, 15, 1000),
               ('00000000-0000-4000-8000-000400000052', 180, 0, 1010),
               ('00000000-0000-4000-8000-000400000053', 180, 10, 980)) o (device_id, azimuth_deg, tilt_deg, specific_yield)
    on o.device_id = d.id;

-- Queries a page would run
-- The arrays, the orientation their estimate assumed and what they are expected to give:
--   select d.name, r.inputs->>'azimuth' azimuth, r.inputs->>'tilt' tilt, d.rated_power_kw, d.status, r.results->>'annual_kwh' annual_kwh
--     from devices d left join runs r on r.subject_id = d.id
--    where d.device_type = 'solar' and d.organisation_id = '00000000-0000-4000-8000-000400000001' order by d.name;
-- Area of the ground array, in m², from its outline:
--   select area_m2(geometry) from devices where id = '00000000-0000-4000-8000-000400000052';
-- What is behind each meter:
--   select m.name, d.name device from meters m join devices d on d.meter_id = m.id
--    where m.site_id = '00000000-0000-4000-8000-000400000010' order by 1, 2;

-- Daily readings are cut in the site's time zone.
update sites set time_zone = 'Europe/Paris' where organisation_id = '00000000-0000-4000-8000-000400000001';

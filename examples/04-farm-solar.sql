-- Example 4 — a farm with PV on the roof, on the ground and over the car park, in the Nord.
-- Needs the `grid` module.
--
-- A farmer's site with a barn and a stable, a field and a car park, PV on
-- the barn roof, a ground array on the field and a carport on the car park,
-- an offtake meter and an injection meter, the annual consumption known from
-- invoices, the product rows the devices are instances of, and a PVGIS
-- estimate for each array as a run.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000400000001', 'GAEC du Mont Noir');

insert into sites (id, organisation_id, name, country, street, postal_code, city, region, profile, geometry) values
  ('00000000-0000-4000-8000-000400000010', '00000000-0000-4000-8000-000400000001', 'Ferme du Mont Noir', 'FR', 'Route de Boeschepe 3', '59270', 'Saint-Jans-Cappel', 'FR-HDF', 'agricultural',
   ST_GeomFromText('POLYGON((2.7210 50.7705, 2.7250 50.7705, 2.7250 50.7730, 2.7210 50.7730, 2.7210 50.7705))', 4326));

insert into buildings (id, organisation_id, site_id, name, profile, footprint, elevation_m, height_m) values
  ('00000000-0000-4000-8000-000400000021', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Barn', 'agricultural',
   ST_GeomFromText('POLYGON((2.7215 50.7710, 2.7222 50.7710, 2.7222 50.7714, 2.7215 50.7714, 2.7215 50.7710))', 4326), 64, 8),
  ('00000000-0000-4000-8000-000400000022', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Stable', 'agricultural',
   ST_GeomFromText('POLYGON((2.7225 50.7710, 2.7230 50.7710, 2.7230 50.7713, 2.7225 50.7713, 2.7225 50.7710))', 4326), 64, 6);

insert into surfaces (id, organisation_id, building_id, site_id, name, kind, azimuth_deg, tilt_deg) values
  ('00000000-0000-4000-8000-000400000031', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000021', null, 'Barn roof, south', 'roof', 175, 15),
  ('00000000-0000-4000-8000-000400000032', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000021', null, 'Barn roof, north', 'roof', 355, 15),
  ('00000000-0000-4000-8000-000400000033', '00000000-0000-4000-8000-000400000001', null, '00000000-0000-4000-8000-000400000010', 'Lower field', 'ground', 180, 0),
  ('00000000-0000-4000-8000-000400000034', '00000000-0000-4000-8000-000400000001', null, '00000000-0000-4000-8000-000400000010', 'Visitor car park', 'carport', 180, 10);

-- What the cadastre and the farmer say about them, each with its source.
insert into attributes (object_id, property_code, value, source) values
  ('00000000-0000-4000-8000-000400000021', 'year_built', '2004', 'building permit'),
  ('00000000-0000-4000-8000-000400000021', 'floors_above_ground', '1', 'building permit'),
  ('00000000-0000-4000-8000-000400000022', 'year_built', '1987', 'building permit'),
  ('00000000-0000-4000-8000-000400000022', 'floors_above_ground', '1', 'building permit'),
  ('00000000-0000-4000-8000-000400000031', 'material', '"fibre cement"', 'roofer''s survey'),
  ('00000000-0000-4000-8000-000400000032', 'material', '"fibre cement"', 'roofer''s survey'),
  ('00000000-0000-4000-8000-000400000033', 'material', '"grass"', 'the farmer'),
  ('00000000-0000-4000-8000-000400000034', 'material', '"steel structure"', 'installer');

update surfaces set geometry = ST_GeomFromText('POLYGON((2.7232 50.7706, 2.7248 50.7706, 2.7248 50.7716, 2.7232 50.7716, 2.7232 50.7706))', 4326)
 where id = '00000000-0000-4000-8000-000400000033';

insert into grid.meters (id, organisation_id, site_id, name, identifier, scheme, resource, direction) values
  ('00000000-0000-4000-8000-000400000041', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Farm supply', '301000000000000987', 'gs1_gsrn', 'electricity', 'both'),
  ('00000000-0000-4000-8000-000400000042', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Field injection point', '301000000000000988', 'gs1_gsrn', 'electricity', 'injection');

insert into device_directory (id, organisation_id, device_type, manufacturer, model_ref, unit_power_kw, unit_surface_m2, unit_price, currency) values
  ('00000000-0000-4000-8000-000400000090', null, 'solar', 'Longi', 'Hi-MO 6 545', 0.545, 2.56, null, null),
  ('00000000-0000-4000-8000-000400000091', '00000000-0000-4000-8000-000400000001', 'inverter', 'SMA', 'Sunny Tripower X 25', 25, null, 2890, 'EUR');

insert into devices (id, organisation_id, site_id, building_id, surface_id, name, device_type, directory_id, manufacturer, model, rated_power_kw, unit_count, status, installation_date, tags) values
  ('00000000-0000-4000-8000-000400000051', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', '00000000-0000-4000-8000-000400000021', '00000000-0000-4000-8000-000400000031',
   'Barn roof array', 'solar', '00000000-0000-4000-8000-000400000090', 'Longi', 'Hi-MO 6 545', 99.19, 182, 'in_service', '2023-06-20', '{solar,electric}'),
  ('00000000-0000-4000-8000-000400000052', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', null, '00000000-0000-4000-8000-000400000033',
   'Lower field ground array', 'solar', '00000000-0000-4000-8000-000400000090', 'Longi', 'Hi-MO 6 545', 498.6, 915, 'planned', null, '{solar,electric}'),
  ('00000000-0000-4000-8000-000400000053', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', null, '00000000-0000-4000-8000-000400000034',
   'Car park array', 'solar', '00000000-0000-4000-8000-000400000090', 'Longi', 'Hi-MO 6 545', 36.0, 66, 'planned', null, '{solar,electric}'),
  ('00000000-0000-4000-8000-000400000054', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', '00000000-0000-4000-8000-000400000021', null,
   'Barn inverters', 'inverter', '00000000-0000-4000-8000-000400000091', 'SMA', 'Sunny Tripower X 25', 100, 4, 'in_service', '2023-06-20', '{electric}'),
  ('00000000-0000-4000-8000-000400000055', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', '00000000-0000-4000-8000-000400000022', null,
   'Milking parlour cooling', 'hvac', null, 'Packo', 'ICE 5000', 22, 1, 'in_service', '2012-03-01', '{electric}');

-- What is behind which connection point.
insert into links (subject_id, type_code, object_id) values
  ('00000000-0000-4000-8000-000400000051', 'behind_meter', '00000000-0000-4000-8000-000400000041'),
  ('00000000-0000-4000-8000-000400000052', 'behind_meter', '00000000-0000-4000-8000-000400000042'),
  ('00000000-0000-4000-8000-000400000053', 'behind_meter', '00000000-0000-4000-8000-000400000041'),
  ('00000000-0000-4000-8000-000400000054', 'behind_meter', '00000000-0000-4000-8000-000400000041'),
  ('00000000-0000-4000-8000-000400000055', 'behind_meter', '00000000-0000-4000-8000-000400000041');

update devices set geometry = ST_GeomFromText('POLYGON((2.7234 50.7707, 2.7246 50.7707, 2.7246 50.7715, 2.7234 50.7715, 2.7234 50.7707))', 4326)
 where id = '00000000-0000-4000-8000-000400000052';

insert into links (subject_id, type_code, object_id) values
  ('00000000-0000-4000-8000-000400000051', 'feeds', '00000000-0000-4000-8000-000400000054'),
  ('00000000-0000-4000-8000-000400000054', 'feeds', '00000000-0000-4000-8000-000400000041');

insert into attributes (object_id, property_code, value, source) values
  ('00000000-0000-4000-8000-000400000010', 'annual_consumption', '186000', 'supplier invoices 2025'),
  ('00000000-0000-4000-8000-000400000041', 'subscribed_power', '160', 'supply contract'),
  ('00000000-0000-4000-8000-000400000031', 'roof_area', '1180', 'measured on the cadastral plan'),
  ('00000000-0000-4000-8000-000400000033', 'roof_area', '11200', 'measured on the cadastral plan');

insert into external_ids (object_id, scheme, value) values
  ('00000000-0000-4000-8000-000400000021', 'osm', 'way/445566778');

insert into documents (object_id, name, kind, uri, media_type, source) values
  ('00000000-0000-4000-8000-000400000010', 'Electricity invoices 2025', 'document', 's3://nexgen-os-examples/farm/invoices-2025.pdf', 'application/pdf', 'supplier'),
  ('00000000-0000-4000-8000-000400000052', 'Ground array layout', 'plan', 's3://nexgen-os-examples/farm/field-layout.geojson', 'application/geo+json', 'installer');

insert into modules (code, name, version, schema_name, requires_core_min) values
  ('solar', 'Solar', '0.1.0', 'solar', '0.1.0')
on conflict (code) do nothing;

select record_run('solar', 'pvgis-5.3+core-0.1.0', d.id, null,
  jsonb_build_object('source', 'pvgis', 'peak_kw', d.rated_power_kw, 'tilt', s.tilt_deg, 'azimuth', s.azimuth_deg, 'loss_pct', 14),
  jsonb_build_object('annual_kwh', round(d.rated_power_kw * case s.kind when 'ground' then 1010 when 'carport' then 980 else 1000 end)))
  from devices d join surfaces s on s.id = d.surface_id
 where d.organisation_id = '00000000-0000-4000-8000-000400000001' and d.device_type = 'solar';

-- Queries a page would run
-- The arrays, where they stand and what they are expected to give:
--   select d.name, s.kind, s.azimuth_deg, s.tilt_deg, d.rated_power_kw, d.status, r.results->>'annual_kwh' annual_kwh
--     from devices d join surfaces s on s.id = d.surface_id left join runs r on r.subject_id = d.id
--    where d.device_type = 'solar' and d.organisation_id = '00000000-0000-4000-8000-000400000001' order by d.name;
-- Area available on the field, in m², from its outline:
--   select area_m2(geometry) from surfaces where id = '00000000-0000-4000-8000-000400000033';
-- What is behind each meter:
--   select m.name, d.name device from grid.meters m join links l on l.object_id = m.id and l.type_code = 'behind_meter'
--     join devices d on d.id = l.subject_id where m.site_id = '00000000-0000-4000-8000-000400000010' order by 1, 2;

-- Daily readings are cut in the site's time zone.
update sites set time_zone = 'Europe/Paris' where organisation_id = '00000000-0000-4000-8000-000400000001';

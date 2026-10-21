-- The physical description of the farm of example 4, for the `building` module:
-- the barn and the stable, their roof faces, the field and the car park,
-- what the cadastre and the farmer say about them, and where the devices of
-- the example are placed among them.

insert into building.buildings (id, organisation_id, site_id, name, profile, footprint, elevation_m, height_m) values
  ('00000000-0000-4000-8000-000400000021', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Barn', 'agricultural',
   ST_GeomFromText('POLYGON((2.7215 50.7710, 2.7222 50.7710, 2.7222 50.7714, 2.7215 50.7714, 2.7215 50.7710))', 4326), 64, 8),
  ('00000000-0000-4000-8000-000400000022', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Stable', 'agricultural',
   ST_GeomFromText('POLYGON((2.7225 50.7710, 2.7230 50.7710, 2.7230 50.7713, 2.7225 50.7713, 2.7225 50.7710))', 4326), 64, 6);

insert into building.surfaces (id, organisation_id, building_id, site_id, name, kind, azimuth_deg, tilt_deg) values
  ('00000000-0000-4000-8000-000400000031', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000021', null, 'Barn roof, south', 'roof', 175, 15),
  ('00000000-0000-4000-8000-000400000032', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000021', null, 'Barn roof, north', 'roof', 355, 15),
  ('00000000-0000-4000-8000-000400000033', '00000000-0000-4000-8000-000400000001', null, '00000000-0000-4000-8000-000400000010', 'Lower field', 'ground', 180, 0),
  ('00000000-0000-4000-8000-000400000034', '00000000-0000-4000-8000-000400000001', null, '00000000-0000-4000-8000-000400000010', 'Visitor car park', 'carport', 180, 10);

-- What the cadastre and the farmer say about them, each with its source.
insert into attributes (object_kind, object_id, property_code, value, source) values
  ('building', '00000000-0000-4000-8000-000400000021', 'year_built', '2004', 'building permit'),
  ('building', '00000000-0000-4000-8000-000400000021', 'floors_above_ground', '1', 'building permit'),
  ('building', '00000000-0000-4000-8000-000400000022', 'year_built', '1987', 'building permit'),
  ('building', '00000000-0000-4000-8000-000400000022', 'floors_above_ground', '1', 'building permit'),
  ('surface', '00000000-0000-4000-8000-000400000031', 'material', '"fibre cement"', 'roofer''s survey'),
  ('surface', '00000000-0000-4000-8000-000400000032', 'material', '"fibre cement"', 'roofer''s survey'),
  ('surface', '00000000-0000-4000-8000-000400000033', 'material', '"grass"', 'the farmer'),
  ('surface', '00000000-0000-4000-8000-000400000034', 'material', '"steel structure"', 'installer');

update building.surfaces set geometry = ST_GeomFromText('POLYGON((2.7232 50.7706, 2.7248 50.7706, 2.7248 50.7716, 2.7232 50.7716, 2.7232 50.7706))', 4326)
 where id = '00000000-0000-4000-8000-000400000033';

insert into attributes (object_kind, object_id, property_code, value, source) values
  ('surface', '00000000-0000-4000-8000-000400000031', 'roof_area', '1180', 'measured on the cadastral plan'),
  ('surface', '00000000-0000-4000-8000-000400000033', 'roof_area', '11200', 'measured on the cadastral plan');

insert into external_ids (object_kind, object_id, scheme, value) values
  ('building', '00000000-0000-4000-8000-000400000021', 'osm', 'way/445566778');

select building.place_device(d, b, null, f)
  from (values ('00000000-0000-4000-8000-000400000051'::uuid, '00000000-0000-4000-8000-000400000021'::uuid, '00000000-0000-4000-8000-000400000031'::uuid),
               ('00000000-0000-4000-8000-000400000052', null, '00000000-0000-4000-8000-000400000033'),
               ('00000000-0000-4000-8000-000400000053', null, '00000000-0000-4000-8000-000400000034'),
               ('00000000-0000-4000-8000-000400000054', '00000000-0000-4000-8000-000400000021', null),
               ('00000000-0000-4000-8000-000400000055', '00000000-0000-4000-8000-000400000022', null)) v (d, b, f);

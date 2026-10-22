-- The physical description of the farm of example 4, for the `building` module:
-- the ground of the farm, the barn and the stable on it, their roof faces,
-- the field and the car park, and what the cadastre and the farmer say
-- about them. The devices of the example are the farm's, and are not placed.

insert into building.sites (id, organisation_id, participant_id, name, profile, geometry) values
  ('00000000-0000-4000-8000-000400000015', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Farmland', 'land',
   ST_GeomFromText('POLYGON((2.7210 50.7705, 2.7250 50.7705, 2.7250 50.7730, 2.7210 50.7730, 2.7210 50.7705))', 4326));

insert into building.buildings (id, organisation_id, participant_id, site_id, name, profile, footprint, elevation_m, height_m) values
  ('00000000-0000-4000-8000-000400000021', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', '00000000-0000-4000-8000-000400000015', 'Barn', 'agricultural',
   ST_GeomFromText('POLYGON((2.7215 50.7710, 2.7222 50.7710, 2.7222 50.7714, 2.7215 50.7714, 2.7215 50.7710))', 4326), 64, 8),
  ('00000000-0000-4000-8000-000400000022', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', '00000000-0000-4000-8000-000400000015', 'Stable', 'agricultural',
   ST_GeomFromText('POLYGON((2.7225 50.7710, 2.7230 50.7710, 2.7230 50.7713, 2.7225 50.7713, 2.7225 50.7710))', 4326), 64, 6);

insert into building.surfaces (id, organisation_id, building_id, site_id, name, kind, azimuth_deg, tilt_deg) values
  ('00000000-0000-4000-8000-000400000031', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000021', null, 'Barn roof, south', 'roof', 175, 15),
  ('00000000-0000-4000-8000-000400000032', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000021', null, 'Barn roof, north', 'roof', 355, 15),
  ('00000000-0000-4000-8000-000400000033', '00000000-0000-4000-8000-000400000001', null, '00000000-0000-4000-8000-000400000015', 'Lower field', 'ground', 180, 0),
  ('00000000-0000-4000-8000-000400000034', '00000000-0000-4000-8000-000400000001', null, '00000000-0000-4000-8000-000400000015', 'Visitor car park', 'carport', 180, 10);

-- What the cadastre and the farmer say about them, the building permit
-- and the surveys being the sources.
update building.buildings set year_built = 2004, floors_above_ground = 1, global_id = 'way/445566778', source_code = 'openstreetmap'
 where id = '00000000-0000-4000-8000-000400000021';
update building.buildings set year_built = 1987, floors_above_ground = 1 where id = '00000000-0000-4000-8000-000400000022';
update building.surfaces set material = 'fibre cement', area_m2 = 1180 where id = '00000000-0000-4000-8000-000400000031';
update building.surfaces set material = 'fibre cement' where id = '00000000-0000-4000-8000-000400000032';
update building.surfaces set material = 'grass', area_m2 = 11200,
       geometry = ST_GeomFromText('POLYGON((2.7232 50.7706, 2.7248 50.7706, 2.7248 50.7716, 2.7232 50.7716, 2.7232 50.7706))', 4326)
 where id = '00000000-0000-4000-8000-000400000033';
update building.surfaces set material = 'steel structure' where id = '00000000-0000-4000-8000-000400000034';

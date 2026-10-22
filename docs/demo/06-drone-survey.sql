-- Example 6 — a roof surveyed by drone, in Bologna. Needs the `building` module.
--
-- A surveyor's organisation, its client as the participant of a solar
-- study, carrying the place, whose factory hall is described by the
-- `building` module, a drone
-- flight whose outputs are documents (orthophoto, photos, video), the roof
-- faces measured on the orthophoto with the survey as their source, a
-- point cloud kept as a document, and the identifier the building is
-- known by.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000600000001', 'Rilievi Esempio srl');

insert into contacts (id, organisation_id, name, kind) values
  ('00000000-0000-4000-8000-000600000005', '00000000-0000-4000-8000-000600000001', 'Meccanica Esempio SpA', 'company');

-- The client answers for the place in the surveyor's solar study.
insert into projects (id, organisation_id, name, kind, country, status) values
  ('00000000-0000-4000-8000-000600000040', '00000000-0000-4000-8000-000600000001', 'Esempio — rooftop solar study', 'study', 'IT', 'simulation');
insert into participants (id, organisation_id, project_id, name, role, contact_id, status, country, street, postal_code, city, region) values
  ('00000000-0000-4000-8000-000600000010', '00000000-0000-4000-8000-000600000001', '00000000-0000-4000-8000-000600000040', 'Meccanica Esempio', 'prosumer',
   '00000000-0000-4000-8000-000600000005', 'simulation', 'IT', 'Via dell''Esempio 210', '40139', 'Bologna', 'IT-45');

-- Hall A, known to OpenStreetMap by its way, one floor seen on the
-- oblique photos.
insert into building.buildings (id, organisation_id, participant_id, name, use, footprint, elevation_m, height_m, floors_above_ground, global_id) values
  ('00000000-0000-4000-8000-000600000020', '00000000-0000-4000-8000-000600000001', '00000000-0000-4000-8000-000600000010', 'Hall A', 'industrial',
   ST_GeomFromText('POLYGON((11.3850 44.4805, 11.3862 44.4805, 11.3862 44.4811, 11.3850 44.4811, 11.3850 44.4805))', 4326), 52, 11, 1, 'way/112233445');

-- The survey itself is a source of this organisation: who flew, under which terms.
insert into sources (code, name, kind, auth, countries, license, attribution, published_by, description) values
  ('rae_drone_survey', 'Rilievi Aerei Emilia — drone surveys', 'device', 'none', '{IT}', 'client contract', '© Rilievi Aerei Emilia', 'rae', 'Photogrammetric surveys flown by the company''s own drones.');

insert into documents (object_kind, object_id, name, kind, uri, media_type, source_code, source, captured_at, metadata) values
  ('participant', '00000000-0000-4000-8000-000600000010', 'Orthophoto 2 cm', 'image', 's3://nexgen-os-examples/bologna/hall-a-ortho.tif', 'image/tiff', 'rae_drone_survey', 'flight 2026-04-08, DJI M3E', '2026-04-08',
   '{"gsd_cm": 2.1, "crs": "EPSG:32632", "images": 412}'),
  ('participant', '00000000-0000-4000-8000-000600000010', 'Oblique photos', 'image', 's3://nexgen-os-examples/bologna/hall-a-obliques.zip', 'application/zip', 'rae_drone_survey', 'flight 2026-04-08', '2026-04-08',
   '{"count": 96, "exif_pose": true}'),
  ('participant', '00000000-0000-4000-8000-000600000010', 'Roof inspection video', 'video', 's3://nexgen-os-examples/bologna/hall-a-roof.mp4', 'video/mp4', 'rae_drone_survey', 'flight 2026-04-08', '2026-04-08',
   '{"duration_s": 214, "camera": "nadir sweep"}'),
  ('participant', '00000000-0000-4000-8000-000600000010', 'Point cloud', 'document', 's3://nexgen-os-examples/bologna/hall-a.copc.laz', 'application/vnd.laszip+copc', 'rae_drone_survey', 'photogrammetry, OpenDroneMod 3.5', '2026-04-08',
   '{"points": 48200000, "density_per_m2": 850, "note": "a survey output kept as a document; the hosted capture tools read it"}');

-- Roof faces measured on the 2 cm orthophoto, their material seen on the
-- oblique photos: two pitches of a sawtooth roof and a flat annex.
insert into building.surfaces (id, organisation_id, building_id, name, kind, azimuth_deg, tilt_deg, area_m2, material, is_external, source_code, geometry) values
  ('00000000-0000-4000-8000-000600000031', '00000000-0000-4000-8000-000600000001', '00000000-0000-4000-8000-000600000020', 'Sawtooth, south pitches', 'roof', 180, 25,
   2860, 'corrugated steel', true, 'rae_drone_survey',
   ST_GeomFromText('POLYGON Z((11.3850 44.4805 60, 11.3862 44.4805 60, 11.3862 44.4808 63, 11.3850 44.4808 63, 11.3850 44.4805 60))', 4326)),
  ('00000000-0000-4000-8000-000600000032', '00000000-0000-4000-8000-000600000001', '00000000-0000-4000-8000-000600000020', 'Sawtooth, north glazing', 'roof', 0, 60,
   410, 'glass', true, 'rae_drone_survey',
   ST_GeomFromText('POLYGON Z((11.3850 44.4808 63, 11.3862 44.4808 63, 11.3862 44.4809 61, 11.3850 44.4809 61, 11.3850 44.4808 63))', 4326)),
  ('00000000-0000-4000-8000-000600000033', '00000000-0000-4000-8000-000600000001', '00000000-0000-4000-8000-000600000020', 'Annex, flat', 'roof', 180, 2,
   1920, 'bitumen', true, 'rae_drone_survey',
   ST_GeomFromText('POLYGON Z((11.3850 44.4809 59, 11.3862 44.4809 59, 11.3862 44.4811 59, 11.3850 44.4811 59, 11.3850 44.4809 59))', 4326));

-- Queries a page would run
-- What the flight produced:
--   select name, kind, media_type, captured_at, metadata from documents where source_code = 'rae_drone_survey' order by name;
-- The roof faces, with the area measured and the plan area of their outline:
--   select s.name, s.azimuth_deg, s.tilt_deg, s.area_m2 measured_m2, area_m2(s.geometry) plan_m2
--     from building.surfaces s where s.building_id = '00000000-0000-4000-8000-000600000020' order by s.name;
-- Where the building's data came from, with license and attribution:
--   select distinct src.name, src.license, src.attribution from attributes a join sources src on src.code = a.source_code
--    where a.object_id in (select id from building.surfaces where building_id = '00000000-0000-4000-8000-000600000020');

-- Daily readings are cut in the participant's time zone.
update participants set time_zone = 'Europe/Rome' where organisation_id = '00000000-0000-4000-8000-000600000001';

-- Example 5 — a district built from open data, in Dakar. Needs the `building`
-- module.
--
-- A city's district plan with its perimeter, six participants each with
-- its plot (the ground the `building` module describes) and its building
-- whose footprints arrive in UTM zone 28N from OpenStreetMap, heights from
-- a height model, buildings known by their OpenStreetMap ids and floors,
-- one plot split in two by the cadastre, and the queries that find what is
-- inside the perimeter.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000500000001', 'Urbanisme — exemple');

insert into projects (id, organisation_id, name, kind, country, status, geometry) values
  ('00000000-0000-4000-8000-000500000020', '00000000-0000-4000-8000-000500000001', 'Plateau — solar rooftops plan', null, 'SN', 'simulation',
   ST_Transform(ST_MakeEnvelope(236000, 1630000, 237000, 1631000, 32628), 4326));

-- Every plot takes part in the plan through the participant whose it is.
insert into participants (id, organisation_id, project_id, name, category, status, country, city)
select ('00000000-0000-4000-8000-0005000000' || (60 + i))::uuid, '00000000-0000-4000-8000-000500000001', '00000000-0000-4000-8000-000500000020',
       'Plot ' || i, 'prosumer', 'simulation', 'SN', 'Dakar'
  from generate_series(1, 6) i;

-- Six plots and their buildings, footprints in EPSG:32628, straight from the open-data importer.
insert into building.sites (id, organisation_id, participant_id, name)
select ('00000000-0000-4000-8000-0005000000' || (30 + i))::uuid, '00000000-0000-4000-8000-000500000001', ('00000000-0000-4000-8000-0005000000' || (60 + i))::uuid, 'Plot ' || i
  from generate_series(1, 6) i;

-- Each building with its OpenStreetMap way and the number of floors it
-- gives (building:levels), the source of the row.
insert into building.buildings (id, organisation_id, participant_id, site_id, name, use, footprint, height_m, floors_above_ground, source_code, global_id)
select ('00000000-0000-4000-8000-0005000000' || (40 + i))::uuid, '00000000-0000-4000-8000-000500000001',
       ('00000000-0000-4000-8000-0005000000' || (60 + i))::uuid, ('00000000-0000-4000-8000-0005000000' || (30 + i))::uuid,
       'Building ' || i, case when i in (2, 5) then 'office' else 'mixed' end,
       ST_SetSRID(ST_MakeEnvelope(236100 + 120 * i, 1630400, 236100 + 120 * i + 20, 1630415), 32628),
       6 + 3 * (i % 4), 2 + (i % 4), 'openstreetmap', 'way/' || (987650000 + i)
  from generate_series(1, 6) i;

-- Heights come from the Copernicus height model, noted as such.
insert into documents (object_kind, object_id, name, kind, uri, media_type, source_code, source) values
  ('project', '00000000-0000-4000-8000-000500000020', 'Height model tile', 'document', 's3://nexgen-os-demo/dakar/dem-n14w018.tif', 'image/tiff', 'copernicus_dem', 'GLO-30 tile N14 W018');

-- A roof face per building, flat, ready for the solar study.
insert into building.surfaces (id, organisation_id, building_id, name, kind, azimuth_deg, tilt_deg)
select ('00000000-0000-4000-8000-0005000000' || (50 + i))::uuid, '00000000-0000-4000-8000-000500000001', ('00000000-0000-4000-8000-0005000000' || (40 + i))::uuid, 'Roof ' || i, 'roof', 180, 0
  from generate_series(1, 6) i;

-- Plot 6 was split in two by the cadastre this year: two new grounds of
-- its participant, with what the cadastre says of where they come from.
insert into building.sites (id, organisation_id, participant_id, name, metadata) values
  ('00000000-0000-4000-8000-000500000037', '00000000-0000-4000-8000-000500000001', '00000000-0000-4000-8000-000500000066', 'Plot 6a',
   '{"cadastre": {"split_from": "Plot 6", "on": "2026-02-01"}}'),
  ('00000000-0000-4000-8000-000500000038', '00000000-0000-4000-8000-000500000001', '00000000-0000-4000-8000-000500000066', 'Plot 6b',
   '{"cadastre": {"split_from": "Plot 6", "on": "2026-02-01"}}');

-- Queries a page would run
-- Buildings inside the perimeter, with their roof area:
--   select b.name, b.height_m, area_m2(b.footprint) roof_m2
--     from building.buildings b, projects p
--    where p.id = '00000000-0000-4000-8000-000500000020' and ST_Within(ST_Force2D(b.footprint), ST_Force2D(p.geometry)) order by b.name;
-- What plot 6 became:
--   select name, metadata->'cadastre'->>'on' since from building.sites where metadata->'cadastre'->>'split_from' = 'Plot 6';

-- Daily readings are cut in the participant's time zone.
update participants set time_zone = 'Africa/Dakar' where organisation_id = '00000000-0000-4000-8000-000500000001';

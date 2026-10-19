-- Example 5 — a district built from open data, in Dakar. Needs the
-- `community` module.
--
-- A city's district plan with its perimeter, six plots and their buildings
-- whose footprints arrive in UTM zone 28N from OpenStreetMap, heights from
-- a height model, buildings known by their OpenStreetMap ids, one plot split
-- in two, a tall building shading a neighbour's roof, and the queries that
-- find what is inside the perimeter.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000500000001', 'Ville de Dakar — urbanisme');

insert into community.projects (id, organisation_id, name, kind, country, status, geometry) values
  ('00000000-0000-4000-8000-000500000020', '00000000-0000-4000-8000-000500000001', 'Plateau — solar rooftops plan', 'district_plan', 'SN', 'simulation',
   ST_Transform(ST_MakeEnvelope(236000, 1630000, 237000, 1631000, 32628), 4326));

-- Six plots and their buildings, footprints in EPSG:32628, straight from the open-data importer.
insert into sites (id, organisation_id, name, country, city, profile)
select ('00000000-0000-4000-8000-0005000000' || (30 + i))::uuid, '00000000-0000-4000-8000-000500000001', 'Plot ' || i, 'SN', 'Dakar', 'mixed'
  from generate_series(1, 6) i;

insert into buildings (id, organisation_id, site_id, name, profile, footprint, height_m, source_code)
select ('00000000-0000-4000-8000-0005000000' || (40 + i))::uuid, '00000000-0000-4000-8000-000500000001', ('00000000-0000-4000-8000-0005000000' || (30 + i))::uuid,
       'Building ' || i, case when i in (2, 5) then 'office' else 'mixed' end,
       ST_SetSRID(ST_MakeEnvelope(236100 + 120 * i, 1630400, 236100 + 120 * i + 20, 1630415), 32628),
       6 + 3 * (i % 4), 'openstreetmap'
  from generate_series(1, 6) i;

-- The number of floors OpenStreetMap gives (building:levels), with its source.
insert into attributes (object_id, property_code, value, source_code, source)
select ('00000000-0000-4000-8000-0005000000' || (40 + i))::uuid, 'floors_above_ground', to_jsonb(2 + (i % 4)), 'openstreetmap', 'building:levels'
  from generate_series(1, 6) i;

insert into external_ids (object_id, scheme, value)
select ('00000000-0000-4000-8000-0005000000' || (40 + i))::uuid, 'osm', 'way/' || (987650000 + i)
  from generate_series(1, 6) i;

insert into attributes (object_id, property_code, value, source_code, source)
select ('00000000-0000-4000-8000-0005000000' || (40 + i))::uuid, 'floor_area', to_jsonb(300 * (2 + (i % 4))), 'openstreetmap', 'footprint × floors'
  from generate_series(1, 6) i;

-- Heights come from the Copernicus height model, noted as such.
insert into documents (object_id, name, kind, uri, media_type, source_code, source) values
  ('00000000-0000-4000-8000-000500000020', 'Height model tile', 'document', 's3://nexgen-os-examples/dakar/dem-n14w018.tif', 'image/tiff', 'copernicus_dem', 'GLO-30 tile N14 W018');

-- A roof face per building, flat, ready for the solar study.
insert into surfaces (id, organisation_id, building_id, name, kind, azimuth_deg, tilt_deg)
select ('00000000-0000-4000-8000-0005000000' || (50 + i))::uuid, '00000000-0000-4000-8000-000500000001', ('00000000-0000-4000-8000-0005000000' || (40 + i))::uuid, 'Roof ' || i, 'roof', 180, 0
  from generate_series(1, 6) i;

-- Building 3 is the tall one; it shades the roof of building 2.
insert into links (subject_id, type_code, object_id) values
  ('00000000-0000-4000-8000-000500000043', 'shades', '00000000-0000-4000-8000-000500000052');

-- Every plot takes part in the plan.
insert into community.participants (organisation_id, project_id, site_id, name, role, status)
select '00000000-0000-4000-8000-000500000001', '00000000-0000-4000-8000-000500000020', ('00000000-0000-4000-8000-0005000000' || (30 + i))::uuid, 'Plot ' || i, 'prosumer', 'simulation'
  from generate_series(1, 6) i;

-- Plot 6 was split in two by the cadastre this year: two new sites, and a
-- split_into link from the old plot to each.
insert into sites (id, organisation_id, name, country, city, profile) values
  ('00000000-0000-4000-8000-000500000037', '00000000-0000-4000-8000-000500000001', 'Plot 6a', 'SN', 'Dakar', 'mixed'),
  ('00000000-0000-4000-8000-000500000038', '00000000-0000-4000-8000-000500000001', 'Plot 6b', 'SN', 'Dakar', 'mixed');
select split_object('00000000-0000-4000-8000-000500000036',
                    array['00000000-0000-4000-8000-000500000037', '00000000-0000-4000-8000-000500000038']::uuid[], '2026-02-01');

-- Queries a page would run
-- Buildings inside the perimeter, with their roof area:
--   select b.name, b.height_m, area_m2(b.footprint) roof_m2
--     from buildings b, community.projects p
--    where p.id = '00000000-0000-4000-8000-000500000020' and ST_Within(ST_Force2D(b.footprint), ST_Force2D(p.geometry)) order by b.name;
-- Which roofs are shaded:
--   select s.name, b.name shaded_by from links l join surfaces s on s.id = l.object_id join buildings b on b.id = l.subject_id where l.type_code = 'shades';
-- What plot 6 became:
--   select s.name, l.valid_from from links l join sites s on s.id = l.object_id
--    where l.type_code = 'split_into' and l.subject_id = '00000000-0000-4000-8000-000500000036';

-- Daily readings are cut in the site's time zone.
update sites set time_zone = 'Africa/Dakar' where organisation_id = '00000000-0000-4000-8000-000500000001';

-- Example 2 — a school, inside and out, in a small municipality. Needs the
-- `building` module.
--
-- A municipality is the participant of its school's study: it carries the
-- place, and its devices; the `building` module describes the main
-- building with two floors and five rooms (one tree of spaces), their
-- floor areas, its year and its energy label. A multisensor per classroom
-- reads temperature, CO2 and presence, a presence detector in the canteen,
-- a heating setpoint per classroom asked of the heat pump, a morning of
-- readings, and the number of pupils as an attribute the installation
-- publishes.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000200000001', 'Commune de Valbrisée');

insert into contacts (id, organisation_id, name, kind) values
  ('00000000-0000-4000-8000-000200000005', '00000000-0000-4000-8000-000200000001', 'Service des bâtiments', 'company');

insert into projects (id, organisation_id, name, kind, country, status) values
  ('00000000-0000-4000-8000-000200000006', '00000000-0000-4000-8000-000200000001', 'School comfort and heating', 'study', 'BE', 'active');

insert into participants (id, organisation_id, project_id, name, role, contact_id, country, street, postal_code, city, region) values
  ('00000000-0000-4000-8000-000200000010', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000006', 'École du Centre', 'consumer',
   '00000000-0000-4000-8000-000200000005', 'BE', 'Rue de l''École 12', '1380', 'Valbrisée', 'BE-WBR');

-- The main building: its footprint and height, and what the archive, the
-- drawings and the certificate say of it.
insert into building.buildings (id, organisation_id, participant_id, name, profile, footprint, elevation_m, height_m,
                                year_built, floor_area_m2, energy_label) values
  ('00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000010', 'Main building', 'school',
   ST_GeomFromText('POLYGON((4.4702 50.6802, 4.4708 50.6802, 4.4708 50.6805, 4.4702 50.6805, 4.4702 50.6802))', 4326), 112, 9.5,
   1968, 1840, 'D');

-- Two floors, and the rooms on them: one tree of spaces.
insert into building.spaces (id, organisation_id, building_id, kind, name, level, elevation_m, height_m) values
  ('00000000-0000-4000-8000-000200000030', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', 'floor', 'Ground floor', 0, 112, 3.2),
  ('00000000-0000-4000-8000-000200000031', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', 'floor', 'First floor', 1, 115.2, 3);

-- The rooms, with their floor areas measured on the drawings.
insert into building.spaces (id, organisation_id, building_id, parent_id, kind, name, floor_area_m2) values
  ('00000000-0000-4000-8000-000200000041', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000030', 'room', 'Classroom 1', 62),
  ('00000000-0000-4000-8000-000200000042', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000030', 'room', 'Classroom 2', 60),
  ('00000000-0000-4000-8000-000200000043', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000030', 'room', 'Canteen', 140),
  ('00000000-0000-4000-8000-000200000044', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000031', 'room', 'Classroom 5', 60),
  ('00000000-0000-4000-8000-000200000045', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000031', 'room', 'Staff room', 35);

-- The heat pump and the instruments are the school's, behind its meter: a
-- multisensor per classroom, a presence detector in the canteen, each
-- named after the room it measures. Where an instrument sits is not
-- described (decision 0026).
insert into devices (id, organisation_id, participant_id, name, device_type, manufacturer, model, rated_power_kw, installation_date) values
  ('00000000-0000-4000-8000-000200000050', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000010',
   'Air-to-water heat pump', 'heat_pump', 'Daikin', 'Altherma 3 H HT 18', 18, '2023-10-02');

-- The points, one series each: what an instrument measures; the heating
-- setpoint of a room is asked of the heat pump, one series per room, named
-- after it.
with instruments as (
  select s.id space_id, s.name,
         install_device('00000000-0000-4000-8000-000200000010',
                        case when s.name = 'Canteen' then 'sensor' else 'sensor_box' end,
                        s.name || case when s.name = 'Canteen' then ' — presence detector' else ' — multisensor' end,
                        p_installed_on => '2024-09-01') device_id
    from building.spaces s
   where s.name like 'Classroom%' or s.name = 'Canteen'
)
insert into series (organisation_id, object_kind, object_id, device_id, quantity_code, kind, value_kind, step, name, external_ref)
select '00000000-0000-4000-8000-000200000001', 'device', case when q.kind = 'setpoint' then '00000000-0000-4000-8000-000200000050'::uuid else i.device_id end,
       case when q.kind = 'setpoint' then '00000000-0000-4000-8000-000200000050'::uuid else i.device_id end,
       q.quantity, q.kind, 'instant', case when q.kind = 'measured' then interval '10 minutes' end, i.name,
       format('mqtt://school/%s/%s', lower(replace(i.name, ' ', '-')), q.topic)
  from instruments i
  cross join (values ('temperature', 'measured', 'temp'),
                     ('co2', 'measured', 'co2'),
                     ('occupancy', 'measured', 'presence'),
                     ('temperature', 'setpoint', 'setpoint')) as q(quantity, kind, topic)
 where i.name like 'Classroom%' or (i.name = 'Canteen' and q.topic = 'presence');

-- A school morning in classroom 1: the room warms up, the CO2 climbs with
-- the pupils, the setpoint goes up at six and down after school.
select store(s.id, array_agg(ts order by ts), array_agg(round((16.5 + 4.5 * least(1, extract(epoch from ts - '2026-01-12 06:00+01'::timestamptz) / 10800))::numeric, 1)::float8 order by ts))
  from series s, generate_series('2026-01-12 06:00+01'::timestamptz, '2026-01-12 12:00+01', '10 minutes') ts
 where s.name = 'Classroom 1' and s.quantity_code = 'temperature' and s.kind = 'measured'
 group by s.id;
select store(s.id, array_agg(ts order by ts), array_agg(round(420 + case when ts >= '2026-01-12 08:30+01' then 900 * least(1, extract(epoch from ts - '2026-01-12 08:30+01'::timestamptz) / 5400) else 0 end)::float8 order by ts))
  from series s, generate_series('2026-01-12 06:00+01'::timestamptz, '2026-01-12 12:00+01', '10 minutes') ts
 where s.name = 'Classroom 1' and s.quantity_code = 'co2'
 group by s.id;
select store(s.id, array['2026-01-12 06:00+01', '2026-01-12 16:30+01']::timestamptz[], array[21, 16]::float8[])
  from series s
 where s.name = 'Classroom 1' and s.kind = 'setpoint';

-- A property the installation publishes, and the attribute that uses it.
insert into property_defs (code, name, datatype, minimum, applies_to, published_by) values
  ('pupils', 'Pupils', 'integer', 0, '{participant}', 'installation')
on conflict (code) do nothing;

insert into attributes (object_kind, object_id, property_code, value, valid_from, source) values
  ('participant', '00000000-0000-4000-8000-000200000010', 'pupils', '212', '2025-09-01', 'school register 2025-2026');

-- The drawings and the model are the school's documents.
insert into documents (object_kind, object_id, name, kind, uri, media_type, source) values
  ('participant', '00000000-0000-4000-8000-000200000010', 'Ground floor plan', 'plan', 's3://nexgen-os-examples/school/ground-floor.dxf', 'image/vnd.dxf', 'architect'),
  ('participant', '00000000-0000-4000-8000-000200000010', 'IFC model', 'document', 's3://nexgen-os-examples/school/main-building.ifc', 'application/x-step', 'architect');

-- Queries a page would run
-- The rooms with their points, floor by floor:
--   select f.level, f.name floor, r.name room, r.floor_area_m2, count(se.id) points
--     from building.spaces f join building.spaces r on r.parent_id = f.id
--     left join series se on se.name = r.name
--    where f.building_id = '00000000-0000-4000-8000-000200000020' and f.kind = 'floor'
--    group by f.level, f.name, r.name, r.floor_area_m2 order by f.level, r.name;
-- Half-hourly temperature in classroom 1:
--   select r.* from series s, resample(s.id, '2026-01-12', '2026-01-13', '30 minutes') r
--    where s.name = 'Classroom 1' and s.quantity_code = 'temperature' and s.kind = 'measured';
-- Whose classroom 5 is, and whose rules apply:
--   select building.participant_of('space', '00000000-0000-4000-8000-000200000044'),
--          country_of('participant', building.participant_of('space', '00000000-0000-4000-8000-000200000044'));

-- Daily readings are cut in the participant's time zone.
update participants set time_zone = 'Europe/Brussels' where organisation_id = '00000000-0000-4000-8000-000200000001';

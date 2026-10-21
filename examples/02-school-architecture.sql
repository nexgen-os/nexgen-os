-- Example 2 — a school, inside and out, in a small municipality. Needs the
-- `building` module.
--
-- A municipality's site, the main building with two floors and five rooms
-- (spaces of the `building` module, one tree), a multisensor in each classroom reading
-- temperature, CO2 and presence, a presence detector in the canteen, a
-- heating setpoint asked of the heat pump per classroom, a heat pump serving
-- the building, a morning of readings, and the acoustic class of each room
-- as an attribute the installation publishes.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000200000001', 'Commune de Valbrisée');

insert into contacts (id, organisation_id, name, kind) values
  ('00000000-0000-4000-8000-000200000005', '00000000-0000-4000-8000-000200000001', 'Service des bâtiments', 'company');

insert into sites (id, organisation_id, name, country, street, postal_code, city, region, profile) values
  ('00000000-0000-4000-8000-000200000010', '00000000-0000-4000-8000-000200000001', 'École du Centre', 'BE', 'Rue de l''École 12', '1380', 'Valbrisée', 'BE-WBR', 'school');

insert into building.buildings (id, organisation_id, site_id, name, profile, footprint, elevation_m, height_m) values
  ('00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000010', 'Main building', 'school',
   ST_GeomFromText('POLYGON((4.4702 50.6802, 4.4708 50.6802, 4.4708 50.6805, 4.4702 50.6805, 4.4702 50.6802))', 4326), 112, 9.5);

-- Two floors, and the rooms on them: one tree of spaces.
insert into building.spaces (id, organisation_id, building_id, kind, name, level, elevation_m, height_m) values
  ('00000000-0000-4000-8000-000200000030', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', 'floor', 'Ground floor', 0, 112, 3.2),
  ('00000000-0000-4000-8000-000200000031', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', 'floor', 'First floor', 1, 115.2, 3);

insert into building.spaces (id, organisation_id, building_id, parent_id, kind, name) values
  ('00000000-0000-4000-8000-000200000041', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000030', 'room', 'Classroom 1'),
  ('00000000-0000-4000-8000-000200000042', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000030', 'room', 'Classroom 2'),
  ('00000000-0000-4000-8000-000200000043', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000030', 'room', 'Canteen'),
  ('00000000-0000-4000-8000-000200000044', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000031', 'room', 'Classroom 5'),
  ('00000000-0000-4000-8000-000200000045', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000031', 'room', 'Staff room');

-- Floor areas measured on the drawings, room by room.
insert into attributes (object_kind, object_id, property_code, value, source) values
  ('space', '00000000-0000-4000-8000-000200000041', 'floor_area', '62', 'as-built drawings'),
  ('space', '00000000-0000-4000-8000-000200000042', 'floor_area', '60', 'as-built drawings'),
  ('space', '00000000-0000-4000-8000-000200000043', 'floor_area', '140', 'as-built drawings'),
  ('space', '00000000-0000-4000-8000-000200000044', 'floor_area', '60', 'as-built drawings'),
  ('space', '00000000-0000-4000-8000-000200000045', 'floor_area', '35', 'as-built drawings');

-- The heat pump in the building, and the instruments in the rooms: a
-- multisensor per classroom, a presence detector in the canteen.
insert into devices (id, organisation_id, site_id, name, device_type, manufacturer, model, rated_power_kw, installation_date) values
  ('00000000-0000-4000-8000-000200000050', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000010',
   'Air-to-water heat pump', 'heat_pump', 'Daikin', 'Altherma 3 H HT 18', 18, '2023-10-02');
select building.place_device('00000000-0000-4000-8000-000200000050', '00000000-0000-4000-8000-000200000020');

-- Each instrument is installed on the site, then placed in its room.
select building.place_device(
         install_device('00000000-0000-4000-8000-000200000010',
                        case when s.name = 'Canteen' then 'sensor' else 'sensor_box' end,
                        s.name || case when s.name = 'Canteen' then ' — presence detector' else ' — multisensor' end,
                        p_installed_on => '2024-09-01'),
         p_space_id => s.id)
  from building.spaces s
 where s.name like 'Classroom%' or s.name = 'Canteen';

insert into links (subject_kind, subject_id, type_code, object_kind, object_id) values
  ('device', '00000000-0000-4000-8000-000200000050', 'serves', 'building', '00000000-0000-4000-8000-000200000020');

-- The points, one series each: what a room is observed for, by the device
-- in it; the heating setpoint of a room is asked of the heat pump.
insert into series (organisation_id, object_kind, object_id, device_id, quantity_code, kind, value_kind, step, external_ref)
select '00000000-0000-4000-8000-000200000001', 'space', s.id, case when q.kind = 'setpoint' then '00000000-0000-4000-8000-000200000050'::uuid else d.device_id end,
       q.quantity, q.kind, 'instant', case when q.kind = 'measured' then interval '10 minutes' end,
       format('mqtt://school/%s/%s', lower(replace(s.name, ' ', '-')), q.topic)
  from building.spaces s
  join building.devices d on d.space_id = s.id
  cross join (values ('temperature', 'measured', 'temp'),
                     ('co2', 'measured', 'co2'),
                     ('occupancy', 'measured', 'presence'),
                     ('temperature', 'setpoint', 'setpoint')) as q(quantity, kind, topic)
 where s.name like 'Classroom%' or (s.name = 'Canteen' and q.topic = 'presence');

-- A school morning in classroom 1: the room warms up, the CO2 climbs with
-- the pupils, the setpoint goes up at six and down after school.
select store(s.id, array_agg(ts order by ts), array_agg(round((16.5 + 4.5 * least(1, extract(epoch from ts - '2026-01-12 06:00+01'::timestamptz) / 10800))::numeric, 1)::float8 order by ts))
  from series s, generate_series('2026-01-12 06:00+01'::timestamptz, '2026-01-12 12:00+01', '10 minutes') ts
 where s.object_id = '00000000-0000-4000-8000-000200000041' and s.quantity_code = 'temperature' and s.kind = 'measured'
 group by s.id;
select store(s.id, array_agg(ts order by ts), array_agg(round(420 + case when ts >= '2026-01-12 08:30+01' then 900 * least(1, extract(epoch from ts - '2026-01-12 08:30+01'::timestamptz) / 5400) else 0 end)::float8 order by ts))
  from series s, generate_series('2026-01-12 06:00+01'::timestamptz, '2026-01-12 12:00+01', '10 minutes') ts
 where s.object_id = '00000000-0000-4000-8000-000200000041' and s.quantity_code = 'co2'
 group by s.id;
select store(s.id, array['2026-01-12 06:00+01', '2026-01-12 16:30+01']::timestamptz[], array[21, 16]::float8[])
  from series s
 where s.object_id = '00000000-0000-4000-8000-000200000041' and s.kind = 'setpoint';

-- A property the installation publishes, and the attributes that use it.
insert into property_defs (code, name, datatype, allowed_values, applies_to, published_by) values
  ('acoustic_class', 'Acoustic class', 'text', '{A,B,C,D}', '{space}', 'installation')
on conflict (code) do nothing;

insert into attributes (object_kind, object_id, property_code, value, source)
select 'space', id, 'acoustic_class', to_jsonb(case when name like 'Classroom%' then 'B' else 'C' end), 'acoustic survey 2024'
  from building.spaces where kind = 'room';

insert into attributes (object_kind, object_id, property_code, value, source) values
  ('building', '00000000-0000-4000-8000-000200000020', 'floor_area', '1840', 'as-built drawings'),
  ('building', '00000000-0000-4000-8000-000200000020', 'year_built', '1968', 'municipal archive'),
  ('building', '00000000-0000-4000-8000-000200000020', 'energy_label', '"D"', 'energy performance certificate 2022');

insert into documents (object_kind, object_id, name, kind, uri, media_type, source) values
  ('building', '00000000-0000-4000-8000-000200000020', 'Ground floor plan', 'plan', 's3://nexgen-os-examples/school/ground-floor.dxf', 'image/vnd.dxf', 'architect'),
  ('building', '00000000-0000-4000-8000-000200000020', 'IFC model', 'document', 's3://nexgen-os-examples/school/main-building.ifc', 'application/x-step', 'architect');

-- Queries a page would run
-- The rooms with their points, floor by floor:
--   select f.level, f.name floor, r.name room, count(se.id) points
--     from building.spaces f join building.spaces r on r.parent_id = f.id
--     left join series se on se.object_id = r.id
--    where f.building_id = '00000000-0000-4000-8000-000200000020' and f.kind = 'floor'
--    group by f.level, f.name, r.name order by f.level, r.name;
-- Half-hourly temperature in classroom 1:
--   select r.* from series s, resample(s.id, '2026-01-12', '2026-01-13', '30 minutes') r
--    where s.object_id = '00000000-0000-4000-8000-000200000041' and s.quantity_code = 'temperature' and s.kind = 'measured';
-- Where is classroom 5, and whose rules apply:
--   select site_of('space', '00000000-0000-4000-8000-000200000044'), country_of('space', '00000000-0000-4000-8000-000200000044');

-- Daily readings are cut in the site's time zone.
update sites set time_zone = 'Europe/Brussels' where organisation_id = '00000000-0000-4000-8000-000200000001';

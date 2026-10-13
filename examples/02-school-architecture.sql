-- Example 2 — a school, inside and out, in Lasne. Needs the `architecture` module.
--
-- A municipality's site, the main building with two floors and five rooms,
-- a temperature, a CO2 and a presence sensor per classroom, a heating
-- setpoint per room, a heat pump serving the building, a morning of
-- readings, and the acoustic class of each room as an attribute published
-- by the module.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000200000001', 'Commune de Lasne');

insert into contacts (id, organisation_id, name, kind, email) values
  ('00000000-0000-4000-8000-000200000005', '00000000-0000-4000-8000-000200000001', 'Service des bâtiments', 'company', 'batiments@lasne.example');

insert into sites (id, organisation_id, name, country, street, postal_code, city, region, profile) values
  ('00000000-0000-4000-8000-000200000010', '00000000-0000-4000-8000-000200000001', 'École du Centre', 'BE', 'Rue de l''École 12', '1380', 'Lasne', 'BE-WBR', 'school');

insert into buildings (id, organisation_id, site_id, name, profile, footprint, elevation_m, height_m, floors_above_ground, year_built) values
  ('00000000-0000-4000-8000-000200000020', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000010', 'Main building', 'school',
   ST_GeomFromText('POLYGON((4.4702 50.6802, 4.4708 50.6802, 4.4708 50.6805, 4.4702 50.6805, 4.4702 50.6802))', 4326), 112, 9.5, 2, 1968);

insert into architecture.floors (id, organisation_id, building_id, name, level, elevation_m, height_m) values
  ('00000000-0000-4000-8000-000200000030', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', 'Ground floor', 0, 112, 3.2),
  ('00000000-0000-4000-8000-000200000031', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000020', 'First floor', 1, 115.2, 3);

insert into architecture.spaces (id, organisation_id, floor_id, name, kind, area_m2) values
  ('00000000-0000-4000-8000-000200000041', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000030', 'Classroom 1', 'room', 62),
  ('00000000-0000-4000-8000-000200000042', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000030', 'Classroom 2', 'room', 60),
  ('00000000-0000-4000-8000-000200000043', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000030', 'Canteen', 'room', 140),
  ('00000000-0000-4000-8000-000200000044', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000031', 'Classroom 5', 'room', 60),
  ('00000000-0000-4000-8000-000200000045', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000031', 'Staff room', 'room', 35);

-- Three sensors and a setpoint per classroom, one presence sensor in the canteen.
insert into sensors (organisation_id, host_id, name, quantity_code, kind, external_ref)
select '00000000-0000-4000-8000-000200000001', s.id, s.name || ' — ' || q.label, q.quantity, q.kind, format('mqtt://school/%s/%s', lower(replace(s.name, ' ', '-')), q.topic)
  from architecture.spaces s
  cross join (values ('temperature', 'temperature', 'sensor', 'temp'),
                     ('CO2', 'co2', 'sensor', 'co2'),
                     ('presence', 'occupancy', 'sensor', 'presence'),
                     ('heating setpoint', 'temperature', 'setpoint', 'setpoint')) as q(label, quantity, kind, topic)
 where s.name like 'Classroom%' or (s.name = 'Canteen' and q.label = 'presence');

insert into devices (id, organisation_id, site_id, building_id, name, device_type, manufacturer, model, rated_power_kw, installation_date) values
  ('00000000-0000-4000-8000-000200000050', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000010', '00000000-0000-4000-8000-000200000020',
   'Air-to-water heat pump', 'heat_pump', 'Daikin', 'Altherma 3 H HT 18', 18, '2023-10-02');

insert into links (subject_id, type_code, object_id) values
  ('00000000-0000-4000-8000-000200000050', 'serves', '00000000-0000-4000-8000-000200000020');

-- A school morning in classroom 1: the room warms up, the CO2 climbs with the pupils.
insert into series (id, organisation_id, object_id, quantity_code, sensor_id, kind, value_kind, step)
select '00000000-0000-4000-8000-000200000071', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000041', 'temperature', id, 'measured', 'instant', '10 minutes'
  from sensors where name = 'Classroom 1 — temperature';
insert into series (id, organisation_id, object_id, quantity_code, sensor_id, kind, value_kind, step)
select '00000000-0000-4000-8000-000200000072', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000041', 'co2', id, 'measured', 'instant', '10 minutes'
  from sensors where name = 'Classroom 1 — CO2';
insert into series (id, organisation_id, object_id, quantity_code, sensor_id, kind, value_kind)
select '00000000-0000-4000-8000-000200000073', '00000000-0000-4000-8000-000200000001', '00000000-0000-4000-8000-000200000041', 'temperature', id, 'setpoint', 'instant'
  from sensors where name = 'Classroom 1 — heating setpoint';

insert into series_values (series_id, at, value)
select '00000000-0000-4000-8000-000200000071', ts, round((16.5 + 4.5 * least(1, extract(epoch from ts - '2026-01-12 06:00+01'::timestamptz) / 10800))::numeric, 1)
  from generate_series('2026-01-12 06:00+01'::timestamptz, '2026-01-12 12:00+01', '10 minutes') ts;
insert into series_values (series_id, at, value)
select '00000000-0000-4000-8000-000200000072', ts, round(420 + case when ts >= '2026-01-12 08:30+01' then 900 * least(1, extract(epoch from ts - '2026-01-12 08:30+01'::timestamptz) / 5400) else 0 end)
  from generate_series('2026-01-12 06:00+01'::timestamptz, '2026-01-12 12:00+01', '10 minutes') ts;
insert into series_values (series_id, at, value) values
  ('00000000-0000-4000-8000-000200000073', '2026-01-12 06:00+01', 21),
  ('00000000-0000-4000-8000-000200000073', '2026-01-12 16:30+01', 16);

-- A property the module publishes, and the attributes that use it.
insert into property_defs (code, name, datatype, allowed_values, applies_to, published_by) values
  ('acoustic_class', 'Acoustic class', 'text', '{A,B,C,D}', '{space}', 'architecture')
on conflict (code) do nothing;

insert into attributes (object_id, property_code, value, source)
select id, 'acoustic_class', to_jsonb(case when name like 'Classroom%' then 'B' else 'C' end), 'acoustic survey 2024'
  from architecture.spaces;

insert into attributes (object_id, property_code, value, source) values
  ('00000000-0000-4000-8000-000200000020', 'floor_area', '1840', 'as-built drawings'),
  ('00000000-0000-4000-8000-000200000020', 'energy_label', '"D"', 'energy performance certificate 2022');

insert into documents (object_id, name, kind, uri, media_type, source) values
  ('00000000-0000-4000-8000-000200000020', 'Ground floor plan', 'plan', 's3://nexgen-os-examples/school/ground-floor.dxf', 'image/vnd.dxf', 'architect'),
  ('00000000-0000-4000-8000-000200000020', 'IFC model', 'document', 's3://nexgen-os-examples/school/main-building.ifc', 'application/x-step', 'architect');

-- Queries a page would run
-- The rooms with their sensors, floor by floor:
--   select st.level, st.name level, sp.name room, count(se.id) sensors
--     from architecture.floors st join architecture.spaces sp on sp.floor_id = st.id
--     left join sensors se on se.host_id = sp.id
--    where st.building_id = '00000000-0000-4000-8000-000200000020'
--    group by st.level, st.name, sp.name order by st.level, sp.name;
-- Half-hourly temperature against its setpoint in classroom 1:
--   select * from resample('00000000-0000-4000-8000-000200000071', '2026-01-12', '2026-01-13', '30 minutes');
-- Where is classroom 5, and whose rules apply:
--   select site_of('00000000-0000-4000-8000-000200000044'), country_of('00000000-0000-4000-8000-000200000044');

-- Daily readings are cut in the site's time zone.
update sites set time_zone = 'Europe/Brussels' where organisation_id = '00000000-0000-4000-8000-000200000001';

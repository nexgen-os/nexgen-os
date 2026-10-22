-- Example 4 — a farm with PV on the roof, on the ground and over the car park, in the Nord.
-- Needs the `solar` module, whose table `solar.estimates` holds the estimates.
--
-- A farm is one participant of its study: its place, an offtake meter and
-- an injection meter (a participant exceptionally carries several), and
-- behind them PV on the barn roof, a ground array on the field and a
-- carport on the car park, the
-- annual consumption known from invoices, the product rows the devices are
-- instances of, and a PVGIS estimate for each array, in `solar.estimates`, with the
-- orientation it assumed. The barn, the stable and their roof faces are a
-- physical description, the `building` module's; the GeoJSON test adds them
-- with the field the ground array stands on.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000400000001', 'GAEC de l''Exemple');

insert into projects (id, organisation_id, name, kind, country, status) values
  ('00000000-0000-4000-8000-000400000005', '00000000-0000-4000-8000-000400000001', 'Farm solar', 'study', 'FR', 'active');

insert into participants (id, organisation_id, project_id, name, role, country, street, postal_code, city, region, geometry) values
  ('00000000-0000-4000-8000-000400000010', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000005', 'Ferme de l''Exemple', 'prosumer', 'FR', 'Chemin de l''Exemple 3', '59270', 'Saint-Jans-Cappel', 'FR-HDF',
   ST_GeomFromText('POLYGON((2.7210 50.7705, 2.7250 50.7705, 2.7250 50.7730, 2.7210 50.7730, 2.7210 50.7705))', 4326));

insert into meters (id, organisation_id, participant_id, name, identifier, scheme, resource, direction) values
  ('00000000-0000-4000-8000-000400000041', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Farm supply', '301000000000000987', 'gs1_gsrn', 'electricity', 'both'),
  ('00000000-0000-4000-8000-000400000042', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010', 'Field injection point', '301000000000000988', 'gs1_gsrn', 'electricity', 'injection');

insert into products (id, organisation_id, device_type, manufacturer, model_ref, unit_power_kw, unit_surface_m2, unit_price, currency) values
  ('00000000-0000-4000-8000-000400000090', null, 'solar', 'Longi', 'Hi-MO 6 545', 0.545, 2.56, null, null),
  ('00000000-0000-4000-8000-000400000091', '00000000-0000-4000-8000-000400000001', 'inverter', 'SMA', 'Sunny Tripower X 25', 25, null, 2890, 'EUR');

insert into devices (id, organisation_id, participant_id, name, device_type, product_id, manufacturer, model, rated_power_kw, unit_count, status, installation_date) values
  ('00000000-0000-4000-8000-000400000051', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010',
   'Barn roof array', 'solar', '00000000-0000-4000-8000-000400000090', 'Longi', 'Hi-MO 6 545', 99.19, 182, 'in_service', '2023-06-20'),
  ('00000000-0000-4000-8000-000400000052', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010',
   'Lower field ground array', 'solar', '00000000-0000-4000-8000-000400000090', 'Longi', 'Hi-MO 6 545', 498.6, 915, 'planned', null),
  ('00000000-0000-4000-8000-000400000053', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010',
   'Car park array', 'solar', '00000000-0000-4000-8000-000400000090', 'Longi', 'Hi-MO 6 545', 36.0, 66, 'planned', null),
  ('00000000-0000-4000-8000-000400000054', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010',
   'Barn inverters', 'inverter', '00000000-0000-4000-8000-000400000091', 'SMA', 'Sunny Tripower X 25', 100, 4, 'in_service', '2023-06-20'),
  ('00000000-0000-4000-8000-000400000055', '00000000-0000-4000-8000-000400000001', '00000000-0000-4000-8000-000400000010',
   'Milking parlour cooling', 'hvac', null, 'Packo', 'ICE 5000', 22, 1, 'in_service', '2012-03-01');

-- Every device is the farm's, behind its two meters (participant_meters()).

insert into attributes (object_kind, object_id, property_code, value, source) values
  ('participant', '00000000-0000-4000-8000-000400000010', 'annual_consumption', '186000', 'supplier invoices 2025'),
  ('meter', '00000000-0000-4000-8000-000400000041', 'subscribed_power', '160', 'supply contract');

insert into documents (object_kind, object_id, name, kind, uri, media_type, source) values
  ('participant', '00000000-0000-4000-8000-000400000010', 'Electricity invoices 2025', 'document', 's3://nexgen-os-examples/farm/invoices-2025.pdf', 'application/pdf', 'supplier'),
  ('device', '00000000-0000-4000-8000-000400000052', 'Ground array layout', 'plan', 's3://nexgen-os-examples/farm/field-layout.geojson', 'application/geo+json', 'installer');

-- The orientation each estimate assumed: the barn roof faces south-south-east
-- at 15°, the ground array south on flat ground, the carport south at 10°.
insert into solar.estimates (organisation_id, device_id, provenance, inputs, results)
select d.organisation_id, d.id, 'pvgis-5.3+solar-0.3.0',
  jsonb_build_object('source', 'pvgis', 'peak_kw', d.rated_power_kw, 'tilt', o.tilt_deg, 'azimuth', o.azimuth_deg, 'loss_pct', 14),
  jsonb_build_object('annual_kwh', round(d.rated_power_kw * o.specific_yield))
  from devices d
  join (values ('00000000-0000-4000-8000-000400000051'::uuid, 175, 15, 1000),
               ('00000000-0000-4000-8000-000400000052', 180, 0, 1010),
               ('00000000-0000-4000-8000-000400000053', 180, 10, 980)) o (device_id, azimuth_deg, tilt_deg, specific_yield)
    on o.device_id = d.id;

-- Queries a page would run
-- The arrays, the orientation their estimate assumed and what they are expected to give:
--   select d.name, e.inputs->>'azimuth' azimuth, e.inputs->>'tilt' tilt, d.rated_power_kw, d.status, e.results->>'annual_kwh' annual_kwh
--     from devices d left join solar.estimates e on e.device_id = d.id
--    where d.device_type = 'solar' and d.organisation_id = '00000000-0000-4000-8000-000400000001' order by d.name;
-- The meters the farm's devices are behind:
--   select m.name from meters m where m.id in (select meter_id from participant_meters('00000000-0000-4000-8000-000400000010')) order by 1;

-- Daily readings are cut in the participant's time zone.
update participants set time_zone = 'Europe/Paris' where organisation_id = '00000000-0000-4000-8000-000400000001';

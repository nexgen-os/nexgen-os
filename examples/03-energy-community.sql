-- Example 3 — an energy community in a harbour, in Rotterdam.
--
-- A cooperative's project, three warehouses behind their meters taking part
-- as consumers, the companies who answer for them (Ekwo contacts), a roof
-- plant on a fourth site taking part as producer, two tenants grouped, a
-- month of quarter-hour offtake per consumer and of injection by the plant,
-- and the invoicing left to Ekwo through a run of the energy module.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000300000001', 'Haven Energie Coöperatie');

insert into contacts (id, organisation_id, name, kind, email, ekwo_contact_id) values
  ('00000000-0000-4000-8000-000300000011', '00000000-0000-4000-8000-000300000001', 'Van Dijk Logistiek BV', 'company', 'facturen@vandijk.example', '11111111-1111-4111-8111-111111111111'),
  ('00000000-0000-4000-8000-000300000012', '00000000-0000-4000-8000-000300000001', 'Maas Koeltransport BV', 'company', 'admin@maas.example', '11111111-1111-4111-8111-111111111112'),
  ('00000000-0000-4000-8000-000300000013', '00000000-0000-4000-8000-000300000001', 'Rijnmond Verpakkingen BV', 'company', 'boekhouding@rijnmond.example', '11111111-1111-4111-8111-111111111113'),
  ('00000000-0000-4000-8000-000300000014', '00000000-0000-4000-8000-000300000001', 'Stedin', 'company', null, null);

insert into projects (id, organisation_id, name, kind, country, status, start_date) values
  ('00000000-0000-4000-8000-000300000020', '00000000-0000-4000-8000-000300000001', 'Waalhaven energy community', 'energy_community', 'NL', 'active', '2025-01-01');

insert into sites (id, organisation_id, name, country, street, postal_code, city, profile) values
  ('00000000-0000-4000-8000-000300000031', '00000000-0000-4000-8000-000300000001', 'Waalhaven Oostzijde 12', 'NL', 'Waalhaven Oostzijde 12', '3087 BM', 'Rotterdam', 'warehouse'),
  ('00000000-0000-4000-8000-000300000032', '00000000-0000-4000-8000-000300000001', 'Waalhaven Oostzijde 14', 'NL', 'Waalhaven Oostzijde 14', '3087 BM', 'Rotterdam', 'warehouse'),
  ('00000000-0000-4000-8000-000300000033', '00000000-0000-4000-8000-000300000001', 'Waalhaven Oostzijde 16', 'NL', 'Waalhaven Oostzijde 16', '3087 BM', 'Rotterdam', 'warehouse'),
  ('00000000-0000-4000-8000-000300000034', '00000000-0000-4000-8000-000300000001', 'Roof plant, hall C', 'NL', 'Waalhaven Oostzijde 20', '3087 BM', 'Rotterdam', 'plant');

insert into meters (id, organisation_id, site_id, identifier, scheme, resource, direction, grid_operator_id) values
  ('00000000-0000-4000-8000-000300000041', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000031', '871687100000000012', 'gs1_gsrn', 'electricity', 'both', '00000000-0000-4000-8000-000300000014'),
  ('00000000-0000-4000-8000-000300000042', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000032', '871687100000000014', 'gs1_gsrn', 'electricity', 'both', '00000000-0000-4000-8000-000300000014'),
  ('00000000-0000-4000-8000-000300000043', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000033', '871687100000000016', 'gs1_gsrn', 'electricity', 'both', '00000000-0000-4000-8000-000300000014'),
  ('00000000-0000-4000-8000-000300000044', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000034', '871687100000000020', 'gs1_gsrn', 'electricity', 'injection', '00000000-0000-4000-8000-000300000014');

insert into participants (id, organisation_id, project_id, site_id, name, role, contact_id, status, join_date) values
  ('00000000-0000-4000-8000-000300000051', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', '00000000-0000-4000-8000-000300000031', 'Van Dijk Logistiek', 'consumer', '00000000-0000-4000-8000-000300000011', 'active', '2025-01-01'),
  ('00000000-0000-4000-8000-000300000052', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', '00000000-0000-4000-8000-000300000032', 'Maas Koeltransport', 'consumer', '00000000-0000-4000-8000-000300000012', 'active', '2025-01-01'),
  ('00000000-0000-4000-8000-000300000053', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', '00000000-0000-4000-8000-000300000033', 'Rijnmond Verpakkingen', 'consumer', '00000000-0000-4000-8000-000300000013', 'active', '2025-04-01'),
  ('00000000-0000-4000-8000-000300000054', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', '00000000-0000-4000-8000-000300000034', 'Roof plant', 'producer', null, 'active', '2025-01-01');

-- Two tenants of the same landlord, read together.
insert into participants (id, organisation_id, project_id, name, is_group, status) values
  ('00000000-0000-4000-8000-000300000055', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', 'Oostzijde 12–14 (same landlord)', true, 'active');
update participants set parent_id = '00000000-0000-4000-8000-000300000055'
 where id in ('00000000-0000-4000-8000-000300000051', '00000000-0000-4000-8000-000300000052');

insert into devices (id, organisation_id, site_id, meter_id, name, device_type, manufacturer, rated_power_kw, unit_count, installation_date, tags) values
  ('00000000-0000-4000-8000-000300000060', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000034', '00000000-0000-4000-8000-000300000044', 'Hall C roof array', 'solar', 'Canadian Solar', 248, 560, '2024-11-15', '{solar,electric}');

-- A month of quarter-hour offtake per consumer, and of injection by the plant.
insert into series (id, organisation_id, object_id, quantity_code, kind, value_kind, step, source)
select ('00000000-0000-4000-8000-0003000000' || (70 + row_number() over ()))::uuid, '00000000-0000-4000-8000-000300000001', m.id,
       case when m.direction = 'injection' then 'injection_energy' else 'offtake_energy' end, 'measured', 'interval', '15 minutes', 'grid operator hub'
  from meters m where m.organisation_id = '00000000-0000-4000-8000-000300000001' order by m.identifier;

insert into series_values (series_id, at, value)
select s.id, ts,
       case when s.quantity_code = 'injection_energy'
            then round(greatest(0, 60 * sin(pi() * (extract(hour from ts at time zone 'Europe/Amsterdam') - 6) / 14))::numeric, 2)
            else round((3 + 9 * (case when extract(isodow from ts) < 6 and extract(hour from ts) between 7 and 18 then 1 else 0.3 end)
                        * (0.8 + 0.4 * random()))::numeric, 2) end
  from series s
  cross join generate_series('2026-05-01 00:00+02'::timestamptz, '2026-05-31 23:45+02', '15 minutes') ts
 where s.organisation_id = '00000000-0000-4000-8000-000300000001';

insert into attributes (object_id, property_code, value, source) values
  ('00000000-0000-4000-8000-000300000041', 'subscribed_power', '80', 'supply contract'),
  ('00000000-0000-4000-8000-000300000042', 'subscribed_power', '120', 'supply contract'),
  ('00000000-0000-4000-8000-000300000043', 'subscribed_power', '63', 'supply contract');

insert into documents (object_id, name, kind, uri, media_type, source) values
  ('00000000-0000-4000-8000-000300000020', 'Community statutes', 'document', 's3://nexgen-os-examples/community/statutes-2024.pdf', 'application/pdf', 'notary'),
  ('00000000-0000-4000-8000-000300000020', 'Allocation key 2026', 'document', 's3://nexgen-os-examples/community/allocation-2026.pdf', 'application/pdf', 'general assembly');

-- The month's settlement, computed by the energy module and handed to Ekwo:
-- the run keeps the lines and the Ekwo document ids they became.
insert into modules (code, name, version, schema_name, requires_core_min) values
  ('energy', 'Energy', '0.1.0', 'energy', '0.1.0')
on conflict (code) do nothing;

select record_run('energy', 'settlement-0.1.0', '00000000-0000-4000-8000-000300000020', null,
  '{"period": "2026-05", "allocation": "proportional", "price_eur_mwh": 95}',
  '{"shared_kwh": 18420, "lines": [
     {"participant": "00000000-0000-4000-8000-000300000051", "kwh": 7210, "eur": 684.95, "ekwo_document_id": "22222222-2222-4222-8222-222222222201"},
     {"participant": "00000000-0000-4000-8000-000300000052", "kwh": 8120, "eur": 771.40, "ekwo_document_id": "22222222-2222-4222-8222-222222222202"},
     {"participant": "00000000-0000-4000-8000-000300000053", "kwh": 3090, "eur": 293.55, "ekwo_document_id": "22222222-2222-4222-8222-222222222203"}]}');

-- Queries a page would run
-- The community as a table:
--   select p.name, p.role, m.identifier, c.name contact, p.join_date
--     from participants p left join meters m on m.site_id = p.site_id left join contacts c on c.id = p.contact_id
--    where p.project_id = '00000000-0000-4000-8000-000300000020' and not p.is_group order by p.role, p.name;
-- Daily offtake of Van Dijk in May:
--   select r.bucket::date, r.value from series s, resample(s.id, '2026-05-01', '2026-06-01', '1 day') r
--    where s.object_id = '00000000-0000-4000-8000-000300000041';
-- The meters behind the landlord's group:
--   select m.identifier from participant_meters('00000000-0000-4000-8000-000300000055') pm join meters m on m.id = pm.meter_id;

-- Daily readings are cut in the site's time zone.
update sites set time_zone = 'Europe/Amsterdam' where organisation_id = '00000000-0000-4000-8000-000300000001';

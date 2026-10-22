-- Example 3 — an energy community in a harbour, in Rotterdam. Needs the
-- `community`, `grid` and `billing` modules.
--
-- A cooperative's project, three warehouses taking part as consumers, each
-- a participant carrying its place and its meter, the companies who answer
-- for them (Ekwo contacts), a roof plant taking part as producer with its
-- array behind its meter, two tenants grouped, a
-- month of quarter-hour offtake per consumer and of injection by the plant,
-- the month's settlement, and one bill between two participants,
-- issued by Ekwo and recorded by the billing module.

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000300000001', 'Energiecoöperatie Voorbeeldkade');

insert into contacts (id, organisation_id, name, kind) values
  ('00000000-0000-4000-8000-000300000011', '00000000-0000-4000-8000-000300000001', 'Logistiek A BV', 'company'),
  ('00000000-0000-4000-8000-000300000012', '00000000-0000-4000-8000-000300000001', 'Koeltransport B BV', 'company'),
  ('00000000-0000-4000-8000-000300000013', '00000000-0000-4000-8000-000300000001', 'Verpakkingen C BV', 'company');

-- Who they are for the invoicing side: their Ekwo contact and the address
-- their invoices go to, kept by the billing module.
insert into billing.contacts (id, ekwo_contact_id, email) values
  ('00000000-0000-4000-8000-000300000011', '11111111-1111-4111-8111-111111111111', 'facturen@logistiek-a.example'),
  ('00000000-0000-4000-8000-000300000012', '11111111-1111-4111-8111-111111111112', 'admin@koeltransport-b.example'),
  ('00000000-0000-4000-8000-000300000013', '11111111-1111-4111-8111-111111111113', 'boekhouding@verpakkingen-c.example');

-- The distribution operator of the harbour. No pack of this country ships
-- yet, so the installation declares it as a pack would.
insert into grid.operators (code, name, kind, country, coverage, published_by) values
  ('stedin', 'Stedin', 'dso', 'NL', 'Rotterdam, The Hague, Utrecht and their regions.', 'installation');

insert into projects (id, organisation_id, name, kind, country, status, start_date) values
  ('00000000-0000-4000-8000-000300000020', '00000000-0000-4000-8000-000300000001', 'Waalhaven energy community', 'energy_community', 'NL', 'active', '2025-01-01');

-- The participants carry their place: three warehouses as consumers, a
-- roof plant as producer, each with the company that answers for it.
insert into participants (id, organisation_id, project_id, name, role, contact_id, status, join_date, country, street, postal_code, city) values
  ('00000000-0000-4000-8000-000300000051', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', 'Logistiek A', 'consumer', '00000000-0000-4000-8000-000300000011', 'active', '2025-01-01', 'NL', 'Voorbeeldkade 12', '3087 BM', 'Rotterdam'),
  ('00000000-0000-4000-8000-000300000052', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', 'Koeltransport B', 'consumer', '00000000-0000-4000-8000-000300000012', 'active', '2025-01-01', 'NL', 'Voorbeeldkade 14', '3087 BM', 'Rotterdam'),
  ('00000000-0000-4000-8000-000300000053', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', 'Verpakkingen C', 'consumer', '00000000-0000-4000-8000-000300000013', 'active', '2025-04-01', 'NL', 'Voorbeeldkade 16', '3087 BM', 'Rotterdam'),
  ('00000000-0000-4000-8000-000300000054', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', 'Roof plant', 'producer', null, 'active', '2025-01-01', 'NL', 'Voorbeeldkade 20', '3087 BM', 'Rotterdam');

-- Each participant carries its connection point.
insert into meters (id, organisation_id, participant_id, identifier, scheme, resource, direction, valid_from) values
  ('00000000-0000-4000-8000-000300000041', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000051', '871687100000000012', 'gs1_gsrn', 'electricity', 'both', '2025-01-01'),
  ('00000000-0000-4000-8000-000300000042', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000052', '871687100000000014', 'gs1_gsrn', 'electricity', 'both', '2025-01-01'),
  ('00000000-0000-4000-8000-000300000043', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000053', '871687100000000016', 'gs1_gsrn', 'electricity', 'both', '2025-04-01'),
  ('00000000-0000-4000-8000-000300000044', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000054', '871687100000000020', 'gs1_gsrn', 'electricity', 'injection', '2025-01-01');

-- The grid side of each connection point: the operator that runs it.
select grid.connect_to_operator(id, 'stedin') from meters where organisation_id = '00000000-0000-4000-8000-000300000001';

-- Two tenants of the same landlord, read together: a group has no place,
-- and carries no meter of its own.
insert into participants (id, organisation_id, project_id, name, status) values
  ('00000000-0000-4000-8000-000300000055', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', 'Oostzijde 12–14 (same landlord)', 'active');
update participants set parent_id = '00000000-0000-4000-8000-000300000055'
 where id in ('00000000-0000-4000-8000-000300000051', '00000000-0000-4000-8000-000300000052');

insert into devices (id, organisation_id, participant_id, name, device_type, manufacturer, rated_power_kw, unit_count, installation_date) values
  ('00000000-0000-4000-8000-000300000060', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000054', 'Hall C roof array', 'solar', 'Canadian Solar', 248, 560, '2024-11-15');

-- A month of quarter-hour offtake per consumer, and of injection by the plant.
insert into series (id, organisation_id, object_kind, object_id, quantity_code, kind, value_kind, step, source)
select ('00000000-0000-4000-8000-0003000000' || (70 + row_number() over ()))::uuid, '00000000-0000-4000-8000-000300000001', 'meter', m.id,
       case when m.direction = 'injection' then 'injection_energy' else 'offtake_energy' end, 'measured', 'interval', '15 minutes', 'grid operator hub'
  from meters m where m.organisation_id = '00000000-0000-4000-8000-000300000001' order by m.identifier;

select store(s.id, array_agg(ts order by ts), array_agg((
       case when s.quantity_code = 'injection_energy'
            then round(greatest(0, 60 * sin(pi() * (extract(hour from ts at time zone 'Europe/Amsterdam') - 6) / 14))::numeric, 2)
            else round((3 + 9 * (case when extract(isodow from ts) < 6 and extract(hour from ts) between 7 and 18 then 1 else 0.3 end)
                        * (0.8 + 0.4 * random()))::numeric, 2) end)::float8 order by ts))
  from series s
  cross join generate_series('2026-05-01 00:00+02'::timestamptz, '2026-05-31 23:45+02', '15 minutes') ts
 where s.organisation_id = '00000000-0000-4000-8000-000300000001'
 group by s.id;

insert into attributes (object_kind, object_id, attribute_type, value, source) values
  ('meter', '00000000-0000-4000-8000-000300000041', 'subscribed_power', '80', 'supply contract'),
  ('meter', '00000000-0000-4000-8000-000300000042', 'subscribed_power', '120', 'supply contract'),
  ('meter', '00000000-0000-4000-8000-000300000043', 'subscribed_power', '63', 'supply contract');

insert into documents (object_kind, object_id, name, kind, uri, media_type, source) values
  ('project', '00000000-0000-4000-8000-000300000020', 'Community statutes', 'document', 's3://nexgen-os-examples/community/statutes-2024.pdf', 'application/pdf', 'notary'),
  ('project', '00000000-0000-4000-8000-000300000020', 'Allocation key 2026', 'document', 's3://nexgen-os-examples/community/allocation-2026.pdf', 'application/pdf', 'general assembly');

-- The month's settlement, computed in the community module: the lines
-- of who received how much, and at which price.
insert into community.settlements (organisation_id, project_id, provenance, inputs, results) values
 ('00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000300000020', 'settlement_example 0.3.0',
  '{"period": "2026-05", "allocation": "proportional", "price_eur_mwh": 95}',
  '{"shared_kwh": 18420, "lines": [
     {"participant": "00000000-0000-4000-8000-000300000051", "kwh": 7210, "eur": 684.95},
     {"participant": "00000000-0000-4000-8000-000300000052", "kwh": 8120, "eur": 771.40},
     {"participant": "00000000-0000-4000-8000-000300000053", "kwh": 3090, "eur": 293.55}]}');

-- Ekwo issued Van Dijk's bill for the energy it bought from the roof plant
-- in May; the billing module keeps the Ekwo id, the two participants and
-- the settlement the amounts came from. The amounts, the tax and the lines are
-- Ekwo's, read by that id.
select billing.record_invoice('00000000-0000-4000-8000-000300000051', '22222222-2222-4222-8222-222222222201', 'purchase',
  '2026-05-01', '2026-05-31', '00000000-0000-4000-8000-000300000054',
  (select id from community.settlements where project_id = '00000000-0000-4000-8000-000300000020'));

-- Queries a page would run
-- The community as a table:
--   select p.name, p.role, m.identifier, c.name contact, p.join_date
--     from participants p left join meters m on m.participant_id = p.id left join contacts c on c.id = p.contact_id
--    where p.project_id = '00000000-0000-4000-8000-000300000020' and p.country is not null order by p.role, p.name;
-- Daily offtake of Van Dijk in May:
--   select r.bucket::date, r.value from series s, resample(s.id, '2026-05-01', '2026-06-01', '1 day') r
--    where s.object_id = '00000000-0000-4000-8000-000300000041';
-- Van Dijk's bills, with their Ekwo ids:
--   select id, kind, period_from, period_to, counterparty_participant_id from billing.invoices_of('00000000-0000-4000-8000-000300000051');
-- The meters behind the landlord's group:
--   select m.identifier from participant_meters('00000000-0000-4000-8000-000300000055') pm join meters m on m.id = pm.meter_id;

-- Daily readings are cut in the participant's time zone.
update participants set time_zone = 'Europe/Amsterdam' where organisation_id = '00000000-0000-4000-8000-000300000001' and country is not null;

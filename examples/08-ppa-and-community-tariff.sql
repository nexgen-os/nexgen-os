-- Example 8 — the contracts of a business park, in Malmö.
--
-- A cold store and a bakery share the production of a roof plant an
-- investor built on the cold store, as an energy community the park runs.
-- The cold store buys the plant's production first, under a physical PPA
-- paid as produced; both members then pay the community's tariff for what
-- they share; each buys the rest from its supplier, the cold store on the
-- day-ahead index with a cap and a floor, the bakery at a fixed price; the
-- plant sells its surplus to an aggregator, hour by hour; and the cold
-- store hedges part of its consumption with a virtual PPA on a wind farm.
-- Prices are in Swedish kronor per MWh: the currency is a column, never a
-- default (`contracts` module).

insert into organisations (id, name) values
  ('00000000-0000-4000-8000-000800000001', 'Hyllie Företagspark');

insert into contacts (id, organisation_id, name, kind, ekwo_contact_id) values
  ('00000000-0000-4000-8000-000800000011', '00000000-0000-4000-8000-000800000001', 'Öresund Kyl AB',          'company', '22222222-2222-4222-8222-222222222211'),
  ('00000000-0000-4000-8000-000800000012', '00000000-0000-4000-8000-000800000001', 'Bageri Hyllie AB',        'company', '22222222-2222-4222-8222-222222222212'),
  ('00000000-0000-4000-8000-000800000013', '00000000-0000-4000-8000-000800000001', 'Takenergi Syd AB',        'company', null),
  ('00000000-0000-4000-8000-000800000014', '00000000-0000-4000-8000-000800000001', 'Sydkraft Handel AB',      'company', null),
  ('00000000-0000-4000-8000-000800000015', '00000000-0000-4000-8000-000800000001', 'Flex Aggregering AB',     'company', null),
  ('00000000-0000-4000-8000-000800000016', '00000000-0000-4000-8000-000800000001', 'Vindpark Kristianstad AB', 'company', null);

insert into projects (id, organisation_id, name, kind, country, status, start_date) values
  ('00000000-0000-4000-8000-000800000020', '00000000-0000-4000-8000-000800000001', 'Hyllie park community', 'energy_community', 'SE', 'active', '2026-01-01');

insert into sites (id, organisation_id, name, country, street, postal_code, city, profile, time_zone) values
  ('00000000-0000-4000-8000-000800000031', '00000000-0000-4000-8000-000800000001', 'Cold store',  'SE', 'Hyllie Boulevard 40', '215 32', 'Malmö', 'warehouse', 'Europe/Stockholm'),
  ('00000000-0000-4000-8000-000800000032', '00000000-0000-4000-8000-000800000001', 'Bakery',      'SE', 'Hyllie Boulevard 44', '215 32', 'Malmö', 'retail',    'Europe/Stockholm');

insert into meters (id, organisation_id, site_id, name, identifier, scheme, resource, direction) values
  ('00000000-0000-4000-8000-000800000041', '00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000031', 'Cold store',      '735999100000004011', 'gs1_gsrn', 'electricity', 'both'),
  ('00000000-0000-4000-8000-000800000042', '00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000032', 'Bakery',          '735999100000004028', 'gs1_gsrn', 'electricity', 'offtake'),
  ('00000000-0000-4000-8000-000800000043', '00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000031', 'Roof plant',      '735999100000004035', 'gs1_gsrn', 'electricity', 'injection');

insert into participants (id, organisation_id, project_id, site_id, name, role, contact_id, status, join_date) values
  ('00000000-0000-4000-8000-000800000051', '00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000020', '00000000-0000-4000-8000-000800000031', 'Öresund Kyl', 'prosumer', '00000000-0000-4000-8000-000800000011', 'active', '2026-01-01'),
  ('00000000-0000-4000-8000-000800000052', '00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000020', '00000000-0000-4000-8000-000800000032', 'Bageri Hyllie', 'consumer', '00000000-0000-4000-8000-000800000012', 'active', '2026-01-01');

-- The index the cold store's supply follows, as the installation publishes it.
insert into contracts.price_indices (code, name, currency, per_unit, published_by, description) values
  ('day_ahead_se4', 'Day-ahead price, bidding zone SE4', 'SEK', 'MegaW-HR', 'installation', 'Hourly day-ahead price of the southern Swedish bidding zone.');

insert into contracts.contracts (id, organisation_id, type, name, reference, seller_contact_id, buyer_contact_id,
                                 meter_id, participant_id, project_id, volume_basis, allocated_power_kw, priority, valid_from, valid_to) values
  -- 1. The roof plant's production, first, to the cold store under it.
  ('00000000-0000-4000-8000-000800000061', '00000000-0000-4000-8000-000800000001', 'ppa_physical', 'Roof plant PPA', 'TES-2026-01',
   '00000000-0000-4000-8000-000800000013', '00000000-0000-4000-8000-000800000011',
   '00000000-0000-4000-8000-000800000041', '00000000-0000-4000-8000-000800000051', null, 'pay_as_produced', null, 1, '2026-01-01', '2041-01-01'),
  -- 2. What the members share, at the community's tariff.
  ('00000000-0000-4000-8000-000800000062', '00000000-0000-4000-8000-000800000001', 'community_tariff', 'Community tariff — cold store', null,
   null, '00000000-0000-4000-8000-000800000011',
   null, '00000000-0000-4000-8000-000800000051', '00000000-0000-4000-8000-000800000020', 'pay_as_consumed', null, 2, '2026-01-01', null),
  ('00000000-0000-4000-8000-000800000063', '00000000-0000-4000-8000-000800000001', 'community_tariff', 'Community tariff — bakery', null,
   null, '00000000-0000-4000-8000-000800000012',
   null, '00000000-0000-4000-8000-000800000052', '00000000-0000-4000-8000-000800000020', 'pay_as_consumed', null, 2, '2026-01-01', null),
  -- 3. The rest, from each member's supplier.
  ('00000000-0000-4000-8000-000800000064', '00000000-0000-4000-8000-000800000001', 'supply', 'Cold store supply', 'SH-88213',
   '00000000-0000-4000-8000-000800000014', '00000000-0000-4000-8000-000800000011',
   '00000000-0000-4000-8000-000800000041', null, null, 'pay_as_consumed', null, 3, '2026-01-01', '2028-01-01'),
  ('00000000-0000-4000-8000-000800000065', '00000000-0000-4000-8000-000800000001', 'supply', 'Bakery supply', 'SH-90417',
   '00000000-0000-4000-8000-000800000014', '00000000-0000-4000-8000-000800000012',
   '00000000-0000-4000-8000-000800000042', null, null, 'pay_as_consumed', null, 3, '2026-01-01', '2027-01-01'),
  -- The plant's surplus, sold to an aggregator.
  ('00000000-0000-4000-8000-000800000066', '00000000-0000-4000-8000-000800000001', 'injection', 'Roof plant surplus', 'FA-2026-117',
   '00000000-0000-4000-8000-000800000013', '00000000-0000-4000-8000-000800000015',
   '00000000-0000-4000-8000-000800000043', null, null, 'pay_as_produced', null, null, '2026-01-01', null),
  -- A hedge on 200 kW of a wind farm: settled, not delivered.
  ('00000000-0000-4000-8000-000800000067', '00000000-0000-4000-8000-000800000001', 'ppa_virtual', 'Wind hedge', 'VK-VPPA-07',
   '00000000-0000-4000-8000-000800000016', '00000000-0000-4000-8000-000800000011',
   null, '00000000-0000-4000-8000-000800000051', null, 'allocated_power', 200, null, '2026-01-01', '2036-01-01');

insert into contracts.price_signals (organisation_id, contract_id, kind, starts_at, ends_at, price, index_code, index_multiplier, index_adder, currency, per_unit, source) values
  ('00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000061', 'fixed',   '2026-01-01T00:00+01', null,                  520,  null, null, null, 'SEK', 'MegaW-HR', 'PPA, annex 2'),
  ('00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000062', 'fixed',   '2026-01-01T00:00+01', null,                  610,  null, null, null, 'SEK', 'MegaW-HR', 'general assembly of 2025-11-20'),
  ('00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000063', 'fixed',   '2026-01-01T00:00+01', null,                  610,  null, null, null, 'SEK', 'MegaW-HR', 'general assembly of 2025-11-20'),
  ('00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000064', 'indexed', '2026-01-01T00:00+01', null,                  null, 'day_ahead_se4', 1.0, 45, 'SEK', 'MegaW-HR', 'supply contract'),
  ('00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000064', 'cap',     '2026-01-01T00:00+01', null,                  1400, null, null, null, 'SEK', 'MegaW-HR', 'supply contract'),
  ('00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000064', 'floor',   '2026-01-01T00:00+01', null,                  150,  null, null, null, 'SEK', 'MegaW-HR', 'supply contract'),
  ('00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000065', 'fixed',   '2026-01-01T00:00+01', '2027-01-01T00:00+01', 890,  null, null, null, 'SEK', 'MegaW-HR', 'supply contract'),
  ('00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000067', 'fixed',   '2026-01-01T00:00+01', null,                  430,  null, null, null, 'SEK', 'MegaW-HR', 'VPPA, strike price');

-- The aggregator's hourly grid for midsummer day: one row per hour.
insert into contracts.price_signals (organisation_id, contract_id, kind, starts_at, ends_at, price, currency, per_unit, source)
select '00000000-0000-4000-8000-000800000001', '00000000-0000-4000-8000-000800000066', 'fixed', h, h + interval '1 hour',
       case when extract(hour from h at time zone 'Europe/Stockholm') between 10 and 15 then 120 else 380 end,
       'SEK', 'MegaW-HR', 'aggregator, day-ahead grid'
  from generate_series('2026-06-20T00:00+02'::timestamptz, '2026-06-20T23:00+02', interval '1 hour') h;

insert into documents (object_id, name, kind, uri, media_type, source) values
  ('00000000-0000-4000-8000-000800000061', 'Roof plant PPA, signed', 'document', 's3://nexgen-os-examples/hyllie/ppa-2026.pdf', 'application/pdf', 'investor'),
  ('00000000-0000-4000-8000-000800000020', 'Community statutes', 'document', 's3://nexgen-os-examples/hyllie/statutes.pdf', 'application/pdf', 'general assembly');

-- Queries a page would run
-- The contracts of the cold store's meter on a day, in the order energy is matched with them:
--   select c->>'name' name, c->>'type' type, c->>'priority' priority
--     from jsonb_array_elements(contracts.in_force('00000000-0000-4000-8000-000800000041', '2026-06-20')) c;
-- What the cold store's supply sets at noon on midsummer day (an index, a cap, a floor):
--   select contracts.prices_at('00000000-0000-4000-8000-000800000064', '2026-06-20T12:00+02');
-- What the aggregator pays for the plant's surplus, hour by hour:
--   select starts_at, price, currency from contracts.price_signals
--    where contract_id = '00000000-0000-4000-8000-000800000066' order by starts_at;

-- Pack fr — the grid: who runs it, and the rules of connection, metering and tariff.
set search_path = nexgen, public, extensions;

insert into legal_sources (code, name, kind, reference, url, publisher, countries, published_by, description) values
  ('entsoe_bidding_zones', 'ENTSO-E Transparency Platform — bidding zones and EIC codes', 'guide', 'ENTSO-E Transparency Platform, areas and EIC codes', 'https://transparency.entsoe.eu/', 'ENTSO-E', '{}', 'pack:fr', 'The reference list of the bidding zones of the European electricity market and their EIC codes.');

insert into grid_operators (code, name, kind, country, regions, coverage, website, data_hub_url, identifier_scheme, published_by, description) values
  ('enedis',   'Enedis',                                'dso',    'FR', '{}',      'About 95 % of the distribution of mainland France; the rest is served by local distribution companies.', 'https://www.enedis.fr/',             'https://datahub-enedis.fr/', 'prm', 'pack:fr', 'The main distribution operator: connection, Linky meters, meter data (Data Connect, SGE), the operator side of collective self-consumption.'),
  ('rte',      'RTE',                                   'tso',    'FR', '{}',      'The transmission grid of mainland France (63 kV to 400 kV).',                                            'https://www.rte-france.com/',        'https://data.rte-france.com/', null, 'pack:fr', 'The transmission system operator: the high-voltage grid, balancing, the connection of large plants, the public data of the system.'),
  ('edf_sei',  'EDF Systèmes Énergétiques Insulaires',  'island', 'FR', '{FR-20R,FR-GP,FR-MQ,FR-GF,FR-RE}', 'Corsica and the overseas departments, not interconnected with the mainland.', 'https://www.edf.fr/sei',        null,                         'prm', 'pack:fr', 'Distribution and system operation of the non-interconnected zones (zones non interconnectées, ZNI): other tariffs, other self-consumption ceilings.'),
  ('es_reseaux','Strasbourg Électricité Réseaux',       'dso',    'FR', '{FR-67}', 'Strasbourg and about 400 municipalities of the Bas-Rhin.',                                               'https://www.es-reseaux.fr/',         null,                         'prm', 'pack:fr', 'The largest local distribution company (entreprise locale de distribution, ELD).'),
  ('geg_reseaux','GreenAlp (GEG)',                      'dso',    'FR', '{FR-38}', 'Grenoble.',                                                                                              'https://www.greenalp.fr/',           null,                         'prm', 'pack:fr', 'The distribution subsidiary of Gaz Électricité de Grenoble.'),
  ('srd',      'SRD',                                   'dso',    'FR', '{FR-86}', 'Most of the Vienne department outside Poitiers.',                                                        'https://www.srd-energies.fr/',       null,                         'prm', 'pack:fr', 'Local distribution company of the Vienne.'),
  ('geredis',  'Gérédis',                               'dso',    'FR', '{FR-79}', 'The Deux-Sèvres department.',                                                                            'https://www.geredis.fr/',            null,                         'prm', 'pack:fr', 'Local distribution company of the Deux-Sèvres.'),
  ('urm',      'URM',                                   'dso',    'FR', '{FR-57}', 'Metz and its surroundings.',                                                                             'https://www.urm-metz.fr/',           null,                         'prm', 'pack:fr', 'Local distribution company of Metz (UEM group).');

insert into rules (code, name, section, country, regions, applies_to, statement, parameters, legal_source_code, article, url, valid_from, valid_to, published_by, notes) values
  ('fr_grid_bidding_zone', 'One bidding zone for the mainland', 'grid', 'FR', '{}', 'meter',
   'Mainland France is one bidding zone of the European market, FR; its day-ahead price is one price for every connection point. The non-interconnected zones (Corsica, overseas) are outside it.',
   '{"bidding_zone": "FR", "eic": "10YFR-RTE------C", "outside": ["FR-20R", "FR-GP", "FR-MQ", "FR-GF", "FR-RE"]}',
   'entsoe_bidding_zones', null, 'https://transparency.entsoe.eu/', null, null, 'pack:fr', null),
  ('fr_grid_metering_step', 'The distribution meter reads every 30 minutes', 'grid', 'FR', '{}', 'meter',
   'A Linky meter records the load curve at a 30-minute step by default (48 values a day); a 10-minute step exists on request. Collective self-consumption is allocated on the 30-minute step.',
   '{"default_step": "PT30M", "optional_step": "PT10M", "time_zone": "Europe/Paris"}',
   'fr_enedis_noi_cf_110e', null, null, null, null, 'pack:fr', null),
  ('fr_grid_turpe7', 'TURPE 7: what a connection point pays the distribution grid', 'grid', 'FR', '{}', 'meter',
   'From 1 August 2025 the network tariff for distribution (HTA and BT) is TURPE 7, for about four years, revised each 1 August. What a user pays is the sum of a management component, a metering component, a withdrawal component in power (subscribed kVA, by time band) and in energy (by time band: HPH, HCH, HPB, HCB), and for producers an injection component in HTA; the prices are those of the grid operator''s tariff sheet of the year.',
   '{"in_force_from": "2025-08-01", "revised_each": "08-01", "components": ["management", "metering", "withdrawal_power", "withdrawal_energy", "injection"], "energy_time_bands": ["HPH", "HCH", "HPB", "HCB"]}',
   'fr_cre_2025_13_turpe7', null, 'https://www.cre.fr/documents/Deliberations/Decision/turpe-7-hta-bt', '2025-08-01', null, 'pack:fr', 'Prices change every 1 August: read them from the operator''s tariff sheet, never from this row.'),
  ('fr_grid_conformity_attestation', 'A production installation is energised after its conformity attestation', 'grid', 'FR', '{}', 'device',
   'Before the distribution operator energises a new or modified electrical installation, a production installation included, the installer files an attestation of conformity with the approved body (Consuel), which stamps it, with or without a site visit. The simplified regime covers production installations below 250 kVA that change the internal installation.',
   '{"max_power_kva_simplified": 250, "body": "Consuel"}',
   'fr_code_energie', 'D. 342-16 à D. 342-21', 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000023983208/LEGISCTA000031748551/', null, null, 'pack:fr', 'Codified from the décret n° 72-1120 du 14 décembre 1972.'),
  ('fr_grid_connection_request', 'A connection is asked from the operator of the area', 'grid', 'FR', '{}', 'site',
   'A site asks its connection, for consumption or injection, from the distribution operator of its municipality (Enedis, or the local distribution company), which answers with a connection proposal and a cost; the municipality decides the operator, never the customer.',
   '{"decided_at": "municipality"}',
   'fr_code_energie', 'L. 342-1 et suivants', 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000023983208/LEGISCTA000023986745/', null, null, 'pack:fr', null);

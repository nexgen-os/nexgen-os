-- Pack fr — support schemes, meter data mandates, and how an address is written.
set search_path = nexgen, public, extensions;

insert into legal_sources (code, name, kind, reference, url, publisher, countries, published_by, description) values
  ('fr_nf_z10_011', 'NF Z 10-011 — Adresse postale', 'standard', 'NF Z 10-011 (AFNOR, 2013)', 'https://www.boutique.afnor.org/fr-fr/norme/nf-z10011/adresse-postale/fa176290/41691', 'AFNOR', '{FR}', 'pack:fr', 'The French standard of the postal address: the lines, their order and the 38-character limit the postal operator reads.');

insert into rules (code, name, section, country, regions, applies_to, statement, parameters, legal_source_code, article, url, valid_from, valid_to, published_by, notes) values
  -- Support.
  ('fr_oa_s21_500kw', 'Purchase obligation on request for roof, barn and carport photovoltaics up to 500 kWc', 'support', 'FR', '{}', 'device',
   'A photovoltaic installation on a building, barn or carport of 500 kWc or less obtains, on request, a twenty-year purchase contract for its surplus or its whole production at the tariff of the quarter it applied in; above, a call for tenders.',
   '{"max_power_kwp": 500, "contract_years": 20, "tariff_period": "P3M"}',
   'fr_arrete_2021_10_06_s21', 'Article 1', 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000044173284/', '2021-10-09', '2025-09-21', 'pack:fr', 'Ceiling lowered to 100 kWc on 22 September 2025.'),
  ('fr_oa_s21_100kw', 'Purchase obligation on request up to 100 kWc; a simplified tender from 100 to 500 kWc', 'support', 'FR', '{}', 'device',
   'Since 22 September 2025 the open-window purchase obligation of the S21 order covers installations on buildings, barns and carports of 100 kWc or less; installations from 100 kWc to 500 kWc go through a simplified call for tenders whose first period opened the same day.',
   '{"max_power_kwp": 100, "tender_from_kwp": 100, "tender_to_kwp": 500, "contract_years": 20, "tariff_period": "P3M"}',
   'fr_arrete_2021_10_06_s21', 'Article 1, as amended on 26 March 2025 and 6 October 2025', 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000044173284/', '2025-09-22', null, 'pack:fr', 'Tariffs and the premium are set each quarter by the regulator: read them from the quarter''s sheet, never from this row.'),
  ('fr_prime_autoconsommation', 'An investment premium for self-consumption with surplus sale', 'support', 'FR', '{}', 'device',
   'An installation on a building that self-consumes and sells its surplus under the S21 order receives an investment premium per kWc, set each quarter with the tariff and decreasing with power.',
   '{"max_power_kwp": 100, "unit": "EUR/kWp", "set_each": "P3M"}',
   'fr_arrete_2021_10_06_s21', 'Article 7', 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000044173284/', '2021-10-09', null, 'pack:fr', null),
  -- Data.
  ('fr_data_consent_meter_data', 'A third party reads a customer''s meter data with the customer''s consent, per metering point', 'data', 'FR', '{}', 'meter',
   'A third party reads a customer''s meter data from the distribution operator (daily index, 30-minute load curve, contract data) only with the customer''s explicit consent, given per metering point (PRM), for a stated purpose and duration, revocable at any time; the 30-minute load curve is collected only when the customer has asked for it.',
   '{"per": "PRM", "scopes": ["contract", "daily_consumption", "load_curve_30min", "daily_production", "max_power"], "load_curve_step": "PT30M", "revocable": true}',
   'fr_enedis_data_connect_terms', null, 'https://datahub-enedis.fr/data-connect/', null, null, 'pack:fr', 'The history a consent opens (36 months of daily data, 24 months of load curve are the depths usually quoted) is to be read from the current Data Connect documentation.'),
  -- Addresses.
  ('fr_address_format', 'How a French address is written', 'addresses', 'FR', '{}', 'site',
   'A French address is a street line (number, repetition index, street), an optional extra line, a five-digit postal code and the municipality; this pack keys regions by the department (ISO 3166-2, FR-01 to FR-976) and municipalities by their INSEE code, which is not the postal code.',
   '{"postal_code_pattern": "^[0-9]{5}$", "region_level": "department", "region_pattern": "^FR-(0[1-9]|[1-8][0-9]|9[0-5]|2[AB]|97[1-6])$", "municipality_scheme": "insee", "lines": ["street", "address_extra", "postal_code city"]}',
   'fr_nf_z10_011', null, null, null, null, 'pack:fr', null);

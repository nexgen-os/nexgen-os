-- Pack fr — identifiers and sources of France.
set search_path = nexgen, public, extensions;

insert into sources (code, name, kind, base_url, docs_url, auth, countries, license, attribution, published_by, description) values
  ('ban',          'Base Adresse Nationale',       'api', 'https://api-adresse.data.gouv.fr/', 'https://adresse.data.gouv.fr/api-doc/adresse', 'none', '{FR}', 'Licence Ouverte 2.0', '© BAN — Base Adresse Nationale', 'pack:fr', 'The national address register: search as you type and reverse geocoding, with house-number precision.'),
  ('geo_api_gouv', 'API Découpage administratif', 'api', 'https://geo.api.gouv.fr/',          'https://geo.api.gouv.fr/decoupage-administratif', 'none', '{FR}', 'Licence Ouverte 2.0', '© Etalab', 'pack:fr', 'Communes, departments and regions, with their codes and boundaries.');

insert into id_schemes (code, name, pattern, url_template, source_code, description) values
  ('insee',       'Code INSEE',  '^[0-9][0-9AB][0-9]{3}$', null, 'geo_api_gouv', 'The code of a French municipality in the national statistics register (code commune INSEE): the level at which the distribution operator, planning rules and most datasets are decided.'),
  ('prm',         'PRM / PDL',   '^[0-9]{14}$', null, null, 'The 14-digit metering point identifier of the French distribution grid (point de référence mesure, also point de livraison).'),
  ('ban_address', 'BAN address', '^[0-9]{5}_[0-9a-z]+_[0-9a-z_]+$', 'https://adresse.data.gouv.fr/base-adresse-nationale/{value}', 'ban', 'The identifier of an address in the Base Adresse Nationale.');

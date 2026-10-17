-- Pack be — the grid: who runs it, region by region.
--
-- One transmission operator for the country, and the distribution operators
-- each region designates: one in Flanders, one in Brussels, several in
-- Wallonia, where the municipality decides which one serves it. A Belgian
-- metering point is a GS1 Global Service Relation Number (the core
-- `gs1_gsrn` scheme), issued by the operator of the connection.
--
-- The rules of the grid (bidding zone, metering step, tariff, connection)
-- name the texts they come from and follow in a later version of the pack.
-- Numbered 0004 so that it loads after the pack's legal sources and tasks.
set search_path = nexgen, public, extensions;

insert into grid_operators (code, name, kind, country, regions, coverage, website, data_hub_url, identifier_scheme, published_by, description) values
  ('elia',    'Elia',                                    'tso', 'BE', '{}',       'The transmission grid of the whole country, from 30 kV to 380 kV, the regional transmission grids included.', 'https://www.elia.be/',    'https://opendata.elia.be/', null,       'pack:be', 'The transmission system operator: the high-voltage grid, balancing, the connection of large plants and the public data of the system.'),
  ('fluvius', 'Fluvius',                                 'dso', 'BE', '{BE-VLG}', 'Every municipality of Flanders, for electricity and gas.',                                               'https://www.fluvius.be/', null,                        'gs1_gsrn', 'pack:be', 'The distribution operator of Flanders: connection, digital meters, meter data, and the operator side of energy sharing in Flanders.'),
  ('sibelga', 'Sibelga',                                 'dso', 'BE', '{BE-BRU}', 'The 19 municipalities of the Brussels-Capital Region, for electricity and gas.',                         'https://www.sibelga.be/', null,                        'gs1_gsrn', 'pack:be', 'The distribution operator of Brussels: connection, meters, meter data, and the operator side of energy sharing in Brussels.'),
  ('ores',    'ORES',                                    'dso', 'BE', '{BE-WAL}', 'Most municipalities of Wallonia.',                                                                      'https://www.ores.be/',    null,                        'gs1_gsrn', 'pack:be', 'The largest distribution operator of Wallonia.'),
  ('resa',    'RESA',                                    'dso', 'BE', '{BE-WAL}', 'Most municipalities of the province of Liège.',                                                         'https://www.resa.be/',    null,                        'gs1_gsrn', 'pack:be', 'The distribution operator of most of the province of Liège.'),
  ('aieg',    'AIEG',                                    'dso', 'BE', '{BE-WAL}', 'A few municipalities of the province of Namur.',                                                        'https://www.aieg.be/',    null,                        'gs1_gsrn', 'pack:be', 'An intermunicipal distribution operator of Wallonia (Association Intercommunale d''Étude et d''Exploitation d''Électricité et de Gaz).'),
  ('aiesh',   'AIESH',                                   'dso', 'BE', '{BE-WAL}', 'A few municipalities of the south of the province of Hainaut and of the province of Namur.',             'https://www.aiesh.be/',   null,                        'gs1_gsrn', 'pack:be', 'An intermunicipal distribution operator of Wallonia (Association Intercommunale d''Électricité du Sud du Hainaut).'),
  ('rew',     'Réseau d''Énergies de Wavre (REW)',       'dso', 'BE', '{BE-WAL}', 'The municipality of Wavre.',                                                                            'https://www.rew.be/',     null,                        'gs1_gsrn', 'pack:be', 'The municipal distribution operator of Wavre.');

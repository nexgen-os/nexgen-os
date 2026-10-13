-- Pack be — identifiers and sources of Belgium.
--
-- Belgium decides most things per region: Flanders (BE-VLG), Brussels
-- (BE-BRU) and Wallonia (BE-WAL) each keep their own address register,
-- building identifiers, grid operators and rules. Every regional row says
-- which region it applies to in `regions`.
--
-- A Belgian metering point (the "EAN" on an energy bill) is a GS1 Global
-- Service Relation Number of 18 digits: it uses the core `gs1_gsrn` scheme,
-- not a scheme of its own.
set search_path = nexgen, public, extensions;

insert into sources (code, name, kind, base_url, docs_url, auth, countries, regions, license, attribution, redistributable, published_by, description) values
  ('geopunt',  'Geolocation API of Digitaal Vlaanderen (Geopunt)', 'api', 'https://geo.api.vlaanderen.be/geolocation/', 'https://geo.api.vlaanderen.be/geolocation/', 'none', '{BE}', '{BE-VLG,BE-BRU}', 'Modellicentie Gratis Hergebruik (Basisregisters Vlaanderen); CC0-1.0 (UrbIS-Adm)', '© Digitaal Vlaanderen — Basisregisters Vlaanderen; © Paradigm — UrbIS', true, 'pack:be', 'The Flemish address register (Basisregisters Vlaanderen) as a geocoder, with the Brussels UrbIS addresses alongside: search, reverse, house-number precision. Its matching is loose on house numbers; the adapter checks the number it matched.'),
  ('basisregisters_vlaanderen', 'Basisregisters Vlaanderen', 'api', 'https://api.basisregisters.vlaanderen.be/v2/', 'https://docs.basisregisters.vlaanderen.be/', 'none', '{BE}', '{BE-VLG}', 'Modellicentie Gratis Hergebruik', '© Digitaal Vlaanderen — Basisregisters Vlaanderen', true, 'pack:be', 'The Flemish base registers: addresses, streets, municipalities (by NIS code), parcels and buildings, each with a persistent identifier.'),
  ('urbis',    'UrbIS geolocation service', 'api', 'https://geoservices.irisnet.be/localization/', 'https://geoservices.irisnet.be/localization/', 'none', '{BE}', '{BE-BRU}', 'CC0-1.0', '© Paradigm — UrbIS', true, 'pack:be', 'The Brussels address register (UrbIS) as a geocoder: addresses in French or Dutch, with how well each part matched. Reverse lookup takes Belgian Lambert 72 only.'),
  ('icar',     'ICAR geocoding service (geocodeWS)', 'api', 'https://geoservices.wallonie.be/geocodeWS/', 'https://metawal.wallonie.be/geonetwork/srv/api/records/c79653b2-501b-4a91-9aa4-908a7cd5800e', 'none', '{BE}', '{BE-WAL}', 'Free and open access; terms of use being drafted by the Service public de Wallonie (not verified)', '© Service public de Wallonie — ICAR', false, 'pack:be', 'The Walloon address register (ICAR, inventaire centralisé des adresses et des rues) as a geocoder: search, reverse, a match score per level and the NIS code of the municipality.'),
  ('rmi_aws',  'RMI automatic weather stations', 'api', 'https://opendata.meteo.be/service/aws/wfs', 'https://opendata.meteo.be/documentation/?dataset=aws', 'none', '{BE}', '{}', 'CC-BY-4.0 (as stated by the Belgian Climate Centre catalogue; not verified on opendata.meteo.be)', '© Royal Meteorological Institute of Belgium (RMI)', true, 'pack:be', 'Observations of the automatic weather stations of the Royal Meteorological Institute (KMI/IRM), every 10 minutes, hour and day: temperature, wind, humidity, global irradiance, through OGC WFS. A network of stations, not a grid.');

insert into id_schemes (code, name, pattern, url_template, source_code, published_by, description) values
  ('nis',                'NIS code',                     '^[0-9]{5}$', null, null, 'pack:be', 'The 5-digit code of a Belgian municipality given by Statbel (also called INS or REFNIS code): the level at which a distribution operator, local planning rules and most datasets are decided. The first digit names the province, or 2 for Brussels.'),
  ('vlaanderen_address', 'Basisregisters address',       '^[0-9]+$', 'https://data.vlaanderen.be/id/adres/{value}', 'basisregisters_vlaanderen', 'pack:be', 'The persistent identifier of an address in the Flemish address register (Adressenregister). Flanders only.'),
  ('vlaanderen_building', 'Basisregisters building (gebouwID)', '^[0-9]+$', 'https://data.vlaanderen.be/id/gebouw/{value}', 'basisregisters_vlaanderen', 'pack:be', 'The persistent identifier of a building in the Flemish building register (Gebouwenregister). Flanders only.'),
  ('urbis_building',     'UrbIS building',               '^[0-9]+$', null, 'urbis', 'pack:be', 'The identifier of a building in UrbIS-Adm, the Brussels reference map (not verified: whether it stays the same from one UrbIS release to the next). Brussels only.'),
  ('icar_address',       'ICAR address',                 '^[0-9]+$', null, 'icar', 'pack:be', 'The identifier of a house number in ICAR, the Walloon address register. Wallonia keeps no building register: an ICAR address is the most precise identifier of a place there.');

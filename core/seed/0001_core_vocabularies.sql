-- Nexgen OS — the vocabularies the core publishes.
--
-- Only what is universal lives here: no country, no product, no market rule.
-- Modules and country packs add their own rows with `published_by` set to
-- their code. Every row names the standard terms it corresponds to.

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- Device types. The codes of Nexgen, in a tree aligned on Brick Equipment and
-- IFC. The module that derives a type into its own table is named when it
-- ships; the instrument that measures (a meter, a sensor) is a device too,
-- and what it measures is a series.
-- ---------------------------------------------------------------------------

insert into device_types (code, name, parent_code, module_code, brick_class, ifc_class, description) values
  ('generator',  'Generator',          null,        null,  'Electrical_Generation_Equipment', 'IfcElectricGenerator', 'Any electricity-producing device.'),
  ('solar',      'PV system',          'generator', 'solar',   'PV_Array',            'IfcSolarDevice',          'Photovoltaic modules and their inverters.'),
  ('wind',       'Wind turbine',       'generator', null,  'Wind_Turbine',        'IfcElectricGenerator',    'A wind turbine.'),
  ('hydro',      'Hydro turbine',      'generator', null,  null,                  'IfcElectricGenerator',    'A hydroelectric turbine.'),
  ('cogeneration',        'Combined heat and power', 'generator', null, null,              'IfcElectricGenerator',    'A cogeneration unit.'),
  ('biomass',    'Biomass plant',      'generator', null,  null,                  'IfcElectricGenerator',    'A biomass boiler or plant.'),
  ('inverter',   'Inverter',           null,        null,   'Inverter',            'IfcElectricFlowStorageDevice', 'A power converter between DC and AC.'),
  ('battery',    'Battery',            null,        null,  'Battery',             'IfcElectricFlowStorageDevice', 'An electrical energy storage system.'),
  ('charger',         'EV charging station', null,       null,  'Electric_Vehicle_Charging_Station', 'IfcElectricAppliance', 'An electric vehicle charging station.'),
  ('heat_pump',   'Heat pump',          null,        null, 'Heat_Pump',           'IfcUnitaryEquipment',     'A heat pump.'),
  ('boiler',     'Boiler',             null,        null, 'Boiler',              'IfcBoiler',               'A boiler.'),
  ('geothermal', 'Geothermal system',  null,        null, null,                  'IfcUnitaryEquipment',     'A ground-source heat exchange system.'),
  ('hvac',       'Air handling unit',  null,        null, 'AHU',                 'IfcUnitaryEquipment',     'An air handling or ventilation unit.'),
  ('meter',      'Meter',              null,        null,    'Meter',               'IfcFlowMeter',            'A physical metering device; the grid module names the connection point it is on.'),
  ('sensor',     'Sensor',             null,        null,     null,                  'IfcSensor',               'An instrument that measures one or more quantities: a thermometer, a CO2 probe, a presence detector.'),
  ('sensor_box', 'Sensor box',         'sensor',    null,     null,                  'IfcSensor',               'A device carrying several sensors, read as one (a multisensor, a smart plug).'),
  ('controller', 'Controller',         null,        null,     'Controller',          'IfcController',           'A gateway or controller that drives other devices.');

-- ---------------------------------------------------------------------------
-- Profiles: what a building or a site is used for.
-- ---------------------------------------------------------------------------

insert into profiles (code, name, applies_to, ifc_occupancy, citygml_function, description) values
  ('residential', 'Residential',        'building', 'Residential',  'residential', 'Dwellings: a house, a flat, a block.'),
  ('office',      'Office',             'building', 'Office',       'office',      'Office space.'),
  ('school',      'School',             'building', 'Education',    'school',      'A school, a nursery, a training centre.'),
  ('retail',      'Retail',             'building', 'Retail',       'retail',      'A shop, a supermarket.'),
  ('industrial',  'Industrial',         'building', 'Industrial',   'industry',    'A factory, a workshop.'),
  ('warehouse',   'Warehouse',          'building', 'Storage',      'warehouse',   'A storage or logistics hall.'),
  ('agricultural','Agricultural',       'building', 'Agricultural', 'agriculture', 'A barn, a stable, a greenhouse.'),
  ('public',      'Public building',    'building', 'Public',       'public',      'A town hall, a library, a sports hall.'),
  ('healthcare',  'Healthcare',         'building', 'Healthcare',   'hospital',    'A hospital, a care home.'),
  ('hospitality', 'Hospitality',        'building', 'Hotel',        'hotel',       'A hotel, a restaurant.'),
  ('mixed',       'Mixed use',          'building', 'Mixed',        'mixed',       'Several uses in one building.'),
  ('plant',       'Production site',    'site',     null,           'industry',    'A site whose purpose is a plant: a PV field, a wind farm.'),
  ('car_park',    'Car park',           'site',     null,           'parking',     'An open car park.'),
  ('land',        'Land',               'site',     null,           'agriculture', 'A field, a meadow, a wood.');

-- ---------------------------------------------------------------------------
-- Link types. Kinds refer to objects.kind.
-- ---------------------------------------------------------------------------

insert into link_types (code, name, inverse_name, subject_kinds, object_kinds, brick_relation, ifc_relation, description) values
  ('feeds',     'feeds',          'is fed by',       '{device}',       null,                 'feeds',       'IfcRelConnectsPorts',     'Energy or a medium flows from the subject to the object.'),
  ('serves',    'serves',         'is served by',    '{device}',       null,                 'feeds',       'IfcRelServicesBuildings', 'The device serves the place (a heat pump serves a building).'),
  ('shades',    'shades',         'is shaded by',    null,             null,                 null,          null,                      'The subject casts shade on the object.'),
  ('adjacent_to','is adjacent to','is adjacent to',  null,             null,                 null,          'IfcRelSpaceBoundary',     'The two objects share a boundary.'),
  ('owns',      'owns',           'is owned by',     '{organisation,participant}', null,     null,          'IfcRelAssignsToActor',    'Ownership: an organisation, or a participant whose contact owns the object.'),
  ('operates',  'operates',       'is operated by',  '{organisation,participant}', null,     null,          'IfcRelAssignsToActor',    'Operation and maintenance responsibility.'),
  -- What became of an object. Identifiers never encode anything and are
  -- never reused: a split, a merge, a replacement is a dated link.
  ('split_into', 'was split into', 'was split from', null,            null,                 null,          null,                      'The subject was divided into the object (a parcel split by the cadastre); one link per part.'),
  ('merged_into','was merged into','was merged from', null,           null,                 null,          null,                      'The subject became part of the object (two buildings joined); one link per former object.'),
  ('replaces',  'replaces',       'is replaced by',  null,             null,                 null,          null,                      'The subject took the place of the object (a meter swapped, an inverter changed).'),
  ('behind_meter', 'was behind',  'had behind it',   '{device}',       '{meter}',            null,          null,                      'The connection point a device was behind before it was connected to another one, over the period it was there (devices.meter_id holds today''s).'),
  ('carried_by', 'was carried by', 'carried',        '{meter}',        '{participant}',      null,          null,                      'The participant that carried a connection point before another one did, over the period it did (meters.participant_id holds today''s).');

-- ---------------------------------------------------------------------------
-- Quantities, each with the one unit it is stored in (QUDT unit codes).
-- ---------------------------------------------------------------------------

insert into quantities (code, name, unit, aggregation, qudt_quantity_kind) values
  -- energy and power: the generic pair for a sensor that does not say which
  -- way, then one per direction so a page never guesses: taken from or
  -- injected into the grid at a meter, produced by or consumed by a device.
  ('energy',              'Energy',                       'KiloW-HR',   'sum',  'Energy'),
  ('offtake_energy',      'Energy taken from the grid',   'KiloW-HR',   'sum',  'Energy'),
  ('injection_energy',    'Energy injected into the grid','KiloW-HR',   'sum',  'Energy'),
  ('production_energy',   'Energy produced',              'KiloW-HR',   'sum',  'Energy'),
  ('consumption_energy',  'Energy consumed',              'KiloW-HR',   'sum',  'Energy'),
  ('power',               'Power',                        'KiloW',      'mean', 'Power'),
  ('production_power',    'Power produced',               'KiloW',      'mean', 'Power'),
  ('consumption_power',   'Power consumed',               'KiloW',      'mean', 'Power'),
  ('temperature',         'Temperature',                  'DEG_C',      'mean', 'Temperature'),
  ('humidity',   'Relative humidity',            'PERCENT',    'mean', 'RelativeHumidity'),
  ('co2',   'CO2 concentration',            'PPM',        'mean', 'DimensionlessRatio'),
  ('irradiance',          'Irradiance',                   'W-PER-M2',   'mean', 'Irradiance'),
  ('occupancy',           'Occupancy',                    'NUM',        'last', 'Count'),
  ('charge_level',     'State of charge',              'PERCENT',    'last', 'DimensionlessRatio'),
  ('volume',              'Volume',                       'M3',         'sum',  'Volume'),
  ('emissions',           'Greenhouse gas emissions',     'KiloGM',     'sum',  'Mass'),
  ('area',                'Area',                         'M2',         'last', 'Area'),
  ('length',              'Length',                       'M',          'last', 'Length'),
  ('u_value','Thermal transmittance',       'W-PER-M2-K', 'last', 'ThermalTransmittance'),
  ('ratio',               'Ratio',                        'UNITLESS',   'last', 'DimensionlessRatio'),
  -- Two quantities of the values a country decides (see below).
  ('emission_factor',     'Emission factor of energy',    'KiloGM-PER-KiloW-HR', 'last', null),
  ('specific_yield',      'Specific yield',               'KiloW-HR-PER-KiloW',  'last', null);

-- ---------------------------------------------------------------------------
-- Units (QUDT codes): the quantity kind each measures, and the factor and
-- offset to the SI unit of that kind (QUDT conversionMultiplier and
-- conversionOffset). store() converts a value given in any of them to the
-- unit of its quantity; convert_unit() converts between any two of a kind.
-- The symbol is how devices and APIs write the unit.
-- ---------------------------------------------------------------------------

insert into units (code, name, symbol, quantity_kind, factor, "offset") values
  ('J',                   'Joule',                         'J',        'Energy',               1, 0),
  ('KiloJ',               'Kilojoule',                     'kJ',       'Energy',               1e3, 0),
  ('MegaJ',               'Megajoule',                     'MJ',       'Energy',               1e6, 0),
  ('GigaJ',               'Gigajoule',                     'GJ',       'Energy',               1e9, 0),
  ('W-HR',                'Watt hour',                     'Wh',       'Energy',               3600, 0),
  ('KiloW-HR',            'Kilowatt hour',                 'kWh',      'Energy',               3.6e6, 0),
  ('MegaW-HR',            'Megawatt hour',                 'MWh',      'Energy',               3.6e9, 0),
  ('GigaW-HR',            'Gigawatt hour',                 'GWh',      'Energy',               3.6e12, 0),
  ('W',                   'Watt',                          'W',        'Power',                1, 0),
  ('KiloW',               'Kilowatt',                      'kW',       'Power',                1e3, 0),
  ('MegaW',               'Megawatt',                      'MW',       'Power',                1e6, 0),
  ('GigaW',               'Gigawatt',                      'GW',       'Power',                1e9, 0),
  ('K',                   'Kelvin',                        'K',        'Temperature',          1, 0),
  ('DEG_C',               'Degree Celsius',                '°C',       'Temperature',          1, 273.15),
  ('DEG_F',               'Degree Fahrenheit',             '°F',       'Temperature',          5.0 / 9, 459.67 * 5 / 9.0),
  ('UNITLESS',            'Unitless',                      null,       'DimensionlessRatio',   1, 0),
  ('PERCENT',             'Percent',                       '%',        'DimensionlessRatio',   0.01, 0),
  ('PPM',                 'Parts per million',             'ppm',      'DimensionlessRatio',   1e-6, 0),
  ('PPB',                 'Parts per billion',             'ppb',      'DimensionlessRatio',   1e-9, 0),
  ('NUM',                 'Number',                        null,       'Count',                1, 0),
  ('W-PER-M2',            'Watt per square metre',         'W/m²',     'Irradiance',           1, 0),
  ('KiloW-PER-M2',        'Kilowatt per square metre',     'kW/m²',    'Irradiance',           1e3, 0),
  ('J-PER-M2',            'Joule per square metre',        'J/m²',     'EnergyPerArea',        1, 0),
  ('W-HR-PER-M2',         'Watt hour per square metre',    'Wh/m²',    'EnergyPerArea',        3600, 0),
  ('KiloW-HR-PER-M2',     'Kilowatt hour per square metre','kWh/m²',   'EnergyPerArea',        3.6e6, 0),
  ('M3',                  'Cubic metre',                   'm³',       'Volume',               1, 0),
  ('L',                   'Litre',                         'L',        'Volume',               1e-3, 0),
  ('FT3',                 'Cubic foot',                    'ft³',      'Volume',               0.028316846592, 0),
  ('KiloGM',              'Kilogram',                      'kg',       'Mass',                 1, 0),
  ('GM',                  'Gram',                          'g',        'Mass',                 1e-3, 0),
  ('TONNE',               'Tonne',                         't',        'Mass',                 1e3, 0),
  ('M2',                  'Square metre',                  'm²',       'Area',                 1, 0),
  ('M',                   'Metre',                         'm',        'Length',               1, 0),
  ('KiloM',               'Kilometre',                     'km',       'Length',               1e3, 0),
  ('CentiM',              'Centimetre',                    'cm',       'Length',               1e-2, 0),
  ('MilliM',              'Millimetre',                    'mm',       'Length',               1e-3, 0),
  ('M-PER-SEC',           'Metre per second',              'm/s',      'Speed',                1, 0),
  ('KiloM-PER-HR',        'Kilometre per hour',            'km/h',     'Speed',                1 / 3.6, 0),
  ('PA',                  'Pascal',                        'Pa',       'Pressure',             1, 0),
  ('HectoPA',             'Hectopascal',                   'hPa',      'Pressure',             1e2, 0),
  ('KiloPA',              'Kilopascal',                    'kPa',      'Pressure',             1e3, 0),
  ('BAR',                 'Bar',                           'bar',      'Pressure',             1e5, 0),
  ('MilliBAR',            'Millibar',                      'mbar',     'Pressure',             1e2, 0),
  ('W-PER-M2-K',          'Watt per square metre kelvin',  'W/(m²·K)', 'ThermalTransmittance', 1, 0),
  ('KiloGM-PER-KiloW-HR', 'Kilogram per kilowatt hour',    'kg/kWh',   'MassPerEnergy',        1 / 3.6e6, 0),
  ('GM-PER-KiloW-HR',     'Gram per kilowatt hour',        'g/kWh',    'MassPerEnergy',        1e-3 / 3.6e6, 0),
  ('HR',                  'Hour',                          'h',        'Time',                 3600, 0),
  ('KiloW-HR-PER-KiloW',  'Kilowatt hour per kilowatt',    'kWh/kW',   'Time',                 3600, 0);

-- ---------------------------------------------------------------------------
-- Property definitions: attributes beyond the columns (bSDD / IFC property
-- sets where they exist). Kinds refer to objects.kind. A fact a column holds
-- is never repeated here: the use of a site is its `profile`, a device's
-- power its `rated_power_kw`, its commissioning its `installation_date`.
-- What describes a building or a roof face (its year, floors, label,
-- material) is published by the `building` module with its kinds.
-- ---------------------------------------------------------------------------

insert into property_defs (code, name, datatype, quantity_code, minimum, maximum, allowed_values, applies_to, ifc_pset, ifc_property) values
  ('efficiency',           'Efficiency',            'number',  'ratio',  0,    1,    null, '{device}',            null,                         null),
  ('annual_consumption',   'Annual consumption',    'number',  'energy', 0,    null, null, '{site,building,participant}', null,              null),
  -- The sum over a site or a project; a device's own is its rated power.
  ('installed_power',      'Installed power',       'number',  'power',  0,    null, null, '{project,site}',      null,                         null),
  -- What the contract of a connection point allows it to take.
  ('subscribed_power',     'Subscribed power',      'number',  'power',  0,    null, null, '{meter}',             null,                         null);

-- The values a country or a region decides, published as `defaults` rows by
-- its pack and read through parameter_of(); an organisation or an object
-- that knows better holds the same property as an attribute. A price is in
-- the currency of the country (countries.currency), hence no quantity.
insert into property_defs (code, name, datatype, quantity_code, minimum, maximum, description) values
  ('metering_step',               'Metering step',                          'text',   null,              null, null, 'The interval of the readings a grid operator publishes, as an ISO 8601 duration (PT15M).'),
  ('bidding_zone',                'Bidding zone',                           'text',   null,              null, null, 'The bidding zone of the wholesale electricity market, by its EIC code.'),
  ('grid_co2_factor',             'Emission factor of grid electricity',    'number', 'emission_factor', 0,    null, 'Greenhouse gas emitted per kWh taken from the grid, from the transmission operator''s yearly balance.'),
  ('pv_specific_yield_fallback',  'Specific yield of PV, fallback',         'number', 'specific_yield',  0,    null, 'The mean yearly energy of one kWp, used only where no yield run exists, and marked as a fallback.'),
  ('vat_rate_electricity',        'Value added tax on electricity',         'number', 'ratio',           0,    1,    'The rate applied to a household electricity bill.'),
  ('energy_price_household',      'Energy price, households',               'number', null,              0,    null, 'In the currency of the country per MWh, without grid fees and taxes, from a public statistic.'),
  ('energy_price_business',       'Energy price, businesses',               'number', null,              0,    null, 'In the currency of the country per MWh, without grid fees and taxes, from a public statistic.'),
  ('grid_fees_and_taxes',         'Grid fees and taxes',                    'number', null,              0,    null, 'In the currency of the country per MWh taken from the grid.'),
  ('injection_price_reference',   'Reference price of injected energy',     'number', null,              0,    null, 'In the currency of the country per MWh injected into the grid.'),
  ('offpeak_hours',               'Off-peak hours',                         'json',   null,              null, null, 'The windows of off-peak hours, as a list of [start, end) local times; null where it depends on the supply contract.'),
  ('sharing_max_distance_m',      'Energy sharing, maximum distance',       'number', 'length',          0,    null, 'The greatest distance between two participants of an energy sharing operation.'),
  ('sharing_max_power_kw',        'Energy sharing, maximum power',          'number', 'power',           0,    null, 'The greatest installed power of an energy sharing operation.'),
  ('sharing_settlement_period',   'Energy sharing, settlement period',      'text',   null,              null, null, 'The period energy is shared over, as an ISO 8601 duration.'),
  ('voltage_levels',              'Voltage levels',                         'json',   null,              null, null, 'The voltage levels of the grid, a list of {code, name, min_kv, max_kv} in kilovolts, a level holding the voltages above min_kv up to max_kv.'),
  ('connection_max_power_lv',     'Maximum power of a low voltage connection',    'number', 'power', 0, null, 'Above it, a connection is made at medium voltage.'),
  ('connection_max_power_mv',     'Maximum power of a medium voltage connection', 'number', 'power', 0, null, 'Above it, a connection is made at high voltage.'),
  ('connection_study_power',      'Power above which a connection is studied',    'number', 'power', 0, null, 'The power from which the grid operator studies a connection request before answering.');

-- ---------------------------------------------------------------------------
-- Tags (Project Haystack markers where one exists).
-- ---------------------------------------------------------------------------

insert into tags (code, name, haystack_tag, description) values
  ('heritage',        'Heritage',            null,     'Protected for its heritage value; changes need a specific authorisation.'),
  ('publicAccess',    'Public access',       null,     'Open to the public.'),
  ('critical',        'Critical',            null,     'Its failure has serious consequences (a hospital wing, a cold room).'),
  ('greenRoof',       'Green roof',          null,     'A vegetated roof.'),
  ('asbestosSuspected','Asbestos suspected', null,     'May contain asbestos; survey before works.'),
  ('electric',        'Electrical',          'elec',   'Concerns electricity.'),
  ('solar',           'Solar',               'solar',  'Concerns solar energy.'),
  ('logged',          'Logged',              'his',    'Its values are kept as a history.'),
  ('writable',        'Writable',            'writable','Accepts values sent to it (setpoints, commands).');

-- ---------------------------------------------------------------------------
-- Sources that are worldwide and open. National ones (cadastres, LiDAR,
-- grid operators' hubs) come with country packs; commercial APIs with the
-- modules that use them.
-- ---------------------------------------------------------------------------

insert into sources (code, name, kind, base_url, docs_url, auth, license, attribution, description) values
  ('openstreetmap', 'OpenStreetMap',        'api',  'https://overpass-api.de/api/',         'https://wiki.openstreetmap.org/wiki/Overpass_API', 'none', 'ODbL-1.0', '© OpenStreetMap contributors', 'Footprints, heights, tags and addresses of the world, through the Overpass API.'),
  ('overture',      'Overture Maps',        'file', 'https://overturemaps.org/',            'https://docs.overturemaps.org/', 'none', 'ODbL-1.0 / CDLA-Permissive-2.0', '© Overture Maps Foundation', 'Buildings, places and addresses with stable GERS identifiers, as downloadable datasets.'),
  ('wikidata',      'Wikidata',             'api',  'https://www.wikidata.org/w/api.php',   'https://www.wikidata.org/wiki/Wikidata:Data_access', 'none', 'CC0-1.0', null, 'Named places and organisations.'),
  ('copernicus_dem','Copernicus DEM GLO-30','file', 'https://dataspace.copernicus.eu/',     'https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model', 'none', 'Copernicus license', '© European Union, Copernicus', 'Ground elevation at 30 m, worldwide.'),
  ('pvgis',         'PVGIS',                'api',  'https://re.jrc.ec.europa.eu/api/v5_3/', 'https://joint-research-centre.ec.europa.eu/pvgis-online-tool_en', 'none', 'CC-BY-4.0', '© European Union, JRC', 'Solar irradiation and PV production estimates, worldwide.'),
  ('open_meteo',    'Open-Meteo',           'api',  'https://api.open-meteo.com/v1/',       'https://open-meteo.com/en/docs', 'none', 'CC-BY-4.0', '© Open-Meteo', 'Weather history and forecasts, worldwide.'),
  -- Geocoders: an address to a point, a point to an address. Both are read
  -- by the `geocoding` library; national geocoders come with country packs,
  -- commercial ones with the installation that holds their key.
  ('nominatim',     'Nominatim',            'api',  'https://nominatim.openstreetmap.org/', 'https://nominatim.org/release-docs/latest/api/Overview/', 'none', 'ODbL-1.0', '© OpenStreetMap contributors', 'Addresses and places of OpenStreetMap, both ways, worldwide. The public instance asks for one request per second and a named user agent.'),
  ('photon',        'Photon',               'api',  'https://photon.komoot.io/',            'https://github.com/komoot/photon', 'none', 'ODbL-1.0', '© OpenStreetMap contributors', 'Search-as-you-type on OpenStreetMap addresses and places, and reverse lookup, worldwide.');

-- ---------------------------------------------------------------------------
-- Identifier schemes that are global. National ones come with country packs.
-- ---------------------------------------------------------------------------

insert into id_schemes (code, name, pattern, url_template, source_code, description) values
  ('ifc_guid',      'IFC GlobalId',               '^[0-9A-Za-z_$]{22}$', null, null, 'The compressed GUID of an IFC object.'),
  ('cityjson',      'CityJSON object',            '^.+$', null, null, 'The id of a CityObject in a CityJSON file: a national building identifier in 3DBAG or UrbIS.'),
  ('osm',           'OpenStreetMap',              '^(node|way|relation)/[0-9]+$', 'https://www.openstreetmap.org/{value}', 'openstreetmap', 'An OpenStreetMap element.'),
  ('overture_gers', 'Overture GERS',              '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$', null, 'overture', 'Global Entity Reference System identifier of Overture Maps.'),
  ('wikidata',      'Wikidata',                   '^Q[0-9]+$', 'https://www.wikidata.org/wiki/{value}', 'wikidata', 'A Wikidata item.'),
  ('gs1_gsrn',      'GS1 Global Service Relation Number', '^[0-9]{18}$', null, null, 'The 18-digit GS1 number used for metering points in many countries.');

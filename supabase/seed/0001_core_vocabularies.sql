-- Nexgen OS — the vocabularies the core publishes.
--
-- Only what is universal lives here: no country, no product, no market rule.
-- Modules and country packs add their own rows with `published_by` set to
-- their code. Every row names the standard terms it corresponds to.

-- ---------------------------------------------------------------------------
-- Device types. The codes of Nexgen, in a tree aligned on Brick and IFC. The
-- module that derives each type into its own table is named.
-- ---------------------------------------------------------------------------

insert into device_types (code, name, parent_code, module_code, brick_class, ifc_class, description) values
  ('generator',  'Generator',          null,        'energy',  'Electrical_Generation_Equipment', 'IfcElectricGenerator', 'Any electricity-producing device.'),
  ('solar',      'PV system',          'generator', 'energy',  'PV_Array',            'IfcSolarDevice',          'Photovoltaic modules and their inverters.'),
  ('wind',       'Wind turbine',       'generator', 'energy',  'Wind_Turbine',        'IfcElectricGenerator',    'A wind turbine.'),
  ('hydro',      'Hydro turbine',      'generator', 'energy',  null,                  'IfcElectricGenerator',    'A hydroelectric turbine.'),
  ('chp',        'Combined heat and power', 'generator', 'energy', null,              'IfcElectricGenerator',    'A cogeneration unit.'),
  ('biomass',    'Biomass plant',      'generator', 'energy',  null,                  'IfcElectricGenerator',    'A biomass boiler or plant.'),
  ('inverter',   'Inverter',           null,        'energy',  'Inverter',            'IfcElectricFlowStorageDevice', 'A power converter between DC and AC.'),
  ('battery',    'Battery',            null,        'energy',  'Battery',             'IfcElectricFlowStorageDevice', 'An electrical energy storage system.'),
  ('ev',         'EV charging station', null,       'energy',  'Electric_Vehicle_Charging_Station', 'IfcElectricAppliance', 'An electric vehicle charging station.'),
  ('heatpump',   'Heat pump',          null,        'heating', 'Heat_Pump',           'IfcUnitaryEquipment',     'A heat pump.'),
  ('boiler',     'Boiler',             null,        'heating', 'Boiler',              'IfcBoiler',               'A boiler.'),
  ('geothermal', 'Geothermal system',  null,        'heating', null,                  'IfcUnitaryEquipment',     'A ground-source heat exchange system.'),
  ('hvac',       'Air handling unit',  null,        'heating', 'AHU',                 'IfcUnitaryEquipment',     'An air handling or ventilation unit.'),
  ('meter',      'Meter',              null,        'grid',    'Meter',               'IfcFlowMeter',            'A physical metering device, on a connection point.'),
  ('sensor_box', 'Sensor box',         null,        'monitoring',     'Sensor',              'IfcSensor',               'A device whose only job is to carry sensors.'),
  ('controller', 'Controller',         null,        'monitoring',     'Controller',          'IfcController',           'A gateway or controller that drives other devices.');

-- ---------------------------------------------------------------------------
-- Profiles: what a building or a site is used for.
-- ---------------------------------------------------------------------------

insert into profiles (code, name, nature, ifc_occupancy, citygml_function, description) values
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
  ('owns',      'owns',           'is owned by',     '{participant}',  null,                 null,          'IfcRelAssignsToActor',    'Ownership, read from the participant (its contact owns the object).'),
  ('occupies',  'occupies',       'is occupied by',  '{participant}',  null,                 null,          'IfcRelOccupiesSpaces',    'Occupation: a tenant, a resident, for a period.'),
  ('operates',  'operates',       'is operated by',  '{participant}',  null,                 null,          'IfcRelAssignsToActor',    'Operation and maintenance responsibility.');

-- ---------------------------------------------------------------------------
-- Quantities, each with the one unit it is stored in (QUDT unit codes).
-- ---------------------------------------------------------------------------

insert into quantities (code, name, unit, aggregation, qudt_quantity_kind) values
  ('energy',              'Energy',                       'KiloW-HR',   'sum',  'Energy'),
  ('energy_import',       'Energy imported from the grid','KiloW-HR',   'sum',  'Energy'),
  ('energy_export',       'Energy exported to the grid',  'KiloW-HR',   'sum',  'Energy'),
  ('power',               'Power',                        'KiloW',      'mean', 'Power'),
  ('temperature',         'Temperature',                  'DEG_C',      'mean', 'Temperature'),
  ('relative_humidity',   'Relative humidity',            'PERCENT',    'mean', 'RelativeHumidity'),
  ('co2_concentration',   'CO2 concentration',            'PPM',        'mean', 'DimensionlessRatio'),
  ('irradiance',          'Irradiance',                   'W-PER-M2',   'mean', 'Irradiance'),
  ('occupancy',           'Occupancy',                    'NUM',        'last', 'Count'),
  ('state_of_charge',     'State of charge',              'PERCENT',    'last', 'DimensionlessRatio'),
  ('volume',              'Volume',                       'M3',         'sum',  'Volume'),
  ('mass_co2e',           'Greenhouse gas emissions',     'KiloGM',     'sum',  'Mass'),
  ('area',                'Area',                         'M2',         'last', 'Area'),
  ('length',              'Length',                       'M',          'last', 'Length'),
  ('thermal_transmittance','Thermal transmittance',       'W-PER-M2-K', 'last', 'ThermalTransmittance'),
  ('ratio',               'Ratio',                        'UNITLESS',   'last', 'DimensionlessRatio');

-- ---------------------------------------------------------------------------
-- Property definitions: attributes beyond the columns (bSDD / IFC property
-- sets where they exist). Kinds refer to objects.kind.
-- ---------------------------------------------------------------------------

insert into property_defs (code, name, datatype, quantity_code, minimum, maximum, allowed_values, applies_to, ifc_pset, ifc_property) values
  ('gross_floor_area',     'Gross floor area',      'number',  'area',   0,    null, null, '{building}',          'Qto_BuildingBaseQuantities', 'GrossFloorArea'),
  ('occupancy_type',       'Occupancy type',        'text',    null,     null, null, null, '{building,site}',     'Pset_BuildingCommon',        'OccupancyType'),
  ('energy_label',         'Energy label',          'text',    null,     null, null, '{A+,A,B,C,D,E,F,G}', '{building}', null,               null),
  ('roof_area',            'Roof area',             'number',  'area',   0,    null, null, '{surface}',           'Qto_RoofBaseQuantities',     'GrossArea'),
  ('thermal_transmittance','Thermal transmittance', 'number',  'thermal_transmittance', 0, null, null, '{surface}', 'Pset_WallCommon',        'ThermalTransmittance'),
  ('is_external',          'Is external',           'boolean', null,     null, null, null, '{surface}',           'Pset_WallCommon',            'IsExternal'),
  ('efficiency',           'Efficiency',            'number',  'ratio',  0,    1,    null, '{device}',            null,                         null),
  ('commissioning_date',   'Commissioning date',    'date',    null,     null, null, null, '{device}',            'Pset_ManufacturerOccurrence', 'AcquisitionDate'),
  ('annual_consumption',   'Annual consumption',    'number',  'energy', 0,    null, null, '{site,building,participant}', null,              null),
  ('subscribed_power',     'Subscribed power',      'number',  'power',  0,    null, null, '{meter}',             null,                         null);

-- ---------------------------------------------------------------------------
-- Tags (Project Haystack markers where one exists).
-- ---------------------------------------------------------------------------

insert into tags (code, name, haystack_tag, description) values
  ('heritage',        'Heritage',            null,     'Protected for its heritage value; changes need a specific authorisation.'),
  ('publicAccess',    'Public access',       null,     'Open to the public.'),
  ('critical',        'Critical',            null,     'Its failure has serious consequences (a hospital wing, a cold room).'),
  ('greenRoof',       'Green roof',          null,     'A vegetated roof.'),
  ('asbestosSuspected','Asbestos suspected', null,     'May contain asbestos; survey before works.'),
  ('elec',            'Electrical',          'elec',   'Concerns electricity.'),
  ('solar',           'Solar',               'solar',  'Concerns solar energy.'),
  ('his',             'Historised',          'his',    'Its values are kept as a history.'),
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
  ('open_meteo',    'Open-Meteo',           'api',  'https://api.open-meteo.com/v1/',       'https://open-meteo.com/en/docs', 'none', 'CC-BY-4.0', '© Open-Meteo', 'Weather history and forecasts, worldwide.');

-- ---------------------------------------------------------------------------
-- Identifier schemes that are global. National ones come with country packs.
-- ---------------------------------------------------------------------------

insert into id_schemes (code, name, pattern, url_template, source_code, description) values
  ('ifc_guid',      'IFC GlobalId',               '^[0-9A-Za-z_$]{22}$', null, null, 'The compressed GUID of an IFC object.'),
  ('osm',           'OpenStreetMap',              '^(node|way|relation)/[0-9]+$', 'https://www.openstreetmap.org/{value}', 'openstreetmap', 'An OpenStreetMap element.'),
  ('overture_gers', 'Overture GERS',              '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$', null, 'overture', 'Global Entity Reference System identifier of Overture Maps.'),
  ('wikidata',      'Wikidata',                   '^Q[0-9]+$', 'https://www.wikidata.org/wiki/{value}', 'wikidata', 'A Wikidata item.'),
  ('gs1_gsrn',      'GS1 Global Service Relation Number', '^[0-9]{18}$', null, null, 'The 18-digit GS1 number used for metering points in many countries.');

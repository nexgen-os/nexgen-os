-- Nexgen OS — the vocabularies the core publishes.
--
-- Only what is universal lives here: no country, no product, no market rule.
-- Modules and country packs add their own rows with `published_by` set to
-- their code. Every class names the standard terms it corresponds to.

-- ---------------------------------------------------------------------------
-- Classes. Six roots, as in Brick plus the agents and collections of IFC and
-- NGSI-LD: location, element, equipment, point, agent, collection.
-- ---------------------------------------------------------------------------

insert into classes (code, name, parent_code, allowed_parents, brick_class, ifc_class, citygml_class, description) values
  ('location',   'Location',   null, '{}', 'Location',   'IfcSpatialElement', null, 'Somewhere: a district, a site, a building, a storey, a room, a zone.'),
  ('element',    'Building or landscape element', null, '{location,element}', null, 'IfcElement', null, 'A physical part of a place: a roof face, a wall, a slab, a window, a tree.'),
  ('equipment',  'Equipment',  null, '{location,element,equipment}', 'Equipment', 'IfcDistributionElement', null, 'A device or system: a PV array, an inverter, a battery, a charger, a heat pump, a meter.'),
  ('point',      'Point',      null, '{location,element,equipment}', 'Point', 'IfcSensor', null, 'A source or target of values over time: a sensor, a setpoint, a command, a meter channel.'),
  ('agent',      'Agent',      null, '{"",agent}', null, 'IfcActor', null, 'A party: an organisation or a person.'),
  ('collection', 'Collection', null, '{"",collection}', 'Collection', 'IfcGroup', null, 'A grouping that is not a place: a portfolio, an energy community, a programme.');

insert into classes (code, name, parent_code, allowed_parents, brick_class, ifc_class, citygml_class, description) values
  ('district',      'District',      'location', '{""}',                          'Region',   'IfcSite',            'CityObjectGroup', 'A neighbourhood, an industrial zone, a campus.'),
  ('site',          'Site',          'location', '{"",district}',                 'Site',     'IfcSite',            null,               'A coherent property: a farm, a factory site, a school campus.'),
  ('parcel',        'Parcel',        'location', '{"",district,site}',            'Site',     'IfcSite',            'LandUse',          'A cadastral parcel.'),
  ('building',      'Building',      'location', '{"",district,site,parcel}',     'Building', 'IfcBuilding',        'Building',         'A building.'),
  ('building_part', 'Building part', 'location', '{building}',                    'Building', 'IfcBuilding',        'BuildingPart',     'A wing or a part of a building with its own height or roof.'),
  ('storey',        'Storey',        'location', '{building,building_part}',      'Floor',    'IfcBuildingStorey',  'Storey',           'A level of a building.'),
  ('space',         'Space',         'location', '{storey,building,building_part}','Space',   'IfcSpace',           'BuildingRoom',     'A room or a unit: an office, a flat, a shop.'),
  ('zone',          'Zone',          'location', '{building,building_part,storey,site}', 'Zone', 'IfcZone',         null,               'A grouping of spaces sharing a purpose: a thermal zone, a tenant lot, a fire compartment.'),
  ('outdoor_area',  'Outdoor area',  'location', '{site,parcel,district}',        'Outdoor_Area', 'IfcSite',        'LandUse',          'A car park, a field, a courtyard.'),
  ('connection_point','Grid connection point','location', '{site,parcel,building,building_part,storey,space,outdoor_area}', null, null, null, 'Where a place is connected to a network: the point a supplier, a tariff and a sharing key attach to. Its meters are devices that can be swapped.'),
  ('infrastructure','Infrastructure','location', '{"",district,site,parcel}',     null,       'IfcFacility',        'CityFurniture',    'A built facility that is not a building: a canopy structure, a bridge, a road.');

insert into classes (code, name, parent_code, allowed_parents, brick_class, ifc_class, citygml_class, description) values
  ('roof',       'Roof face',    'element', '{building,building_part,infrastructure}', 'Roof', 'IfcRoof',     'RoofSurface',   'One planar face of a roof, with its azimuth and tilt.'),
  ('wall',       'Wall',         'element', '{building,building_part,storey,space}',   'Wall', 'IfcWall',     'WallSurface',   'A wall or a facade face.'),
  ('slab',       'Slab',         'element', '{building,building_part,storey}',         null,   'IfcSlab',     'FloorSurface',  'A floor or ground slab.'),
  ('opening',    'Window or door','element','{wall,roof}',                             'Window','IfcWindow',  'Window',        'A window, a door, a skylight in a wall or a roof.'),
  ('ground',     'Ground surface','element','{site,parcel,outdoor_area,district}',     null,   'IfcGeographicElement', 'LandUse', 'A ground surface: a field, a car park surface, a terrain patch.'),
  ('vegetation', 'Vegetation',   'element', '{site,parcel,outdoor_area,district}',     null,   'IfcGeographicElement', 'SolitaryVegetationObject', 'A tree, a hedge, a planted area.');

insert into classes (code, name, parent_code, allowed_parents, brick_class, ifc_class, citygml_class, description) values
  ('generator',     'Generator',            'equipment', '{}', 'Electrical_Generation_Equipment', 'IfcElectricGenerator', null, 'Any electricity-producing equipment.'),
  ('pv_array',      'PV array',             'generator', '{}', 'PV_Array',            'IfcSolarDevice',          null, 'Photovoltaic modules sharing one orientation.'),
  ('wind_turbine',  'Wind turbine',         'generator', '{}', 'Wind_Turbine',        'IfcElectricGenerator',    null, 'A wind turbine.'),
  ('inverter',      'Inverter',             'equipment', '{}', 'Inverter',            'IfcElectricFlowStorageDevice', null, 'A power converter between DC and AC.'),
  ('battery',       'Battery',              'equipment', '{}', 'Battery',             'IfcElectricFlowStorageDevice', null, 'An electrical energy storage system.'),
  ('ev_charger',    'EV charger',           'equipment', '{}', 'Electric_Vehicle_Charging_Station', 'IfcElectricAppliance', null, 'An electric vehicle charging station.'),
  ('heat_pump',     'Heat pump',            'equipment', '{}', 'Heat_Pump',           'IfcUnitaryEquipment',     null, 'A heat pump.'),
  ('boiler',        'Boiler',               'equipment', '{}', 'Boiler',              'IfcBoiler',               null, 'A boiler.'),
  ('hvac_unit',     'Air handling unit',    'equipment', '{}', 'AHU',                 'IfcUnitaryEquipment',     null, 'An air handling or ventilation unit.'),
  ('meter',         'Meter',                'equipment', '{}', 'Meter',               'IfcFlowMeter',            null, 'A metering device.'),
  ('electricity_meter','Electricity meter', 'meter',     '{}', 'Electrical_Meter',    'IfcFlowMeter',            null, 'An electricity meter.'),
  ('gas_meter',     'Gas meter',            'meter',     '{}', 'Gas_Meter',           'IfcFlowMeter',            null, 'A gas meter.'),
  ('heat_meter',    'Heat meter',           'meter',     '{}', 'Thermal_Energy_Meter','IfcFlowMeter',            null, 'A heat meter.'),
  ('water_meter',   'Water meter',          'meter',     '{}', 'Water_Meter',         'IfcFlowMeter',            null, 'A water meter.');

insert into classes (code, name, parent_code, allowed_parents, brick_class, ifc_class, citygml_class, description) values
  ('sensor',        'Sensor',               'point', '{}', 'Sensor',   'IfcSensor',   null, 'Measures something.'),
  ('setpoint',      'Setpoint',             'point', '{}', 'Setpoint', 'IfcController', null, 'A target value asked of a device.'),
  ('command',       'Command',              'point', '{}', 'Command',  'IfcActuator', null, 'An order sent to a device.'),
  ('organisation',  'Organisation',         'agent', '{}', null,       'IfcOrganization', null, 'A company, a public body, an association.'),
  ('person',        'Person',               'agent', '{}', null,       'IfcPerson',   null, 'A natural person. Hold only what the purpose requires.'),
  ('portfolio',     'Portfolio',            'collection', '{}', 'Collection', 'IfcGroup', null, 'A set of places managed together.'),
  ('energy_community','Energy community',   'collection', '{}', 'Collection', 'IfcGroup', null, 'Participants sharing energy under a set of rules.');

-- ---------------------------------------------------------------------------
-- Relation types.
-- ---------------------------------------------------------------------------

insert into relation_types (code, name, inverse_name, subject_class, object_class, brick_relation, ifc_relation, description) values
  ('feeds',        'feeds',          'is fed by',        'equipment', null,        'feeds',        'IfcRelConnectsPorts',       'Energy or a medium flows from the subject to the object.'),
  ('monitors',     'monitors',       'is monitored by',  'point',     null,        'isPointOf',    'IfcRelAssignsToControl',    'The point measures or controls the object.'),
  ('meters',       'meters',         'is metered by',    'meter',     null,        'meters',       null,                        'The meter measures what the object consumes or produces.'),
  ('mounted_on',   'is mounted on',  'carries',          'equipment', 'element',   'hasLocation',  'IfcRelConnectsElements',    'The equipment is installed on the element (an array on a roof face).'),
  ('serves',       'serves',         'is served by',     null,        'location',  'feeds',        'IfcRelServicesBuildings',   'The subject serves the place (a heat pump serves a zone).'),
  ('shades',       'shades',         'is shaded by',     null,        null,        null,           null,                        'The subject casts shade on the object.'),
  ('adjacent_to',  'is adjacent to', 'is adjacent to',   'location',  'location',  null,           'IfcRelSpaceBoundary',       'The two places share a boundary.'),
  ('owns',         'owns',           'is owned by',      'agent',     null,        null,           'IfcRelAssignsToActor',      'Ownership.'),
  ('occupies',     'occupies',       'is occupied by',   'agent',     'location',  null,           'IfcRelOccupiesSpaces',      'Occupation: a tenant, a resident.'),
  ('operates',     'operates',       'is operated by',   'agent',     null,        null,           'IfcRelAssignsToActor',      'Operation and maintenance responsibility.'),
  ('member_of',    'is member of',   'has member',       null,        'collection','isPartOf',     'IfcRelAssignsToGroup',      'Membership of a collection (a site in a portfolio, a participant in a community).');

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
  ('state_of_charge',     'State of charge',              'PERCENT',    'last', 'DimensionlessRatio'),
  ('volume',              'Volume',                       'M3',         'sum',  'Volume'),
  ('mass_co2e',           'Greenhouse gas emissions',     'KiloGM',     'sum',  'Mass'),
  ('area',                'Area',                         'M2',         'last', 'Area'),
  ('length',              'Length',                       'M',          'last', 'Length'),
  ('thermal_transmittance','Thermal transmittance',       'W-PER-M2-K', 'last', 'ThermalTransmittance'),
  ('ratio',               'Ratio',                        'UNITLESS',   'last', 'DimensionlessRatio');

-- ---------------------------------------------------------------------------
-- Property definitions (bSDD / IFC property sets where they exist).
-- ---------------------------------------------------------------------------

insert into property_defs (code, name, datatype, quantity_code, minimum, maximum, applies_to, ifc_pset, ifc_property) values
  ('gross_floor_area',     'Gross floor area',      'number',  'area',   0,    null, 'location',  'Qto_BuildingBaseQuantities', 'GrossFloorArea'),
  ('year_of_construction', 'Year of construction',  'integer', null,     1000, 2200, 'location',  'Pset_BuildingCommon',        'YearOfConstruction'),
  ('number_of_storeys',    'Number of storeys',     'integer', null,     0,    300,  'location',  'Pset_BuildingCommon',        'NumberOfStoreys'),
  ('occupancy_type',       'Occupancy type',        'text',    null,     null, null, 'location',  'Pset_BuildingCommon',        'OccupancyType'),
  ('roof_area',            'Roof area',             'number',  'area',   0,    null, 'element',   'Qto_RoofBaseQuantities',     'GrossArea'),
  ('thermal_transmittance','Thermal transmittance', 'number',  'thermal_transmittance', 0, null, 'element', 'Pset_WallCommon', 'ThermalTransmittance'),
  ('is_external',          'Is external',           'boolean', null,     null, null, 'element',   'Pset_WallCommon',            'IsExternal'),
  ('rated_power',          'Rated power',           'number',  'power',  0,    null, 'equipment', 'Pset_ElectricGeneratorTypeCommon', 'MaximumPowerOutput'),
  ('peak_power',           'Peak power',            'number',  'power',  0,    null, 'generator', 'Pset_SolarDeviceTypeCommon', 'NominalPower'),
  ('energy_capacity',      'Energy capacity',       'number',  'energy', 0,    null, 'battery',   'Pset_ElectricFlowStorageDeviceTypeCommon', 'NominalSupplyCurrent'),
  ('efficiency',           'Efficiency',            'number',  'ratio',  0,    1,    'equipment', null,                         null),
  ('manufacturer',         'Manufacturer',          'text',    null,     null, null, null,        'Pset_ManufacturerTypeInformation', 'Manufacturer'),
  ('model_reference',      'Model reference',       'text',    null,     null, null, null,        'Pset_ManufacturerTypeInformation', 'ModelReference'),
  ('commissioning_date',   'Commissioning date',    'date',    null,     null, null, 'equipment', 'Pset_ManufacturerOccurrence', 'AcquisitionDate'),
  ('annual_consumption',   'Annual consumption',    'number',  'energy', 0,    null, null,        null,                         null);

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
-- Identifier schemes that are global. National ones come with country packs.
-- ---------------------------------------------------------------------------

insert into id_schemes (code, name, pattern, url_template, description) values
  ('ifc_guid',      'IFC GlobalId',               '^[0-9A-Za-z_$]{22}$', null, 'The compressed GUID of an IFC object.'),
  ('osm',           'OpenStreetMap',              '^(node|way|relation)/[0-9]+$', 'https://www.openstreetmap.org/{value}', 'An OpenStreetMap element.'),
  ('overture_gers', 'Overture GERS',              '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$', null, 'Global Entity Reference System identifier of Overture Maps.'),
  ('wikidata',      'Wikidata',                   '^Q[0-9]+$', 'https://www.wikidata.org/wiki/{value}', 'A Wikidata item.'),
  ('gs1_gsrn',      'GS1 Global Service Relation Number', '^[0-9]{18}$', null, 'The 18-digit GS1 number used for metering points in many countries.');

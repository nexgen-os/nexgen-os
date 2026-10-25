-- Nexgen OS — the vocabularies the core publishes.
--
-- Only what is universal lives here: no country, no product, no market rule.
-- Modules and country packs add their own rows with `published_by` set to
-- their code. Every row names the standard terms it corresponds to.

set search_path = nexgen, extensions;

-- ---------------------------------------------------------------------------
-- Device types. The codes of the trades, in a tree aligned on Brick Equipment
-- and IFC. The module that derives a type into its own table is named when it
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
  ('parking_canopy', 'PV parking canopy', 'solar',   'solar', 'PV_Array',            'IfcSolarDevice',          'A PV system on a canopy over parking spaces, its structure part of it.'),
  ('hydrogen',   'Hydrogen system',    null,        null,  null,                  null,                      'An electrolyser, a hydrogen store or a fuel cell.'),
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
  -- What happens behind the meter of a place that produces and stores:
  -- the energy produced and consumed on the spot, the energy put into a
  -- battery and the energy taken out of it, each positive (decision 0030).
  -- The rest is derived, never stored twice: the surplus is
  -- production_energy − self_consumption_energy − battery_charge_energy
  -- (what is injected, injection_energy, when the meter sees only that
  -- place), the residual consumption is consumption_energy −
  -- self_consumption_energy − battery_discharge_energy (what is taken,
  -- offtake_energy).
  ('self_consumption_energy',  'Energy self-consumed',     'KiloW-HR',   'sum',  'Energy'),
  ('battery_charge_energy',    'Energy charged into a battery',   'KiloW-HR', 'sum', 'Energy'),
  ('battery_discharge_energy', 'Energy discharged from a battery','KiloW-HR', 'sum', 'Energy'),
  ('power',               'Power',                        'KiloW',      'mean', 'Power'),
  ('production_power',    'Power produced',               'KiloW',      'mean', 'Power'),
  ('consumption_power',   'Power consumed',               'KiloW',      'mean', 'Power'),
  -- What a supply contract subscribes where the network counts volt-amperes:
  -- apparent power, which converts to active power only by a power factor.
  ('apparent_power',      'Apparent power',               'KiloV-A',    'mean', 'ApparentPower'),
  -- What a meter measures at the connection point, as its operator's hub
  -- publishes it: the mean active power over a step in each direction, the
  -- reactive power and energy in each quadrant pair (inductive, taken with
  -- a lagging current; capacitive, with a leading one: IEC 62053-23) and
  -- the voltage. A load curve stored as power keeps the hub's own quantity;
  -- its energy is the power times the step, derived on read.
  ('offtake_power',       'Power taken from the grid',    'KiloW',      'mean', 'Power'),
  ('injection_power',     'Power injected into the grid', 'KiloW',      'mean', 'Power'),
  ('reactive_power_inductive',   'Reactive power, inductive',   'KiloV-A_Reactive',    'mean', 'ReactivePower'),
  ('reactive_power_capacitive',  'Reactive power, capacitive',  'KiloV-A_Reactive',    'mean', 'ReactivePower'),
  ('reactive_energy_inductive',  'Reactive energy, inductive',  'KiloV-A_Reactive-HR', 'sum',  'ReactiveEnergy'),
  ('reactive_energy_capacitive', 'Reactive energy, capacitive', 'KiloV-A_Reactive-HR', 'sum',  'ReactiveEnergy'),
  ('voltage',             'Voltage',                      'V',          'mean', 'Voltage'),
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
  ('specific_yield',      'Specific yield',               'KiloW-HR-PER-KiloW',  'last', null),
  -- Prices, kept in a currency: the unit is the currency pattern of the
  -- units below (XXX, ISO 4217 "no currency"), and a value is stored in
  -- the copy of it in its currency — the country's of its object, or the
  -- one a series names (quantity_unit()). An energy price per MWh, a
  -- power price per kW and per year (a capacity charge), a fixed price
  -- per month (a subscription); and an amount of money, a sum in the
  -- currency (a saving, a value of energy), never added across currencies.
  ('energy_price',        'Price of energy',              'XXX-PER-MegaW-HR',    'mean', null),
  ('power_price',         'Price of power',               'XXX-PER-KiloW-YR',    'mean', null),
  ('fixed_price',         'Fixed price',                  'XXX-PER-MO',          'mean', null),
  ('amount',              'Amount of money',              'XXX',                 'sum',  null);

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
  ('V-A',                 'Volt ampere',                   'VA',       'ApparentPower',        1, 0),
  ('KiloV-A',             'Kilovolt ampere',               'kVA',      'ApparentPower',        1e3, 0),
  ('V-A_Reactive',        'Volt ampere reactive',          'var',      'ReactivePower',        1, 0),
  ('KiloV-A_Reactive',    'Kilovolt ampere reactive',      'kvar',     'ReactivePower',        1e3, 0),
  ('V-A_Reactive-HR',     'Volt ampere reactive hour',     'varh',     'ReactiveEnergy',       3600, 0),
  ('KiloV-A_Reactive-HR', 'Kilovolt ampere reactive hour', 'kvarh',    'ReactiveEnergy',       3.6e6, 0),
  ('V',                   'Volt',                          'V',        'Voltage',              1, 0),
  ('KiloV',               'Kilovolt',                      'kV',       'Voltage',              1e3, 0),
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
  ('DAY',                 'Day',                           'd',        'Time',                 86400, 0),
  -- QUDT's month and year: a twelfth of a Julian year, a Julian year.
  ('MO',                  'Month',                         'mo',       'Time',                 2629800, 0),
  ('YR',                  'Year',                          'a',        'Time',                 31557600, 0),
  ('KiloW-HR-PER-KiloW',  'Kilowatt hour per kilowatt',    'kWh/kW',   'Time',                 3600, 0);

-- Currencies: ISO 4217, the list Ekwo OS seeds, row for row — the code and
-- the decimals of ISO 4217 list one as SIX Financial Information publishes
-- it on behalf of the maintenance agency (edition of 17 September 2026) —
-- so that a database holding both cores holds one list
-- (docs/with-ekwo-os.md); and XXX, ISO 4217's "no currency", the pattern
-- the units of a price are written in once. A pack adds the currency of its
-- country when the list does not hold it.
insert into currencies (code, name, symbol, decimal_places) values
  ('EUR', 'Euro',                 E'€', 2),
  ('USD', 'US dollar',            '$',       2),
  ('GBP', 'Pound sterling',       E'£', 2),
  ('CHF', 'Swiss franc',          'CHF',     2),
  ('SEK', 'Swedish krona',        'kr',      2),
  ('DKK', 'Danish krone',         'kr',      2),
  ('NOK', 'Norwegian krone',      'kr',      2),
  ('PLN', 'Polish zloty',         E'z\u0142', 2),
  ('CZK', 'Czech koruna',         E'Kč', 2),
  ('RON', 'Romanian leu',         'lei',     2),
  ('CAD', 'Canadian dollar',      '$',       2),
  ('JPY', 'Japanese yen',         E'¥', 0),
  ('XOF', 'CFA franc BCEAO',      'F CFA',   0),
  ('MXN', 'Mexican peso',         '$',       2),
  ('COP', 'Colombian peso',       '$',       2),
  ('XAF', 'CFA franc BEAC',       'F CFA',   0),
  ('KMF', 'Comorian franc',       'CF',      0),
  ('GNF', 'Guinean franc',        'FG',      0),
  ('CDF', 'Congolese franc',      'FC',      2),
  ('AUD', 'Australian dollar',    '$',       2),
  ('SGD', 'Singapore dollar',     '$',       2),
  ('NZD', 'New Zealand dollar',   '$',       2),
  ('HKD', 'Hong Kong dollar',     E'HK$',    2),
  ('TWD', 'New Taiwan dollar',    E'NT$',    2),
  ('KRW', 'South Korean won',     E'₩',      0),
  ('AED', 'UAE dirham',           E'د.إ', 2),
  ('THB', 'Thai baht',            E'฿', 2),
  ('VND', 'Vietnamese dong',      E'₫', 0),
  ('SAR', 'Saudi riyal',          E'ر.س', 2),
  ('HUF', 'Hungarian forint',     'Ft',      2),
  ('ISK', 'Icelandic krona',      'kr',      0),
  ('TRY', 'Turkish lira',         E'₺', 2),
  ('EGP', 'Egyptian pound',       E'ج.م', 2),
  ('TND', 'Tunisian dinar',       E'د.ت', 3),
  ('DZD', 'Algerian dinar',       E'د.ج', 2),
  ('MAD', 'Moroccan dirham',      E'د.م.', 2),
  ('ZAR', 'South African rand',   'R',       2),
  ('KES', 'Kenyan shilling',      E'KSh',    2),
  ('IDR', 'Indonesian rupiah',    'Rp',      0),
  ('MYR', 'Malaysian ringgit',    'RM',      2),
  ('ILS', 'Israeli new shekel',   E'₪', 2),
  ('PHP', 'Philippine peso',      E'₱', 2),
  ('ARS', 'Argentine peso',       '$',       2),
  ('NGN', 'Nigerian naira',       E'₦', 2),
  ('CLP', 'Chilean peso',         '$',       0),
  ('PEN', 'Peruvian sol',         'S/',      2),
  ('UAH', 'Ukrainian hryvnia',    E'₴', 2),
  ('UYU', 'Uruguayan peso',       E'$U', 2),
  ('BOB', 'Bolivian boliviano',   'Bs',      2),
  ('PYG', 'Paraguayan guaraní',   E'₲', 0),
  ('CNY', 'Chinese yuan',         E'¥', 2),
  ('DOP', 'Dominican peso',       'RD$',     2),
  ('INR', 'Indian rupee',         E'₹', 2),
  ('GTQ', 'Guatemalan quetzal',   'Q',       2),
  ('CRC', 'Costa Rican colón',    E'₡', 2),
  ('GEL', 'Georgian lari',        E'₾', 2),
  ('MDL', 'Moldovan leu',         'L',       2),
  ('BAM', 'Convertible mark',     'KM',      2),
  ('RSD', 'Serbian dinar',        E'дин.', 2),
  ('MKD', 'Macedonian denar',     E'ден.', 2),
  ('ALL', 'Albanian lek',         'L',       2),
  ('GHS', 'Ghanaian cedi',        E'GH₵', 2),
  ('TZS', 'Tanzanian shilling',   'TSh',     2),
  ('BHD', 'Bahraini dinar',       E'.د.ب', 3),
  ('OMR', 'Omani rial',           E'ر.ع.', 3),
  ('UGX', 'Uganda shilling',      'USh',     0),
  ('RWF', 'Rwandan franc',        E'FRw', 0),
  ('KZT', 'Kazakhstani tenge',    E'₸', 2),
  ('PKR', 'Pakistani rupee', E'₨', 2),
  ('BDT', 'Bangladeshi taka', E'৳', 2),
  ('LKR', 'Sri Lankan rupee', E'Rs', 2),
  ('AMD', 'Armenian dram',        E'֏', 2),
  ('AZN', 'Azerbaijani manat',    E'₼', 2),
  ('HNL', 'Honduran lempira', 'L', 2),
  ('NIO', 'Nicaraguan córdoba', 'C$', 2),
  ('ETB', 'Ethiopian birr', 'Br', 2),
  ('MUR', 'Mauritian rupee', 'Rs', 2),
  ('MZN', 'Mozambican metical', 'MT', 2),
  ('AOA', 'Angolan kwanza', 'Kz', 2),
  ('ZMW', 'Zambian kwacha', 'K', 2),
  ('BMD', 'Bermudian dollar', '$', 2),
  ('KYD', 'Cayman Islands dollar', 'CI$', 2),
  ('QAR', 'Qatari riyal', 'QR', 2),
  ('KWD', 'Kuwaiti dinar', E'د.ك', 3),
  ('BND', 'Brunei dollar', 'B$', 2),
  ('MOP', 'Macanese pataca', E'MOP$', 2),
  ('ZWG', 'Zimbabwe Gold', 'ZiG', 2),
  ('XCD', 'East Caribbean dollar', 'EC$', 2),
  ('BSD', 'Bahamian dollar', 'B$', 2),
  ('GYD', 'Guyanese dollar', 'G$', 2),
  ('JMD', 'Jamaican dollar', 'J$', 2),
  ('XXX', 'No currency',          E'¤',      0)
on conflict (code) do nothing;

-- The units of a price, written once in XXX (ISO 4217 "no currency") as
-- the pattern of every currency: currency_units() copies them for each
-- currency a country declares (EUR, EUR-PER-MegaW-HR, EUR/MWh). The factor
-- brings one currency unit per MWh, per kW and year, per month, to one per
-- joule, per watt and second, per second: a price per kWh converts to one
-- per MWh, a fee per year to one per month, and never to another currency.
insert into units (code, name, symbol, quantity_kind, factor, "offset", currency) values
  ('XXX',                 'Currency',                            '¤',          'Amount',      1,          0, 'XXX'),
  ('XXX-PER-W-HR',        'Currency per watt hour',              '¤/Wh',       'EnergyPrice', 1 / 3600.0, 0, 'XXX'),
  ('XXX-PER-KiloW-HR',    'Currency per kilowatt hour',          '¤/kWh',      'EnergyPrice', 1 / 3.6e6,  0, 'XXX'),
  ('XXX-PER-MegaW-HR',    'Currency per megawatt hour',          '¤/MWh',      'EnergyPrice', 1 / 3.6e9,  0, 'XXX'),
  ('XXX-PER-KiloW-YR',    'Currency per kilowatt per year',      '¤/(kW·a)',   'PowerPrice',  1 / (1e3 * 31557600), 0, 'XXX'),
  ('XXX-PER-KiloW-MO',    'Currency per kilowatt per month',     '¤/(kW·mo)',  'PowerPrice',  1 / (1e3 * 2629800),  0, 'XXX'),
  ('XXX-PER-DAY',         'Currency per day',                    '¤/d',        'FixedPrice',  1 / 86400.0,    0, 'XXX'),
  ('XXX-PER-MO',          'Currency per month',                  '¤/mo',       'FixedPrice',  1 / 2629800.0,  0, 'XXX'),
  ('XXX-PER-YR',          'Currency per year',                   '¤/a',        'FixedPrice',  1 / 31557600.0, 0, 'XXX');

-- ---------------------------------------------------------------------------
-- Attribute types: attributes of the objects of the core beyond their
-- columns. A fact a column holds is never repeated here: a device's power
-- is its `rated_power_kw`, its commissioning its `installation_date`.
-- ---------------------------------------------------------------------------

insert into attribute_types (code, name, datatype, quantity_code, minimum, maximum, allowed_values, applies_to) values
  ('efficiency',           'Efficiency',            'number',  'ratio',  0,    1,    null, '{device}'),
  ('annual_consumption',   'Annual consumption',    'number',  'energy', 0,    null, null, '{participant}'),
  -- The sum over a participant or a project; a device's own is its rated power.
  ('installed_power',      'Installed power',       'number',  'power',  0,    null, null, '{project,participant}'),
  -- What the contract of a connection point allows it to take.
  ('subscribed_power',     'Subscribed power',      'number',  'power',  0,    null, null, '{meter}'),
  -- The same, where the contract subscribes apparent power (kVA).
  ('subscribed_apparent_power', 'Subscribed apparent power', 'number', 'apparent_power', 0, null, null, '{meter}'),
  -- How the supply contract prices energy over time, as its bill prints it.
  ('supply_contract_type', 'Supply contract type',  'text',    null,     null, null, '{fixed,variable,indexed}', '{participant,meter}');

-- What a participant's supply contract costs, as its bill reads it
-- (`@nexgen-os/energy-bill`): one energy price, and the grid of prices by
-- time-of-use band and season it was read from, in the currency of the bill.
-- What the account of a participant writes itself (attribute_types.written_with,
-- decision 0052): how to reach it and how it wants to be notified.
insert into attribute_types (code, name, datatype, applies_to, written_with, description) values
  ('contact_email',         'Contact email',         'text', '{participant}', 'account.contact',
   'The address the end customer a participant is wants to be written to.'),
  ('contact_phone',         'Contact phone',         'text', '{participant}', 'account.contact',
   'The telephone number of the end customer a participant is, in E.164 form.'),
  ('notification_channels', 'Notification channels', 'json', '{participant}', 'account.notifications',
   'How the end customer a participant is wants to be notified, by subject: {"<subject>": ["email", "sms", "push"]}, an empty list for none. The subjects are the application''s (a bill, a reading, a recommendation).');

-- How sure a source is that an equipment it recognised behind a meter is
-- there (the consumption module's recognise_device()).
insert into attribute_types (code, name, datatype, quantity_code, minimum, maximum, applies_to, description) values
  ('recognition_confidence', 'Recognition confidence', 'number', 'ratio', 0, 1, '{device}',
   'How sure the source that recognised a device from the readings of a meter (disaggregation) is that it is there, 0 to 1.');

insert into attribute_types (code, name, datatype, quantity_code, minimum, maximum, applies_to, description) values
  ('supply_energy_price', 'Energy price of the supply contract', 'number', 'energy_price', 0, null, '{participant,meter}', 'Per MWh in the currency of the country: what a kWh of energy costs under the contract, every component of the energy added up, each band at the price the contract projects, weighted by the energy of the bill; without network delivery when the bill bills it apart, without taxes. Read as the offtake price of a participant (the energy price of a saving).'),
  ('supply_tariff',       'Tariff of the supply contract',       'json',   null,           null, null, '{participant,meter}', 'The prices of the supply contract by time-of-use band and season, as its bill reads them: {currency, unit, projection, bands: [{band, season, billed, latest}], network, taxes, contributions, subscription, invoice}; band and season codes are those of the pack of the country.');

-- The values a country or a region decides, published as `defaults` rows by
-- its pack and read through parameter_of(); an organisation or an object
-- that knows better holds the same attribute type as an attribute. A price is an
-- energy_price, kept in the currency of the country (countries.currency):
-- a pack writes it in that currency's unit (EUR-PER-MegaW-HR).
insert into attribute_types (code, name, datatype, quantity_code, minimum, maximum, description) values
  ('metering_step',               'Metering step',                          'text',   null,              null, null, 'The interval of the readings a grid operator publishes, as an ISO 8601 duration (PT15M).'),
  ('bidding_zone',                'Bidding zone',                           'text',   null,              null, null, 'The bidding zone of the wholesale electricity market, by its EIC code: a pack''s default for a country, a region or a municipality, resolved for a meter or a project from its place; an attribute of a market series (a price, a carbon intensity) naming the zone it holds for.'),
  ('control_area',                'Control area',                           'text',   null,              null, null, 'The control area a transmission operator balances, by its EIC code.'),
  ('imbalance_settlement_period', 'Imbalance settlement period',            'text',   null,              null, null, 'The period imbalances of a balance responsible party are settled over, as an ISO 8601 duration (PT15M).'),
  ('grid_co2_factor',             'Emission factor of grid electricity',    'number', 'emission_factor', 0,    null, 'Greenhouse gas emitted per kWh taken from the grid, from the transmission operator''s yearly balance.'),
  ('market_co2_factor',           'Emission factor of electricity bought',  'number', 'emission_factor', 0,    null, 'Greenhouse gas per kWh of the electricity a contract supplies, for the market-based method of scope 2: the supplier''s disclosed mix as an attribute of the meter or the participant over the contract''s period; the residual mix of the country (what is left once guarantees of origin are cancelled) as its pack''s default.'),
  ('pv_specific_yield_fallback',  'Specific yield of PV, fallback',         'number', 'specific_yield',  0,    null, 'The mean yearly energy of one kWp, used only where no yield estimate exists, and marked as a fallback.'),
  ('vat_rate_electricity',        'Value added tax on electricity',         'number', 'ratio',           0,    1,    'The rate applied to a household electricity bill, as a ratio, kept for simulation: an invoice takes the tax that vat_code_electricity names from the invoicing side.'),
  ('vat_code_electricity',        'Value added tax on electricity, code',   'text',   null,              null, null, 'The code of the tax vat_rate_electricity mirrors on the invoicing side (the code of a tax of an Ekwo OS country pack, its taxes.json), valid over the same period and for the same condition: the billing module takes the tax of an invoice by this code, never by the rate.'),
  ('energy_price_household',      'Energy price, households',               'number', 'energy_price',              0,    null, 'In the currency of the country per MWh, without grid fees and taxes, from a public statistic.'),
  ('energy_price_business',       'Energy price, businesses',               'number', 'energy_price',              0,    null, 'In the currency of the country per MWh, without grid fees and taxes, from a public statistic.'),
  ('grid_fees_and_taxes',         'Grid fees and taxes',                    'number', 'energy_price',              0,    null, 'In the currency of the country per MWh taken from the grid.'),
  ('injection_price_reference',   'Reference price of injected energy',     'number', 'energy_price',              0,    null, 'In the currency of the country per MWh injected into the grid.'),
  ('offpeak_hours',               'Off-peak hours',                         'json',   null,              null, null, 'The windows of off-peak hours, as a list of [start, end) local times; null where it depends on the supply contract.'),
  ('sharing_max_distance_m',      'Energy sharing, maximum distance',       'number', 'length',          0,    null, 'The greatest distance between two participants of an energy sharing operation.'),
  ('sharing_max_power_kw',        'Energy sharing, maximum power',          'number', 'power',           0,    null, 'The greatest installed power of an energy sharing operation.'),
  ('sharing_settlement_period',   'Energy sharing, settlement period',      'text',   null,              null, null, 'The period energy is shared over, as an ISO 8601 duration.'),
  ('sharing_perimeter',           'Energy sharing, perimeter rule',         'json',   null,              null, null, 'The criteria of proximity the participants of an energy sharing operation meet, any one of them sufficing, as a list of: max_distance_between_members (sharing_max_distance_m), radius_around_producer (sharing_radius_m), same_municipality, same_substation, same_region.'),
  ('sharing_radius_m',            'Energy sharing, radius around a producer', 'number', 'length',        0,    null, 'The greatest distance between a participant of an energy sharing operation and the producer nearest to it.'),
  ('sharing_municipality_extension_m', 'Energy sharing, extension to an adjacent municipality', 'number', 'length', 0, null, 'Under a same-municipality perimeter, the distance from the limit of its municipality within which a producer (of a technology) extends the perimeter to the adjacent municipality.'),
  ('pv_power_per_area',           'PV power per area',                      'number', null,              0,    null, 'The peak power of PV modules laid on one square metre of a surface, in kWp/m²: what a roof of a known area can carry.'),
  ('sharing_consent_required',    'Energy sharing, consent required',       'boolean', null,             null, null, 'Whether a participant takes part in a settlement of energy sharing only with a valid consent to sharing its metering data.'),
  ('voltage_levels',              'Voltage levels',                         'json',   null,              null, null, 'The voltage levels of the grid, a list of {code, name, min_kv, max_kv} in kilovolts, a level holding the voltages above min_kv up to max_kv.'),
  ('connection_max_power_lv',     'Maximum power of a low voltage connection',    'number', 'power', 0, null, 'Above it, a connection is made at medium voltage.'),
  ('electricity_excise',          'Excise on electricity',                  'number', 'energy_price',    0,    null, 'The excise duty per MWh of electricity consumed, which a country often sets by customer segment.'),
  ('density_class',               'Density class of a municipality',        'text',   null,              null, null, 'The class of the municipality in its country''s statistical density grid, as its pack names it; a default of a municipality, and a condition of the defaults that depend on it (a sharing perimeter).');

-- What a battery is when neither the device nor its product says it: the
-- core's, beside its device type `battery` and its quantities, so that a
-- pack publishes them without the module that dispatches the battery.
insert into attribute_types (code, name, description, datatype, quantity_code, minimum, maximum, applies_to) values
  ('battery_c_rate', 'C-rate of a battery',
   'The power of a battery as a fraction of its usable capacity per hour (0.5: a 10 kWh battery charges and discharges at 5 kW), read when neither the device nor its product gives its power.',
   'number', null, 0, null, '{device,participant,project,organisation}'),
  ('round_trip_efficiency', 'Round-trip efficiency',
   'The share of the energy charged into a storage that comes back out of it, 0 to 1.',
   'number', 'ratio', 0, 1, '{device,participant,project,organisation}');

-- ---------------------------------------------------------------------------
-- Sizing criteria: what `<module>.size()` optimises (decision 0045).
-- ---------------------------------------------------------------------------

insert into sizing_criteria (code, name, aim, description) values
  ('self_consumption_rate', 'Self-consumption rate', 'target',
   'The share of the production consumed on the spot, aimed at a target between 0 and 1.'),
  ('self_sufficiency',      'Self-sufficiency',      'target',
   'The share of the consumption covered by the production on the spot, aimed at a target between 0 and 1.'),
  ('payback',               'Payback',               'minimise',
   'The years the investment takes to be repaid by what it saves and earns, the shortest.'),
  ('net_present_value',     'Net present value',     'maximise',
   'What the investment is worth over its horizon, discounted, the largest; not building is worth zero.'),
  ('max_power',             'Maximum power',         'maximise',
   'The largest power the limit allows: the roof, or the connection.');

-- ---------------------------------------------------------------------------
-- Project kinds: the frame a project is carried out in, in the words every
-- country shares, each read by a condition, an action template or a module.
-- The legal frames of a country (a collective self-consumption operation, a
-- renewable energy community as its law defines them) are its pack's
-- rows, each refining one of these. A project with no particular frame has
-- no kind (decision 0057).
-- ---------------------------------------------------------------------------

insert into project_kinds (code, name, parent_code, description) values
  ('pv_roof',                     'Rooftop PV project',           null, 'The design and installation of a PV system on a roof.'),
  ('self_consumption',            'Self-consumption',             null, 'Energy produced and consumed at or near where it is produced.'),
  ('individual_self_consumption', 'Individual self-consumption',  'self_consumption', 'One participant consuming what it produces behind its own meter.'),
  ('collective_self_consumption', 'Collective self-consumption',  'self_consumption', 'Several participants sharing the energy produced by some of them, through the meters of the grid.'),
  ('energy_community',            'Energy community',             'collective_self_consumption', 'A legal entity of participants producing, sharing and consuming energy together.');

-- ---------------------------------------------------------------------------
-- Segments: the customer segment of a participant (residential or
-- professional, refined into the five kinds of member the platform the core
-- was taken from counts).
-- ---------------------------------------------------------------------------

insert into segments (code, name, parent_code, description) values
  ('residential',   'Residential',     null,           'A consumer for its home.'),
  ('professional',  'Professional',    null,           'A consumer for a trade, a service or a public mission.'),
  ('individual',    'Individual',      'residential',  'A person or a household.'),
  ('coproperty',    'Co-ownership',    'residential',  'The owners of a residential building, for its common parts.'),
  ('business',      'Business',        'professional', 'A company, a farm, a self-employed person for its trade.'),
  ('public_entity', 'Public entity',   'professional', 'A municipality, a school, a public body.'),
  ('association',   'Association',     'professional', 'A non-profit association or a foundation.');

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
  -- Market prices: the day-ahead price of each bidding zone of the
  -- interconnected European market, stored as series of the organisation
  -- that reads them (energy_price, named by the zone's EIC code).
  ('entsoe_transparency', 'ENTSO-E Transparency Platform', 'api', 'https://web-api.tp.entsoe.eu/api', 'https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html', 'api_key', 'ENTSO-E Transparency terms of use', '© ENTSO-E', 'Day-ahead prices, load and generation of the bidding zones of the European interconnected grid.'),
  -- Geocoders: an address to a point, a point to an address. Both are read
  -- by the `geocoding` library; national geocoders come with country packs,
  -- commercial ones with the installation that holds their key.
  ('nominatim',     'Nominatim',            'api',  'https://nominatim.openstreetmap.org/', 'https://nominatim.org/release-docs/latest/api/Overview/', 'none', 'ODbL-1.0', '© OpenStreetMap contributors', 'Addresses and places of OpenStreetMap, both ways, worldwide. The public instance asks for one request per second and a named user agent.'),
  ('photon',        'Photon',               'api',  'https://photon.komoot.io/',            'https://github.com/komoot/photon', 'none', 'ODbL-1.0', '© OpenStreetMap contributors', 'Search-as-you-type on OpenStreetMap addresses and places, and reverse lookup, worldwide.'),
  -- What the end customer a participant is says about itself, through the
  -- account of the participant: an equipment it confirms, a contact detail.
  ('customer_declaration', 'Customer declaration', 'manual', null, null, 'none', null, null, 'Declared by the end customer a participant is, through its own account (participants.user_id): an equipment it confirmed, a contact detail, a notification setting.');

-- ---------------------------------------------------------------------------
-- Identifier schemes that are global. National ones come with country packs.
-- ---------------------------------------------------------------------------

insert into identifier_schemes (code, name, pattern, url_template, source_code, description) values
  ('ifc_guid',      'IFC GlobalId',               '^[0-9A-Za-z_$]{22}$', null, null, 'The compressed GUID of an IFC object.'),
  ('cityjson',      'CityJSON object',            '^.+$', null, null, 'The id of a CityObject in a CityJSON file: a national building identifier in 3DBAG or UrbIS.'),
  ('osm',           'OpenStreetMap',              '^(node|way|relation)/[0-9]+$', 'https://www.openstreetmap.org/{value}', 'openstreetmap', 'An OpenStreetMap element.'),
  ('overture_gers', 'Overture GERS',              '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$', null, 'overture', 'Global Entity Reference System identifier of Overture Maps.'),
  ('wikidata',      'Wikidata',                   '^Q[0-9]+$', 'https://www.wikidata.org/wiki/{value}', 'wikidata', 'A Wikidata item.'),
  ('gs1_gsrn',      'GS1 Global Service Relation Number', '^[0-9]{18}$', null, null, 'The 18-digit GS1 number used for metering points in many countries.');

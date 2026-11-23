-- Nexgen OS — module `battery`: the unit of each figure, on its column,
-- and the capacity a battery keeps at the end of its lifetime.
--
-- A battery's figures were in two conventions a reader had to guess: the
-- round-trip efficiency and the capacity left at the end of life are
-- ratios from 0 to 1, the band of state of charge is in percent of the
-- usable capacity, as the core's quantity `charge_level` is. Nothing is
-- renamed — a package of an earlier release reads these columns — and
-- each says its unit where the REST API and any reader of the catalogue
-- find it.

set search_path = nexgen, extensions;

comment on column battery.products.charge_power_kw is
  'The greatest power one unit charges at, in kW.';
comment on column battery.products.discharge_power_kw is
  'The greatest power one unit discharges at, in kW.';
comment on column battery.products.round_trip_efficiency is
  'The share of the energy charged that comes back, a ratio from 0 to 1: 0.9 for 90 %.';
comment on column battery.products.cycle_life is
  'Full cycles to the end of life the manufacturer states, a count.';
comment on column battery.products.end_of_life_capacity is
  'The share of the capacity left at the end of life, a ratio from 0 to 1: 0.7 for 70 %.';
comment on column battery.devices.usable_capacity_kwh is
  'The energy between an empty and a full battery, in kWh; null: its product''s unit capacity times its unit count.';
comment on column battery.devices.charge_power_kw is
  'The greatest power it charges at on its AC side, in kW.';
comment on column battery.devices.discharge_power_kw is
  'The greatest power it discharges at on its AC side, in kW.';
comment on column battery.devices.round_trip_efficiency is
  'The share of the energy charged that comes back, a ratio from 0 to 1: 0.9 for 90 %; null: its product''s, or the parameter round_trip_efficiency.';
comment on column battery.devices.min_charge_level is
  'The lowest state of charge it is kept at, in percent of its usable capacity, 0 to 100: 10 for 10 % (the unit of the quantity charge_level).';
comment on column battery.devices.max_charge_level is
  'The highest state of charge it is kept at, in percent of its usable capacity, 0 to 100: 90 for 90 % (the unit of the quantity charge_level).';
comment on column battery.devices.peak_threshold_kw is
  'For peak shaving: the power the consumption taken from the grid is kept under, in kW.';

-- A sizing counted the savings of the first year every year of the
-- lifetime, at a capacity that never faded. `battery_end_of_life_capacity`
-- is the share of its usable capacity a battery keeps after
-- `battery_lifetime` years, the figure a product states as its
-- `end_of_life_capacity`; a sizing, which has no product yet, reads it by
-- parameter_of() and fades the capacity linearly to it. Nobody's figure is
-- shipped: a sizing counts no fade when nobody says it, and says so in its
-- inputs.
insert into attribute_types (code, name, description, datatype, quantity_code, minimum, maximum, applies_to, published_by) values
  ('battery_end_of_life_capacity', 'Capacity left at the end of life',
   'The share of its usable capacity a battery keeps after battery_lifetime years, a ratio from 0 to 1 (0.7 for 70 %), read by a sizing that fades the capacity linearly to it.',
   'number', 'ratio', 0, 1, '{device,participant,project,organisation}', 'battery');

update nexgen.modules set version = '0.5.0' where code = 'battery';

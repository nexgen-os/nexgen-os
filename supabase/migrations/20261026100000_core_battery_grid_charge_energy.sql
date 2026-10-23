-- Nexgen OS — the energy a battery takes from the grid.
--
-- `battery_charge_energy` is everything put into a battery. A battery run for
-- peak shaving or arbitrage, or a hybrid inverter set to charge at night,
-- also charges from the grid: that part is neither produced nor
-- self-consumed. It is a quantity of its own, the part of the charge that
-- came from the grid, so that what the place produced and kept is
-- `battery_charge_energy − battery_grid_charge_energy` and never more than
-- the production.

set search_path = nexgen, extensions;

insert into quantities (code, name, unit, aggregation, qudt_quantity_kind, description) values
  ('battery_grid_charge_energy', 'Energy charged into a battery from the grid', 'KiloW-HR', 'sum', 'Energy',
   'The part of battery_charge_energy taken from the grid rather than from the production of the place, positive and never more than it.')
on conflict (code) do nothing;

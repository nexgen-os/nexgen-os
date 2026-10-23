-- Nexgen OS — module `battery`: the operating cost of a battery.
--
-- A sizing weighed what a battery saves against what it costs to install
-- (`battery_cost`), and nothing against what it costs to keep: maintenance,
-- insurance, monitoring. `battery_opex` is that yearly cost per MWh of
-- usable capacity, read by `size()` for the payback and the net present
-- value. Nobody's figure is shipped: a sizing counts no operating cost when
-- nobody says it, and says so in its inputs.

set search_path = nexgen, extensions;

insert into attribute_types (code, name, description, datatype, quantity_code, minimum, maximum, applies_to, published_by) values
  ('battery_opex', 'Operating cost of storage',
   'The yearly operating cost of one MWh of usable storage capacity (maintenance, insurance, monitoring), in the currency of the country per MWh and per year, read by a sizing.',
   'number', 'energy_price', 0, null, '{device,participant,project,organisation}', 'battery');

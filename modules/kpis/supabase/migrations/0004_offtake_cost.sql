-- Nexgen OS — indicators: what the energy taken from the grid costs, and
-- what it is made of.
--
-- The savings of self-consumption read the energy price of the participant's
-- segment and the grid fees and taxes of its place; nothing read the same
-- figures for the energy a participant still takes from the grid, and no
-- indicator read the excise its pack declares. Four indicators now read them,
-- each from the row its pack declares once, chosen by the segment of the
-- participant (the energy price through `by_segment`, the grid fees and taxes
-- and the excise through the `segment` condition of their default):
--
--   offtake_energy_cost          the energy and supply part;
--   offtake_grid_fees_and_taxes  the network costs, taxes and levies;
--   offtake_excise               of which the excise on electricity;
--   offtake_cost                 the two parts together, VAT excluded.
--
-- The excise is a part of the grid fees and taxes, never added to them: a
-- pack declares it beside them for whoever needs it alone. A template,
-- `offtake_cost_breakdown`, puts them month by month beside the emissions
-- of the same energy (scope 2, location- and market-based), which read the
-- emission factors of the pack.

set search_path = nexgen, extensions;

insert into kpis.indicators (code, name, quantity_code, display_unit, applies_to, better, formula, variables, reference, description) values
  ('offtake_energy_cost', 'Cost of the energy taken from the grid, energy part', 'amount', null, '{participant,project}', 'lower',
   'offtake * energy_price / 1000',
   '{"offtake": {"quantity": "offtake_energy"}, "energy_price": {"parameter": "energy_price_household", "by_segment": {"professional": "energy_price_business"}}}', null,
   'The energy taken from the grid at the energy price of the participant''s segment (the household price for a residential participant, the business price for a professional one; per MWh), unless the object, its parents or its organisation set their own; for a project whose participants differ in segment, at the household price, and the figure says so; VAT excluded, in the currency of the place.'),
  ('offtake_grid_fees_and_taxes', 'Cost of the energy taken from the grid, grid fees and taxes', 'amount', null, '{participant,project}', 'lower',
   'offtake * grid_fees / 1000',
   '{"offtake": {"quantity": "offtake_energy"}, "grid_fees": {"parameter": "grid_fees_and_taxes"}}', null,
   'The energy taken from the grid at the grid fees and taxes of the place (network costs, taxes and levies per MWh, the excise among them), as the pack declares them for the participant''s segment, unless the object, its parents or its organisation set their own; VAT excluded, in the currency of the place.'),
  ('offtake_excise', 'Excise on the energy taken from the grid', 'amount', null, '{participant,project}', 'lower',
   'offtake * excise / 1000',
   '{"offtake": {"quantity": "offtake_energy"}, "excise": {"parameter": "electricity_excise"}}', null,
   'The excise on electricity of the energy taken from the grid, at the rate the pack declares for the participant''s segment (per MWh), unless the object, its parents or its organisation set their own; a part of offtake_grid_fees_and_taxes, never added to it; in the currency of the place.'),
  ('offtake_cost', 'Cost of the energy taken from the grid', 'amount', null, '{participant,project}', 'lower',
   'offtake * (energy_price + grid_fees) / 1000',
   '{"offtake": {"quantity": "offtake_energy"}, "energy_price": {"parameter": "energy_price_household", "by_segment": {"professional": "energy_price_business"}}, "grid_fees": {"parameter": "grid_fees_and_taxes"}}', null,
   'The energy taken from the grid at the energy price of the participant''s segment and the grid fees and taxes of its place (per MWh): offtake_energy_cost plus offtake_grid_fees_and_taxes, the same parameters read; VAT excluded, in the currency of the place.');

insert into kpis.templates (code, name, granularity, layout, description) values
  ('offtake_cost_breakdown', 'Cost of the energy taken from the grid', '1 month',
   '{"sheets": [
      {"name": "Cost", "sections": [
        {"name": "Total", "indicators": ["offtake_cost"]},
        {"name": "Parts", "indicators": ["offtake_energy_cost", "offtake_grid_fees_and_taxes", "offtake_excise"]}]},
      {"name": "Emissions", "sections": [
        {"name": "Scope 2", "indicators": ["scope2_location_based", "scope2_market_based"]}]}]}',
   'What the energy a participant or a project takes from the grid costs month by month, its energy part, its grid fees and taxes and the excise among them, and what it emits; every price and factor read from the pack of the place for the participant''s segment.');

update nexgen.modules set version = '0.6.0' where code = 'kpis';

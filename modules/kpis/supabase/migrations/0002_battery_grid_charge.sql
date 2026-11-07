-- Nexgen OS — module `kpis`: a battery that also charges from the grid.
--
-- `battery_charge_energy` is everything put into a battery; when it also
-- charges from the grid (peak shaving, arbitrage, a hybrid inverter set to
-- charge at night), that part was neither produced nor self-consumed. The
-- core says it apart, `battery_grid_charge_energy`, and the `battery`
-- module writes it with the dispatch of a battery run for peak shaving or
-- arbitrage. The two indicators that read what the batteries stored of the
-- production now read `charge − grid_charge` (zero without a series, as
-- before):
--
-- - `self_consumption_rate`, what is not injected over what is produced,
--   is `(direct + charge − grid_charge) / production`, never above 1 when
--   the self-consumption is measured; when it is not, the direct part is
--   `production − injection − (charge − grid_charge)`, and the rate stays
--   `(production − injection) / production`;
-- - `battery_boost_rate` is `(charge − grid_charge) / production`.
--
-- The indicators that count what a battery gives back (self-consumed
-- energy, self-sufficiency, coverage, savings, CO2 avoided) are unchanged:
-- the share of a discharge that came from the grid is not told apart yet.

set search_path = nexgen, extensions;

update kpis.indicators
   set formula = '(direct + charge - grid_charge) / production',
       variables = jsonb_set(variables, '{direct,otherwise}', '"production - injection - charge + grid_charge"')
                   || '{"grid_charge": {"quantity": "battery_grid_charge_energy", "otherwise": "0"}}'::jsonb,
       description = 'The part of the energy produced that is not injected: consumed on the spot or stored. The charge a battery took from the grid is not counted.'
 where code = 'self_consumption_rate';

update kpis.indicators
   set formula = '(charge - grid_charge) / production',
       variables = variables || '{"grid_charge": {"quantity": "battery_grid_charge_energy", "otherwise": "0"}}'::jsonb,
       description = 'The points of self-consumption rate the batteries add: the energy they stored of the production, which would have been injected without them, over the energy produced. For a project, every battery of its participants, a community battery among them: the boost of the collective self-consumption. The charge a battery took from the grid is not counted.'
 where code = 'battery_boost_rate';

# `kpis` — indicators as data

The indicators of a participant, a project, a meter or a device: a
self-consumption rate, a peak, a specific yield, the CO2 avoided, the money
saved. An indicator is a row of `kpis.indicators`, never code: a formula
over named variables, the quantity of its figure, the kinds of object it
applies to, which way is better. A pack, a module or an installation adds
one with an insert.

## What it holds

| Table | What a row is |
|---|---|
| `kpis.indicators` | an indicator: `formula`, `variables`, `quantity_code` (hence the unit it is stored in), `display_unit` (a rate stored 0 to 1 is shown in %), `applies_to`, `better` (`higher`, `lower`), `reference`, `published_by`; `program` is the formula compiled when the row is written |
| `kpis.targets` | a target of an object for an indicator over a period (`valid_from`, `valid_to` excluded), in the unit of the indicator's quantity; a trajectory is one row per period |
| `kpis.figures` | what the module computed (decision [0004](../../docs/decisions/0004-a-figure-says-where-it-comes-from.md)): the object, the indicator, the period, the granularity, its `provenance`, its `inputs` (the indicator as it was, the series and the parameters read), its `results` (the value and the variables of each bucket and of the period), and the series it wrote |
| `kpis.templates` | an export as data: sheets of sections of indicators, and the granularity of their figures |

Indicators and templates are vocabularies, read by everyone signed in;
targets and figures are an organisation's, under row level security.

## A formula and its variables

```
code      self_sufficiency_rate
formula   (production - injection) / (offtake + production - injection)
variables {"production": {"quantity": "production_energy"},
           "injection":  {"quantity": "injection_energy"},
           "offtake":    {"quantity": "offtake_energy"}}
```

A formula is numbers, the variables the row declares, `+ - * /`, a unary
minus, parentheses, `min(a, b)`, `max(a, b)` and `abs(a)`. `kpis.compile()`
turns it into its reverse Polish program when the row is written and
refuses anything else by name (`formula_invalid`, `function_unknown`,
`variable_unknown`); `kpis.evaluate()` runs the program on numbers. No
formula ever becomes SQL. A missing value or a division by zero gives no
value — never a zero.

A variable reads one of two things:

- `{"quantity": "<code>"}`: the amount of the object's series of that
  quantity in a bucket, as `resample()` gives it. The series are the
  object's own; for a participant with none, those of its meters, else
  those of its devices, so that a production read by a meter and by its
  inverter counts once; for a project, those of each of its participants
  (`kpis.series_of()`). Several series of an energy add up, several of a
  mean quantity (an irradiance) average. Options: `kind`; `step` and `combine` (`sum`, `mean`, `max`, `min`) to read the
  quantity on a finer step and combine those values into the bucket — the
  heaviest hour of a month, the irradiation of its hours; never finer than
  the series are kept: a variable that names a step reads its series on
  that step or on the coarsest step they are kept at, whichever is coarser
  (`kpis.own_step()`: each series' `step`, or for an irregular series the
  smallest gap between two of its readings), and the figure says the step
  read (`steps`); `per` (a duration under a day) to read the amount of each
  read bucket over its length — an energy per `1 hour`, a mean power in kW;
  `shift` to read the same bucket shifted (`-1 year`). A quantity is checked when the
  indicator is computed (`quantity_unknown`): a module installed after this
  one publishes it.
  Without a `kind`, a variable reads the measured series, and the
  simulated ones when the object has none (a study); the figures this
  module wrote back are never read. `otherwise`: a formula over the other
  variables, the amount when the object has no series of the quantity —
  the self-consumption a series measures, else the balance that gives it;
  `"0"` for a battery the place does not have. `times: {"quantity":
  "energy_price"}`: each read bucket weighted by the price of that bucket,
  the nearest price series of the object, its parents (`parents_of()`) or
  its organisation (`prices_required` without one); a bucket without a
  price leaves its bucket without a value. Which way each variable was had
  — `measured`, `simulated` or `computed` — is in the figure's inputs
  (`read`), with the price series read (`prices`).
- `{"parameter": "<attribute type>"}`: `parameter_of()` of the object at the
  start of each bucket — its own attribute, its parents', its
  organisation's, then the region's and the country's of its pack; for a
  project, its own country's. A factor or a price is never a literal of a
  formula.

### Hour by hour when the series exists

A variable weighted by a series (`"times"`) may read only the series naming
the bidding zone of the object (`"zone": true`: a series of the object, its
parents or its organisation whose `bidding_zone` attribute is the zone
`parameter_of()` gives the object) and name the formula that stands in when
there is none (`"without_times"`). The figure lists, in `inputs.fallbacks`,
every variable computed without its series, the series it lacked and the
formula used; `inputs.prices` lists the series read hour by hour. An hour
the weighting series does not cover leaves its bucket without a value.

## Gestures

- `kpis.compute(object_kind, object_id, indicator, from, to, granularity)`
  computes an indicator over a period, by buckets of the granularity (`1
  month`, `1 day`, `1 hour`; days and months cut in the time zone of the
  object's participant, the one a project's participants share) or, with
  no granularity, as one figure. It keeps a figure, and writes the value of
  each bucket as a `simulated` series of the object, named after the
  indicator, whose source is `kpis.figures:<id>`, through `store()`: read
  like any series by `resample()`. The same indicator, object, period and
  granularity computed again replaces the figure and keeps its series.
- `kpis.measure(…)`, the same arguments: what `compute()` would write,
  written nowhere.
- `kpis.of(object_kind, object_id, from, to)`: the latest figure of each
  indicator and granularity of an object within a period, with the target
  that holds over it and whether it is met.
- `kpis.portfolio(indicator, from, to)`: the indicator over every project
  the caller may read, with no table: the projects' figures added for an
  additive indicator, the formula over their added amounts for a rate;
  amounts of money by currency, never across. A project it could not
  measure is listed with its refusal.
- `kpis.report(template, object_kind, object_id, from, to)`: the rows of a
  template from the figures already computed at its granularity; an
  indicator without a figure is `not_computed`, an empty cell.

Refusals: `indicator_unknown`, `indicator_not_applicable`, `period_invalid`,
`object_not_found`, `time_zone_required`, `quantity_unknown`,
`series_not_found`, `prices_required`, `variable_invalid`, `template_unknown`, and what
`parameter_of()` (`parameter_missing`, `parameter_not_decided`),
`resample()` and `store()` refuse.

## Two rules of the figures

- **A rate over a period is the formula over the period's amounts**, never
  the mean of the rates of its months: a self-consumption rate of 3/4 in
  January and 3/6 in February is 6/10 over both.
- **An additive figure sums its buckets** — an energy, an emission, an
  amount, each quantity whose aggregation is `sum` — so that a factor or a
  price that changes on the first of a month weighs on that month only.

## The indicators it publishes

The balance of a place reads `direct`, the self-consumption a series
measures (`self_consumption_energy`), otherwise `production - injection -
charge`; `charge` and `discharge`, the batteries' (`battery_charge_energy`,
`battery_discharge_energy`), otherwise `0`. The energy consumed of the
place's own production is `direct + discharge`; what is not injected is
`direct + charge`; what is consumed is `offtake + direct + discharge`.

| Code | Formula | Figure |
|---|---|---|
| `self_consumed_energy` | `direct + discharge` | kWh |
| `self_consumption_rate` | `(direct + charge) / production` | ratio |
| `self_sufficiency_rate` | `(direct + discharge) / (offtake + direct + discharge)` | ratio |
| `coverage_rate` | `production / (offtake + direct + discharge)` | ratio |
| `shared_rate` | `shared_injection / production` | ratio; a project's collective self-consumption rate |
| `shared_coverage_rate` | `shared_offtake / (offtake + direct + discharge)` | ratio; how much less a place depends on the grid than without the sharing |
| `residual_offtake_energy` | `offtake - shared_offtake` | kWh bought from a supplier |
| `peak_offtake_power` | `offtake`, read by quarter-hours per hour, the heaviest | kW, the highest mean power over the step the meters keep: a quarter of an hour for a meter read every 15 minutes, an hour for an hourly series |
| `specific_yield` | `production / installed_power` | kWh/kWp: the final yield of IEC 61724-1, the full-load hours of any generator |
| `performance_ratio` | `production / (installed_power * irradiation / 1000)`, the in-plane irradiation summed by hour | ratio, IEC 61724-1 |
| `co2_avoided` | `direct_co2 + discharge_co2`: the energy of each hour at the carbon intensity series of the bidding zone, or without one `(direct + discharge) * factor` month by month, `grid_co2_factor` | kg |
| `scope2_location_based` | `offtake_co2`: the energy taken from the grid hour by hour at the carbon intensity of the zone, or `offtake * factor` month by month | kg, GHG Protocol Scope 2, location-based |
| `scope2_market_based` | `offtake * factor`, `market_co2_factor`: the supplier's disclosed mix as an attribute over the contract's period, else the residual mix of the country (its pack) | kg, GHG Protocol Scope 2, market-based |
| `self_consumption_savings_household`, `_business` | `(direct + discharge) * (energy_price + grid_fees) / 1000`, the household or business energy price and `grid_fees_and_taxes` per MWh | an `amount` in the currency of the place |
| `injection_value` | `injection * price / 1000`, `injection_price_reference` | an amount |
| `offtake_change_rate` | `offtake / offtake_year_before` | ratio: below 1 the place saves, above it rebounds |
| `battery_charged_energy`, `battery_discharged_energy` | `charge`, `discharge` | kWh, of a battery, a participant's, a project's |
| `battery_boost_rate` | `charge / production` | ratio: the points of self-consumption the batteries add; for a project, every battery of its participants, a community battery among them |
| `injection_day_ahead_value` | `injection / 1000`, the injection of each hour times the `energy_price` of that hour | an amount |
| `shared_day_ahead_value` | `shared_injection / 1000`, hour by hour at the price | an amount |
| `residual_day_ahead_value` | `(offtake - shared_offtake) / 1000`, hour by hour at the price | an amount |

`shared_*` and `residual_*` read the volumes of a sharing
(`shared_offtake_energy`, `shared_injection_energy`, the `community`
module's); `performance_ratio` reads the plane-of-array irradiance of the
`solar` module, whose own IEC 61724-1 indicators of a PV system
(`modules/solar/src/performance.ts`) count only the hours where every
series has a value. The battery series are a device's: measured by its
inverter, or simulated by the `battery` module's dispatch. A day-ahead
price is an `energy_price` series of the project or the organisation;
read by hour, a market of quarter-hours is read at its hourly mean.

An amount of money is the core's `amount` quantity, whose unit is the
currency pattern (`XXX`, ISO 4217's "no currency"): its series is kept in
the currency of its object's country, like a price, and `portfolio()`
never adds two currencies. The savings read the core's price attribute
types (`energy_price_household`, `energy_price_business`,
`grid_fees_and_taxes`, quantity `energy_price`) through `parameter_of()`.

Two templates: `energy_community_report` (flows, storage, rates,
environment, economy, by month) and `pv_performance` (yield and use, by
month).

## What it reads of the core

Every word it reads is the core's: the energy self-consumed measured
(`self_consumption_energy`), the battery charge and discharge, the prices
(`energy_price` and the currency units), the amount of money (`amount`),
and a project's own country for `parameter_of()`.

## What it does not compute

- A sum interval by interval of a nonlinear expression — the collective
  self-consumption of a project as the sum over quarter-hours of
  `min(production, consumption)`: that is the volume a sharing engine
  writes (`community`), read here as a quantity.
- Indicators around an intervention (energy flexibility, value of
  flexibility, load shifting capacity): they need the window of an
  intervention and a baseline, which no table holds yet.
- Values entered by hand: an attribute of the object, not an indicator.

# `storage` — batteries, their dispatch and their size

Status: shipped. Schema: `storage`.

A battery is a device of the core of type `battery`. This module says what
its dispatch is computed from — its usable capacity, its power, its
round-trip efficiency, the band of state of charge it is kept in, what it
is run for and which flows it sees — computes that dispatch on the interval
series of a participant's place or of a project's sharing, and sizes a
battery for a named criterion. What it computes is an estimate, kept in
`storage.estimates` (decision [0004](../../docs/decisions/0004-a-figure-says-where-it-comes-from.md)).
Hydrogen and heat storage come later.

## What it adds to the core

| Table | Holds |
|---|---|
| `storage.devices` | the battery, a device of type `battery` with the same id (`call derive_devices('storage.devices', 'battery')`): `usable_capacity_kwh`, `charge_power_kw` and `discharge_power_kw` on its AC side, `round_trip_efficiency` (0 to 1), `min_charge_level` and `max_charge_level` (percent of its usable capacity), its `objective`, its `perimeter` (`site`: the flows of its participant's place, individual self-consumption; `project`: the surplus and residual of its project once energy is shared, collective self-consumption), `peak_threshold_kw` for peak shaving. Every figure may be null: the product or `parameter_of()` says it then. |
| `storage.battery_products` | the physics of a battery product of the core's `products`, same id: charge and discharge power per unit, round-trip efficiency, cycle life and the capacity left at its end, the source of the figures. The usable capacity is the product's `unit_capacity_kwh`. Shared products are read by everyone signed in; an organisation's by its members. |
| `storage.objectives` | what a battery is run for, a vocabulary: `self_consumption`, `peak_shaving`, `arbitrage`. |
| `storage.estimates` | what the module computed: a dispatch, about the battery (`device_id`), or a sizing, about the participant or the project (`participant_id` or `project_id`, with its `criterion`); one subject each, by foreign key, the estimate going with it; its `provenance`, `inputs` and `results`. |

Five properties are read through `parameter_of()` where neither the
device nor its product says them — the device's own attribute, its
participant's, its project's, its organisation's, then its pack's:
`battery_c_rate` (power as a fraction of capacity per hour) and
`round_trip_efficiency`, the core's attribute types, and for a sizing,
published by this module, `battery_cost` (installed cost per MWh of usable
capacity, in the currency of the country), `battery_lifetime` (years) and
`discount_rate`.

This module publishes `battery_c_rate` (0.4) and `round_trip_efficiency`
(0.85) **at the generic level of `parameter_of()`**, valid in every
country, below every place, with no condition
([0053](../../docs/decisions/0053-a-technology-figure-holds-everywhere-below-every-place.md)):
a technology figure is the same everywhere, and only a row without a
condition answers a sizing, which asks for a participant or a project that
has no device type yet. A pack, an organisation, a project or the device
that says otherwise wins. Their source (`atb_2025_residential_battery`) is
the page *Residential Battery Storage* of the Annual Technology Baseline
2025 of the National Laboratory of the Rockies (formerly NREL): a
representative 5 kW / 12.5 kWh (2.5-hour) system, a C-rate of 0.4, and the
85 % round-trip efficiency the 2025 ATB adopts from Cole et al. (2025). The rule this module was taken from used a
C-rate of 0.5 and an efficiency of 0.9; no published source of those two
figures was found, so they are not shipped: an installation that holds
them sets them on its organisation, with their source. The cost, the
lifetime and the discount rate are not shipped: a figure nobody decided is
refused by name (`parameter_missing`).

`storage.battery_of(device, at)` gives every figure a dispatch reads, each
with where it came from:

| Figure | Read from, first that says it |
|---|---|
| usable capacity | the device; its product's unit capacity times its unit count; else `capacity_required` |
| charge, discharge power | the device; its battery product, per unit, times its unit count; its rated power (`devices.rated_power_kw`); its product's unit power; its capacity times `battery_c_rate` |
| round-trip efficiency | the device; its battery product; `round_trip_efficiency` |
| band of state of charge | the device; else 0 to 100 % |

## The dispatch, in plain words

`dispatch()` (`src/estimates.ts`) runs the batteries of a perimeter over a
period, at the step of its series. The rule is `src/dispatch.ts`; for a
battery run for **self-consumption**, in each interval, in time order:

1. the surplus of the interval (production minus consumption, when
   positive) charges the battery, up to its charge power over the interval
   and up to the room left under its highest state of charge;
2. the residual (consumption minus production, when positive) is served
   by the battery, up to its discharge power over the interval and up to
   what it holds above its lowest state of charge;
3. what the battery did not take is injected; what it did not serve is
   taken from the grid.

The **round-trip efficiency is applied once, on discharge**, where the rule
this one was taken from applies it: serving 1 kWh empties the battery of
1 / efficiency kWh; charging 1 kWh fills it of 1 kWh. That rule served
`min(residual, power, stock) × efficiency` and emptied the battery of the
energy served only, so that over a day nothing was lost; here the loss
leaves the battery. A battery emptied every day therefore serves
`efficiency` times what that rule served, and exactly what it served
without losses (`tests/dispatch.test.ts`, on that rule's own fixtures).

The **state of charge at the start of the period** is the one it ends
with: the period is run from the middle of the band, then again from where
it ended, until the two differ by less than 1e-4 kWh, twenty passes at most
(`converged` and `iterations` in the results). The rule taken from did the
same on a typical day, at 1e-4 MWh; here it runs on the whole period.

**Several batteries** of one perimeter are chained, in the order they were
described: the second sees the surplus and the residual the first left, so
the same surplus is never stored twice and the sum of what they serve
never exceeds the residual.

**Peak shaving** keeps the power taken from the grid under
`peak_threshold_kw`: the battery serves whatever the residual takes above
it, charges from the surplus, and from the grid while the residual and that
charge stay under the threshold. **Arbitrage** reads a price for each
interval, an `energy_price` series of the participant, its project or its
organisation (nearest first; `prices_required` without one): in each local
day of the participant (`time_zone_required` without one), the battery
charges from the grid in the cheapest intervals it needs to fill up and
serves the consumption in the dearest intervals with a consumption that
it needs to empty, when the price there, times its efficiency, is above the
cheapest of the day; it charges from the surplus whenever there is one.

### What it reads and writes

```ts
import { dispatch } from './src/estimates.js';

await dispatch(db, { perimeter: { kind: 'participant', id: participantId }, from: '2026-06-01T00:00:00Z', to: '2027-06-01T00:00:00Z' });
// [{ estimateId, deviceId, indicators, savings, series: { charge, discharge, level } }]
```

On a participant's place it reads its `production_energy` and
`consumption_energy` series; on a project's sharing, the project's
`injection_energy` (the surplus left once the energy is shared) and
`offtake_energy` (the residual) — measured first, the one on the perimeter
itself first, then the latest — or the series the request names. The step
is the request's or that of the consumption series, under a day, and
divides the period; a bucket without a value is refused
(`series_incomplete`), never taken for zero.

Each battery gets one estimate, about the device, and three `simulated`
series of the device written through `store()`, each naming the estimate in
its source (`storage.estimates:<id>`): `battery_charge_energy` and
`battery_discharge_energy` per interval, `charge_level` (percent of the
usable capacity) at the start of each interval. The inputs say the period,
the step, the series read, the battery as `battery_of()` gave it, its place
in the chain and the batteries before it, the prices read and where they
came from. The results say the energy charged, charged from the grid and
served, the full cycles (the energy drawn over the band), the
self-consumption and self-sufficiency rates without and with the battery
(the energy served counts as self-consumed in the share of the charge that
came from the surplus; the rate with the battery is never below the rate
without), the injection, the offtake and the peak of offtake without and
with, and the savings.

The **savings** are the offtake avoided at the price of each interval —
the price series when there is one, else the energy price of the
participant's segment (`energy_price_household` for a residential one,
`energy_price_business` for a professional one, or the property the request
names in `offtakePrice`) plus `grid_fees_and_taxes` on a participant's
place; on a project's sharing the energy goes through the grid and its fees
are not avoided — less the injection avoided at `injection_price_reference`,
each read through `parameter_of()`. A price that is missing leaves the
savings null and is named in the inputs (`prices.missing`).

## The size of a battery

`size()` is the one sizing gesture of the module; it sizes **one more**
battery for a participant's place or a project's sharing, after the
batteries it already has:

```ts
await size(db, { perimeter: { kind: 'project', id: projectId }, from, to, criterion: 'net_present_value' });
// { estimateId, curve: [{ capacity_kwh, discharge_kwh, self_consumption_rate, self_sufficiency, peak_kw,
//                          savings_per_year, capex, payback_years, net_present_value }], recommended, reason }
```

It sweeps the capacity — without bounds, from 1/40th up to what one cycle a
day can move (the mean over the days of the period of the smaller of the
day's surplus and residual, as the rule it was taken from bounded it) in 40
steps; for peak shaving, up to what holds the most a day takes above the
threshold — with its power from `battery_c_rate` and its efficiency from
`round_trip_efficiency`, and recommends, by criterion:

| Criterion | Recommended point |
|---|---|
| `self_consumption_rate`, `self_sufficiency` | the smallest capacity within 0.1 point of the best rate of the sweep: past it, a bigger battery adds less than 0.1 point |
| `payback` | the shortest simple payback, the capex (capacity at `battery_cost`) over the savings of a year |
| `net_present_value` | the greatest net present value of the savings of a year over `battery_lifetime` years at `discount_rate`, less the capex; none when no capacity has a positive one (`reason`). With a discount rate of 0 it is the net benefit the rule taken from maximised, times the lifetime |
| `max_power` | the smallest capacity giving the lowest peak of offtake, the battery run for peak shaving under `peakThresholdKw` |

The savings of the period are scaled to a year of 365.25 days. The
estimate is about the participant or the project, with its `criterion`, a
word of the core's vocabulary `sizing_criteria`, shared with
`solar.size()` (decision [0045](../../docs/decisions/0045-to-size-is-one-gesture.md));
a word it does not hold is `sizing_criterion_unknown`, a word it holds that
no point of a battery's curve is found for, `criterion_unsupported`.

## Refusals

By name, in the function or the table: `participant_not_found`,
`project_not_found`, `perimeter_invalid`, `no_battery`, `series_not_found`,
`series_incomplete`, `step_required`, `step_invalid`, `period_empty`,
`time_zone_required`, `prices_required`, `peak_threshold_required`,
`objective_unknown`, `objective_unsupported`, `sizing_criterion_unknown`, `criterion_unsupported`,
`bounds_invalid`, `capacity_required`, `power_required`,
`efficiency_invalid`, `charge_levels_invalid`, `series_misaligned`,
`series_invalid`, `device_not_found`, `battery_not_described`,
`device_type_mismatch`, `product_not_found`, `product_type_mismatch`, and
what `parameter_of()` refuses (`parameter_missing`, `parameter_ambiguous`).

## What it does not model

The efficiency does not change with the power or the temperature; the
battery does not age over the period (its cycle life is said, not
applied); a battery charges from the grid only for peak shaving and
arbitrage, and never discharges to the grid; the self-discharge, the
standby consumption of the system and the power price of a peak avoided
are not counted. What the figures are and are not:
[DISCLAIMER.md](../../DISCLAIMER.md).

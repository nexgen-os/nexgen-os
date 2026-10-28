# `@nexgen-os/utilityrate5` — SAM electricity rates ↔ plain rates

Reads and writes the electricity rate of a case of the
[System Advisor Model](https://sam.nrel.gov) (SAM, NREL): the `ur_` inputs
of its `utilityrate5` compute module, as SAM writes a case to JSON and
PySAM's `export()` gives them, flat or under their group. MIT; no
dependency, no database, no network.

| Inputs | Read as | Notes |
|---|---|---|
| `ur_ec_tou_mat` | `energyCharges`: `period`, `tier`, `maxUsage`, `maxUsageUnit` (`kWh`, `kWh/kW`, `kWh daily`, `kWh/kW daily`), `buy`, `sell` | rates per kWh in the file's currency, which the file does not name |
| `ur_ec_sched_weekday`, `ur_ec_sched_weekend` | `weekday`, `weekend`: 12 months × 24 hours, the period of each hour | every period named is one `ur_ec_tou_mat` charges |
| `ur_sell_eq_buy` | `sellEqualsBuy` | |
| `ur_en_ts_buy_rate` and `ur_ts_buy_rate`, `ur_en_ts_sell_rate` and `ur_ts_sell_rate` | `timeSeriesBuy`, `timeSeriesSell` when turned on | equal steps over 8760 hours (hourly, quarter-hourly…) |
| every other `ur_` key: demand charges, fixed and minimum charges, metering option, a time series turned off | `other`, as read | written back as read |

`writeUtilityRate()` gives the flat `ur_` inputs back, the same keys in the
same values; `JSON.stringify` makes the file.

```ts
import { hourlyRates, rateFromHourly, readUtilityRate, writeUtilityRate } from '@nexgen-os/utilityrate5';

const rate = readUtilityRate(samCaseJson);
const { stepMinutes, buy, sell } = hourlyRates(rate);       // a rate at each hour of SAM's year
const back = writeUtilityRate(rateFromHourly(buy, sell));   // the 12 × 24 schedules again
```

## A rate at each hour of the year

SAM reads a rate over its own year: 365 days of 24 hours in local standard
time, from 1 January, the first day a Monday, Saturdays and Sundays on the
weekend schedule. `hourlyRates()` gives the buy and the sell rate of each
step of that year: the time-series rates where the rate has them, the
period of the hour's schedule otherwise, the buy rate when energy is sold
at the rate it is bought. Placing that year on a calendar and a time zone
is the reader's: the file holds neither.

`rateFromHourly(buy, sell?)` folds an hourly year back: when every hour of a
month, a time of day and a kind of day carries one buy and sell rate, it is
the 12 × 24 weekday and weekend schedules, one single-tier period for each
pair of rates in the order they first come; otherwise the same year as
time-series rates. Either way `hourlyRates()` gives the same year back.

What it never does: compute a bill, apply a tier, a demand charge or a
metering option, or name a currency. Writing a rate as the price series of
a contract is an importer's job.

## Refusals

`utilityrate5_unreadable` (not JSON, not an object, no energy charges and
no time-series buy rate, a row or a series that is not what SAM writes),
`utilityrate5_schedule_invalid` (a schedule that is not 12 × 24, or names a
period no charge has), `utilityrate5_tiered` (an hourly rate asked of a
period whose rate depends on the usage), `utilityrate5_series_length` (an
hourly year that is not 8760 hours, time-series buy and sell rates of
different steps).

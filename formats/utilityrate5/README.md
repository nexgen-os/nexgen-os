# `@nexgen-os/utilityrate5` — the energy rates of SAM ⇄ price intervals

Writes the fixed prices of a contract as the energy rates of `utilityrate5`,
the compute module that SAM (System Advisor Model) and PySAM run to compute
a bill, and reads them back. The US Utility Rate Database publishes its
tariffs in the same shape. MIT, like every format library; it reads no
database and computes no price
([0035](../../docs/decisions/0035-a-format-library-touches-no-database.md)).

A price interval is a fixed price on an interval of time, start included,
end excluded, in the shape of a row of `contracts.price_signals`
(`starts_at`, `ends_at`, `price`, `currency`, `per_unit`): a row passes as it
is. An indexed price, a cap or a floor is resolved to fixed prices by a run
first.

| Price intervals | `utilityrate5` | Notes |
|---|---|---|
| buy prices that repeat by month, hour of the day and weekday or weekend | `ur_ec_sched_weekday`, `ur_ec_sched_weekend` (12 × 24 periods), `ur_ec_tou_mat` | `writeSchedule`; one period per pair of buy and sell rates, at most twelve, one tier without limit (`1e38`) |
| any hourly or sub-hourly prices | `ur_en_ts_buy_rate` = 1, `ur_ts_buy_rate` | `writeTimeSeries`, `steps_per_hour` 1 by default; 8760 × steps per hour rates |
| sell prices (injection), when given | the sell column of `ur_ec_tou_mat`, or `ur_en_ts_sell_rate` = 1, `ur_ts_sell_rate` | none given: the schedule's sell rate is 0 and the time series has none |
| `price` per `KiloW-HR` or `MegaW-HR` | rates per kWh | the one conversion the format defines |
| `currency` | — | the format holds none: the writer returns it, the reader is told it |

```ts
import { writeSchedule, readSchedule } from './formats/utilityrate5/index.js';

const { rates, currency } = writeSchedule({ year: 2025, utc_offset_hours: 1, buy: supplySignals, sell: injectionSignals });
// rates go as they are into PySAM: UtilityRate5.ElectricityRates.assign(rates)
const { buy, sell } = readSchedule(rates, { year: 2025, utc_offset_hours: 1, currency });
```

## SAM's year

SAM runs on 8760 hours of local standard time, without summer time. The
caller gives the year and the UTC offset of the place's standard time
(`utc_offset_hours`), never guessed. On a leap year the hours of
29 February are left out, so the intervals read back stop at its start and
resume the next day. A tariff whose peak follows the wall clock shifts by an
hour in standard time during summer time: the months where the clock
changes then hold two prices in one cell, and the schedule is refused by
name; the time series says it hour by hour.

## Refusals

`utilityrate5_price_not_fixed` (an indexed price, a cap or a floor),
`utilityrate5_price_missing` (an hour of the year without a price),
`utilityrate5_price_misaligned` (a price that changes inside a step),
`utilityrate5_prices_overlap`, `utilityrate5_mixed_currencies`,
`utilityrate5_price_unreadable`, `utilityrate5_not_a_schedule` (an hour of
a month that holds two prices), `utilityrate5_too_many_periods`,
`utilityrate5_step_unsupported`, `utilityrate5_year_required`,
`utilityrate5_utc_offset_required`, `utilityrate5_currency_required`; when
reading, `utilityrate5_unreadable`, `utilityrate5_tiered_rate_unsupported`
(a price interval has no tier) and `utilityrate5_period_unknown`.

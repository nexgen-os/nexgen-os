# `forecast` — forecasts of a series of the core

The core stores every series, forecasts included: a series of kind
`forecast` keeps each issue in `forecast_values` with the time it was
issued, and `forecast_at()` reads it as it was known
([0029](../../docs/decisions/0029-a-series-belongs-to-an-object.md),
[0031](../../docs/decisions/0031-one-way-to-write-a-series-one-way-to-read-it.md)).
A connector that receives a forecast, a weather model's, writes it there
with no model. This module computes one.

## What it holds

| Table | What a row is |
|---|---|
| `forecast.methods` | a method of forecasting, as data: its code, whether it repeats a season, where it is described |
| `forecast.forecasts` | a series of the core forecast by a method, over a horizon, from a history; its inputs, its provenance and its results, the forecast series it writes |

The module ships the two benchmarks every forecast is measured against,
as Hyndman and Athanasopoulos describe them (*Forecasting: Principles and
Practice*, 3rd edition, §5.2):

- `naive`: every value ahead is the last value observed;
- `seasonal_naive`: every value ahead is the one observed one season
  earlier (`1 day`, `7 days`), or whole seasons earlier when that lies
  beyond the last value observed.

## What it computes

- `forecast.issue(forecast, issued_at)`: reads the series over its history
  before `issued_at` — the values whose interval had ended by then and that
  are not missing — and forecasts every step after the last value observed
  until the horizon after `issued_at`. It writes them through `store()` into
  a forecast series of the same object, quantity and step, whose source
  names the forecast (`forecast.forecasts:<id>`), with `issued_at` as their
  issue time. Every issue is kept. The same `issued_at` gives the same
  values again: an issue in the past is a backtest.
- `forecast.accuracy(forecast, from, to, horizon)`: the forecast against its
  series over a period — the pairs compared, mean absolute error, root mean
  square error and bias (positive when the forecast is above), in the unit
  of the quantity — each value as forecast at least `horizon` ahead, or by
  its latest issue.

Read the issues like any forecast: `forecast_at()` as known at a time or
at a horizon, `resample()` and `window()` for the latest issue.

```sql
insert into forecast.forecasts (series_id, method, season, horizon)
values ('<series>', 'seasonal_naive', '7 days', '2 days')
returning id;

select forecast.issue('<forecast>', '2026-03-04T00:00:00Z');
select forecast.accuracy('<forecast>', '2026-03-04T00:00:00Z', '2026-03-05T00:00:00Z', '12 hours');
```

From TypeScript, `createForecast()`, `issueForecast()` and
`forecastAccuracy()` of `src/forecast.ts` call the same functions.

## Conventions

A value is dated at the start of its interval, in UTC, in the unit of its
quantity. A season, a horizon and a history are elapsed time: a daily
season is 24 hours, so a change of daylight-saving time shifts a local
pattern by an hour for the days after it. A forecast continues a measured
or simulated series of values per interval or at an instant, with a step
of fixed length; a cumulative register is forecast through its amount per
interval.

## What it does not do yet

Models that learn — regressions, trees, models driven by the weather of the
`weather` module — come as methods of their own, in TypeScript or through a
program connector ([0013](../../docs/decisions/0013-a-program-connector-reads-one-request.md)),
each measured against these two benchmarks. Issuing on a schedule is the
installation's: a forecast is issued when it is asked to be.

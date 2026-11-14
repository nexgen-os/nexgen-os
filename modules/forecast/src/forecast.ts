// Forecasts of a series of the core, typed for TypeScript.
//
// The gestures are the module's SQL functions (`forecast.issue()`,
// `forecast.accuracy()`), so that a page, the Python client, the command
// line and an agent compute the same forecast; this file names them and
// says what they take. The issued values are read like any forecast of the
// core, by `forecastAt()` or `resample()` of `@nexgen-os/core`.

import type { Db } from '@nexgen-os/core';

/** A series of the core forecast by a method of `forecast.methods`. */
export interface ForecastRequest {
  /** The series forecast: measured or simulated, regular, not a cumulative register. */
  seriesId: string;
  /** A method of `forecast.methods`: `naive`, `seasonal_naive`. */
  method: string;
  /** How far beyond an issue it forecasts, a Postgres interval (`1 day`). */
  horizon: string;
  /** The season a seasonal method repeats (`1 day`, `7 days`), a whole number of steps of the series. */
  season?: string | null;
  /** How far before an issue it reads the series; `28 days` when absent. */
  history?: string | null;
}

/** How far a forecast was from its series over a period, in the unit of the quantity. */
export interface Accuracy {
  pairs: number;
  /** Mean absolute error. */
  mae: number | null;
  /** Root mean square error. */
  rmse: number | null;
  /** Mean error: positive when the forecast is above what was measured. */
  bias: number | null;
  from: string;
  to: string;
  horizon: string | null;
  unit: string;
  series_id: string;
  forecast_series_id: string;
  method: string;
}

/** A forecast of a series, not yet issued; it takes the organisation of the series. Returns its id. */
export async function createForecast(db: Db, request: ForecastRequest): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into forecast.forecasts (series_id, method, horizon, season, history)
     values ($1, $2, $3::interval, $4::interval, coalesce($5::interval, '28 days'))
     returning id`,
    [request.seriesId, request.method, request.horizon, request.season ?? null, request.history ?? null],
  );
  return r.rows[0].id;
}

/** Issues a forecast as known at `issuedAt` (now when absent): an issue in the past is a backtest. Returns the forecast series. */
export async function issueForecast(db: Db, forecastId: string, issuedAt?: string | null): Promise<string> {
  const r = await db.query<{ id: string }>(
    'select forecast.issue($1, coalesce($2::timestamptz, now())) id',
    [forecastId, issuedAt ?? null],
  );
  return r.rows[0].id;
}

/** The accuracy of a forecast over a period, each value forecast at least `horizon` ahead (its latest issue when absent). */
export async function forecastAccuracy(db: Db, forecastId: string, from: string, to: string, horizon?: string | null): Promise<Accuracy> {
  const r = await db.query<{ a: Accuracy }>(
    'select forecast.accuracy($1, $2::timestamptz, $3::timestamptz, $4::interval) a',
    [forecastId, from, to, horizon ?? null],
  );
  return r.rows[0].a;
}

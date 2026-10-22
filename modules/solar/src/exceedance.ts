// P50 and P90 of a yield estimate: the energy a year exceeds with a probability.
//
// A yield estimate on real years gives one total per year. Their mean is the
// P50; their spread from one year to the next is the interannual
// variability, the one component of the uncertainty the weather itself
// measures. The others — the irradiance dataset, the transposition, the
// models, soiling, availability — are not in the data: the caller names
// them, each as a standard deviation in percent, and they are added in
// quadrature, as yield assessments do. The annual energy is taken as
// normally distributed:
//
//   σ = √(σ_interannual² / horizon + Σ σ_i²),   P_x = P50 · (1 − z_x · σ)
//
// with `horizon` the number of years the figure is for (1: any one year;
// 10: the mean of ten years, whose weather varies less). The result is an estimate
// of the `solar` module that names the yield estimate, the yearly totals and every
// component, so that anyone can redo it.

import type { Db } from '@nexgen-os/core';
import { annualTotals } from './pvwatts.js';

export const EXCEEDANCE_ENGINE_VERSION = 'solar-exceedance-0.3.0';

export interface ExceedanceRequest {
  /** A yield estimate of the `solar` module on real years. */
  yieldEstimateId: string;
  /** The components the years do not measure, each a standard deviation in percent of the P50. */
  uncertainties?: { code: string; pct: number }[];
  /** The probabilities of exceedance asked for, in percent. Default 75, 90, 99. */
  probabilities?: number[];
  /** The number of years the figure is for. Default 1. */
  horizonYears?: number;
}

export interface ExceedanceResult {
  estimateId: string;
  p50_kwh: number;
  /** `{ "90": kWh, … }`. */
  exceedance_kwh: Record<string, number>;
  /** Relative standard deviations: interannual (one year), over the horizon, and the total. */
  sigma: { interannual: number; interannual_over_horizon: number; total: number };
  years: { year: number; kwh: number }[];
}

/**
 * Named errors: `estimate_not_found`, `real_years_required` (a typical year, or
 * fewer than two complete years), `time_zone_required`.
 */
export async function exceedance(db: Db, request: ExceedanceRequest): Promise<ExceedanceResult> {
  const estimate = (
    await db.query<{ id: string; device_id: string; inputs: { weather?: { years?: { from: number; to: number } } }; results: { series_id?: string; typical_months?: unknown } }>(
      `select id, device_id, inputs, results from solar.estimates where id = $1`,
      [request.yieldEstimateId],
    )
  ).rows[0];
  const years = estimate?.inputs.weather?.years;
  if (!estimate || !estimate.results.series_id || !years) throw new Error(`estimate_not_found: ${request.yieldEstimateId} is not a yield estimate`);
  if (estimate.results.typical_months) throw new Error('real_years_required: the estimate gives one typical year; P50 and P90 need an estimate on real years');

  const seriesId = estimate.results.series_id;
  const tz = (await db.query<{ tz: string | null }>('select series_time_zone($1) tz', [seriesId])).rows[0]?.tz;
  if (!tz) throw new Error('time_zone_required: the years of the estimate are cut in the participant\'s time zone');
  const values = (
    await db.query<{ bucket: string | Date; value: number }>(
      `select bucket, value from resample($1, ($2::text || '-01-01')::timestamp at time zone $4, ($3::text || '-01-01')::timestamp at time zone $4, '1 hour')`,
      [seriesId, years.from - 1, years.to + 2, tz],
    )
  ).rows.map((r) => ({ at: new Date(r.bucket).toISOString(), value: r.value }));
  const totals = annualTotals(values, tz, years);
  if (totals.length < 2) throw new Error(`real_years_required: ${totals.length} complete year in the estimate; the spread needs two or more`);

  const horizon = request.horizonYears ?? 1;
  if (!(horizon >= 1)) throw new Error('horizon_invalid: the horizon is one year or more');
  const uncertainties = request.uncertainties ?? [];
  for (const u of uncertainties) if (!(u.pct >= 0)) throw new Error(`uncertainty_invalid: ${u.code} is a standard deviation in percent, zero or more`);
  const probabilities = request.probabilities ?? [75, 90, 99];
  for (const p of probabilities) if (!(p > 0 && p < 100)) throw new Error(`probability_invalid: ${p} is not a percentage between 0 and 100`);

  const n = totals.length;
  const p50 = totals.reduce((s, t) => s + t.total, 0) / n;
  const interannual = Math.sqrt(totals.reduce((s, t) => s + (t.total - p50) ** 2, 0) / (n - 1)) / p50;
  const overHorizon = interannual / Math.sqrt(horizon);
  const total = Math.sqrt(overHorizon ** 2 + uncertainties.reduce((s, u) => s + (u.pct / 100) ** 2, 0));
  const exceedanceKwh = Object.fromEntries(probabilities.map((p) => [String(p), round(p50 * (1 - normalQuantile(p / 100) * total), 3)]));

  const result: Omit<ExceedanceResult, 'estimateId'> = {
    p50_kwh: round(p50, 3),
    exceedance_kwh: exceedanceKwh,
    sigma: { interannual: round(interannual, 6), interannual_over_horizon: round(overHorizon, 6), total: round(total, 6) },
    years: totals.map((t) => ({ year: t.year, kwh: round(t.total, 3) })),
  };
  const inputs = {
    kind: 'exceedance',
    yield_estimate_id: estimate.id,
    series_id: seriesId,
    years: result.years,
    uncertainties,
    probabilities,
    horizon_years: horizon,
    method: 'normal distribution of the annual energy; interannual variability from the years of the estimate (sample standard deviation), divided by the square root of the horizon; the named components added in quadrature',
  };
  const recorded = await db.query<{ id: string }>(
    `select record_calculation('solar.estimates', 'device', $2, $1, $3::jsonb, $4::jsonb) id`,
    [EXCEEDANCE_ENGINE_VERSION, estimate.device_id, JSON.stringify(inputs), JSON.stringify(result)],
  );
  return { estimateId: recorded.rows[0].id, ...result };
}

/**
 * The `q` quantile of the standard normal distribution: P90 uses q = 0.9,
 * z = 1.2816. Acklam's rational approximation, relative error below 1.2e-9.
 */
export function normalQuantile(q: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (q < low) {
    const t = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  if (q > 1 - low) return -normalQuantile(1 - q);
  const r = q - 0.5;
  const s = r * r;
  return ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

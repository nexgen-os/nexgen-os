// P50 and P90 of a yield estimate: the energy a year exceeds with a probability.
//
// A yield estimate on real years gives one total per year, in the
// participant's local standard years; `exceedanceLevels()` of
// `@nexgen-os/solar` gives their P50, their spread and the levels asked for
// (the method is written there). The result is an estimate of the `solar`
// module that names the yield estimate, the yearly totals and every
// component, so that anyone can redo it.

import type { Db } from '@nexgen-os/core';
import { annualTotals, exceedanceLevels, type ExceedanceLevels } from '@nexgen-os/solar';
import { writeEstimate } from './estimates.js';

export const EXCEEDANCE_ENGINE_VERSION = 'solar-exceedance-0.3.0';

export interface ExceedanceRequest {
  /** A yield estimate of the `solar` module on real years. */
  yieldEstimateId: string;
  /** The components the years do not measure, each a standard deviation in percent of the P50. */
  uncertainties?: { code: string; pct: number }[];
  /** The probabilities of exceedance asked for, in percent (P75, P90, P95, P99…). Default 75, 90, 99. Kept with P50 as rows of `solar.estimate_levels`. */
  probabilities?: number[];
  /** The number of years the figure is for. Default 1. */
  horizonYears?: number;
  /** An estimate this computation replaces: it keeps its id and takes the new inputs, provenance and results. */
  replaces?: string;
}

export interface ExceedanceResult extends ExceedanceLevels {
  estimateId: string;
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

  const probabilities = request.probabilities ?? [75, 90, 99];
  const uncertainties = request.uncertainties ?? [];
  const horizon = request.horizonYears ?? 1;
  const result = exceedanceLevels(totals, { uncertainties, probabilities, horizonYears: horizon });

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
  const { estimateId } = await writeEstimate(db, {
    provenance: EXCEEDANCE_ENGINE_VERSION, kind: 'exceedance', deviceId: estimate.device_id, inputs, results: () => ({ ...result }), replaces: request.replaces,
    levels: [{ probability: 50, energy_kwh: result.p50_kwh },
      ...probabilities.filter((p) => p !== 50).map((p) => ({ probability: p, energy_kwh: result.exceedance_kwh[String(p)] }))],
  });
  return { estimateId, ...result };
}

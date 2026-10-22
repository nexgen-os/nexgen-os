// How a PV system performs against the sun it received and the yield it was
// expected to give: the indicators of IEC 61724-1 (decision 0012).
//
//   final yield Yf      = measured energy / installed DC power (kWh/kWp, hours)
//   reference yield Yr  = in-plane irradiation / 1 kW/m² (hours)
//   performance ratio   = Yf / Yr
//   energy performance index EPI = measured energy / expected energy,
//                         the expected energy being a yield estimate's series
//
// They are computed on the hours where every series read has a value, so
// that a missing reading never counts as a dark hour; how many hours that
// is, is part of the answer. Months are cut in the participant's time zone. The
// in-plane irradiance is measured when a sensor on the system (or on its one
// array) gives it, else the yield estimate's simulated irradiance of each array,
// weighted by the arrays' power, and the answer says which. The result is an
// estimate of the `solar` module whose inputs name every series read, and a new
// computation that names it replaces it.

import type { Db } from '@nexgen-os/core';
import { writeEstimate } from './estimates.js';

export const PERFORMANCE_ENGINE_VERSION = 'solar-iec61724-0.3.0';
const G_REF_W_M2 = 1000;

export interface PerformanceRequest {
  pvSystemId: string;
  /** First and last day included, `YYYY-MM-DD` in the participant's time zone. */
  from: string;
  to: string;
  /** The yield estimate the measurement is compared with: the energy performance index, and the irradiance when no sensor gives it. */
  yieldEstimateId?: string;
  /** An estimate this computation replaces: it keeps its id and takes the new inputs, provenance and results. */
  replaces?: string;
}

export interface PeriodIndicators {
  /** `YYYY-MM` in the participant's time zone, or `total`. */
  period: string;
  /** Hours where every series read has a value. */
  hours: number;
  energy_kwh: number;
  irradiation_kwh_m2: number;
  final_yield_h: number;
  reference_yield_h: number;
  /** Null when the plane received no light in those hours. */
  performance_ratio: number | null;
  expected_kwh: number | null;
  energy_performance_index: number | null;
}

export interface PerformanceResult {
  estimateId: string;
  irradiance: 'measured' | 'simulated';
  total: PeriodIndicators;
  months: PeriodIndicators[];
}

interface SeriesRead {
  id: string;
  samples: number;
  total: number;
  values: Map<number, number>;
}

/**
 * The IEC 61724-1 indicators of a PV system over whole days, written as an
 * estimate. Named errors: `pv_system_not_found`, `time_zone_required`,
 * `series_not_found` (no measured production), `irradiance_required` (no
 * sensor and no yield estimate to read it from), `estimate_not_of_system`,
 * `period_not_covered` (no hour where every series has a value).
 */
export async function performanceIndicators(db: Db, request: PerformanceRequest): Promise<PerformanceResult> {
  const system = (
    await db.query<{ time_zone: string | null; kwp_dc: string; start: string; end: string }>(
      `select s.time_zone, p.kwp_dc,
              (($2::date)::timestamp at time zone coalesce(s.time_zone, 'UTC'))::text start,
              (($3::date + 1)::timestamp at time zone coalesce(s.time_zone, 'UTC'))::text "end"
         from solar.pv_systems p
         join devices d on d.id = p.id
         join participants s on s.id = d.participant_id
        where p.id = $1`,
      [request.pvSystemId, request.from, request.to],
    )
  ).rows[0];
  if (!system) throw new Error(`pv_system_not_found: ${request.pvSystemId}`);
  if (!system.time_zone) throw new Error('time_zone_required: the participant of the PV system has no time zone; the indicators are given by month in it');
  const timeZone = system.time_zone;
  const kwp = Number(system.kwp_dc);
  const read = (seriesId: string) => readHourly(db, seriesId, system.start, system.end);

  const measuredId = (
    await db.query<{ id: string }>(
      `select id from series where object_id = $1 and quantity_code = 'production_energy' and kind = 'measured' order by created_at, id limit 1`,
      [request.pvSystemId],
    )
  ).rows[0]?.id;
  if (!measuredId) throw new Error('series_not_found: no measured production on the PV system');
  const energy = await read(measuredId);

  let estimate: { id: string; results: { series_id?: string; array_series?: Record<string, Record<string, string>> } } | undefined;
  if (request.yieldEstimateId) {
    estimate = (await db.query<typeof estimate & object>(`select id, results from solar.estimates where id = $1 and device_id = $2`, [request.yieldEstimateId, request.pvSystemId])).rows[0];
    if (!estimate) throw new Error(`estimate_not_of_system: ${request.yieldEstimateId} is not a yield estimate of this PV system`);
  }

  // The plane's irradiance: a sensor on the system, else the estimate's arrays weighted by power.
  const sensors = (
    await db.query<{ id: string }>(
      `select s.id from series s
        where s.quantity_code = 'poa_irradiance' and s.kind = 'measured' and s.object_kind = 'device' and s.object_id = $1
        order by s.created_at, s.id`,
      [request.pvSystemId],
    )
  ).rows;
  let irradiance: Map<number, number>;
  let irradianceInputs: unknown;
  let source: PerformanceResult['irradiance'];
  if (sensors.length > 0) {
    const sensor = await read(sensors[0].id);
    irradiance = sensor.values;
    irradianceInputs = { source: 'measured', series: [fingerprint(sensor)] };
    source = 'measured';
  } else if (estimate?.results.array_series) {
    const arrays = (await db.query<{ name: string; kwp_dc: string }>(`select name, kwp_dc from solar.pv_arrays where pv_system_id = $1`, [request.pvSystemId])).rows;
    const weighted: { read: SeriesRead; kwp: number }[] = [];
    for (const a of arrays) {
      const id = estimate.results.array_series[a.name]?.poa_irradiance;
      if (id) weighted.push({ read: await read(id), kwp: Number(a.kwp_dc) });
    }
    if (weighted.length === 0) throw new Error('irradiance_required: the yield estimate has no in-plane irradiance of the arrays');
    irradiance = weightedMean(weighted);
    irradianceInputs = { source: 'simulated', estimate_id: estimate.id, series: weighted.map((w) => ({ ...fingerprint(w.read), kwp: w.kwp })) };
    source = 'simulated';
  } else {
    throw new Error('irradiance_required: no in-plane irradiance sensor on the system, and no yield estimate to read it from');
  }

  const expected = estimate?.results.series_id ? await read(estimate.results.series_id) : null;

  // The hours every series has; months in the participant's time zone.
  const month = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
  const sums = new Map<string, { hours: number; e: number; h: number; x: number }>();
  for (const [at, e] of energy.values) {
    const g = irradiance.get(at);
    const x = expected ? expected.values.get(at) : 0;
    if (g === undefined || x === undefined) continue;
    const key = month.format(new Date(at)).slice(0, 7);
    const s = sums.get(key) ?? { hours: 0, e: 0, h: 0, x: 0 };
    s.hours += 1;
    s.e += e;
    s.h += g / 1000;
    s.x += x;
    sums.set(key, s);
  }
  if (sums.size === 0) throw new Error('period_not_covered: no hour of the period has every series it needs');

  const indicators = (period: string, s: { hours: number; e: number; h: number; x: number }): PeriodIndicators => {
    const yf = s.e / kwp;
    const yr = s.h / (G_REF_W_M2 / 1000);
    return {
      period,
      hours: s.hours,
      energy_kwh: round(s.e),
      irradiation_kwh_m2: round(s.h),
      final_yield_h: round(yf),
      reference_yield_h: round(yr),
      performance_ratio: yr > 0 ? round(yf / yr) : null,
      expected_kwh: expected ? round(s.x) : null,
      energy_performance_index: expected && s.x > 0 ? round(s.e / s.x) : null,
    };
  };
  const months = [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, s]) => indicators(k, s));
  const all = [...sums.values()].reduce((t, s) => ({ hours: t.hours + s.hours, e: t.e + s.e, h: t.h + s.h, x: t.x + s.x }), { hours: 0, e: 0, h: 0, x: 0 });
  const total = indicators('total', all);

  const inputs = {
    kind: 'performance',
    standard: 'IEC 61724-1',
    period: { from: request.from, to: request.to, time_zone: timeZone },
    kwp,
    measured: fingerprint(energy),
    irradiance: irradianceInputs,
    expected: expected ? { estimate_id: estimate!.id, ...fingerprint(expected) } : null,
    conventions: {
      hours: 'hours where every series read has a value',
      g_ref_w_m2: G_REF_W_M2,
      months: "cut in the participant's time zone",
    },
  };
  const { estimateId } = await writeEstimate(db, {
    provenance: PERFORMANCE_ENGINE_VERSION, deviceId: request.pvSystemId, inputs, results: () => ({ irradiance: source, total, months }), replaces: request.replaces,
  });
  return { estimateId, irradiance: source, total, months };
}

/** A series read hour by hour through `resample()`, keyed by the hour's start in milliseconds. */
async function readHourly(db: Db, seriesId: string, start: string, end: string): Promise<SeriesRead> {
  const rows = (await db.query<{ bucket: string | Date; value: number }>(`select bucket, value from resample($1, $2, $3, '1 hour')`, [seriesId, start, end])).rows;
  const values = new Map(rows.map((r) => [new Date(r.bucket).getTime(), r.value]));
  return { id: seriesId, samples: rows.length, total: round(rows.reduce((s, r) => s + r.value, 0)), values };
}

/** What an estimate says of a series it read: enough for a new reading to make a new estimate. */
function fingerprint(s: SeriesRead): { series_id: string; samples: number; total: number } {
  return { series_id: s.id, samples: s.samples, total: s.total };
}

/** The power-weighted mean of several irradiance series, on the hours they all have. */
function weightedMean(series: { read: SeriesRead; kwp: number }[]): Map<number, number> {
  const weight = series.reduce((s, x) => s + x.kwp, 0);
  const out = new Map<number, number>();
  for (const [at] of series[0].read.values) {
    let sum = 0;
    let complete = true;
    for (const s of series) {
      const v = s.read.values.get(at);
      if (v === undefined) {
        complete = false;
        break;
      }
      sum += v * s.kwp;
    }
    if (complete) out.set(at, sum / weight);
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

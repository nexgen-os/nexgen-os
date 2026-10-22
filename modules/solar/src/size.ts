// To size is one gesture: `size(subject, criterion, bounds)` (decision 0045).
//
// `size()` answers the PV power that best meets a named criterion for a
// participant, within the limit of its roof — the roof faces of the
// `building` module times the power a square metre carries
// (`pv_power_per_area`, read by parameter_of()), or a maximum the caller
// states. It sweeps the powers from nothing to that limit and, for each,
// splits the production of the period step by step: what is consumed on the
// spot is min(production, consumption), the rest is injected. The
// consumption is the participant's curve, measured first
// (`consumption.curve()`); the production of one kWp is a production series
// the caller names with the power it was computed for (a yield of this
// module, a reference system), so that every figure says what it read.
//
// The rule is the one of the platform this core was taken from
// (`utils/solarSizing.ts`): a target self-consumption rate is met by the
// power closest to it, an economic criterion by the best value over a sweep
// bounded by the roof, and the step is refined around the best point.
// The criteria are the core's vocabulary `sizing_criteria`; money is the
// caller's, in the currency of the place: the price of the energy taken
// from the grid, the price of the energy injected, the cost of a kWp, the
// horizon and the discount rate.
//
// The answer is a row of `solar.estimates` about the participant, kind
// `sizing`: its inputs (the criterion, the bounds and where the limit came
// from, the series read, the economics), its provenance, and its results —
// the curve of the sweep and the recommended point. Nothing else is written.

import type { Db } from '@nexgen-os/core';
import { resample } from '@nexgen-os/core';
import { writeEstimate } from './estimates.js';

export const SIZING_ENGINE_VERSION = 'solar-size-0.3.0';
const SWEEP_POINTS = 100;
const YEAR_MS = 365.25 * 86_400_000;

export interface SizingEconomics {
  /** The price of a kWh taken from the grid, saved by each kWh consumed on the spot. */
  offtakePricePerKwh: number;
  /** The price a kWh injected earns. */
  injectionPricePerKwh: number;
  /** What one kWp costs installed. */
  costPerKwp: number;
  /** The years the investment is counted over. */
  horizonYears: number;
  /** The yearly discount rate, 0.04 for 4 %. */
  discountRate: number;
  /** The currency of these figures, ISO 4217. */
  currency: string;
}

export interface SizingRequest {
  participantId: string;
  /** A code of `sizing_criteria`. */
  criterion: string;
  /** For a criterion that aims at a target (`self_consumption_rate`, `self_sufficiency`): 0 to 1. */
  target?: number;
  /** The period the curves are read over, `[from, to)`; a whole year is the usual one. */
  from: string;
  to: string;
  /** A Postgres interval: `1 hour`, `15 minutes`. */
  step: string;
  /** The production of `kwp` kWp over the period: a production series and the power it was computed for. */
  shape: { seriesId: string; kwp: number };
  /** The limit of the power: a stated maximum, else the roof faces of the participant (`building`). */
  bounds?: { maxKwp?: number; source?: string };
  economics?: SizingEconomics;
}

export interface SizingPoint {
  kwp: number;
  productionKwh: number;
  selfConsumedKwh: number;
  injectedKwh: number;
  selfConsumptionRate: number;
  selfSufficiency: number;
  netPresentValue?: number;
  paybackYears?: number | null;
}

export interface SizingResult {
  estimateId: string;
  recommended: SizingPoint;
  curve: SizingPoint[];
  limit: { maxKwp: number; by: string };
}

interface Criterion {
  code: string;
  aim: 'maximise' | 'minimise' | 'target';
}

export async function size(db: Db, request: SizingRequest): Promise<SizingResult> {
  const participant = (await db.query<{ id: string }>('select id from participants where id = $1', [request.participantId])).rows[0];
  if (!participant) throw new Error(`participant_not_found: ${request.participantId}`);
  const criterion = (await db.query<Criterion>('select code, aim from sizing_criteria where code = $1', [request.criterion])).rows[0];
  if (!criterion) throw new Error(`sizing_criterion_unknown: ${request.criterion} is not a sizing_criteria code`);
  if (criterion.aim === 'target' && !(request.target !== undefined && request.target > 0 && request.target <= 1)) {
    throw new Error(`target_required: ${criterion.code} aims at a target between 0 and 1`);
  }
  if ((criterion.code === 'payback' || criterion.code === 'net_present_value') && !request.economics) {
    throw new Error(`economics_required: ${criterion.code} reads the prices, the cost of a kWp, the horizon and the discount rate`);
  }
  if (!(request.shape.kwp > 0)) throw new Error('shape_invalid: the production series is given with the power it was computed for');

  const limit = await limitOf(db, request);

  // The curves on one grid of steps: consumption measured first, production of one kWp.
  const hasConsumption = (
    await db.query<{ ok: boolean }>(`select to_regprocedure('consumption.curve(uuid, timestamptz, timestamptz, interval)') is not null ok`)
  ).rows[0].ok;
  if (!hasConsumption) throw new Error('consumption_curve_missing: the consumption module reads the curve a sizing is made against');
  const consumptionRows = (
    await db.query<{ bucket: string | Date; value: number | null; series_id: string; kind: string }>(
      'select bucket, value, series_id, kind from consumption.curve($1, $2::timestamptz, $3::timestamptz, $4::interval)',
      [request.participantId, request.from, request.to, request.step],
    )
  ).rows;
  if (consumptionRows.length === 0) throw new Error(`consumption_curve_missing: participant ${request.participantId} has no consumption from ${request.from} to ${request.to}`);
  const consumption = new Map(consumptionRows.filter((r) => r.value !== null).map((r) => [Date.parse(new Date(r.bucket).toISOString()), Number(r.value)]));
  const shape = new Map(
    (await resample(db, request.shape.seriesId, request.from, request.to, request.step))
      .filter((b) => b.value !== null && b.samples > 0)
      .map((b) => [Date.parse(b.bucket), Number(b.value) / request.shape.kwp]),
  );
  const steps = [...consumption.keys()].filter((at) => shape.has(at));
  if (steps.length === 0) throw new Error('series_incomplete: the production and the consumption share no step of the period');
  const years = (Date.parse(request.to) - Date.parse(request.from)) / YEAR_MS;
  const consumed = steps.reduce((s, at) => s + consumption.get(at)!, 0);

  const point = (kwp: number): SizingPoint => {
    let production = 0;
    let self = 0;
    for (const at of steps) {
      const p = kwp * shape.get(at)!;
      production += p;
      self += Math.min(p, consumption.get(at)!);
    }
    const pt: SizingPoint = {
      kwp: round(kwp, 3),
      productionKwh: round(production, 3),
      selfConsumedKwh: round(self, 3),
      injectedKwh: round(production - self, 3),
      selfConsumptionRate: production > 0 ? round(self / production, 4) : 1,
      selfSufficiency: consumed > 0 ? round(self / consumed, 4) : 0,
    };
    const e = request.economics;
    if (e) {
      const yearly = ((self * e.offtakePricePerKwh) + ((production - self) * e.injectionPricePerKwh)) / years;
      const cost = kwp * e.costPerKwp;
      let npv = -cost;
      for (let t = 1; t <= e.horizonYears; t += 1) npv += yearly / (1 + e.discountRate) ** t;
      pt.netPresentValue = round(npv, 2);
      pt.paybackYears = kwp > 0 && yearly > 0 ? round(cost / yearly, 2) : null;
    }
    return pt;
  };

  // The sweep, then a finer one around the best point.
  const coarse = limit.maxKwp / SWEEP_POINTS;
  const curve = Array.from({ length: SWEEP_POINTS }, (_, i) => point((i + 1) * coarse));
  let best = pick(curve, criterion, request.target);
  const fine = Array.from({ length: 21 }, (_, i) => best.kwp - coarse + (i * coarse) / 10)
    .filter((k) => k > 0 && k <= limit.maxKwp)
    .map(point);
  best = pick([best, ...fine], criterion, request.target);

  const { estimateId } = await writeEstimate(db, {
    provenance: SIZING_ENGINE_VERSION,
    kind: 'sizing',
    participantId: request.participantId,
    inputs: {
      criterion: { code: criterion.code, aim: criterion.aim, target: request.target ?? null },
      period: { from: request.from, to: request.to, step: request.step, steps: steps.length },
      limit,
      consumption: { series_id: consumptionRows[0].series_id, kind: consumptionRows[0].kind, kwh: round(consumed, 3) },
      production_shape: { series_id: request.shape.seriesId, kwp: request.shape.kwp },
      economics: request.economics ?? null,
      method: 'a sweep of powers up to the limit; at each step, self-consumed = min(production, consumption), injected = the rest',
      conventions: { energy: 'kWh over the period', money: 'the currency of the economics, per year over the period' },
    },
    results: () => ({ recommended: best, curve }),
  });
  return { estimateId, recommended: best, curve, limit };
}

/** The best point for a criterion: the closest to its target, the largest or the smallest value it reads. */
function pick(points: SizingPoint[], criterion: Criterion, target?: number): SizingPoint {
  const value = (p: SizingPoint): number => {
    switch (criterion.code) {
      case 'self_consumption_rate':
        return -Math.abs(p.selfConsumptionRate - target!);
      case 'self_sufficiency':
        return -Math.abs(p.selfSufficiency - target!);
      case 'net_present_value':
        return p.netPresentValue ?? -Infinity;
      case 'payback':
        return p.paybackYears === null || p.paybackYears === undefined ? -Infinity : -p.paybackYears;
      case 'max_power':
        return p.kwp;
      default:
        throw new Error(`sizing_criterion_unsupported: solar.size() does not size for ${criterion.code}`);
    }
  };
  // Ties go to the smaller power: what costs less for the same answer.
  return points.reduce((a, b) => (value(b) > value(a) + 1e-12 || (Math.abs(value(b) - value(a)) <= 1e-12 && b.kwp < a.kwp) ? b : a));
}

/** The limit of the power: the stated one, else the roof faces of the participant times the power a square metre carries. */
async function limitOf(db: Db, request: SizingRequest): Promise<{ maxKwp: number; by: string; source?: string; roof_m2?: number; per_area?: unknown }> {
  if (request.bounds?.maxKwp !== undefined) {
    if (!(request.bounds.maxKwp > 0)) throw new Error('bounds_invalid: the maximum power is positive');
    return { maxKwp: request.bounds.maxKwp, by: 'stated', ...(request.bounds.source ? { source: request.bounds.source } : {}) };
  }
  const hasBuilding = (await db.query<{ ok: boolean }>(`select to_regclass('building.surfaces') is not null ok`)).rows[0].ok;
  const roof = hasBuilding
    ? Number((await db.query<{ m2: number | null }>(
        `select sum(s.area_m2) m2 from building.surfaces s
           left join building.buildings b on b.id = s.building_id
           left join building.sites t on t.id = s.site_id
          where s.kind in ('roof', 'carport') and coalesce(b.participant_id, t.participant_id) = $1`,
        [request.participantId],
      )).rows[0].m2 ?? 0)
    : 0;
  if (!(roof > 0)) throw new Error('max_power_required: state a maximum power, or describe the roof faces of the participant with their area (building module)');
  const perArea = (await db.query<{ p: { value: number } }>(`select parameter_of('participant', $1, 'pv_power_per_area') p`, [request.participantId])).rows[0].p;
  return { maxKwp: round(roof * Number(perArea.value), 3), by: 'roof', roof_m2: roof, per_area: perArea };
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

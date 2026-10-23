// The two gestures of the `battery` module, each recorded as estimates:
//
//   dispatch()  runs the batteries of a perimeter — a participant's place,
//               or a project's sharing — over a period, at the step of its
//               series, chained in the order they were described; writes
//               one estimate per battery, its charge, discharge and state
//               of charge as `simulated` series of the device.
//   size()      sweeps the capacity of one more battery for a participant or
//               a project, after the batteries it already has, and returns
//               the curve and the point a named criterion recommends; writes
//               one estimate about the participant or the project.
//
// What a dispatch reads is said in its inputs, each figure with where it
// came from: the battery from `battery.battery_of()` (the device, its
// product, else `parameter_of()`), the series by their ids, the prices from
// a price series of the perimeter or from `parameter_of()`. Nothing is a
// constant of this file.

import { store, type Db } from '@nexgen-os/core';
import {
  OBJECTIVES, BATTERY_ENGINE_VERSION, dispatchChain, indicators, round,
  type Battery, type Dispatch, type Flows, type Indicators, type Objective,
} from './dispatch.js';

/**
 * The criteria of the core's vocabulary `sizing_criteria` a battery's
 * recommended point is found for; the vocabulary is the one list of the
 * words, read by `size()`.
 */
export const RECOMMENDED_FOR = ['self_consumption_rate', 'self_sufficiency', 'payback', 'net_present_value', 'max_power'] as const;
export type Criterion = (typeof RECOMMENDED_FOR)[number];

/** A Julian year, in hours: the year a figure of a period is scaled to. */
const YEAR_HOURS = 8766;

export interface Perimeter {
  kind: 'participant' | 'project';
  id: string;
}

export interface PeriodRequest {
  /** The participant whose place, or the project whose sharing, the batteries see. */
  perimeter: Perimeter;
  /** The period, as instants: `from` included, `to` excluded. */
  from: string;
  to: string;
  /** The step of the dispatch, a Postgres interval under a day; the step of the consumption series when absent. */
  step?: string;
  /**
   * The series to read, by id. Absent: for a participant, its
   * `production_energy` and `consumption_energy` series; for a project, its
   * `injection_energy` (the surplus left once energy is shared) and
   * `offtake_energy` (the residual) — measured first, then the latest; the
   * prices, an `energy_price` series of the participant, its project or its
   * organisation, when one holds values over the period.
   */
  series?: { production?: string; consumption?: string; prices?: string };
  /**
   * The property of the price of energy taken from the grid. Absent: the
   * energy price of the segment of the participant (of the first battery
   * on a project's sharing), `energy_price_household` for a residential
   * one, `energy_price_business` for a professional one.
   */
  offtakePrice?: string;
}

/** A battery of a perimeter, with what the dispatch read of it. */
interface Described {
  deviceId: string;
  participantId: string;
  battery: Battery;
  /** What `battery.battery_of()` answered. */
  of: BatteryOf;
}

interface Read {
  flows: Flows;
  buckets: string[];
  step: string;
  /** The buying price of each interval, per kWh, when a price series was read. */
  priceSeries: string | null;
  production: string;
  consumption: string;
  timeZone: string | null;
}

// ---------------------------------------------------------------------------
// Reading the perimeter
// ---------------------------------------------------------------------------

async function perimeterOf(db: Db, perimeter: Perimeter): Promise<{ participantId: string | null; projectId: string; organisationId: string; timeZone: string | null }> {
  if (perimeter.kind === 'participant') {
    const r = (await db.query<{ project_id: string; organisation_id: string; time_zone: string | null }>(
      'select project_id, organisation_id, time_zone from participants where id = $1', [perimeter.id])).rows[0];
    if (!r) throw new Error(`participant_not_found: ${perimeter.id}`);
    return { participantId: perimeter.id, projectId: r.project_id, organisationId: r.organisation_id, timeZone: r.time_zone };
  }
  if (perimeter.kind === 'project') {
    const r = (await db.query<{ organisation_id: string }>('select organisation_id from projects where id = $1', [perimeter.id])).rows[0];
    if (!r) throw new Error(`project_not_found: ${perimeter.id}`);
    return { participantId: null, projectId: perimeter.id, organisationId: r.organisation_id, timeZone: null };
  }
  throw new Error(`perimeter_invalid: ${String((perimeter as Perimeter).kind)}; a battery sees a participant's place or a project's sharing`);
}

/** The series of a quantity of the perimeter: measured first, the one on the perimeter itself first, then the latest. */
async function seriesOf(db: Db, perimeter: Perimeter, quantity: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `select se.id from series se
      where se.quantity_code = $2
        and (se.object_id = $1 or ($3 = 'participant' and participant_of(se.object_kind, se.object_id) = $1))
        and se.kind in ('measured', 'simulated')
      order by se.kind = 'measured' desc, se.object_id = $1 desc, se.created_at desc
      limit 1`,
    [perimeter.id, quantity, perimeter.kind],
  );
  if (!r.rows[0]) throw new Error(`series_not_found: the ${perimeter.kind} ${perimeter.id} has no ${quantity} series; name the series to read`);
  return r.rows[0].id;
}

/** An `energy_price` series of the participant, its project or its organisation holding values over the period, nearest first. */
async function priceSeriesOf(db: Db, objects: string[], from: string, to: string): Promise<string | null> {
  const r = await db.query<{ id: string }>(
    `select se.id from series se
      where se.quantity_code = 'energy_price' and se.object_id = any($1::uuid[])
        and exists (select 1 from series_values v where v.series_id = se.id and v.at >= $2 and v.at < $3)
      order by array_position($1::uuid[], se.object_id), se.created_at desc
      limit 1`,
    [objects, from, to],
  );
  return r.rows[0]?.id ?? null;
}

/** The values of a series on every bucket of the period; refuses a bucket without a value. */
async function onGrid(db: Db, seriesId: string, from: string, to: string, step: string, buckets: string[]): Promise<number[]> {
  const r = await db.query<{ bucket: Date | string; value: number | null }>(
    'select bucket, value from resample($1, $2::timestamptz, $3::timestamptz, $4::interval)', [seriesId, from, to, step]);
  const byBucket = new Map(r.rows.map((b) => [new Date(b.bucket).toISOString(), b.value]));
  const values = buckets.map((b) => byBucket.get(b));
  const missing = values.filter((v) => v === null || v === undefined).length;
  if (missing > 0) throw new Error(`series_incomplete: series ${seriesId} has no value for ${missing} of the ${buckets.length} intervals of the period`);
  return values as number[];
}

async function readFlows(db: Db, request: PeriodRequest, place: Awaited<ReturnType<typeof perimeterOf>>): Promise<Read> {
  const fromMs = Date.parse(request.from);
  const toMs = Date.parse(request.to);
  if (!(toMs > fromMs)) throw new Error(`period_empty: ${request.from} to ${request.to}`);
  const project = request.perimeter.kind === 'project';
  const production = request.series?.production ?? (await seriesOf(db, request.perimeter, project ? 'injection_energy' : 'production_energy'));
  const consumption = request.series?.consumption ?? (await seriesOf(db, request.perimeter, project ? 'offtake_energy' : 'consumption_energy'));
  const step = request.step ?? (await db.query<{ step: string | null }>('select step::text step from series where id = $1', [consumption])).rows[0]?.step;
  if (!step) throw new Error(`step_required: series ${consumption} has no regular step; name the step of the dispatch`);
  const seconds = Number((await db.query<{ s: number }>('select extract(epoch from $1::interval)::float8 s', [step])).rows[0].s);
  if (!(seconds > 0 && seconds < 86400 && (toMs - fromMs) % (seconds * 1000) === 0)) {
    throw new Error(`step_invalid: ${step}; a dispatch runs on a step under a day that divides the period`);
  }
  const buckets: string[] = [];
  for (let t = fromMs; t < toMs; t += seconds * 1000) buckets.push(new Date(t).toISOString());
  const prices = request.series?.prices
    ?? (await priceSeriesOf(db, [place.participantId, place.projectId, place.organisationId].filter((x): x is string => !!x), request.from, request.to));
  return {
    flows: {
      production: await onGrid(db, production, request.from, request.to, step, buckets),
      consumption: await onGrid(db, consumption, request.from, request.to, step, buckets),
      stepHours: seconds / 3600,
      // A price is kept per MWh (energy_price): per kWh here.
      prices: prices ? (await onGrid(db, prices, request.from, request.to, step, buckets)).map((p) => p / 1000) : null,
    },
    buckets,
    step,
    priceSeries: prices,
    production,
    consumption,
    timeZone: place.timeZone,
  };
}

/** The local day of each bucket, in a time zone. */
function localDays(buckets: string[], timeZone: string): string[] {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return buckets.map((b) => f.format(new Date(b)));
}

/** What `battery.battery_of()` answers: each figure with where it came from. */
interface BatteryOf {
  usable_capacity_kwh: { value: number | string };
  charge_power_kw: { value: number | string };
  discharge_power_kw: { value: number | string };
  round_trip_efficiency: { value: number | string };
  min_charge_level: number | string;
  max_charge_level: number | string;
  objective: string;
  peak_threshold_kw: number | string | null;
}

/** A battery as `battery.battery_of()` gives it. */
function batteryFrom(of: BatteryOf): Battery {
  return {
    capacityKwh: Number(of.usable_capacity_kwh.value),
    chargePowerKw: Number(of.charge_power_kw.value),
    dischargePowerKw: Number(of.discharge_power_kw.value),
    efficiency: Number(of.round_trip_efficiency.value),
    minLevel: Number(of.min_charge_level) / 100,
    maxLevel: Number(of.max_charge_level) / 100,
    objective: of.objective as Objective,
    peakThresholdKw: of.peak_threshold_kw === null ? null : Number(of.peak_threshold_kw),
  };
}

/** The batteries of a perimeter that are not out of service, in the order they were described. */
async function batteriesOf(db: Db, perimeter: Perimeter, at: string): Promise<Described[]> {
  const r = await db.query<{ id: string; participant_id: string; of: BatteryOf }>(
    `select d.id, d.participant_id, battery.battery_of(d.id, $3::timestamptz) "of"
       from devices d
       join battery.devices s on s.id = d.id
       join participants p on p.id = d.participant_id
      where d.status not in ('out_of_service', 'removed')
        and case $2 when 'participant' then d.participant_id = $1 and s.perimeter = 'site'
                    else p.project_id = $1 and s.perimeter = 'project' end
      order by s.created_at, d.id`,
    [perimeter.id, perimeter.kind, at],
  );
  return r.rows.map((row) => ({ deviceId: row.id, participantId: row.participant_id, battery: batteryFrom(row.of), of: row.of }));
}

// ---------------------------------------------------------------------------
// Prices and savings
// ---------------------------------------------------------------------------

interface Prices {
  /** Per kWh, in the currency of the perimeter. */
  offtake: number | null;
  injection: number | null;
  /** Each price read, with where it came from, and the parameters that were missing. */
  read: Record<string, unknown>;
  missing: string[];
  currency: string | null;
}

async function parameter(db: Db, kind: string, id: string, property: string, at: string): Promise<{ value: number; from: unknown } | null> {
  const r = (await db.query<{ p: Record<string, unknown> | null }>('select battery.parameter_or_null($1, $2, $3, $4::timestamptz) p', [kind, id, property, at])).rows[0].p;
  return r ? { value: Number(r.value), from: r } : null;
}

/**
 * The prices a saving is valued at, per kWh: energy taken from the grid at
 * the energy price of the participant's segment (`energy_price_household`
 * for a residential one, `energy_price_business` for a professional one),
 * plus `grid_fees_and_taxes` on a participant's place — on a project's
 * sharing, the energy goes through the grid and its fees are not avoided —
 * and energy injected at `injection_price_reference`, each as
 * `parameter_of()` resolves it.
 */
async function pricesOf(db: Db, perimeter: Perimeter, participantId: string | null, at: string, offtakePrice?: string): Promise<Prices> {
  const segment = (await db.query<{ residential: boolean | null; professional: boolean | null }>(
    `select is_a('segments', segment, 'residential') residential, is_a('segments', segment, 'professional') professional
       from participants where id = $1`, [participantId])).rows[0];
  const missing: string[] = [];
  const read: Record<string, unknown> = {};
  const energyProperty = offtakePrice ?? (segment?.residential ? 'energy_price_household' : segment?.professional ? 'energy_price_business' : null);
  if (!energyProperty) missing.push('segment_required: the segment of the participant decides which energy price applies; or name the property of the offtake price');
  const take = async (property: string) => {
    const p = await parameter(db, perimeter.kind, perimeter.id, property, at);
    if (!p) missing.push(`parameter_missing: ${property}`);
    else read[property] = p.from;
    return p ? p.value / 1000 : null;
  };
  const energy = energyProperty ? await take(energyProperty) : null;
  const fees = perimeter.kind === 'participant' ? await take('grid_fees_and_taxes') : 0;
  const injection = await take('injection_price_reference');
  const currency = (await db.query<{ c: string | null }>('select currency_of($1, $2) c', [perimeter.kind, perimeter.id])).rows[0].c;
  return { offtake: energy === null || fees === null ? null : energy + fees, injection, read, missing, currency };
}

/**
 * What a dispatch saves over its period: the offtake it avoided at the
 * price of each interval (the price series, else the offtake price), less
 * the injection it avoided at the injection price. Null when a price is
 * missing.
 */
function savingsOf(flows: Flows, d: Dispatch, prices: Prices, feesPerKwh: number): number | null {
  if (prices.injection === null) return null;
  let offtake = 0;
  for (let i = 0; i < d.offtake.length; i++) {
    const without = Math.max(flows.consumption[i] - flows.production[i], 0);
    const price = flows.prices ? (flows.prices[i] as number) + feesPerKwh : prices.offtake;
    if (price === null) return null;
    offtake += (without - d.offtake[i]) * price;
  }
  const injected = flows.production.reduce((s, p, i) => s + Math.max(p - flows.consumption[i], 0), 0) - d.injection.reduce((s, v) => s + v, 0);
  return offtake - injected * prices.injection;
}

// ---------------------------------------------------------------------------
// dispatch()
// ---------------------------------------------------------------------------

export interface DispatchedBattery {
  estimateId: string;
  deviceId: string;
  indicators: Indicators;
  savings: number | null;
  series: { charge: string; discharge: string; level: string };
}

/**
 * Runs the batteries of a perimeter over a period, chained, and records one
 * estimate per battery with its series. Refuses by name: the perimeter not
 * found, `no_battery`, the series not found or incomplete, a step that
 * does not divide the period, what `battery.battery_of()` and the rule
 * refuse; `time_zone_required` for arbitrage on a participant without one.
 */
export async function dispatch(db: Db, request: PeriodRequest): Promise<DispatchedBattery[]> {
  const place = await perimeterOf(db, request.perimeter);
  const described = await batteriesOf(db, request.perimeter, request.from);
  if (described.length === 0) throw new Error(`no_battery: the ${request.perimeter.kind} ${request.perimeter.id} has no battery in service on its ${request.perimeter.kind === 'participant' ? 'site' : 'sharing'}`);
  const read = await readFlows(db, request, place);
  const needsDays = described.some((b) => b.battery.objective === 'arbitrage');
  if (needsDays) {
    const tz = read.timeZone ?? (await db.query<{ time_zone: string | null }>('select time_zone from participants where id = $1', [described[0].participantId])).rows[0]?.time_zone;
    if (!tz) throw new Error('time_zone_required: arbitrage is decided by local day, and the participant has no time zone');
    read.flows.days = localDays(read.buckets, tz);
  }
  const results = dispatchChain(read.flows, described.map((b) => b.battery));
  const prices = await pricesOf(db, request.perimeter, place.participantId ?? described[0].participantId, request.from, request.offtakePrice);
  const fees = request.perimeter.kind === 'participant' && prices.read.grid_fees_and_taxes ? Number((prices.read.grid_fees_and_taxes as { value: unknown }).value) / 1000 : 0;

  const out: DispatchedBattery[] = [];
  let seen: Flows = read.flows;
  for (const [n, b] of described.entries()) {
    const d = results[n];
    const k = indicators(seen, b.battery, d);
    const saved = savingsOf(seen, d, prices, fees);
    const savings = saved === null ? null : round(saved, 2);
    const inputs = {
      period: { from: request.from, to: request.to, step: read.step, intervals: read.buckets.length },
      perimeter: request.perimeter,
      series: { production: read.production, consumption: read.consumption, prices: read.priceSeries },
      battery: b.of,
      chain: { position: n + 1, of: described.length, after: described.slice(0, n).map((x) => x.deviceId) },
      prices: { read: prices.read, missing: prices.missing, currency: prices.currency },
      conventions: {
        time: 'interval start, UTC', energy: 'kWh per interval', efficiency: 'round trip, its square root on charge and on discharge',
        start_level: 'the level the period ends with, within 1e-4 kWh, twenty passes at most',
      },
    };
    const row = (await db.query<{ id: string }>(
      `insert into battery.estimates (device_id, provenance, inputs, results)
       values ($1, $2, $3::jsonb, '{}') returning id`,
      [b.deviceId, BATTERY_ENGINE_VERSION, JSON.stringify(inputs)])).rows[0];
    const source = `battery.estimates:${row.id}`;
    const write = (quantity: string, values: number[], valueKind: 'interval' | 'instant') =>
      store(db, {
        object_kind: 'device', object_id: b.deviceId, device_id: b.deviceId, quantity_code: quantity, kind: 'simulated', value_kind: valueKind,
        step: read.step, name: `${quantity} ${request.from} to ${request.to}`, source,
      }, values.map((value, i) => ({ at: read.buckets[i], value: round(value) })));
    const series = {
      charge: (await write('battery_charge_energy', d.charge, 'interval')).seriesId,
      discharge: (await write('battery_discharge_energy', d.discharge, 'interval')).seriesId,
      // The state of charge at the start of each interval, in percent of the usable capacity.
      level: (await write('charge_level', d.level.map((l) => (l / b.battery.capacityKwh) * 100), 'instant')).seriesId,
    };
    const results_ = {
      ...k, savings, currency: prices.currency, start_level_kwh: round(d.startLevelKwh), iterations: d.iterations, converged: d.converged, series,
    };
    await db.query('update battery.estimates set results = $2::jsonb where id = $1', [row.id, JSON.stringify(results_)]);
    out.push({ estimateId: row.id, deviceId: b.deviceId, indicators: k, savings, series });
    seen = { ...read.flows, production: d.injection, consumption: d.offtake };
  }
  return out;
}

// ---------------------------------------------------------------------------
// size()
// ---------------------------------------------------------------------------

export interface SizeRequest extends PeriodRequest {
  criterion: Criterion;
  /** The capacities swept, kWh: from `minKwh` to `maxKwh` by `stepKwh`, or `points` points. */
  bounds?: { minKwh?: number; maxKwh?: number; stepKwh?: number; points?: number };
  /** What the battery sized is run for: self-consumption, or peak shaving under a threshold for `max_power`. */
  objective?: Objective;
  peakThresholdKw?: number;
}

export interface SizePoint {
  capacity_kwh: number;
  discharge_kwh: number;
  self_consumption_rate: number | null;
  self_sufficiency: number | null;
  peak_kw: number;
  savings_per_year: number | null;
  /** The operating cost of a year at `battery_opex`; null when nobody says it, and none is counted. */
  opex_per_year: number | null;
  capex: number | null;
  payback_years: number | null;
  net_present_value: number | null;
}

export interface SizeResult {
  estimateId: string;
  curve: SizePoint[];
  recommended: SizePoint | null;
  reason: string | null;
  /** What the caller should know before relying on the recommendation, each starting with a name. */
  warnings: string[];
}

/** How many capacities a sweep has when the request says neither its step nor its points, as the reference rule swept. */
const SWEEP_POINTS = 40;
/** Two values of a rate within this are the same point of the curve; two peaks within this, in kW. */
const SAME_RATE = 1e-3;
const SAME_POWER_KW = 1e-3;

/**
 * Sizes one more battery for a participant or a project, after the
 * batteries it already has: sweeps its capacity, its power from
 * `battery_c_rate` and its efficiency from `round_trip_efficiency` as
 * `parameter_of()` resolves them for the perimeter, and recommends:
 *
 *   self_consumption_rate, self_sufficiency  the smallest capacity within
 *       0.1 point of the best rate of the sweep (past it, a bigger battery
 *       adds less than 0.1 point);
 *   payback            the shortest simple payback, capex over yearly savings;
 *   net_present_value  the greatest net present value over `battery_lifetime`
 *       years at `discount_rate`, none when no capacity pays back;
 *   max_power          the smallest capacity giving the lowest peak of
 *       offtake, the battery run for peak shaving under `peakThresholdKw`.
 *
 * The capex is the capacity at `battery_cost`. Without bounds the sweep
 * goes up to the mean over the days of the period of the smaller of the
 * day's surplus and residual — what one cycle a day can move — in 40 steps.
 */
export async function size(db: Db, request: SizeRequest): Promise<SizeResult> {
  const known = (await db.query<{ code: string }>('select code from sizing_criteria where code = $1', [request.criterion])).rows[0];
  if (!known) throw new Error(`sizing_criterion_unknown: ${String(request.criterion)} is not a sizing_criteria code`);
  if (!RECOMMENDED_FOR.includes(request.criterion)) {
    throw new Error(`criterion_unsupported: a battery is sized for ${RECOMMENDED_FOR.join(', ')}, not ${String(request.criterion)}`);
  }
  const objective: Objective = request.objective ?? (request.criterion === 'max_power' ? 'peak_shaving' : 'self_consumption');
  if (!OBJECTIVES.includes(objective) || objective === 'arbitrage') throw new Error(`objective_unsupported: a sizing runs self_consumption or peak_shaving, not ${objective}`);
  const place = await perimeterOf(db, request.perimeter);
  const read = await readFlows(db, request, place);
  const existing = await batteriesOf(db, request.perimeter, request.from);
  if (existing.some((b) => b.battery.objective === 'arbitrage')) {
    const tz = read.timeZone ?? (await db.query<{ time_zone: string | null }>('select time_zone from participants where id = $1', [existing[0].participantId])).rows[0]?.time_zone;
    if (!tz) throw new Error('time_zone_required: arbitrage is decided by local day, and the participant has no time zone');
    read.flows.days = localDays(read.buckets, tz);
  }
  // What the batteries already there leave.
  const chain = dispatchChain(read.flows, existing.map((b) => b.battery));
  const left: Flows = chain.length ? { ...read.flows, production: chain.at(-1)!.injection, consumption: chain.at(-1)!.offtake } : read.flows;

  const { kind, id } = request.perimeter;
  const need = async (property: string) => {
    const r = (await db.query<{ p: Record<string, unknown> }>('select parameter_of($1, $2, $3, $4::timestamptz) p', [kind, id, property, request.from])).rows[0].p;
    return { value: Number(r.value), from: r };
  };
  const cRate = await need('battery_c_rate');
  const efficiency = await need('round_trip_efficiency');
  const economic = request.criterion === 'payback' || request.criterion === 'net_present_value';
  const optional = async (property: string) => (economic ? need(property) : await parameter(db, kind, id, property, request.from));
  const cost = await optional('battery_cost');
  const opex = await parameter(db, kind, id, 'battery_opex', request.from);
  const lifetime = request.criterion === 'net_present_value' ? await need('battery_lifetime') : await parameter(db, kind, id, 'battery_lifetime', request.from);
  const discount = request.criterion === 'net_present_value' ? await need('discount_rate') : await parameter(db, kind, id, 'discount_rate', request.from);
  const prices = await pricesOf(db, request.perimeter, place.participantId ?? existing[0]?.participantId ?? null, request.from, request.offtakePrice);
  if (economic && ((prices.offtake === null && !read.flows.prices) || prices.injection === null)) {
    throw new Error(`prices_required: ${prices.missing.join('; ')}`);
  }
  const fees = kind === 'participant' && prices.read.grid_fees_and_taxes ? Number((prices.read.grid_fees_and_taxes as { value: unknown }).value) / 1000 : 0;

  if (objective === 'peak_shaving' && !(request.peakThresholdKw != null && request.peakThresholdKw >= 0)) {
    throw new Error('peak_threshold_required: a battery sized for peak shaving needs the power the offtake is kept under');
  }

  // The bounds of the sweep: by blocks of 24 hours from the start, what one
  // cycle a day can move — the smaller of the day's surplus and residual,
  // on average — or, for peak shaving, what holds the most a day takes
  // above the threshold once the efficiency is lost.
  const perDay = Math.round(24 / left.stepHours);
  const above = (request.peakThresholdKw ?? 0) * left.stepHours;
  let movable = 0;
  let peakDay = 0;
  let days = 0;
  for (let start = 0; start < left.production.length; start += perDay) {
    let surplus = 0;
    let residual = 0;
    let over = 0;
    for (let i = start; i < Math.min(start + perDay, left.production.length); i++) {
      const net = left.consumption[i] - left.production[i];
      surplus += Math.max(-net, 0);
      residual += Math.max(net, 0);
      over += Math.max(net - above, 0);
    }
    movable += Math.min(surplus, residual);
    peakDay = Math.max(peakDay, over);
    days++;
  }
  const maxKwh = request.bounds?.maxKwh ?? (objective === 'peak_shaving' ? peakDay / Math.sqrt(efficiency.value) : movable / days);
  const points = request.bounds?.points ?? SWEEP_POINTS;
  const stepKwh = request.bounds?.stepKwh ?? maxKwh / points;
  const minKwh = request.bounds?.minKwh ?? stepKwh;
  if (!(maxKwh > 0 && stepKwh > 0 && minKwh > 0 && minKwh <= maxKwh)) {
    throw new Error(`bounds_invalid: from ${minKwh} to ${maxKwh} kWh by ${stepKwh}; nothing to store over the period when the upper bound is 0`);
  }

  const years = (read.buckets.length * read.flows.stepHours) / YEAR_HOURS;
  // The savings of the period are scaled to a year: on a period under a year,
  // the season it covers weighs on every figure of the curve.
  const periodDays = round((read.buckets.length * read.flows.stepHours) / 24, 3);
  const warnings = periodDays < 365
    ? [`period_under_a_year: ${periodDays} day${periodDays === 1 ? '' : 's'}, scaled to a year of 365.25; the season of the period weighs on the savings, the payback, the net present value and the rates`]
    : [];
  const annuity = lifetime ? Array.from({ length: lifetime.value }, (_, y) => (1 + (discount?.value ?? 0)) ** -(y + 1)).reduce((s, v) => s + v, 0) : null;
  const curve: SizePoint[] = [];
  for (let capacity = minKwh; capacity <= maxKwh + 1e-9; capacity += stepKwh) {
    const battery: Battery = {
      capacityKwh: capacity, chargePowerKw: capacity * cRate.value, dischargePowerKw: capacity * cRate.value, efficiency: efficiency.value,
      minLevel: 0, maxLevel: 1, objective, peakThresholdKw: request.peakThresholdKw ?? null,
    };
    const [d] = dispatchChain(left, [battery]);
    const k = indicators(left, battery, d);
    const saved = savingsOf(left, d, prices, fees);
    const perYear = saved === null ? null : round(saved / years, 2);
    const capex = cost ? round((capacity * cost.value) / 1000, 2) : null;
    const opexPerYear = opex ? round((capacity * opex.value) / 1000, 2) : null;
    // What a year brings once the battery is kept running.
    const net = perYear === null ? null : round(perYear - (opexPerYear ?? 0), 2);
    curve.push({
      capacity_kwh: round(capacity, 3),
      discharge_kwh: k.discharge_kwh,
      self_consumption_rate: k.self_consumption_rate_with,
      self_sufficiency: k.self_sufficiency_with,
      peak_kw: k.peak_with_kw,
      savings_per_year: perYear,
      opex_per_year: opexPerYear,
      capex,
      payback_years: capex !== null && net !== null && net > 0 ? round(capex / net, 3) : null,
      net_present_value: capex !== null && net !== null && annuity !== null ? round(net * annuity - capex, 2) : null,
    });
  }

  let recommended: SizePoint | null = null;
  let reason: string | null = null;
  if (request.criterion === 'self_consumption_rate' || request.criterion === 'self_sufficiency') {
    const key = request.criterion;
    const best = Math.max(...curve.map((p) => p[key] ?? 0));
    recommended = curve.find((p) => (p[key] ?? 0) >= best - SAME_RATE) ?? null;
  } else if (request.criterion === 'payback') {
    const paying = curve.filter((p) => p.payback_years !== null);
    recommended = paying.reduce<SizePoint | null>((b, p) => (!b || (p.payback_years as number) < (b.payback_years as number) ? p : b), null);
    if (!recommended) reason = 'no_capacity_pays_back: no capacity of the sweep saves anything';
  } else if (request.criterion === 'net_present_value') {
    const best = curve.reduce<SizePoint | null>((b, p) => (!b || (p.net_present_value as number) > (b.net_present_value as number) ? p : b), null);
    if (best && (best.net_present_value as number) > 0) recommended = best;
    else reason = 'no_capacity_pays_back: no capacity of the sweep has a positive net present value';
  } else {
    const lowest = Math.min(...curve.map((p) => p.peak_kw));
    recommended = curve.find((p) => p.peak_kw <= lowest + SAME_POWER_KW) ?? null;
  }

  const inputs = {
    period: { from: request.from, to: request.to, step: read.step, intervals: read.buckets.length },
    perimeter: request.perimeter,
    series: { production: read.production, consumption: read.consumption, prices: read.priceSeries },
    after: existing.map((b) => b.deviceId),
    objective,
    peak_threshold_kw: request.peakThresholdKw ?? null,
    bounds: { min_kwh: round(minKwh, 3), max_kwh: round(maxKwh, 3), step_kwh: round(stepKwh, 3) },
    parameters: {
      battery_c_rate: cRate.from, round_trip_efficiency: efficiency.from,
      battery_cost: cost?.from ?? null, battery_opex: opex?.from ?? null, battery_lifetime: lifetime?.from ?? null, discount_rate: discount?.from ?? null,
    },
    prices: { read: prices.read, missing: prices.missing, currency: prices.currency },
  };
  const results = { criterion: request.criterion, recommended, reason, warnings, curve, currency: prices.currency };
  const row = (await db.query<{ id: string }>(
    `insert into battery.estimates (participant_id, project_id, criterion, provenance, inputs, results)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb) returning id`,
    [kind === 'participant' ? id : null, kind === 'project' ? id : null, request.criterion, BATTERY_ENGINE_VERSION, JSON.stringify(inputs), JSON.stringify(results)])).rows[0];
  return { estimateId: row.id, curve, recommended, reason, warnings };
}

// The dispatch of a battery on interval series: how much it charges and
// discharges in each interval of a period, and what is left of the surplus
// and of the consumption once it has.
//
// The rule, for a battery whose objective is self-consumption, in each
// interval of the series, in time order:
//
//   1. the surplus of the interval (production − consumption, when positive)
//      charges the battery, up to its charge power over the interval and up
//      to the room left under its highest state of charge;
//   2. the residual (consumption − production, when positive) is served by
//      the battery, up to its discharge power over the interval and up to
//      what it holds above its lowest state of charge;
//   3. what the battery did not take is injected, what it did not serve is
//      taken from the grid.
//
// The round-trip efficiency η is split between the two ways, √η on each, as
// the hourly engine of the platform this one was taken from splits it:
// charging 1 kWh fills the battery of √η kWh, and serving 1 kWh empties it
// of 1 / √η kWh. What goes through the battery loses 1 − η either way; the
// split says what a full battery holds against the grid: it takes
// capacity / √η of the surplus and serves capacity × √η.
//
// The state of charge at the start of the period is the one it ends with:
// the period is run from the middle of the band of state of charge, then
// again from the level it ended at, until the two differ by less than
// 1e-4 kWh, twenty passes at most — the rule taken from did the same on a
// typical day; here it is run on the whole period, at the step of its
// series.
//
// Several batteries of one perimeter are chained: the second sees the
// surplus and the residual the first left, and so on, so the same surplus
// is never stored twice.
//
// Peak shaving keeps the power taken from the grid under a threshold: the
// battery serves whatever the residual takes above it, charges from the
// surplus, and from the grid while the residual and that charge stay under
// it. Arbitrage reads a price per interval: in each local day, the battery
// charges from the grid in the cheapest intervals it needs to fill up, and
// serves the consumption in the dearest intervals with a consumption to
// serve that it needs to empty, when
// the price there, times its efficiency, is above the cheapest of the day;
// it charges from the surplus whenever there is one.
//
// Conventions: every value is the energy of its interval, in kWh, dated at
// its start; a power is in kW, a price in the currency of the perimeter per
// kWh. No figure is a constant of this file: the battery comes with every
// one of its own.

export const BATTERY_ENGINE_VERSION = 'battery-dispatch-0.3.1';

export const OBJECTIVES = ['self_consumption', 'peak_shaving', 'arbitrage'] as const;
export type Objective = (typeof OBJECTIVES)[number];

/** A battery as a dispatch reads it. */
export interface Battery {
  /** Usable capacity, kWh: the energy between an empty and a full battery. */
  capacityKwh: number;
  chargePowerKw: number;
  dischargePowerKw: number;
  /** Round-trip efficiency, 0 to 1: √η is lost on charge, √η on discharge. */
  efficiency: number;
  /** The band of state of charge it is kept in, as fractions of its capacity. */
  minLevel: number;
  maxLevel: number;
  objective: Objective;
  /** For peak shaving: the power the grid offtake is kept under, kW. */
  peakThresholdKw?: number | null;
}

/** The flows a battery sees, one value per interval of one step. */
export interface Flows {
  /** Energy produced in the perimeter, or the surplus of a project, kWh per interval. */
  production: number[];
  /** Energy consumed in the perimeter, or the residual of a project, kWh per interval. */
  consumption: number[];
  /** The length of an interval, in hours. */
  stepHours: number;
  /** For arbitrage: the price of energy taken from the grid in each interval, per kWh. */
  prices?: (number | null)[] | null;
  /** For arbitrage: the local day of each interval, any key that is equal within a day. */
  days?: (string | number)[] | null;
}

export interface Dispatch {
  /** Energy into the battery, from the surplus and from the grid, kWh per interval. */
  charge: number[];
  /** The part of `charge` taken from the grid. */
  chargeFromGrid: number[];
  /** Energy the battery served to the consumption, kWh per interval. */
  discharge: number[];
  /** Energy in the battery at the start of each interval, kWh. */
  level: number[];
  /** What is left of the surplus, injected, and of the consumption, taken from the grid, once the battery has run. */
  injection: number[];
  offtake: number[];
  startLevelKwh: number;
  endLevelKwh: number;
  /** Passes over the period it took for its end to meet its start, and whether it did within 1e-4 kWh. */
  iterations: number;
  converged: boolean;
}

export const CONVERGENCE_KWH = 1e-4;
export const MAX_ITERATIONS = 20;

export class DispatchError extends Error {}

function refuse(message: string): never {
  throw new DispatchError(message);
}

/** Checks a battery and its flows, and refuses by name what the rule cannot run. */
export function checkDispatch(flows: Flows, battery: Battery): void {
  const n = flows.production.length;
  if (n === 0) refuse('period_empty: no interval to dispatch');
  if (flows.consumption.length !== n) refuse(`series_misaligned: ${n} production values and ${flows.consumption.length} consumption values`);
  if (!(flows.stepHours > 0)) refuse(`step_invalid: ${flows.stepHours} hours`);
  for (const [name, values] of [['production', flows.production], ['consumption', flows.consumption]] as const) {
    if (values.some((v) => !(Number.isFinite(v) && v >= 0))) refuse(`series_invalid: the ${name} holds a value that is not a finite energy of zero or more`);
  }
  if (!OBJECTIVES.includes(battery.objective)) refuse(`objective_unknown: ${battery.objective}`);
  if (!(battery.capacityKwh > 0)) refuse(`capacity_required: ${battery.capacityKwh} kWh`);
  if (!(battery.chargePowerKw > 0) || !(battery.dischargePowerKw > 0)) refuse(`power_required: charge ${battery.chargePowerKw} kW, discharge ${battery.dischargePowerKw} kW`);
  if (!(battery.efficiency > 0 && battery.efficiency <= 1)) refuse(`efficiency_invalid: ${battery.efficiency}; a round-trip efficiency is above 0 and at most 1`);
  if (!(battery.minLevel >= 0 && battery.maxLevel <= 1 && battery.minLevel < battery.maxLevel)) refuse(`charge_levels_invalid: ${battery.minLevel} to ${battery.maxLevel}`);
  if (battery.objective === 'peak_shaving' && !(battery.peakThresholdKw != null && battery.peakThresholdKw >= 0)) {
    refuse('peak_threshold_required: a battery run for peak shaving needs the power the offtake is kept under');
  }
  if (battery.objective === 'arbitrage') {
    if (!flows.prices || flows.prices.length !== n || flows.prices.some((p) => p === null || !Number.isFinite(p))) {
      refuse('prices_required: a battery run for arbitrage reads a price for every interval of the period');
    }
    if (!flows.days || flows.days.length !== n) refuse('days_required: arbitrage is decided day by day, and needs the local day of every interval');
  }
}

/** What arbitrage does in each interval: charge from the grid, discharge, or neither. */
function arbitrageRoles(flows: Flows, battery: Battery): Int8Array {
  const n = flows.production.length;
  const roles = new Int8Array(n);
  const prices = flows.prices as number[];
  const band = battery.capacityKwh * (battery.maxLevel - battery.minLevel);
  const half = Math.sqrt(battery.efficiency);
  const toFill = Math.ceil(band / half / (battery.chargePowerKw * flows.stepHours) - 1e-9);
  const toEmpty = Math.ceil((band * half) / (battery.dischargePowerKw * flows.stepHours) - 1e-9);
  const byDay = new Map<string | number, number[]>();
  (flows.days as (string | number)[]).forEach((d, i) => {
    const list = byDay.get(d);
    if (list) list.push(i);
    else byDay.set(d, [i]);
  });
  for (const intervals of byDay.values()) {
    // Cheapest first, the earlier of two equal prices first.
    const sorted = [...intervals].sort((a, b) => prices[a] - prices[b] || a - b);
    const cheap = sorted.slice(0, toFill);
    for (const i of cheap) roles[i] = 1;
    const floor = prices[sorted[0]];
    // The dearest intervals where there is a consumption to serve.
    const dear = sorted.slice(cheap.length).filter((i) => flows.consumption[i] > flows.production[i]).reverse();
    for (const i of dear.slice(0, toEmpty)) {
      if (prices[i] * battery.efficiency > floor) roles[i] = -1;
    }
  }
  return roles;
}

/** One pass over the period from a level, kWh. */
function passOver(flows: Flows, battery: Battery, start: number, roles: Int8Array | null): Dispatch {
  const n = flows.production.length;
  const h = flows.stepHours;
  const low = battery.capacityKwh * battery.minLevel;
  const high = battery.capacityKwh * battery.maxLevel;
  const maxIn = battery.chargePowerKw * h;
  const maxOut = battery.dischargePowerKw * h;
  // Half of the round trip on the way in, half on the way out.
  const half = Math.sqrt(battery.efficiency);
  const threshold = battery.objective === 'peak_shaving' ? (battery.peakThresholdKw as number) * h : Infinity;
  const out: Dispatch = {
    charge: new Array(n), chargeFromGrid: new Array(n), discharge: new Array(n), level: new Array(n),
    injection: new Array(n), offtake: new Array(n), startLevelKwh: start, endLevelKwh: start, iterations: 1, converged: false,
  };
  let level = start;
  for (let i = 0; i < n; i++) {
    out.level[i] = level;
    const surplus = Math.max(flows.production[i] - flows.consumption[i], 0);
    const residual = Math.max(flows.consumption[i] - flows.production[i], 0);
    const fromSurplus = Math.min(surplus, maxIn, (high - level) / half);
    level += fromSurplus * half;
    let fromGrid = 0;
    let served = 0;
    if (battery.objective === 'self_consumption') {
      served = Math.min(residual, maxOut, (level - low) * half);
    } else if (battery.objective === 'peak_shaving') {
      if (residual > threshold) served = Math.min(residual - threshold, maxOut, (level - low) * half);
      else fromGrid = Math.max(0, Math.min(threshold - residual, maxIn - fromSurplus, (high - level) / half));
    } else {
      const role = (roles as Int8Array)[i];
      if (role === 1) fromGrid = Math.max(0, Math.min(maxIn - fromSurplus, (high - level) / half));
      else if (role === -1) served = Math.min(residual, maxOut, (level - low) * half);
    }
    level += fromGrid * half - served / half;
    // The band holds to the rounding of a float.
    level = Math.min(high, Math.max(low, level));
    out.charge[i] = fromSurplus + fromGrid;
    out.chargeFromGrid[i] = fromGrid;
    out.discharge[i] = served;
    out.injection[i] = surplus - fromSurplus;
    out.offtake[i] = residual - served + fromGrid;
  }
  out.endLevelKwh = level;
  return out;
}

/**
 * The dispatch of one battery on its flows, its state of charge at the
 * start of the period the one it ends with (within 1e-4 kWh, twenty passes
 * at most).
 */
export function dispatchBattery(flows: Flows, battery: Battery): Dispatch {
  checkDispatch(flows, battery);
  const roles = battery.objective === 'arbitrage' ? arbitrageRoles(flows, battery) : null;
  let start = battery.capacityKwh * (battery.minLevel + (battery.maxLevel - battery.minLevel) / 2);
  let result = passOver(flows, battery, start, roles);
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    result.iterations = iteration;
    if (Math.abs(result.endLevelKwh - start) < CONVERGENCE_KWH) {
      result.converged = true;
      break;
    }
    if (iteration === MAX_ITERATIONS) break;
    start = result.endLevelKwh;
    result = passOver(flows, battery, start, roles);
  }
  return result;
}

/**
 * The batteries of one perimeter, in order: each sees the surplus left by
 * the one before as its production and the offtake it left as its
 * consumption.
 */
export function dispatchChain(flows: Flows, batteries: Battery[]): Dispatch[] {
  const results: Dispatch[] = [];
  let seen: Flows = flows;
  for (const battery of batteries) {
    const d = dispatchBattery(seen, battery);
    results.push(d);
    seen = { ...flows, production: d.injection, consumption: d.offtake };
  }
  return results;
}

/** What a dispatch changed in its perimeter, over the period. */
export interface Indicators {
  production_kwh: number;
  consumption_kwh: number;
  charge_kwh: number;
  charge_from_grid_kwh: number;
  discharge_kwh: number;
  /** Full cycles: the energy drawn from the battery over its band of state of charge. */
  cycles: number;
  self_consumed_without_kwh: number;
  self_consumed_with_kwh: number;
  /** Self-consumed over produced, and over consumed; null when nothing was. */
  self_consumption_rate_without: number | null;
  self_consumption_rate_with: number | null;
  self_sufficiency_without: number | null;
  self_sufficiency_with: number | null;
  injection_without_kwh: number;
  injection_with_kwh: number;
  offtake_without_kwh: number;
  offtake_with_kwh: number;
  /** The highest power taken from the grid in an interval, kW. */
  peak_without_kw: number;
  peak_with_kw: number;
}

/**
 * The indicators of a dispatch on the flows it saw. The energy served
 * counts as self-consumed in the share of its charge that came from the
 * surplus; the rate with the battery is never below the rate without.
 */
export function indicators(flows: Flows, battery: Battery, d: Dispatch): Indicators {
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const production = sum(flows.production);
  const consumption = sum(flows.consumption);
  const charge = sum(d.charge);
  const fromGrid = sum(d.chargeFromGrid);
  const discharge = sum(d.discharge);
  const without = flows.production.reduce((s, p, i) => s + Math.min(p, flows.consumption[i]), 0);
  const solarShare = charge > 0 ? (charge - fromGrid) / charge : 0;
  const withBattery = Math.max(without, without + discharge * solarShare);
  const band = battery.capacityKwh * (battery.maxLevel - battery.minLevel);
  const ratio = (a: number, b: number) => (b > 0 ? round(a / b, 9) : null);
  const peak = (a: number[]) => a.reduce((m, v) => Math.max(m, v), 0) / flows.stepHours;
  return {
    production_kwh: round(production),
    consumption_kwh: round(consumption),
    charge_kwh: round(charge),
    charge_from_grid_kwh: round(fromGrid),
    discharge_kwh: round(discharge),
    cycles: round(discharge / Math.sqrt(battery.efficiency) / band),
    self_consumed_without_kwh: round(without),
    self_consumed_with_kwh: round(withBattery),
    self_consumption_rate_without: ratio(without, production),
    self_consumption_rate_with: ratio(withBattery, production),
    self_sufficiency_without: ratio(without, consumption),
    self_sufficiency_with: ratio(withBattery, consumption),
    injection_without_kwh: round(flows.production.reduce((s, p, i) => s + Math.max(p - flows.consumption[i], 0), 0)),
    injection_with_kwh: round(sum(d.injection)),
    offtake_without_kwh: round(flows.consumption.reduce((s, c, i) => s + Math.max(c - flows.production[i], 0), 0)),
    offtake_with_kwh: round(sum(d.offtake)),
    peak_without_kw: round(peak(flows.consumption.map((c, i) => Math.max(c - flows.production[i], 0)))),
    peak_with_kw: round(peak(d.offtake)),
  };
}

export function round(n: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

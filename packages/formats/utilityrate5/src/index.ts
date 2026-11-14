// SAM utilityrate5 rates → plain rates, and back.
//
// The System Advisor Model (SAM, NREL) describes what a site pays and is
// paid for its electricity with the inputs of its `utilityrate5` compute
// module, the `ur_` keys: the energy charges by period and tier
// (`ur_ec_tou_mat`), the period of each hour of each month on weekdays and
// on weekends (`ur_ec_sched_weekday`, `ur_ec_sched_weekend`, 12 × 24), and
// buy and sell rates given hour by hour instead (`ur_ts_buy_rate`,
// `ur_ts_sell_rate`). They travel as the JSON SAM writes for a case and
// PySAM's `export()` gives, flat or under their group.
//
// The rates read here carry what the file says: rates per kWh in the file's
// currency, which the file does not name, periods and tiers numbered as SAM
// numbers them. Every other `ur_` key (demand charges, fixed and minimum
// charges, metering option) is carried as read, so that a rate written back
// gives the same keys and values.
//
// A rate is also a price at each hour of a year, the way SAM reads it: 365
// days of 24 hours in local standard time, the first a Monday, Saturday and
// Sunday on the weekend schedule (`hourlyRates`). An hourly year goes back to
// the 12 × 24 schedules when it is one (`rateFromHourly`), and is written as
// time-series rates otherwise.
//
// The library imports nothing, opens no connection and calls no network:
// writing a rate as a price series of the model is an importer's job.
//
// SPDX-License-Identifier: MIT

/** How the usage limit of a tier is counted (`ur_ec_tou_mat`, fourth column). */
export type UsageLimitUnit = 'kWh' | 'kWh/kW' | 'kWh daily' | 'kWh/kW daily';

/** One row of `ur_ec_tou_mat`: what a period charges and pays up to a usage. */
export interface EnergyCharge {
  /** From 1, as the schedules name it. */
  period: number;
  /** From 1; the rate of tier n holds up to its `maxUsage`, then tier n + 1. */
  tier: number;
  /** In `maxUsageUnit`; SAM writes 1e38 for no limit. */
  maxUsage: number;
  maxUsageUnit: UsageLimitUnit;
  /** Per kWh bought, in the file's currency. */
  buy: number;
  /** Per kWh sold, in the file's currency. */
  sell: number;
}

/** Twelve months of 24 hours, each the period it falls in, from 1. */
export type MonthHourSchedule = number[][];

export interface UtilityRate {
  energyCharges: EnergyCharge[];
  weekday: MonthHourSchedule;
  weekend: MonthHourSchedule;
  /** `ur_sell_eq_buy`: energy sold at the rate it is bought. */
  sellEqualsBuy: boolean;
  /** `ur_ts_buy_rate` when `ur_en_ts_buy_rate` is on: per kWh, at equal steps over the year. */
  timeSeriesBuy: number[] | null;
  /** `ur_ts_sell_rate` when `ur_en_ts_sell_rate` is on. */
  timeSeriesSell: number[] | null;
  /** Every other `ur_` key as read, and a time series that was off. */
  other: Record<string, unknown>;
}

/** The rates of a year, at equal steps from the first hour of SAM's year. */
export interface HourlyRates {
  stepMinutes: number;
  buy: number[];
  sell: number[];
}

/** SAM's year: 365 days, January to December. */
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const HOURS_IN_YEAR = 8760;

const UNITS: UsageLimitUnit[] = ['kWh', 'kWh/kW', 'kWh daily', 'kWh/kW daily'];
const TYPED = new Set([
  'ur_ec_tou_mat',
  'ur_ec_sched_weekday',
  'ur_ec_sched_weekend',
  'ur_sell_eq_buy',
  'ur_en_ts_buy_rate',
  'ur_ts_buy_rate',
  'ur_en_ts_sell_rate',
  'ur_ts_sell_rate',
]);

type Inputs = Record<string, unknown>;

function isObject(value: unknown): value is Inputs {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `ur_` keys of a SAM case: at the top of the object, or in the group
 * PySAM's `export()` puts them under. Refuses `utilityrate5_unreadable`.
 */
function rateInputs(input: unknown): Inputs {
  const parsed = typeof input === 'string' ? parseJson(input) : input;
  if (!isObject(parsed)) throw new Error('utilityrate5_unreadable: a SAM case is a JSON object of inputs');
  const found: Inputs = {};
  const take = (from: Inputs) => {
    for (const [key, value] of Object.entries(from)) if (key.startsWith('ur_')) found[key] = value;
  };
  take(parsed);
  for (const value of Object.values(parsed)) if (isObject(value)) take(value);
  if (!('ur_ec_tou_mat' in found) && found.ur_en_ts_buy_rate !== 1) {
    throw new Error('utilityrate5_unreadable: no ur_ec_tou_mat, and no time-series buy rate turned on');
  }
  return found;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('utilityrate5_unreadable: not JSON');
  }
}

function numbers(value: unknown, key: string): number[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error(`utilityrate5_unreadable: ${key} is not a list of numbers`);
  }
  return value as number[];
}

function matrix(value: unknown, key: string): number[][] {
  if (!Array.isArray(value)) throw new Error(`utilityrate5_unreadable: ${key} is not a matrix`);
  return value.map((row) => numbers(row, key));
}

function flag(value: unknown): boolean {
  return value === 1 || value === true;
}

/** Checks a 12 × 24 schedule whose periods are those of the energy charges. */
function checkSchedule(schedule: MonthHourSchedule, key: string, periods: Set<number>): void {
  if (schedule.length !== 12 || schedule.some((row) => row.length !== 24)) {
    throw new Error(`utilityrate5_schedule_invalid: ${key} is 12 months of 24 hours`);
  }
  for (const [m, row] of schedule.entries()) {
    for (const [h, period] of row.entries()) {
      if (!periods.has(period)) {
        throw new Error(`utilityrate5_schedule_invalid: ${key} names period ${period} in month ${m + 1} at hour ${h}, which ur_ec_tou_mat does not charge`);
      }
    }
  }
}

/**
 * Reads the rate of a SAM case: its JSON text, or the object SAM or
 * PySAM's `export()` gives. Refuses `utilityrate5_unreadable` and
 * `utilityrate5_schedule_invalid`.
 */
export function readUtilityRate(input: unknown): UtilityRate {
  const inputs = rateInputs(input);
  const energyCharges = 'ur_ec_tou_mat' in inputs
    ? matrix(inputs.ur_ec_tou_mat, 'ur_ec_tou_mat').map((row): EnergyCharge => {
        if (row.length !== 6) throw new Error('utilityrate5_unreadable: a row of ur_ec_tou_mat is period, tier, max usage, its unit, buy, sell');
        const [period, tier, maxUsage, unit, buy, sell] = row as [number, number, number, number, number, number];
        const maxUsageUnit = UNITS[unit];
        if (!maxUsageUnit) throw new Error(`utilityrate5_unreadable: max usage unit ${unit} in ur_ec_tou_mat (0 to 3)`);
        return { period, tier, maxUsage, maxUsageUnit, buy, sell };
      })
    : [];
  const periods = new Set(energyCharges.map((c) => c.period));
  const schedule = (key: string): MonthHourSchedule => {
    if (!(key in inputs)) {
      if (energyCharges.length === 0) return [];
      throw new Error(`utilityrate5_schedule_invalid: no ${key}`);
    }
    const s = matrix(inputs[key], key);
    checkSchedule(s, key, periods);
    return s;
  };
  const other: Inputs = {};
  for (const [key, value] of Object.entries(inputs)) if (!TYPED.has(key)) other[key] = value;
  const series = (on: string, values: string): number[] | null => {
    if (!flag(inputs[on])) {
      if (on in inputs) other[on] = inputs[on];
      if (values in inputs) other[values] = inputs[values];
      return null;
    }
    const v = numbers(inputs[values], values);
    if (v.length === 0 || (v.length % HOURS_IN_YEAR !== 0 && HOURS_IN_YEAR % v.length !== 0)) {
      throw new Error(`utilityrate5_unreadable: ${values} holds ${v.length} values, not equal steps over ${HOURS_IN_YEAR} hours`);
    }
    return v;
  };
  return {
    energyCharges,
    weekday: schedule('ur_ec_sched_weekday'),
    weekend: schedule('ur_ec_sched_weekend'),
    sellEqualsBuy: flag(inputs.ur_sell_eq_buy),
    timeSeriesBuy: series('ur_en_ts_buy_rate', 'ur_ts_buy_rate'),
    timeSeriesSell: series('ur_en_ts_sell_rate', 'ur_ts_sell_rate'),
    other,
  };
}

/**
 * Writes a rate as the flat `ur_` inputs of a SAM case, the keys it was
 * read from in the same values; `JSON.stringify` gives the file.
 */
export function writeUtilityRate(rate: UtilityRate): Record<string, unknown> {
  const out: Inputs = { ...rate.other };
  if (rate.energyCharges.length > 0) {
    out.ur_ec_tou_mat = rate.energyCharges.map((c) => [c.period, c.tier, c.maxUsage, UNITS.indexOf(c.maxUsageUnit), c.buy, c.sell]);
    out.ur_ec_sched_weekday = rate.weekday.map((row) => [...row]);
    out.ur_ec_sched_weekend = rate.weekend.map((row) => [...row]);
  }
  out.ur_sell_eq_buy = rate.sellEqualsBuy ? 1 : 0;
  if (rate.timeSeriesBuy) {
    out.ur_en_ts_buy_rate = 1;
    out.ur_ts_buy_rate = [...rate.timeSeriesBuy];
  }
  if (rate.timeSeriesSell) {
    out.ur_en_ts_sell_rate = 1;
    out.ur_ts_sell_rate = [...rate.timeSeriesSell];
  }
  return out;
}

/** Month (0–11), hour of the day and weekend, for each hour of SAM's year. */
function* yearHours(): Generator<{ month: number; hour: number; weekend: boolean }> {
  let day = 0;
  for (const [month, days] of DAYS_IN_MONTH.entries()) {
    for (let d = 0; d < days; d++, day++) {
      // The first day of SAM's year is a Monday: days 5 and 6 of each week are the weekend.
      const weekend = day % 7 >= 5;
      for (let hour = 0; hour < 24; hour++) yield { month, hour, weekend };
    }
  }
}

/**
 * The buy and sell rate of each hour of SAM's year, per kWh in the file's
 * currency: the time-series rates where the rate has them, the period of
 * the hour's schedule otherwise. A period of several tiers has no rate of
 * its own at an hour, its tiers depend on the usage: refused
 * `utilityrate5_tiered`.
 */
export function hourlyRates(rate: UtilityRate): HourlyRates {
  const lengths = [rate.timeSeriesBuy, rate.timeSeriesSell].filter((s): s is number[] => s !== null).map((s) => s.length);
  if (new Set(lengths).size > 1) throw new Error('utilityrate5_series_length: the time-series buy and sell rates have different steps');
  const steps = lengths[0] ?? HOURS_IN_YEAR;
  const perHour = steps / HOURS_IN_YEAR;
  const fromSchedule = (side: 'buy' | 'sell'): number[] => {
    const byPeriod = new Map<number, number>();
    for (const c of rate.energyCharges) {
      if (rate.energyCharges.some((o) => o.period === c.period && o.tier !== c.tier)) {
        throw new Error(`utilityrate5_tiered: period ${c.period} charges by tier of usage, not by hour`);
      }
      byPeriod.set(c.period, c[side]);
    }
    if (byPeriod.size === 0) throw new Error(`utilityrate5_unreadable: no energy charge and no time-series ${side} rate`);
    const out: number[] = [];
    for (const { month, hour, weekend } of yearHours()) {
      const period = (weekend ? rate.weekend : rate.weekday)[month]![hour]!;
      for (let k = 0; k < perHour; k++) out.push(byPeriod.get(period)!);
    }
    return out;
  };
  const resample = (series: number[]): number[] => {
    if (series.length >= steps) return [...series];
    // A series coarser than the other side's is repeated over its finer steps.
    const n = steps / series.length;
    return series.flatMap((v) => Array.from({ length: n }, () => v));
  };
  const buy = rate.timeSeriesBuy ? resample(rate.timeSeriesBuy) : fromSchedule('buy');
  const sell = rate.sellEqualsBuy ? [...buy] : rate.timeSeriesSell ? resample(rate.timeSeriesSell) : fromSchedule('sell');
  return { stepMinutes: (60 * HOURS_IN_YEAR) / steps, buy, sell };
}

/**
 * The rate an hourly year of buy and sell rates is: the 12 × 24 weekday and
 * weekend schedules when every hour of a month, a time of day and a kind of
 * day has one buy and sell rate, a period per pair in the order they first
 * come; the same year as time-series rates otherwise. `sell` omitted is
 * energy sold at the rate it is bought. Refuses `utilityrate5_series_length`.
 */
export function rateFromHourly(buy: number[], sell?: number[]): UtilityRate {
  if (buy.length !== HOURS_IN_YEAR || (sell && sell.length !== HOURS_IN_YEAR)) {
    throw new Error(`utilityrate5_series_length: an hourly year of SAM holds ${HOURS_IN_YEAR} rates`);
  }
  const sold = sell ?? buy;
  const blank = () => Array.from({ length: 12 }, () => Array.from({ length: 24 }, () => 0));
  const weekday = blank();
  const weekend = blank();
  const periods = new Map<string, number>();
  const energyCharges: EnergyCharge[] = [];
  let i = 0;
  for (const { month, hour, weekend: isWeekend } of yearHours()) {
    const key = JSON.stringify([buy[i], sold[i]]);
    let period = periods.get(key);
    if (period === undefined) {
      period = periods.size + 1;
      periods.set(key, period);
      energyCharges.push({ period, tier: 1, maxUsage: 1e38, maxUsageUnit: 'kWh', buy: buy[i]!, sell: sold[i]! });
    }
    const schedule = isWeekend ? weekend : weekday;
    const held = schedule[month]![hour]!;
    if (held !== 0 && held !== period) {
      return { energyCharges: [], weekday: [], weekend: [], sellEqualsBuy: !sell, timeSeriesBuy: [...buy], timeSeriesSell: sell ? [...sell] : null, other: {} };
    }
    schedule[month]![hour] = period;
    i++;
  }
  return { energyCharges, weekday, weekend, sellEqualsBuy: !sell, timeSeriesBuy: null, timeSeriesSell: null, other: {} };
}

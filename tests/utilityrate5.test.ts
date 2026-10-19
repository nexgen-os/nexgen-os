// The energy rates of SAM's utilityrate5 ⇄ price intervals: a time-of-use
// contract becomes a 12 × 24 schedule and reads back the same; hourly
// prices become a time series of SAM's year, in local standard time, 29
// February left out; what the format cannot say is refused by name.
import { describe, expect, it } from 'vitest';
import {
  NO_LIMIT,
  readSchedule,
  readTimeSeries,
  writeSchedule,
  writeTimeSeries,
  type PriceInterval,
} from '../formats/utilityrate5/index.js';

const HOUR = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();
/** 2025 starts at 2024-12-31T23:00Z in local standard time at UTC+1. */
const START_2025 = Date.UTC(2024, 11, 31, 23);
const END_2025 = START_2025 + 8760 * HOUR;

const fixed = (from: number, to: number, price: number, extra: Partial<PriceInterval> = {}): PriceInterval => ({
  kind: 'fixed',
  starts_at: iso(from),
  ends_at: iso(to),
  price,
  currency: 'EUR',
  per_unit: 'MegaW-HR',
  ...extra,
});

/** Peak 08:00-20:00 local standard time on weekdays at 240 per MWh, 160 per MWh otherwise. */
function peakAndOffPeak(): PriceInterval[] {
  const out: PriceInterval[] = [];
  for (let day = START_2025; day < END_2025; day += 24 * HOUR) {
    const weekday = new Date(day + HOUR).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    if (weekend) out.push(fixed(day, day + 24 * HOUR, 160));
    else out.push(fixed(day, day + 8 * HOUR, 160), fixed(day + 8 * HOUR, day + 20 * HOUR, 240), fixed(day + 20 * HOUR, day + 24 * HOUR, 160));
  }
  return out;
}

/** Adjacent intervals at one price merged, as the reader gives them. */
function merged(prices: PriceInterval[]): PriceInterval[] {
  const out: PriceInterval[] = [];
  for (const p of prices) {
    const last = out[out.length - 1];
    if (last && last.ends_at === p.starts_at && last.price === p.price) last.ends_at = p.ends_at;
    else out.push({ ...p });
  }
  return out;
}

const perKwh = (prices: PriceInterval[]) => prices.map((p) => ({ ...p, price: p.price / 1000, per_unit: 'KiloW-HR' as const }));

describe('a schedule', () => {
  it('writes a peak and off-peak contract as two periods, rates per kWh, the currency apart', () => {
    const { rates, currency } = writeSchedule({ year: 2025, utc_offset_hours: 1, buy: peakAndOffPeak() });
    expect(currency).toBe('EUR');
    expect(rates.ur_ec_tou_mat).toEqual([
      [1, 1, NO_LIMIT, 0, 0.16, 0],
      [2, 1, NO_LIMIT, 0, 0.24, 0],
    ]);
    const day = [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1];
    expect(rates.ur_ec_sched_weekday).toEqual(Array(12).fill(day));
    expect(rates.ur_ec_sched_weekend).toEqual(Array(12).fill(Array(24).fill(1)));
    expect([rates.ur_en_ts_buy_rate, rates.ur_en_ts_sell_rate]).toEqual([0, 0]);
  });

  it('reads back the same prices, merged where they follow at one price, broken on 29 February only on a leap year', () => {
    const buy = peakAndOffPeak();
    const sell = [fixed(START_2025, END_2025, 50)];
    const { rates } = writeSchedule({ year: 2025, utc_offset_hours: 1, buy, sell });
    expect(rates.ur_ec_tou_mat.map((r) => r[5])).toEqual([0.05, 0.05]);
    const read = readSchedule(rates, { year: 2025, utc_offset_hours: 1, currency: 'EUR' });
    expect(read.buy).toEqual(perKwh(merged(buy)));
    expect(read.sell).toEqual(perKwh(sell));

    const leap = readSchedule(rates, { year: 2024, utc_offset_hours: 1, currency: 'EUR' }).sell;
    expect(leap.map((p) => [p.starts_at, p.ends_at])).toEqual([
      ['2023-12-31T23:00:00.000Z', '2024-02-28T23:00:00.000Z'],
      ['2024-02-29T23:00:00.000Z', '2024-12-31T23:00:00.000Z'],
    ]);
  });

  it('refuses by name an hour that holds two prices in a month, or more than twelve pairs of rates', () => {
    const prices = peakAndOffPeak();
    prices[1] = { ...prices[1], price: 250 }; // 1 January, peak hours
    expect(() => writeSchedule({ year: 2025, utc_offset_hours: 1, buy: prices })).toThrow(/^utilityrate5_not_a_schedule: weekday Jan hour 8 holds/);
    const hourly = Array.from({ length: 8760 }, (_, i) => fixed(START_2025 + i * HOUR, START_2025 + (i + 1) * HOUR, (i % 24) * 10));
    expect(() => writeSchedule({ year: 2025, utc_offset_hours: 1, buy: hourly })).toThrow(/^utilityrate5_too_many_periods/);
  });

  it('refuses a tiered rate and a period without rates when it reads', () => {
    const { rates } = writeSchedule({ year: 2025, utc_offset_hours: 1, buy: peakAndOffPeak() });
    const options = { year: 2025, utc_offset_hours: 1, currency: 'EUR' };
    expect(() => readSchedule({ ...rates, ur_ec_tou_mat: [...rates.ur_ec_tou_mat, [1, 2, NO_LIMIT, 0, 0.3, 0]] }, options)).toThrow(/^utilityrate5_tiered_rate_unsupported/);
    expect(() => readSchedule({ ...rates, ur_ec_tou_mat: rates.ur_ec_tou_mat.slice(0, 1) }, options)).toThrow(/^utilityrate5_period_unknown: period 2/);
    expect(() => readSchedule({ ...rates, ur_ec_sched_weekday: [[1]] }, options)).toThrow(/^utilityrate5_unreadable/);
    expect(() => readSchedule(rates, { ...options, currency: '' })).toThrow(/^utilityrate5_currency_required/);
  });
});

describe('a time series', () => {
  const hourly = Array.from({ length: 8760 }, (_, i) => fixed(START_2025 + i * HOUR, START_2025 + (i + 1) * HOUR, 40 + (i % 24) * 5));

  it('writes one rate per hour of the year in local standard time, and reads back the same', () => {
    const { rates, currency } = writeTimeSeries({ year: 2025, utc_offset_hours: 1, buy: hourly, sell: [fixed(START_2025, END_2025, 30)] });
    expect(currency).toBe('EUR');
    expect(rates.ur_ts_buy_rate).toHaveLength(8760);
    expect(rates.ur_ts_buy_rate.slice(0, 3)).toEqual([0.04, 0.045, 0.05]);
    expect([rates.ur_en_ts_buy_rate, rates.ur_en_ts_sell_rate, rates.ur_ts_sell_rate[100]]).toEqual([1, 1, 0.03]);
    const read = readTimeSeries(rates, { year: 2025, utc_offset_hours: 1, currency: 'EUR' });
    expect(read.buy).toEqual(perKwh(hourly));
    expect(read.sell).toEqual(perKwh([fixed(START_2025, END_2025, 30)]));
  });

  it('writes quarter hours, takes an open-ended price to the end of the year, and leaves out 29 February', () => {
    const open = [{ ...fixed(Date.UTC(2023, 0, 1), 0, 120), ends_at: null }];
    const { rates } = writeTimeSeries({ year: 2024, utc_offset_hours: -5, buy: open, steps_per_hour: 4 });
    expect(rates.ur_ts_buy_rate).toHaveLength(8760 * 4);
    expect(new Set(rates.ur_ts_buy_rate)).toEqual(new Set([0.12]));
    expect([rates.ur_en_ts_sell_rate, rates.ur_ts_sell_rate]).toEqual([0, []]);
    const read = readTimeSeries(rates, { year: 2024, utc_offset_hours: -5, currency: 'USD' }).buy;
    expect(read.map((p) => [p.starts_at, p.ends_at, p.currency])).toEqual([
      ['2024-01-01T05:00:00.000Z', '2024-02-29T05:00:00.000Z', 'USD'],
      ['2024-03-01T05:00:00.000Z', '2025-01-01T05:00:00.000Z', 'USD'],
    ]);
  });

  it('refuses by name what the format cannot say', () => {
    const year = { year: 2025, utc_offset_hours: 1 };
    expect(() => writeTimeSeries({ ...year, buy: [{ ...hourly[0], kind: 'indexed' }] })).toThrow(/^utilityrate5_price_not_fixed: a indexed buy price/);
    expect(() => writeTimeSeries({ ...year, buy: hourly.slice(1) })).toThrow(/^utilityrate5_price_missing: no buy price at 2024-12-31T23:00:00.000Z/);
    expect(() => writeTimeSeries({ ...year, buy: [fixed(START_2025, START_2025 + 1.5 * HOUR, 1), fixed(START_2025 + 1.5 * HOUR, END_2025, 2)] })).toThrow(/^utilityrate5_price_misaligned/);
    expect(() => writeTimeSeries({ ...year, buy: [hourly[0], { ...hourly[0], price: 2 }, ...hourly.slice(1)] })).toThrow(/^utilityrate5_prices_overlap/);
    expect(() => writeTimeSeries({ ...year, buy: hourly, sell: [fixed(START_2025, END_2025, 1, { currency: 'USD' })] })).toThrow(/^utilityrate5_mixed_currencies: buy prices in EUR, sell prices in USD/);
    expect(() => writeTimeSeries({ ...year, buy: [hourly[0], { ...hourly[1], currency: 'CHF' }] })).toThrow(/^utilityrate5_mixed_currencies: buy prices in CHF, EUR/);
    expect(() => writeTimeSeries({ ...year, buy: hourly, steps_per_hour: 7 })).toThrow(/^utilityrate5_step_unsupported/);
    expect(() => writeTimeSeries({ year: 2025, utc_offset_hours: Number.NaN, buy: hourly })).toThrow(/^utilityrate5_utc_offset_required/);
    expect(() => readTimeSeries({ ur_ts_buy_rate: [1, 2, 3] }, { ...year, currency: 'EUR' })).toThrow(/^utilityrate5_unreadable/);
  });
});

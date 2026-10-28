// SAM utilityrate5 rates read into plain rates with no database: the energy
// charges and their 12 × 24 schedules, the time-series rates, every other
// `ur_` key carried as read; written back to the same inputs; spread over
// the hours of SAM's year, and an hourly year folded back to its schedules.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { HOURS_IN_YEAR, hourlyRates, rateFromHourly, readUtilityRate, writeUtilityRate } from '@nexgen-os/utilityrate5';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** The index of an hour of SAM's year: day of the year from 0, hour of the day. */
const at = (day: number, hour: number) => day * 24 + hour;

describe('reading a rate', () => {
  it('reads the energy charges, the schedules and the sell rate of a time-of-use case', async () => {
    const rate = readUtilityRate(await fixture('time-of-use.json'));
    expect(rate.energyCharges).toEqual([
      { period: 1, tier: 1, maxUsage: 1e38, maxUsageUnit: 'kWh', buy: 0.2412, sell: 0.07 },
      { period: 2, tier: 1, maxUsage: 1e38, maxUsageUnit: 'kWh', buy: 0.1867, sell: 0.07 },
      { period: 3, tier: 1, maxUsage: 1e38, maxUsageUnit: 'kWh', buy: 0.3105, sell: 0.07 },
    ]);
    expect(rate.weekday).toHaveLength(12);
    expect(rate.weekday[6]![12]).toBe(3);
    expect(rate.weekday[0]![12]).toBe(1);
    expect(rate.weekend[6]![12]).toBe(2);
    expect(rate.sellEqualsBuy).toBe(false);
    expect(rate.timeSeriesBuy).toBeNull();
    expect(rate.timeSeriesSell).toBeNull();
  });

  it('carries every other ur_ key as read, a time series turned off included, and leaves the rest of the case', async () => {
    const rate = readUtilityRate(await fixture('time-of-use.json'));
    expect(rate.other.ur_monthly_fixed_charge).toBe(12.5);
    expect(rate.other.ur_metering_option).toBe(2);
    expect(rate.other.ur_dc_tou_mat).toEqual([[1, 1, 1e38, 4.1]]);
    expect(rate.other.ur_en_ts_sell_rate).toBe(0);
    expect(rate.other.ur_ts_sell_rate).toEqual([0]);
    expect(rate.other).not.toHaveProperty('system_capacity');
  });

  it('finds the ur_ keys under the group PySAM exports them in, and reads tiers with their usage limit', async () => {
    const rate = readUtilityRate(await fixture('tiered-pysam-export.json'));
    expect(rate.energyCharges).toEqual([
      { period: 1, tier: 1, maxUsage: 300, maxUsageUnit: 'kWh', buy: 0.15, sell: 0.05 },
      { period: 1, tier: 2, maxUsage: 1e38, maxUsageUnit: 'kWh', buy: 0.22, sell: 0.05 },
    ]);
    expect(rate.other).toEqual({ ur_metering_option: 0 });
  });

  it('reads an object as well as its JSON text', async () => {
    const text = await fixture('time-of-use.json');
    expect(readUtilityRate(JSON.parse(text))).toEqual(readUtilityRate(`﻿${text}`));
  });

  it('refuses by name what is not a rate', async () => {
    expect(() => readUtilityRate('PVObject_=pvModule')).toThrow(/^utilityrate5_unreadable: not JSON/);
    expect(() => readUtilityRate([1, 2])).toThrow(/^utilityrate5_unreadable: a SAM case is a JSON object/);
    expect(() => readUtilityRate({ system_capacity: 4 })).toThrow(/^utilityrate5_unreadable: no ur_ec_tou_mat/);
    expect(() => readUtilityRate({ ur_ec_tou_mat: [[1, 1, 1e38, 7, 0.2, 0]] })).toThrow(/^utilityrate5_unreadable: max usage unit 7/);
    expect(() => readUtilityRate({ ur_ec_tou_mat: [[1, 1, 1e38, 0, 0.2]] })).toThrow(/^utilityrate5_unreadable: a row of ur_ec_tou_mat/);
    const case_ = JSON.parse(await fixture('time-of-use.json'));
    expect(() => readUtilityRate({ ...case_, ur_ec_sched_weekend: case_.ur_ec_sched_weekend.slice(1) })).toThrow(/^utilityrate5_schedule_invalid: ur_ec_sched_weekend is 12 months/);
    case_.ur_ec_sched_weekday[2][5] = 4;
    expect(() => readUtilityRate(case_)).toThrow('utilityrate5_schedule_invalid: ur_ec_sched_weekday names period 4 in month 3 at hour 5');
    expect(() => readUtilityRate({ ur_en_ts_buy_rate: 1, ur_ts_buy_rate: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7] })).toThrow(/^utilityrate5_unreadable: ur_ts_buy_rate holds 7 values/);
  });
});

describe('writing a rate', () => {
  it('gives back the ur_ inputs it was read from, value for value', async () => {
    const case_ = JSON.parse(await fixture('time-of-use.json'));
    const { system_capacity: _, ...inputs } = case_;
    expect(writeUtilityRate(readUtilityRate(case_))).toEqual(inputs);
  });

  it('writes the inputs of a grouped export flat', async () => {
    const grouped = JSON.parse(await fixture('tiered-pysam-export.json'));
    expect(writeUtilityRate(readUtilityRate(grouped))).toEqual(grouped.ElectricityRates);
  });
});

describe('the rates of each hour of the year', () => {
  it('spreads the schedules over SAM\'s year, the first day a Monday', async () => {
    const { stepMinutes, buy, sell } = hourlyRates(readUtilityRate(await fixture('time-of-use.json')));
    expect(stepMinutes).toBe(60);
    expect(buy).toHaveLength(HOURS_IN_YEAR);
    expect(buy[at(0, 8)]).toBe(0.2412); // Monday 1 January, 8:00: weekday peak
    expect(buy[at(0, 3)]).toBe(0.1867); // the night
    expect(buy[at(5, 8)]).toBe(0.1867); // Saturday 6 January
    expect(buy[at(6, 8)]).toBe(0.1867); // Sunday 7 January
    expect(buy[at(7, 8)]).toBe(0.2412); // Monday 8 January
    expect(buy[at(181, 12)]).toBe(0.1867); // Sunday 1 July (day 181), noon
    expect(buy[at(182, 12)]).toBe(0.3105); // Monday 2 July: summer peak
    expect(buy[at(187, 12)]).toBe(0.1867); // Saturday 7 July
    expect(new Set(sell)).toEqual(new Set([0.07]));
  });

  it('sells at the buy rate when the rate says so', () => {
    const rate = rateFromHourly(Array.from({ length: HOURS_IN_YEAR }, (_, i) => (i % 24 < 12 ? 0.1 : 0.2)));
    expect(rate.sellEqualsBuy).toBe(true);
    expect(hourlyRates(rate).sell).toEqual(hourlyRates(rate).buy);
  });

  it('reads the time-series rates, at their own step, and repeats a coarser one over the finer', () => {
    const quarterHours = Array.from({ length: HOURS_IN_YEAR * 4 }, (_, i) => (i % 4) / 100);
    const rates = hourlyRates({
      energyCharges: [],
      weekday: [],
      weekend: [],
      sellEqualsBuy: true,
      timeSeriesBuy: quarterHours,
      timeSeriesSell: null,
      other: {},
    });
    expect(rates.stepMinutes).toBe(15);
    expect(rates.buy.slice(0, 5)).toEqual([0, 0.01, 0.02, 0.03, 0]);
    expect(() => hourlyRates({ energyCharges: [], weekday: [], weekend: [], sellEqualsBuy: false, timeSeriesBuy: quarterHours, timeSeriesSell: null, other: {} }).sell).toThrow(/^utilityrate5_unreadable: no energy charge and no time-series sell rate/);
  });

  it('refuses a tiered period, whose rate depends on the usage, and time series of different steps', async () => {
    const tiered = readUtilityRate(await fixture('tiered-pysam-export.json'));
    expect(() => hourlyRates(tiered)).toThrow('utilityrate5_tiered: period 1 charges by tier of usage, not by hour');
    const year = Array.from({ length: HOURS_IN_YEAR }, () => 0.1);
    expect(() => hourlyRates({ energyCharges: [], weekday: [], weekend: [], sellEqualsBuy: false, timeSeriesBuy: year, timeSeriesSell: [...year, ...year], other: {} })).toThrow(/^utilityrate5_series_length/);
  });
});

describe('an hourly year folded back', () => {
  it('gives back the schedules and charges of a time-of-use rate, its periods numbered as they first come, and the same hourly rates', async () => {
    const rate = readUtilityRate(await fixture('time-of-use.json'));
    const { buy, sell } = hourlyRates(rate);
    const folded = rateFromHourly(buy, sell);
    expect(folded.timeSeriesBuy).toBeNull();
    // Midnight of 1 January is the off-peak period, the file's 2: it comes first.
    expect(folded.energyCharges.map((c) => c.buy)).toEqual([0.1867, 0.2412, 0.3105]);
    const fileNumber = (period: number) => rate.energyCharges.find((c) => c.buy === folded.energyCharges[period - 1]!.buy)!.period;
    expect(folded.weekday.map((row) => row.map(fileNumber))).toEqual(rate.weekday);
    expect(folded.weekend.map((row) => row.map(fileNumber))).toEqual(rate.weekend);
    expect(hourlyRates(folded)).toEqual(hourlyRates(rate));
  });

  it('keeps a year that no schedule holds as time-series rates, read back without loss', () => {
    const buy = Array.from({ length: HOURS_IN_YEAR }, (_, i) => Math.round(100 * Math.sin(i / 50)) / 1000 + 0);
    const folded = rateFromHourly(buy);
    expect(folded.energyCharges).toEqual([]);
    expect(folded.timeSeriesBuy).toEqual(buy);
    const written = writeUtilityRate(folded);
    expect(written).toMatchObject({ ur_en_ts_buy_rate: 1, ur_sell_eq_buy: 1 });
    expect(hourlyRates(readUtilityRate(JSON.stringify(written)))).toEqual({ stepMinutes: 60, buy, sell: buy });
  });

  it('refuses a year that is not 8760 hours', () => {
    expect(() => rateFromHourly(Array.from({ length: 8784 }, () => 0.1))).toThrow(/^utilityrate5_series_length/);
  });
});

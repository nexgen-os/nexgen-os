// The `forecast` module: the hourly consumption of a participant over three
// days, a daily pattern that the third day exceeds by 0.5 kWh every hour;
// forecast by the naive and the seasonal naive methods, issued as known at
// a time (the values after it are not read, so an issue in the past is a
// backtest), every issue kept, read back as known at a time or at a horizon,
// and measured against what the third day was. Figures worked out by hand.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { forecastAt, store } from '@nexgen-os/core';
import { USER_A, USER_B, asUser, freshDatabase, one, organisation, participant } from '../../../tests/helpers/db.js';
import { createForecast, forecastAccuracy, issueForecast } from '../src/forecast.js';

const HOUR_MS = 3_600_000;
const START = Date.parse('2026-03-02T00:00:00Z');
const DAY1 = '2026-03-02T00:00:00.000Z';
const DAY3 = '2026-03-04T00:00:00.000Z';
const DAY4 = '2026-03-05T00:00:00.000Z';
const at = (hours: number) => new Date(START + hours * HOUR_MS).toISOString();

/** The consumption of hour `h` of the day: 1 + h kWh, 0.5 kWh more on the third day. */
const measured = (i: number) => 1 + (i % 24) + (i >= 48 ? 0.5 : 0);

let db: PGlite;
let home: string;
let series: string;

const refusal = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message.split(':')[0];
  }
  return 'accepted';
};

const issuesOf = async (seriesId: string) =>
  (await db.query<{ issued_at: Date; n: number }>(
    'select issued_at, count(*)::int n from forecast_values where series_id = $1 group by issued_at order by issued_at', [seriesId])).rows
    .map((r) => ({ issued_at: r.issued_at.toISOString(), n: r.n }));

beforeAll(async () => {
  db = await freshDatabase(['forecast']);
  const org = await organisation(db, 'A housing cooperative');
  await organisation(db, 'Another company', USER_B);
  // A country is data: Testland, its currency and its time zone, as a pack writes them.
  await db.query(`insert into currencies (code, name) values ('ZZZ', 'Testland currency') on conflict do nothing`);
  await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by)
                  values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz')`);
  home = await participant(db, { organisation_id: org, name: 'Flat 4', country: 'ZZ', time_zone: 'UTC' });
  ({ seriesId: series } = await store(db, { object_kind: 'participant', object_id: home, quantity_code: 'consumption_energy', step: '1 hour' },
    Array.from({ length: 72 }, (_, i) => ({ at: at(i), value: measured(i) }))));
});

afterAll(async () => {
  await db.close();
});

describe('methods', () => {
  it('are data: the two benchmarks ship with the module, with where they are described', async () => {
    const rows = (await db.query<{ code: string; seasonal: boolean; reference: string }>('select code, seasonal, reference from forecast.methods order by code')).rows;
    expect(rows.map((r) => [r.code, r.seasonal])).toEqual([['naive', false], ['seasonal_naive', true]]);
    expect(rows.every((r) => r.reference.includes('Forecasting: Principles and Practice'))).toBe(true);
  });
});

describe('a forecast', () => {
  it('takes the organisation of its series and refuses, by name, a season it cannot repeat', async () => {
    const id = await createForecast(db, { seriesId: series, method: 'naive', horizon: '1 day' });
    expect((await one<{ same: boolean }>(db, `select f.organisation_id = s.organisation_id same from forecast.forecasts f join series s on s.id = f.series_id where f.id = $1`, [id])).same).toBe(true);
    expect(await refusal(() => createForecast(db, { seriesId: series, method: 'seasonal_naive', horizon: '1 day' }))).toBe('season_required');
    expect(await refusal(() => createForecast(db, { seriesId: series, method: 'naive', horizon: '1 day', season: '1 day' }))).toBe('season_unexpected');
    expect(await refusal(() => createForecast(db, { seriesId: series, method: 'seasonal_naive', horizon: '1 day', season: '90 minutes' }))).toBe('season_not_whole_steps');
    expect(await refusal(() => createForecast(db, { seriesId: series, method: 'seasonal_naive', horizon: '1 day', season: '7 days', history: '3 days' }))).toBe('history_too_short');
    expect(await refusal(() => createForecast(db, { seriesId: series, method: 'naive', horizon: '1 month' }))).toMatch(/forecasts_fixed_lengths/);
    expect(await refusal(() => createForecast(db, { seriesId: series, method: 'persistence', horizon: '1 day' }))).toMatch(/forecasts_method_fkey/);
  });

  it('continues a regular series of amounts or instants, and says by name why it does not continue another', async () => {
    const { seriesId: register } = await store(db, { object_kind: 'participant', object_id: home, quantity_code: 'consumption_energy', value_kind: 'cumulative', step: '1 hour', name: 'index' },
      [{ at: at(0), value: 100 }]);
    const { seriesId: irregular } = await store(db, { object_kind: 'participant', object_id: home, quantity_code: 'consumption_energy', step: null, name: 'readings' },
      [{ at: at(0), value: 1 }]);
    const cumulative = await createForecast(db, { seriesId: register, method: 'naive', horizon: '1 day' });
    const steady = await createForecast(db, { seriesId: irregular, method: 'naive', horizon: '1 day' });
    expect(await refusal(() => issueForecast(db, cumulative, DAY3))).toBe('value_kind_unsupported');
    expect(await refusal(() => issueForecast(db, steady, DAY3))).toBe('step_required');
    const naive = await createForecast(db, { seriesId: series, method: 'naive', horizon: '1 day', history: '1 day' });
    expect(await refusal(() => issueForecast(db, naive, '2026-01-01T00:00:00Z'))).toBe('history_required');
    expect(await refusal(() => forecastAccuracy(db, naive, DAY3, DAY4))).toBe('forecast_not_issued');
  });
});

describe('an issue', () => {
  let seasonal: string;
  let naive: string;
  let seasonalSeries: string;

  beforeAll(async () => {
    seasonal = await createForecast(db, { seriesId: series, method: 'seasonal_naive', horizon: '1 day', season: '1 day' });
    naive = await createForecast(db, { seriesId: series, method: 'naive', horizon: '1 day' });
  });

  it('repeats the day before, from the last value observed to the horizon, written as a forecast series of the same object', async () => {
    seasonalSeries = await issueForecast(db, seasonal, DAY3);
    const values = await forecastAt(db, seasonalSeries, DAY3, DAY4);
    expect(values).toHaveLength(24);
    expect(values.map((v) => v.value)).toEqual(Array.from({ length: 24 }, (_, h) => 1 + h));
    expect(values.every((v) => v.issued_at === DAY3)).toBe(true);
    const s = await one<Record<string, unknown>>(db, 'select object_kind, object_id, quantity_code, kind, step::text step, source from series where id = $1', [seasonalSeries]);
    expect(s).toEqual({ object_kind: 'participant', object_id: home, quantity_code: 'consumption_energy', kind: 'forecast', step: '01:00:00', source: `forecast.forecasts:${seasonal}` });
  });

  it('says where it comes from: what it read, as of when, and what it wrote', async () => {
    const f = await one<{ provenance: string; inputs: Record<string, any>; results: Record<string, any>; forecast_series_id: string }>(
      db, 'select provenance, inputs, results, forecast_series_id from forecast.forecasts where id = $1', [seasonal]);
    expect(f.provenance).toBe('forecast.issue 0.5.0');
    expect(f.forecast_series_id).toBe(seasonalSeries);
    expect(f.inputs).toMatchObject({ series_id: series, method: 'seasonal_naive', season: '1 day', horizon: '1 day', history: '28 days', last_observed: { value: 24 } });
    expect(new Date(f.inputs.last_observed.at).toISOString()).toBe(at(47));
    expect(f.results).toMatchObject({ series_id: seasonalSeries, values: 24 });
    expect(new Date(f.results.from).toISOString()).toBe(DAY3);
    expect(new Date(f.results.to).toISOString()).toBe(DAY4);
  });

  it('reads only the intervals ended by its time: the hour still running is forecast too', async () => {
    const lagging = await createForecast(db, { seriesId: series, method: 'seasonal_naive', horizon: '1 hour', season: '1 day' });
    const id = await issueForecast(db, lagging, '2026-03-03T23:30:00Z');
    const values = await forecastAt(db, id, DAY1, DAY4);
    // 23:00 has not ended at 23:30: it is forecast from 23:00 the day before, as is the hour up to the horizon.
    expect(values.map((v) => [v.at, v.value])).toEqual([[at(47), 24], [at(48), 1]]);
  });

  it('keeps every issue, and the same time gives the same values again: a backtest', async () => {
    await issueForecast(db, seasonal, '2026-03-04T12:00:00Z');
    await issueForecast(db, seasonal, DAY3);
    expect(await issuesOf(seasonalSeries)).toEqual([{ issued_at: DAY3, n: 24 }, { issued_at: '2026-03-04T12:00:00.000Z', n: 24 }]);
    // The second issue read the third morning, 0.5 kWh above the day before.
    const latest = await forecastAt(db, seasonalSeries, '2026-03-04T12:00:00Z', '2026-03-04T13:00:00Z');
    expect(latest).toEqual([{ at: '2026-03-04T12:00:00.000Z', value: 13, issued_at: '2026-03-04T12:00:00.000Z' }]);
    const tomorrow = await forecastAt(db, seasonalSeries, '2026-03-05T00:00:00Z', '2026-03-05T01:00:00Z');
    expect(tomorrow).toEqual([{ at: '2026-03-05T00:00:00.000Z', value: 1.5, issued_at: '2026-03-04T12:00:00.000Z' }]);
    // At a horizon of 12 hours, 20:00 is read from the issue of midnight.
    const ahead = await forecastAt(db, seasonalSeries, '2026-03-04T20:00:00Z', '2026-03-04T21:00:00Z', { horizon: '12 hours' });
    expect(ahead).toEqual([{ at: '2026-03-04T20:00:00.000Z', value: 21, issued_at: DAY3 }]);
  });

  it('is measured against the series: mean absolute error, root mean square error and bias, at a horizon', async () => {
    // Every hour of the third day was forecast 0.5 kWh below it, by its latest issue;
    // 12 hours ahead, only the afternoon was forecast by then, at midnight.
    expect(await forecastAccuracy(db, seasonal, DAY3, DAY4, '12 hours')).toMatchObject({ pairs: 12, horizon: '12:00:00', bias: -0.5 });
    const a = await forecastAccuracy(db, seasonal, DAY3, DAY4);
    expect(a).toMatchObject({ pairs: 24, unit: 'KiloW-HR', horizon: null, method: 'seasonal_naive', series_id: series, forecast_series_id: seasonalSeries });
    expect(a.mae).toBeCloseTo(0.5, 9);
    expect(a.rmse).toBeCloseTo(0.5, 9);
    expect(a.bias).toBeCloseTo(-0.5, 9);

    await issueForecast(db, naive, DAY3);
    const n = await forecastAccuracy(db, naive, DAY3, DAY4);
    // 24 kWh every hour against 1.5 + h: errors 22.5 - h.
    const errors = Array.from({ length: 24 }, (_, h) => 22.5 - h);
    expect(n.pairs).toBe(24);
    expect(n.mae).toBeCloseTo(errors.reduce((s, e) => s + Math.abs(e), 0) / 24, 9);
    expect(n.rmse).toBeCloseTo(Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / 24), 9);
    expect(n.bias).toBeCloseTo(11, 9);
    expect(n.mae!).toBeGreaterThan(a.mae!);
  });

  it('is computed and read under row level security: another company sees no forecast and issues none', async () => {
    await asUser(db, USER_A, async () => {
      const mine = await createForecast(db, { seriesId: series, method: 'naive', horizon: '6 hours' });
      expect(await issueForecast(db, mine, DAY3)).toBeTruthy();
    });
    await asUser(db, USER_B, async () => {
      expect((await db.query('select id from forecast.forecasts')).rows).toHaveLength(0);
      expect(await refusal(() => issueForecast(db, seasonal, DAY3))).toBe('forecast_not_found');
      expect(await refusal(() => createForecast(db, { seriesId: series, method: 'naive', horizon: '1 day' }))).toMatch(/object_not_found|row-level security/);
      expect((await db.query('select code from forecast.methods')).rows).toHaveLength(2);
    });
  });
});

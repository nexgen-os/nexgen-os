// P50 and P90 of a yield run on real years: the yearly totals in the site's
// local standard time, their spread, the components the caller names in
// quadrature, recorded as a run anyone can redo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { storeSeries, type SeriesPoint } from '@nexgen-os/core';
import { EXCEEDANCE_ENGINE_VERSION, exceedance, normalQuantile } from '../modules/solar/src/exceedance.js';
import { USER_A, freshDatabase, insert, one, organisation } from './helpers/db.js';

const HOUR = 3_600_000;
/** Every hour of the local standard years of Brussels (UTC+1), one constant energy per year. */
const years = (perHour: Record<number, number>): SeriesPoint[] =>
  Object.entries(perHour).flatMap(([year, kwh]) => {
    const start = Date.UTC(Number(year), 0, 1) - HOUR;
    const hours = (Date.UTC(Number(year) + 1, 0, 1) - Date.UTC(Number(year), 0, 1)) / HOUR;
    return Array.from({ length: hours }, (_, i) => ({ at: new Date(start + i * HOUR).toISOString(), value: kwh }));
  });

let db: PGlite;
let org: string;
let system: string;

beforeAll(async () => {
  db = await freshDatabase(['solar']);
  org = await organisation(db, 'A cooperative', USER_A);
  const site = await insert(db, 'sites', { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  system = await insert(db, 'devices', { organisation_id: org, site_id: site, name: 'Roof PV', device_type: 'solar', rated_power_kw: 1 });
  await db.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 1)', [system]);
});

afterAll(async () => {
  await db.close();
});

const yieldRun = async (name: string, perHour: Record<number, number>, results: Record<string, unknown> = {}) => {
  const { seriesId } = await storeSeries(db, { organisationId: org, objectKind: 'device', objectId: system, sourceCode: 'open_meteo', kind: 'simulated', name }, { quantity_code: 'production_energy', value_kind: 'interval', step: '1 hour', values: years(perHour) });
  const span = Object.keys(perHour).map(Number);
  return (await db.query<{ id: string }>(`select record_run('solar', 'fake 1.0.0', 'device', $1, null, $2::jsonb, $3::jsonb) id`, [system, JSON.stringify({ name, weather: { years: { from: Math.min(...span), to: Math.max(...span) } } }), JSON.stringify({ series_id: seriesId, ...results })])).rows[0].id;
};

describe('the quantiles of the normal distribution', () => {
  it('gives the z of P50, P75, P90 and P99', () => {
    expect([0.5, 0.75, 0.9, 0.99, 0.01].map((q) => Math.round(normalQuantile(q) * 1e7) / 1e7)).toEqual([0, 0.6744898, 1.2815516, 2.3263479, -2.3263479]);
  });
});

describe('P50 and P90 of a yield run', () => {
  it('takes the yearly totals of the run, their spread, and gives P75, P90 and P99 for one year', async () => {
    // 876, 963.6 and 788.4 kWh: a mean of 876 and a sample standard deviation of 87.6, 10 %.
    const run = await yieldRun('fake 2021-2023', { 2021: 0.1, 2022: 0.11, 2023: 0.09 });
    const got = await exceedance(db, { yieldRunId: run });
    expect(got.years).toEqual([{ year: 2021, kwh: 876 }, { year: 2022, kwh: 963.6 }, { year: 2023, kwh: 788.4 }]);
    expect(got.p50_kwh).toBe(876);
    expect(got.sigma).toEqual({ interannual: 0.1, interannual_over_horizon: 0.1, total: 0.1 });
    expect(got.exceedance_kwh['90']).toBeCloseTo(876 * (1 - 1.2815516 * 0.1), 2);
    expect(Object.keys(got.exceedance_kwh)).toEqual(['75', '90', '99']);

    const recorded = await one<{ engine_version: string; subject_id: string; inputs: Record<string, any> }>(db, 'select engine_version, subject_id, inputs from runs where id = $1', [got.runId]);
    expect(recorded).toMatchObject({ engine_version: EXCEEDANCE_ENGINE_VERSION, subject_id: system, inputs: { kind: 'exceedance', yield_run_id: run, horizon_years: 1, uncertainties: [] } });
    expect((await exceedance(db, { yieldRunId: run })).runId).toBe(got.runId);
  });

  it('adds the named components in quadrature, the weather of ten years varying less than one', async () => {
    const run = await yieldRun('fake 2021-2023 again', { 2021: 0.1, 2022: 0.11, 2023: 0.09 });
    const got = await exceedance(db, { yieldRunId: run, horizonYears: 10, uncertainties: [{ code: 'irradiance', pct: 5 }, { code: 'models', pct: 3 }], probabilities: [90] });
    const sigma = Math.sqrt(0.01 / 10 + 0.05 ** 2 + 0.03 ** 2);
    expect(got.sigma.interannual_over_horizon).toBeCloseTo(0.1 / Math.sqrt(10), 6);
    expect(got.sigma.total).toBeCloseTo(sigma, 6);
    expect(got.exceedance_kwh).toEqual({ '90': expect.closeTo(876 * (1 - 1.2815516 * sigma), 2) });
  });

  it('refuses a typical year, a run of one complete year and what is not a yield run, by name', async () => {
    await expect(exceedance(db, { yieldRunId: await yieldRun('typical', { 2023: 0.1 }, { typical_months: [2019] }) })).rejects.toThrow(/^real_years_required: the run gives one typical year/);
    await expect(exceedance(db, { yieldRunId: await yieldRun('one year', { 2023: 0.1 }) })).rejects.toThrow(/^real_years_required: 1 complete year/);
    await expect(exceedance(db, { yieldRunId: system })).rejects.toThrow(/^run_not_found/);
    const run = await yieldRun('fake 2021-2022', { 2021: 0.1, 2022: 0.11 });
    await expect(exceedance(db, { yieldRunId: run, probabilities: [100] })).rejects.toThrow(/^probability_invalid/);
    await expect(exceedance(db, { yieldRunId: run, uncertainties: [{ code: 'soiling', pct: -1 }] })).rejects.toThrow(/^uncertainty_invalid/);
  });
});

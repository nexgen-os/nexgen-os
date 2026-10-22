// The IEC 61724-1 indicators of a PV system: final and reference yields,
// performance ratio and energy performance index, on the hours every series
// has, by month in the time zone of the participant, recorded as a run that a new
// reading renews.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { storeSeries, type SeriesPoint } from '@nexgen-os/core';
import { PERFORMANCE_ENGINE_VERSION, performanceIndicators } from '../modules/solar/src/performance.js';
import { USER_A, freshDatabase, insert, one, organisation, participant } from './helpers/db.js';

const HOUR = 3_600_000;

/** Hourly values from `start` (UTC) for `hours` hours: a clear-sky-like day shape. */
const hourly = (start: string, hours: number, value: (h: number) => number): SeriesPoint[] =>
  Array.from({ length: hours }, (_, i) => ({ at: new Date(Date.parse(start) + i * HOUR).toISOString(), value: value(i) }));
const sun = (i: number) => Math.max(0, Math.sin(((i % 24) - 6) / 12 * Math.PI)) * 800; // W/m², light from 06:00 to 18:00 UTC

let db: PGlite;
let org: string;
let home: string;
let system: string;


beforeAll(async () => {
  db = await freshDatabase(['solar']);
  org = await organisation(db, 'A cooperative', USER_A);
  home = await participant(db, { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  system = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Roof PV', device_type: 'solar', rated_power_kw: 10 });
  await db.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 10)', [system]);
  await db.query(`insert into solar.pv_arrays (organisation_id, pv_system_id, name, azimuth_deg, tilt_deg, mounting, kwp_dc) values ($1, $2, 'South', 180, 30, 'roof_parallel', 10)`, [org, system]);
});

afterAll(async () => {
  await db.close();
});

const target = (objectKind: string, objectId: string, kind: 'measured' | 'simulated', name: string | null = null) => ({ organisationId: org, objectKind, objectId, sourceCode: 'pvgis', kind, name });

describe('the IEC 61724-1 indicators', () => {
  it('refuses by name what it cannot compute', async () => {
    await expect(performanceIndicators(db, { pvSystemId: home, from: '2025-06-01', to: '2025-06-30' })).rejects.toThrow(/^pv_system_not_found/);
    await expect(performanceIndicators(db, { pvSystemId: system, from: '2025-06-01', to: '2025-06-30' })).rejects.toThrow(/^series_not_found: no measured production/);
    // Ten days of production at a performance ratio of 0.8, from 25 June to 4 July 2025 (UTC days, Brussels is UTC+2).
    await storeSeries(db, target('device', system, 'measured'), { quantity_code: 'production_energy', value_kind: 'interval', step: '1 hour', values: hourly('2025-06-25T00:00:00Z', 240, (i) => (sun(i) / 1000) * 10 * 0.8) });
    await expect(performanceIndicators(db, { pvSystemId: system, from: '2025-06-25', to: '2025-07-04' })).rejects.toThrow(/^irradiance_required/);
  });

  it('gives the final and reference yields and the performance ratio from a sensor, by month in the time zone of the participant, on the hours both have', async () => {
    const sensor = await storeSeries(db, target('device', system, 'measured'), { quantity_code: 'poa_irradiance', value_kind: 'interval', step: '1 hour', values: hourly('2025-06-25T00:00:00Z', 240, sun).filter((_, i) => i !== 36) });
    const got = await performanceIndicators(db, { pvSystemId: system, from: '2025-06-26', to: '2025-07-03' });
    expect(got.irradiance).toBe('measured');
    // 26 June 00:00 to 4 July 00:00 in Brussels: 8 days of 24 hours, less the hour without irradiance (26 June 12:00 UTC).
    expect(got.total.hours).toBe(8 * 24 - 1);
    expect(got.total.performance_ratio).toBeCloseTo(0.8, 6);
    expect(got.total.final_yield_h).toBeCloseTo(got.total.energy_kwh / 10, 6);
    expect(got.total.reference_yield_h).toBeCloseTo(got.total.irradiation_kwh_m2, 6);
    expect([got.total.expected_kwh, got.total.energy_performance_index]).toEqual([null, null]);
    // June ends at 22:00 UTC on the 30th in Brussels: 5 days of June less the missing hour, 3 days of July.
    expect(got.months.map((m) => [m.period, m.hours])).toEqual([['2025-06', 5 * 24 - 1], ['2025-07', 3 * 24]]);
    expect(got.months.reduce((s, m) => s + m.energy_kwh, 0)).toBeCloseTo(got.total.energy_kwh, 5);

    const run = await one<{ engine_version: string; device_id: string; inputs: Record<string, any> }>(db, 'select engine_version, device_id, inputs from solar.runs where id = $1', [got.runId]);
    expect(run).toMatchObject({ engine_version: PERFORMANCE_ENGINE_VERSION, device_id: system });
    expect(run.inputs).toMatchObject({ kind: 'performance', standard: 'IEC 61724-1', kwp: 10, period: { from: '2025-06-26', to: '2025-07-03', time_zone: 'Europe/Brussels' }, irradiance: { source: 'measured', series: [{ series_id: sensor.seriesId }] } });

    // The same readings give the same run; a new reading, a new one.
    expect((await performanceIndicators(db, { pvSystemId: system, from: '2025-06-26', to: '2025-07-03' })).runId).toBe(got.runId);
    await storeSeries(db, target('device', system, 'measured'), { quantity_code: 'poa_irradiance', value_kind: 'interval', step: '1 hour', values: [{ at: '2025-06-26T12:00:00.000Z', value: 800 }] });
    const renewed = await performanceIndicators(db, { pvSystemId: system, from: '2025-06-26', to: '2025-07-03' });
    expect(renewed.runId).not.toBe(got.runId);
    expect(renewed.total.hours).toBe(8 * 24);
  });

  it('compares with a yield run: the energy performance index, and the run\'s irradiance when no sensor is there', async () => {
    const expected = await storeSeries(db, target('device', system, 'simulated', 'fake 2025-2025'), { quantity_code: 'production_energy', value_kind: 'interval', step: '1 hour', values: hourly('2025-06-25T00:00:00Z', 240, (i) => (sun(i) / 1000) * 10 * 0.8 / 0.95) });
    const poa = await storeSeries(db, target('device', system, 'simulated', 'fake 2025-2025 South'), { quantity_code: 'poa_irradiance', value_kind: 'interval', step: '1 hour', values: hourly('2025-06-25T00:00:00Z', 240, (i) => sun(i) * 1.05) });
    const yieldRun = (await db.query<{ id: string }>(`select record_run('solar.runs', 'device', $1, 'fake 1.0.0', '{"profile": "pvwatts"}', $2::jsonb) id`, [system, JSON.stringify({ series_id: expected.seriesId, array_series: { South: { poa_irradiance: poa.seriesId } } })])).rows[0].id;

    const withSensor = await performanceIndicators(db, { pvSystemId: system, from: '2025-06-26', to: '2025-07-03', yieldRunId: yieldRun });
    expect(withSensor.irradiance).toBe('measured');
    expect(withSensor.total.energy_performance_index).toBeCloseTo(0.95, 6);

    await db.query(`delete from series where object_id = $1 and kind = 'measured' and quantity_code = 'poa_irradiance'`, [system]);
    const fromRun = await performanceIndicators(db, { pvSystemId: system, from: '2025-06-26', to: '2025-07-03', yieldRunId: yieldRun });
    expect(fromRun.irradiance).toBe('simulated');
    expect(fromRun.total.performance_ratio).toBeCloseTo(0.8 / 1.05, 6);
    expect(fromRun.total.energy_performance_index).toBeCloseTo(0.95, 6);
    const run = await one<{ inputs: Record<string, any> }>(db, 'select inputs from solar.runs where id = $1', [fromRun.runId]);
    expect(run.inputs.irradiance).toMatchObject({ source: 'simulated', run_id: yieldRun, series: [{ series_id: poa.seriesId, kwp: 10 }] });
    expect(run.inputs.expected).toMatchObject({ run_id: yieldRun, series_id: expected.seriesId });

    await expect(performanceIndicators(db, { pvSystemId: system, from: '2025-06-26', to: '2025-07-03', yieldRunId: home })).rejects.toThrow(/^run_not_of_system/);
    await expect(performanceIndicators(db, { pvSystemId: system, from: '2024-06-26', to: '2024-07-03', yieldRunId: yieldRun })).rejects.toThrow(/^period_not_covered/);
  });

  it('needs the time zone of the participant', async () => {
    const other = await participant(db, { organisation_id: org, name: 'No zone', country: 'BE', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
    const device = await insert(db, 'devices', { organisation_id: org, participant_id: other, name: 'PV', device_type: 'solar', rated_power_kw: 3 });
    await db.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 3)', [device]);
    await expect(performanceIndicators(db, { pvSystemId: device, from: '2025-06-01', to: '2025-06-30' })).rejects.toThrow(/^time_zone_required/);
  });
});

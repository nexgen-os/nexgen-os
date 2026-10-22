// The IEC 61724-1 indicators of a PV system: final and reference yields,
// performance ratio and energy performance index, on the hours every series
// has, by month in the time zone of the participant, recorded as an estimate that a new
// reading renews.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { storeSeries, type SeriesPoint } from '@nexgen-os/core';
import { PERFORMANCE_ENGINE_VERSION, performanceIndicators } from '../src/performance.js';
import { USER_A, freshDatabase, insert, one, organisation, participant } from '../../../tests/helpers/db.js';

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
  await db.query('insert into solar.devices (id, kwp_dc) values ($1, 10)', [system]);
  await db.query(`insert into solar.pv_arrays (organisation_id, device_id, name, azimuth_deg, tilt_deg, mounting, kwp_dc) values ($1, $2, 'South', 180, 30, 'roof_parallel', 10)`, [org, system]);
});

afterAll(async () => {
  await db.close();
});

const target = (objectKind: string, objectId: string, kind: 'measured' | 'simulated', name: string | null = null) => ({ organisationId: org, objectKind, objectId, sourceCode: 'pvgis', kind, name });

describe('the IEC 61724-1 indicators', () => {
  it('refuses by name what it cannot compute', async () => {
    await expect(performanceIndicators(db, { deviceId: home, from: '2025-06-01', to: '2025-06-30' })).rejects.toThrow(/^device_not_found/);
    await expect(performanceIndicators(db, { deviceId: system, from: '2025-06-01', to: '2025-06-30' })).rejects.toThrow(/^series_not_found: no measured production/);
    // Ten days of production at a performance ratio of 0.8, from 25 June to 4 July 2025 (UTC days, Brussels is UTC+2).
    await storeSeries(db, target('device', system, 'measured'), { quantity_code: 'production_energy', value_kind: 'interval', step: '1 hour', values: hourly('2025-06-25T00:00:00Z', 240, (i) => (sun(i) / 1000) * 10 * 0.8) });
    await expect(performanceIndicators(db, { deviceId: system, from: '2025-06-25', to: '2025-07-04' })).rejects.toThrow(/^irradiance_required/);
  });

  it('gives the final and reference yields and the performance ratio from a sensor, by month in the time zone of the participant, on the hours both have', async () => {
    const sensor = await storeSeries(db, target('device', system, 'measured'), { quantity_code: 'poa_irradiance', value_kind: 'interval', step: '1 hour', values: hourly('2025-06-25T00:00:00Z', 240, sun).filter((_, i) => i !== 36) });
    const got = await performanceIndicators(db, { deviceId: system, from: '2025-06-26', to: '2025-07-03' });
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

    const estimate = await one<{ provenance: string; device_id: string; inputs: Record<string, any> }>(db, 'select provenance, device_id, inputs from solar.estimates where id = $1', [got.estimateId]);
    expect(estimate).toMatchObject({ provenance: PERFORMANCE_ENGINE_VERSION, device_id: system });
    expect(estimate.inputs).toMatchObject({ kind: 'performance', standard: 'IEC 61724-1', kwp: 10, period: { from: '2025-06-26', to: '2025-07-03', time_zone: 'Europe/Brussels' }, irradiance: { source: 'measured', series: [{ series_id: sensor.seriesId }] } });

    // A new reading, a new computation: it replaces the estimate it names.
    await storeSeries(db, target('device', system, 'measured'), { quantity_code: 'poa_irradiance', value_kind: 'interval', step: '1 hour', values: [{ at: '2025-06-26T12:00:00.000Z', value: 800 }] });
    const renewed = await performanceIndicators(db, { deviceId: system, from: '2025-06-26', to: '2025-07-03', replaces: got.estimateId });
    expect(renewed.estimateId).toBe(got.estimateId);
    expect(renewed.total.hours).toBe(8 * 24);
    const replaced = await one<{ results: { total: { hours: number } } }>(db, 'select results from solar.estimates where id = $1', [got.estimateId]);
    expect(replaced.results.total.hours).toBe(8 * 24);
  });

  it('compares with a yield estimate: the energy performance index, and the estimate\'s irradiance when no sensor is there', async () => {
    const expected = await storeSeries(db, target('device', system, 'simulated', 'fake 2025-2025'), { quantity_code: 'production_energy', value_kind: 'interval', step: '1 hour', values: hourly('2025-06-25T00:00:00Z', 240, (i) => (sun(i) / 1000) * 10 * 0.8 / 0.95) });
    const poa = await storeSeries(db, target('device', system, 'simulated', 'fake 2025-2025 South'), { quantity_code: 'poa_irradiance', value_kind: 'interval', step: '1 hour', values: hourly('2025-06-25T00:00:00Z', 240, (i) => sun(i) * 1.05) });
    const yieldEstimate = (await db.query<{ id: string }>(`insert into solar.estimates (organisation_id, device_id, provenance, inputs, results) values (object_organisation('device', $1), $1, 'fake 1.0.0', '{"profile": "pvwatts"}', $2::jsonb) returning id`, [system, JSON.stringify({ series_id: expected.seriesId, array_series: { South: { poa_irradiance: poa.seriesId } } })])).rows[0].id;

    const withSensor = await performanceIndicators(db, { deviceId: system, from: '2025-06-26', to: '2025-07-03', yieldEstimateId: yieldEstimate });
    expect(withSensor.irradiance).toBe('measured');
    expect(withSensor.total.energy_performance_index).toBeCloseTo(0.95, 6);

    await db.query(`delete from series where object_id = $1 and kind = 'measured' and quantity_code = 'poa_irradiance'`, [system]);
    const fromEstimate = await performanceIndicators(db, { deviceId: system, from: '2025-06-26', to: '2025-07-03', yieldEstimateId: yieldEstimate });
    expect(fromEstimate.irradiance).toBe('simulated');
    expect(fromEstimate.total.performance_ratio).toBeCloseTo(0.8 / 1.05, 6);
    expect(fromEstimate.total.energy_performance_index).toBeCloseTo(0.95, 6);
    const estimate = await one<{ inputs: Record<string, any> }>(db, 'select inputs from solar.estimates where id = $1', [fromEstimate.estimateId]);
    expect(estimate.inputs.irradiance).toMatchObject({ source: 'simulated', estimate_id: yieldEstimate, series: [{ series_id: poa.seriesId, kwp: 10 }] });
    expect(estimate.inputs.expected).toMatchObject({ estimate_id: yieldEstimate, series_id: expected.seriesId });

    await expect(performanceIndicators(db, { deviceId: system, from: '2025-06-26', to: '2025-07-03', yieldEstimateId: home })).rejects.toThrow(/^estimate_not_of_system/);
    await expect(performanceIndicators(db, { deviceId: system, from: '2024-06-26', to: '2024-07-03', yieldEstimateId: yieldEstimate })).rejects.toThrow(/^period_not_covered/);
  });

  it('needs the time zone of the participant', async () => {
    const other = await participant(db, { organisation_id: org, name: 'No zone', country: 'BE', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
    const device = await insert(db, 'devices', { organisation_id: org, participant_id: other, name: 'PV', device_type: 'solar', rated_power_kw: 3 });
    await db.query('insert into solar.devices (id, kwp_dc) values ($1, 3)', [device]);
    await expect(performanceIndicators(db, { deviceId: device, from: '2025-06-01', to: '2025-06-30' })).rejects.toThrow(/^time_zone_required/);
  });
});

// To size is one gesture: solar.size(participant, criterion, bounds). A
// participant with no PV yet consumes 1 kWh an hour; one kWp produces
// 0.5 kWh an hour from 8 to 16. The sweep finds the power each criterion of
// the core's vocabulary asks for, within a stated maximum or the roof of the
// building module, and writes it as an estimate about the participant.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation } from '../../../tests/helpers/db.js';
import { size, type SizingRequest } from '../src/size.js';

let db: PGlite;
let org: string;
let home: string;
let shapeSeries: string;
const hours = Array.from({ length: 48 }, (_, h) => new Date(Date.UTC(2026, 5, 1, h)).toISOString());
let base: Omit<SizingRequest, 'criterion'>;
const economics = { offtakePricePerKwh: 0.25, injectionPricePerKwh: 0.05, costPerKwp: 1000, horizonYears: 20, discountRate: 0.04, currency: 'EUR' };

beforeAll(async () => {
  db = await freshDatabase(['solar', 'actions', 'consumption', 'building']);
  org = await organisation(db, 'A sizing office');
  const project = await insert(db, 'projects', { organisation_id: org, name: 'Roof study', kind: 'pv_roof', country: 'BE' });
  home = (await one<{ id: string }>(db, `select join_project($1, 'House', '{"country": "BE"}') id`, [project])).id;
  const reference = (await one<{ id: string }>(db, `select join_project($1, 'Reference', '{"country": "BE"}', 'producer') id`, [project])).id;
  const pv = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Reference array', p_rated_power_kw => 1) id`, [reference])).id;
  const store = (object: Record<string, unknown>, values: number[]) =>
    one<{ series_id: string }>(db, `select series_id from store(null, $1::timestamptz[], $2::float8[], p_series => $3::jsonb)`, [hours, values, JSON.stringify(object)]);
  shapeSeries = (await store({ object_kind: 'device', object_id: pv, quantity_code: 'production_energy', step: '1 hour' },
    hours.map((_, h) => (h % 24 >= 8 && h % 24 < 16 ? 0.5 : 0)))).series_id;
  await store({ object_kind: 'participant', object_id: home, quantity_code: 'consumption_energy', step: '1 hour' }, hours.map(() => 1));
  base = { participantId: home, from: hours[0], to: '2026-06-03T00:00:00.000Z', step: '1 hour', shape: { seriesId: shapeSeries, kwp: 1 }, bounds: { maxKwp: 10, source: 'the owner' } };
});

afterAll(async () => {
  await db.close();
});

describe('solar.size()', () => {
  it('meets a target self-consumption rate, and writes the sizing as an estimate about the participant', async () => {
    const r = await size(db, { ...base, criterion: 'self_consumption_rate', target: 0.8 });
    expect(r.recommended.kwp).toBeCloseTo(2.5, 6);
    expect(r.recommended.selfConsumptionRate).toBeCloseTo(0.8, 4);
    expect(r.curve).toHaveLength(100);
    expect(r.limit).toEqual({ maxKwp: 10, by: 'stated', source: 'the owner' });
    const row = await one<{ kind: string; participant_id: string; device_id: string | null; provenance: string; inputs: Record<string, any> }>(db,
      'select kind, participant_id, device_id, provenance, inputs from solar.estimates where id = $1', [r.estimateId]);
    expect(row).toMatchObject({ kind: 'sizing', participant_id: home, device_id: null, provenance: 'solar-size-0.3.0' });
    expect(row.inputs).toMatchObject({ criterion: { code: 'self_consumption_rate', aim: 'target', target: 0.8 }, production_shape: { series_id: shapeSeries, kwp: 1 }, consumption: { kind: 'measured', kwh: 48 } });
  });

  it('meets a target self-sufficiency, the largest power the limit allows, and the best net present value', async () => {
    expect((await size(db, { ...base, criterion: 'self_sufficiency', target: 0.25 })).recommended.kwp).toBeCloseTo(1.5, 6);
    expect((await size(db, { ...base, criterion: 'max_power' })).recommended.kwp).toBe(10);
    // Each kWp self-consumed earns more than it costs, each kWp injected less: 2 kWp.
    const npv = await size(db, { ...base, criterion: 'net_present_value', economics });
    expect(npv.recommended.kwp).toBeCloseTo(2, 6);
    expect(npv.recommended.netPresentValue).toBeGreaterThan(0);
    const payback = await size(db, { ...base, criterion: 'payback', economics });
    expect(payback.recommended.paybackYears).toBeCloseTo(2.74, 2);
  });

  it('reads the limit from the roof faces of the participant, the power a square metre carries a parameter', async () => {
    const building = await insert(db, 'building.buildings', { organisation_id: org, participant_id: home, name: 'House' });
    await insert(db, 'building.surfaces', { organisation_id: org, building_id: building, name: 'South roof', kind: 'roof', area_m2: 40 });
    await expect(size(db, { ...base, bounds: undefined, criterion: 'max_power' })).rejects.toThrow(/parameter_missing: pv_power_per_area/);
    await db.query(`select set_attribute('organisation', $1, 'pv_power_per_area', '0.2'::jsonb, null, null, 'installer datasheets')`, [org]);
    const r = await size(db, { ...base, bounds: undefined, criterion: 'max_power' });
    expect(r.limit).toMatchObject({ maxKwp: 8, by: 'roof', roof_m2: 40, per_area: { value: 0.2, level: 'organisation' } });
    expect(r.recommended.kwp).toBe(8);
  });

  it('refuses by name what it cannot size', async () => {
    await expect(size(db, { ...base, criterion: 'cheapest' })).rejects.toThrow(/^sizing_criterion_unknown/);
    await expect(size(db, { ...base, criterion: 'self_consumption_rate' })).rejects.toThrow(/^target_required/);
    await expect(size(db, { ...base, criterion: 'payback' })).rejects.toThrow(/^economics_required/);
    const other = (await one<{ id: string }>(db, `select join_project((select project_id from participants where id = $1), 'Shed', '{"country": "BE"}') id`, [home])).id;
    await expect(size(db, { ...base, participantId: other, criterion: 'max_power' })).rejects.toThrow(/^consumption_curve_missing/);
    await expect(db.query(`insert into solar.estimates (participant_id, kind, provenance, inputs, results) values ($1, 'yield', 'x', '{}', '{}')`, [home]))
      .rejects.toThrow(/estimates_kind_of_subject/);
  });

  it('reads the same criteria as every module that sizes, from the core', async () => {
    const codes = await db.query<{ code: string }>('select code from sizing_criteria order by code');
    expect(codes.rows.map((r) => r.code)).toEqual(['max_power', 'net_present_value', 'payback', 'self_consumption_rate', 'self_sufficiency']);
  });
});

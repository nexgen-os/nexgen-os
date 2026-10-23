// The `battery` module on a database: a household with PV and a battery, a
// shared battery of a community on the surplus and residual of its
// sharing, a battery run for arbitrage on a price series, the sizing of a
// battery for a criterion, and what each refuses by name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { store } from '@nexgen-os/core';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from '../../../tests/helpers/db.js';
import { dispatch, size } from '../src/estimates.js';

let db: PGlite;
let org: string;
let home: string;
let battery: string;
let community: string;

const FROM = '2026-06-01T00:00:00.000Z';
const TO = '2026-06-02T00:00:00.000Z';
const hours = (values: Record<number, number>) => Array.from({ length: 24 }, (_, h) => values[h] ?? 0);
const at = (h: number) => new Date(Date.parse(FROM) + h * 3_600_000).toISOString();
const points = (values: number[]) => values.map((value, h) => ({ at: at(h), value }));
/** A sunny day: 4 kWh an hour from 10:00 to 14:00 UTC, 3 kWh an hour of evening load from 18:00 to 22:00. */
const SUN = hours({ 10: 4, 11: 4, 12: 4, 13: 4 });
const EVENING = hours({ 18: 3, 19: 3, 20: 3, 21: 3 });

async function series(objectKind: string, objectId: string, quantity: string, values: number[]): Promise<string> {
  return (await store(db, { object_kind: objectKind, object_id: objectId, quantity_code: quantity, kind: 'measured', value_kind: 'interval', step: '1 hour' }, points(values))).seriesId;
}

async function place(project: string, name: string, fields: Record<string, unknown> = {}): Promise<string> {
  return insert(db, 'participants', { organisation_id: org, project_id: project, name, country: 'BE', time_zone: 'Europe/Brussels', segment: 'individual', ...fields });
}

async function attribute(kind: string, id: string, property: string, value: number): Promise<void> {
  await db.query(`select set_attribute($1, $2, $3, $4::jsonb, null, null, 'assumptions of the study')`, [kind, id, property, JSON.stringify(value)]);
}

async function newBattery(participant: string, name: string, fields: Record<string, unknown>, ratedPowerKw: number | null = 5): Promise<string> {
  const id = (await one<{ id: string }>(db, `select install_device($1, 'battery', $2, null, $3, '2026-01-01') id`, [participant, name, ratedPowerKw])).id;
  await insert(db, 'battery.devices', { id, ...fields });
  return id;
}

beforeAll(async () => {
  db = await freshDatabase(['grid', 'battery'], ['be']);
  await db.query('insert into auth.users (id) values ($1), ($2) on conflict do nothing', [USER_A, USER_B]);
  org = await organisation(db, 'A study office', USER_A);
  await organisation(db, 'Another company', USER_B);
  // The organisation's assumptions: they come before the pack's.
  await attribute('organisation', org, 'battery_c_rate', 0.5);
  await attribute('organisation', org, 'round_trip_efficiency', 0.9);
  await attribute('organisation', org, 'energy_price_household', 200);
  await attribute('organisation', org, 'grid_fees_and_taxes', 100);
  await attribute('organisation', org, 'injection_price_reference', 50);

  const project = await insert(db, 'projects', { organisation_id: org, name: 'A home', kind: 'individual_self_consumption', country: 'BE' });
  home = await place(project, 'Household');
  await series('participant', home, 'production_energy', SUN);
  await series('participant', home, 'consumption_energy', EVENING);
  battery = await newBattery(home, 'Home battery', { usable_capacity_kwh: 10, round_trip_efficiency: 1 });

  community = await insert(db, 'projects', { organisation_id: org, name: 'A street', kind: 'collective_self_consumption', country: 'BE' });
});

afterAll(async () => {
  await db.close();
});

describe('a battery and its figures', () => {
  it('says each figure it reads and where it came from: the device, its rated power', async () => {
    const of = (await one<{ b: Record<string, any> }>(db, 'select battery.battery_of($1) b', [battery])).b;
    expect(of.usable_capacity_kwh).toEqual({ value: 10, level: 'device' });
    expect(of.charge_power_kw).toEqual({ value: 5, level: 'rated_power' });
    expect(of.round_trip_efficiency).toEqual({ value: 1, level: 'device' });
    expect([of.min_charge_level, of.max_charge_level, of.objective, of.perimeter]).toEqual([0, 100, 'self_consumption', 'site']);
  });

  it('reads its product, then the C-rate and the efficiency parameter_of() resolves', async () => {
    const product = await insert(db, 'products', { organisation_id: org, device_type: 'battery', manufacturer: 'Generic', model: 'B5', unit_capacity_kwh: 5 });
    await insert(db, 'battery.products', { id: product, round_trip_efficiency: 0.95, cycle_life: 6000, discharge_power_kw: 2 });
    const id = (await one<{ id: string }>(db, `select install_device($1, 'battery', 'Two units', $2, null, null, null, 2) id`, [home, product])).id;
    await insert(db, 'battery.devices', { id, objective: 'peak_shaving', peak_threshold_kw: 3, perimeter: 'project' });
    const of = (await one<{ b: Record<string, any> }>(db, 'select battery.battery_of($1) b', [id])).b;
    expect(of.usable_capacity_kwh).toMatchObject({ value: 10, level: 'product' });
    expect(of.discharge_power_kw).toMatchObject({ value: 4, level: 'product' });
    // Neither the device, nor its product, nor a rated power gives its charge power: its capacity at its C-rate.
    expect(of.charge_power_kw).toMatchObject({ value: 5, level: 'c_rate', c_rate: { value: 0.5, level: 'organisation' } });
    expect(of.round_trip_efficiency).toMatchObject({ value: 0.95, level: 'product' });
    expect(of.cycle_life).toBe(6000);
    await db.query('delete from devices where id = $1', [id]);

    const bare = await newBattery(home, 'Bare', { usable_capacity_kwh: 8 }, null);
    const b = (await one<{ b: Record<string, any> }>(db, 'select battery.battery_of($1) b', [bare])).b;
    expect(b.charge_power_kw).toMatchObject({ value: 4, level: 'c_rate' });
    expect(b.round_trip_efficiency).toMatchObject({ value: 0.9, level: 'organisation' });
    await db.query('delete from devices where id = $1', [bare]);
  });

  it('refuses by name what it cannot say', async () => {
    const undescribed = (await one<{ id: string }>(db, `select install_device($1, 'battery', 'Undescribed', null, 5) id`, [home])).id;
    await expect(db.query('select battery.battery_of($1)', [undescribed])).rejects.toThrow(/battery_not_described/);
    await insert(db, 'battery.devices', { id: undescribed, perimeter: 'project' });
    await expect(db.query('select battery.battery_of($1)', [undescribed])).rejects.toThrow(/capacity_required/);
    await db.query('delete from devices where id = $1', [undescribed]);
    const pv = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Roof', null, 6) id`, [home])).id;
    await expect(insert(db, 'battery.devices', { id: pv })).rejects.toThrow(/device_type_mismatch/);
    await expect(db.query(`update battery.devices set objective = 'spot' where id = $1`, [battery])).rejects.toThrow(/foreign key/);
    await expect(db.query('update battery.devices set min_charge_level = 90, max_charge_level = 80 where id = $1', [battery])).rejects.toThrow(/devices_charge_levels/);
    await db.query('delete from devices where id = $1', [pv]);
  });

  it('reads the C-rate and the efficiency the module publishes for every country, cited, unless a level above says otherwise', async () => {
    const other = await organisation(db, 'Without assumptions', USER_A);
    const p = await insert(db, 'projects', { organisation_id: other, name: 'Elsewhere', country: 'BE' });
    const somebody = await insert(db, 'participants', { organisation_id: other, project_id: p, name: 'Somebody', country: 'BE' });
    const id = (await one<{ id: string }>(db, `select install_device($1, 'battery', 'Bare', null, null) id`, [somebody])).id;
    await insert(db, 'battery.devices', { id, usable_capacity_kwh: 10 });
    const b = (await one<{ b: Record<string, any> }>(db, 'select battery.battery_of($1) b', [id])).b;
    expect(b.charge_power_kw).toMatchObject({ value: 4, level: 'c_rate', c_rate: { value: 0.4, level: 'generic', published_by: 'battery', source_code: 'atb_2025_residential_battery' } });
    expect(b.round_trip_efficiency).toMatchObject({ value: 0.85, level: 'generic', source_code: 'atb_2025_residential_battery' });
    // A country whose pack decides nothing of a battery reads the same
    // technology figure; an organisation that says otherwise wins.
    await db.query(`insert into countries (code, name, currency, time_zones, region_level, published_by) values ('ZZ', 'Testland', 'EUR', '{UTC}', 'region', 'pack:zz')`);
    const nowhere = await insert(db, 'participants', { organisation_id: other, project_id: p, name: 'Nowhere', country: 'ZZ' });
    const lost = (await one<{ id: string }>(db, `select install_device($1, 'battery', 'Lost', null, null) id`, [nowhere])).id;
    await insert(db, 'battery.devices', { id: lost, usable_capacity_kwh: 10 });
    expect((await one<{ b: Record<string, any> }>(db, 'select battery.battery_of($1) b', [lost])).b.charge_power_kw).toMatchObject({ value: 4, c_rate: { level: 'generic' } });
    await db.query(`select set_attribute('organisation', $1, 'battery_c_rate', '0.5'::jsonb, null, 'atb_2025_residential_battery')`, [other]);
    expect((await one<{ b: Record<string, any> }>(db, 'select battery.battery_of($1) b', [lost])).b.charge_power_kw).toMatchObject({ value: 5, c_rate: { level: 'organisation' } });
    // What nobody decided stays refused by name.
    await expect(db.query(`select parameter_of('device', $1, 'battery_cost')`, [lost])).rejects.toThrow(/parameter_missing: battery_cost/);
  });
});

describe('dispatch() on a participant\'s place', () => {
  it('records an estimate of the battery with its inputs, its results and its series', async () => {
    const [r] = await dispatch(db, { perimeter: { kind: 'participant', id: home }, from: FROM, to: TO });
    expect(r.deviceId).toBe(battery);
    expect(r.indicators).toMatchObject({ charge_kwh: 10, discharge_kwh: 10, cycles: 1, self_consumption_rate_with: 0.625, offtake_with_kwh: 2, injection_with_kwh: 6 });
    // 10 kWh not taken at 200 + 100 per MWh, 10 kWh not injected at 50: 3 − 0.5.
    expect(r.savings).toBe(2.5);
    const e = await one<{ device_id: string; participant_id: string | null; provenance: string; inputs: any; results: any; organisation_id: string }>(
      db, 'select * from battery.estimates where id = $1', [r.estimateId]);
    expect([e.device_id, e.participant_id, e.organisation_id, e.provenance]).toEqual([battery, null, org, 'battery-dispatch-0.3.1']);
    expect(e.inputs.period).toEqual({ from: FROM, to: TO, step: '01:00:00', intervals: 24 });
    expect(e.inputs.battery.usable_capacity_kwh).toEqual({ value: 10, level: 'device' });
    expect(e.inputs.prices.read.energy_price_household).toMatchObject({ value: 200, level: 'organisation' });
    expect(e.results).toMatchObject({ savings: 2.5, currency: 'EUR', converged: true, start_level_kwh: 0 });
    const written = await db.query<{ quantity_code: string; kind: string; object_id: string; total: number }>(
      `select se.quantity_code, se.kind, se.object_id, sum(v.value) total from series se join series_values v on v.series_id = se.id
        where se.source = $1 group by 1, 2, 3 order by 1`, [`battery.estimates:${r.estimateId}`]);
    expect(written.rows).toEqual([
      { quantity_code: 'battery_charge_energy', kind: 'simulated', object_id: battery, total: 10 },
      { quantity_code: 'battery_discharge_energy', kind: 'simulated', object_id: battery, total: 10 },
      { quantity_code: 'charge_level', kind: 'simulated', object_id: battery, total: expect.any(Number) },
    ]);
    const level = await one<{ value: number }>(db, 'select v.value from series_values v where v.series_id = $1 and v.at = $2', [r.series.level, at(18)]);
    expect(level.value).toBe(100);
  });

  it('chains a second battery after the first, and says so', async () => {
    const second = await newBattery(home, 'Second battery', { usable_capacity_kwh: 10, round_trip_efficiency: 1 });
    const [a, b] = await dispatch(db, { perimeter: { kind: 'participant', id: home }, from: FROM, to: TO });
    expect([a.deviceId, b.deviceId]).toEqual([battery, second]);
    expect(b.indicators).toMatchObject({ production_kwh: 6, consumption_kwh: 2, discharge_kwh: 2 });
    const inputs = (await one<{ inputs: any }>(db, 'select inputs from battery.estimates where id = $1', [b.estimateId])).inputs;
    expect(inputs.chain).toEqual({ position: 2, of: 2, after: [battery] });
    await db.query(`update devices set status = 'out_of_service' where id = $1`, [second]);
  });

  it('refuses by name what it cannot run', async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Bare', country: 'BE' });
    const nobody = await place(project, 'No battery');
    await expect(dispatch(db, { perimeter: { kind: 'participant', id: nobody }, from: FROM, to: TO })).rejects.toThrow(/no_battery/);
    await newBattery(nobody, 'Its battery', { usable_capacity_kwh: 10 });
    await expect(dispatch(db, { perimeter: { kind: 'participant', id: nobody }, from: FROM, to: TO })).rejects.toThrow(/series_not_found/);
    await series('participant', nobody, 'production_energy', SUN);
    const gappy = await store(db, { object_kind: 'participant', object_id: nobody, quantity_code: 'consumption_energy', kind: 'measured', value_kind: 'interval', step: '1 hour' },
      points(EVENING).filter((_, h) => h !== 5));
    await expect(dispatch(db, { perimeter: { kind: 'participant', id: nobody }, from: FROM, to: TO })).rejects.toThrow(/series_incomplete: .* 1 of the 24/);
    await expect(dispatch(db, { perimeter: { kind: 'participant', id: nobody }, from: FROM, to: TO, step: '7 hours' })).rejects.toThrow(/step_invalid/);
    await expect(dispatch(db, { perimeter: { kind: 'participant', id: nobody }, from: TO, to: FROM })).rejects.toThrow(/period_empty/);
    expect(gappy.seriesId).toBeTruthy();
    await expect(dispatch(db, { perimeter: { kind: 'participant', id: '00000000-0000-4000-8000-0000000000ff' }, from: FROM, to: TO })).rejects.toThrow(/participant_not_found/);
  });

  it('refuses a battery run for peak shaving without its threshold', async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Workshop', country: 'BE' });
    const workshop = await place(project, 'Workshop', { segment: 'business' });
    await series('participant', workshop, 'production_energy', hours({}));
    await series('participant', workshop, 'consumption_energy', hours({ 8: 2, 9: 9, 10: 2 }));
    const b = await newBattery(workshop, 'Peak battery', { usable_capacity_kwh: 10, objective: 'peak_shaving' });
    await expect(dispatch(db, { perimeter: { kind: 'participant', id: workshop }, from: FROM, to: TO })).rejects.toThrow(/peak_threshold_required/);
    await db.query('update battery.devices set peak_threshold_kw = 5 where id = $1', [b]);
    const [r] = await dispatch(db, { perimeter: { kind: 'participant', id: workshop }, from: FROM, to: TO });
    expect([r.indicators.peak_without_kw, r.indicators.peak_with_kw]).toEqual([9, 5]);
    // A business: the business energy price is not set by the organisation, so the pack's answers.
    const read = (await one<{ inputs: any }>(db, 'select inputs from battery.estimates where id = $1', [r.estimateId])).inputs.prices.read;
    expect(read.energy_price_business).toMatchObject({ level: 'country', source_code: 'be_eurostat_business_prices' });
  });
});

describe('dispatch() on a project\'s sharing', () => {
  it('runs a shared battery on the surplus and residual of the project, its grid fees not avoided', async () => {
    const plant = await place(community, 'Shared battery');
    const shared = await newBattery(plant, 'Street battery', { usable_capacity_kwh: 10, round_trip_efficiency: 1, perimeter: 'project' });
    await series('project', community, 'injection_energy', SUN);
    await series('project', community, 'offtake_energy', EVENING);
    const [r] = await dispatch(db, { perimeter: { kind: 'project', id: community }, from: FROM, to: TO });
    expect(r.deviceId).toBe(shared);
    expect(r.indicators.discharge_kwh).toBe(10);
    // 10 kWh at 200 per MWh, less 10 kWh not injected at 50.
    expect(r.savings).toBe(1.5);
  });
});

describe('dispatch() for arbitrage', () => {
  let trader: string;
  beforeAll(async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Trader', country: 'BE' });
    trader = await place(project, 'Trader');
    await series('participant', trader, 'production_energy', hours({}));
    await series('participant', trader, 'consumption_energy', hours({ 3: 5, 19: 5 }));
    await newBattery(trader, 'Arbitrage battery', { usable_capacity_kwh: 5, round_trip_efficiency: 0.9, objective: 'arbitrage' });
  });

  it('is refused without a price series', async () => {
    await expect(dispatch(db, { perimeter: { kind: 'participant', id: trader }, from: FROM, to: TO })).rejects.toThrow(/prices_required/);
  });

  it('charges at night and serves the evening by the price series of the participant', async () => {
    // 50 per MWh at night, 300 in the evening, 100 otherwise.
    const prices = hours(Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, h < 6 ? 50 : h >= 17 && h < 21 ? 300 : 100])));
    await store(db, { object_kind: 'participant', object_id: trader, quantity_code: 'energy_price', kind: 'measured', value_kind: 'interval', step: '1 hour' },
      points(prices), { unit: 'EUR-PER-MegaW-HR' });
    const [r] = await dispatch(db, { perimeter: { kind: 'participant', id: trader }, from: FROM, to: TO });
    // 5 kWh held take 5 / √0.9 kWh from the grid in the two cheapest hours and serve 5 × √0.9 kWh.
    expect(r.indicators.charge_from_grid_kwh).toBeCloseTo(5 / Math.sqrt(0.9), 6);
    expect(r.indicators.discharge_kwh).toBeCloseTo(5 * Math.sqrt(0.9), 6);
    const discharge = await db.query<{ at: Date; value: number }>('select at, value from series_values where series_id = $1 and value > 0', [r.series.discharge]);
    expect(discharge.rows.map((v) => v.at.toISOString())).toEqual([at(19)]);
  });

  it('is refused for a participant without a time zone', async () => {
    await db.query('update participants set time_zone = null where id = $1', [trader]);
    await expect(dispatch(db, { perimeter: { kind: 'participant', id: trader }, from: FROM, to: TO })).rejects.toThrow(/time_zone_required/);
    await db.query(`update participants set time_zone = 'Europe/Brussels' where id = $1`, [trader]);
  });
});

describe('size()', () => {
  let roof: string;
  beforeAll(async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Roof', country: 'BE' });
    roof = await place(project, 'Roof without battery');
    await series('participant', roof, 'production_energy', SUN);
    await series('participant', roof, 'consumption_energy', EVENING);
  });

  it('sweeps capacities up to what one cycle a day moves, and recommends the smallest past which the rate gains under 0.1 point', async () => {
    const r = await size(db, { perimeter: { kind: 'participant', id: roof }, from: FROM, to: TO, criterion: 'self_consumption_rate' });
    // min(16 kWh of surplus, 12 kWh of evening load) = 12 kWh, in 40 steps.
    expect(r.curve).toHaveLength(40);
    expect(r.curve.at(-1)!.capacity_kwh).toBe(12);
    // 12 kWh held take 12 / √0.9 = 12.65 kWh of the surplus and serve 12 × √0.9 = 11.38 kWh of the 16 produced.
    expect(r.recommended).toMatchObject({ capacity_kwh: 12 });
    expect(r.recommended!.self_consumption_rate).toBeCloseTo((12 * Math.sqrt(0.9)) / 16, 6);
    const e = await one<{ participant_id: string; criterion: string; inputs: any }>(db, 'select participant_id, criterion, inputs from battery.estimates where id = $1', [r.estimateId]);
    expect([e.participant_id, e.criterion]).toEqual([roof, 'self_consumption_rate']);
    expect(e.inputs.parameters.battery_c_rate).toMatchObject({ value: 0.5, level: 'organisation' });
  });

  it('refuses payback and net present value without their cost, then recommends by them', async () => {
    await expect(size(db, { perimeter: { kind: 'participant', id: roof }, from: FROM, to: TO, criterion: 'net_present_value' }))
      .rejects.toThrow(/parameter_missing: battery_cost/);
    await attribute('organisation', org, 'battery_cost', 450_000);
    await attribute('organisation', org, 'battery_lifetime', 15);
    await attribute('organisation', org, 'discount_rate', 0.05);
    const npv = await size(db, { perimeter: { kind: 'participant', id: roof }, from: FROM, to: TO, criterion: 'net_present_value' });
    // Per kWh of capacity, a day serves √0.9 kWh at 0.3 and keeps 1 / √0.9 kWh from injection at 0.05:
    // 0.2319, 84.70 a year; 15 years at 5 % make 879.17 against 450.
    const perKwhDay = 0.3 * Math.sqrt(0.9) - 0.05 / Math.sqrt(0.9);
    const last = npv.curve.at(-1)!;
    expect(last.savings_per_year).toBeCloseTo(12 * perKwhDay * 365.25, 1);
    expect(npv.recommended!.capacity_kwh).toBe(12);
    const payback = await size(db, { perimeter: { kind: 'participant', id: roof }, from: FROM, to: TO, criterion: 'payback' });
    expect(payback.recommended!.payback_years).toBeCloseTo(450 / (perKwhDay * 365.25), 2);
  });

  it('counts the operating cost of a year when it is said, and says when it is not', async () => {
    const without = await size(db, { perimeter: { kind: 'participant', id: roof }, from: FROM, to: TO, criterion: 'net_present_value' });
    const e0 = await one<{ inputs: any }>(db, 'select inputs from battery.estimates where id = $1', [without.estimateId]);
    expect(e0.inputs.parameters.battery_opex).toBeNull();
    expect(without.curve.every((p) => p.opex_per_year === null)).toBe(true);
    // 10 per kWh of usable capacity and per year, the organisation's figure.
    await attribute('organisation', org, 'battery_opex', 10_000);
    const withOpex = await size(db, { perimeter: { kind: 'participant', id: roof }, from: FROM, to: TO, criterion: 'net_present_value' });
    const before = without.curve.at(-1)!;
    const after = withOpex.curve.at(-1)!;
    expect(after.opex_per_year).toBe(12 * 10);
    expect(after.savings_per_year).toBe(before.savings_per_year);
    // 15 years at 5 %: an annuity factor of 10.3797; the net present value loses 120 a year over it.
    const annuity = Array.from({ length: 15 }, (_, y) => 1.05 ** -(y + 1)).reduce((s, v) => s + v, 0);
    expect(after.net_present_value!).toBeCloseTo(before.net_present_value! - 120 * annuity, 1);
    expect(after.payback_years!).toBeCloseTo(after.capex! / (after.savings_per_year! - 120), 2);
    const e1 = await one<{ inputs: any }>(db, 'select inputs from battery.estimates where id = $1', [withOpex.estimateId]);
    expect(e1.inputs.parameters.battery_opex).toMatchObject({ value: 10_000, level: 'organisation' });
    await db.query(`delete from attributes where object_kind = 'organisation' and object_id = $1 and attribute_type = 'battery_opex'`, [org]);
  });

  it('sizes for the peak under a threshold', async () => {
    const r = await size(db, { perimeter: { kind: 'participant', id: roof }, from: FROM, to: TO, criterion: 'max_power', peakThresholdKw: 2 });
    // One kWh an hour above 2 kW for four hours: 4 kWh to serve, 4 / √0.9 = 4.216 kWh to hold.
    expect(r.recommended).toMatchObject({ capacity_kwh: 4.216, peak_kw: 2 });
    expect(r.curve.at(-2)!.peak_kw).toBeGreaterThan(2);
  });

  it('says when the period is under a year, whose season weighs on what it recommends', async () => {
    // The day of June above: one day scaled to a year.
    const day = await size(db, { perimeter: { kind: 'participant', id: roof }, from: FROM, to: TO, criterion: 'self_consumption_rate' });
    expect(day.warnings).toEqual([expect.stringMatching(/^period_under_a_year: 1 day, scaled to a year of 365\.25/)]);
    const e = await one<{ results: any }>(db, 'select results from battery.estimates where id = $1', [day.estimateId]);
    expect(e.results.warnings).toEqual(day.warnings);
    // The same day every day of a whole year: nothing to say.
    const project = await insert(db, 'projects', { organisation_id: org, name: 'A year', country: 'BE' });
    const year = await place(project, 'A year of days');
    const start = Date.parse('2025-06-01T00:00:00.000Z');
    const hoursOfYear = Array.from({ length: 365 * 24 }, (_, i) => i);
    for (const [quantity, values] of [['production_energy', SUN], ['consumption_energy', EVENING]] as const) {
      await store(db, { object_kind: 'participant', object_id: year, quantity_code: quantity, kind: 'measured', value_kind: 'interval', step: '1 hour' },
        hoursOfYear.map((i) => ({ at: new Date(start + i * 3_600_000).toISOString(), value: values[i % 24] })));
    }
    const whole = await size(db, { perimeter: { kind: 'participant', id: year }, from: '2025-06-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z', criterion: 'self_consumption_rate' });
    expect(whole.warnings).toEqual([]);
  });

  it('refuses a criterion it does not know, in the function and in the table', async () => {
    await expect(size(db, { perimeter: { kind: 'participant', id: roof }, from: FROM, to: TO, criterion: 'beauty' as never })).rejects.toThrow(/sizing_criterion_unknown/);
    await expect(size(db, { perimeter: { kind: 'participant', id: roof }, from: FROM, to: TO, criterion: 'max_power' })).rejects.toThrow(/peak_threshold_required/);
    await expect(db.query(`insert into battery.estimates (participant_id, criterion, provenance, inputs, results) values ($1, 'beauty', 'test', '{}', '{}')`, [roof]))
      .rejects.toThrow(/estimates_criterion_fkey/);
    await expect(db.query(`insert into battery.estimates (device_id, criterion, provenance, inputs, results) values ($1, 'payback', 'test', '{}', '{}')`, [battery]))
      .rejects.toThrow(/estimates_criterion_subject/);
    await expect(db.query(`insert into battery.estimates (device_id, participant_id, provenance, inputs, results) values ($1, $2, 'test', '{}', '{}')`, [battery, roof]))
      .rejects.toThrow(/estimates_one_subject/);
  });

  it('recommends what the reference sizing recommends on its own fixtures', async () => {
    // The reference's day in kWh, on a project's sharing (no grid fees):
    // 200 kWh of surplus an hour from 10:00 to 15:00, 150 of residual from
    // 18:00 to 23:00; a shifted MWh worth 100, storage at 450 per kWh over
    // 25 years, not discounted. The reference sweeps up to min(1200, 900)
    // kWh and finds its net benefit growing to the bound: 900 kWh.
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Reference', kind: 'collective_self_consumption', country: 'BE' });
    await attribute('project', project, 'battery_lifetime', 25);
    await attribute('project', project, 'discount_rate', 0);
    await attribute('project', project, 'injection_price_reference', 0);
    await attribute('project', project, 'energy_price_household', 100);
    await series('project', project, 'injection_energy', hours(Object.fromEntries([10, 11, 12, 13, 14, 15].map((h) => [h, 200]))));
    await series('project', project, 'offtake_energy', hours(Object.fromEntries([18, 19, 20, 21, 22, 23].map((h) => [h, 150]))));
    const r = await size(db, { perimeter: { kind: 'project', id: project }, from: FROM, to: TO, criterion: 'net_present_value', offtakePrice: 'energy_price_household' });
    expect(r.recommended!.capacity_kwh).toBe(900);
    expect(r.curve[0].capacity_kwh).toBe(22.5);
  });
});

describe('row level security', () => {
  it('shows the estimates and batteries of an organisation to its members only', async () => {
    const mine = await asUser(db, USER_A, async () => (await db.query('select id from battery.estimates')).rows.length);
    expect(mine).toBeGreaterThan(0);
    await asUser(db, USER_B, async () => {
      expect((await db.query('select id from battery.estimates')).rows).toHaveLength(0);
      expect((await db.query('select id from battery.devices')).rows).toHaveLength(0);
      expect((await db.query('select code from battery.objectives')).rows).toHaveLength(3);
    });
  });

  it('goes with its subject', async () => {
    const before = (await one<{ n: number }>(db, 'select count(*)::int n from battery.estimates where device_id = $1', [battery])).n;
    expect(before).toBeGreaterThan(0);
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Gone', country: 'BE' });
    const gone = await place(project, 'Gone');
    const b = await newBattery(gone, 'Gone battery', { usable_capacity_kwh: 10 });
    await insert(db, 'battery.estimates', { device_id: b, provenance: 'test', inputs: '{}', results: '{}' });
    await db.query('delete from devices where id = $1', [b]);
    expect((await one<{ n: number }>(db, 'select count(*)::int n from battery.estimates where device_id = $1', [b])).n).toBe(0);
  });

  it('lets a member describe a battery and run its dispatch', async () => {
    await asUser(db, USER_A, async () => {
      await db.query('update battery.devices set round_trip_efficiency = 0.95 where id = $1', [battery]);
      const [r] = await dispatch(db, { perimeter: { kind: 'participant', id: home }, from: FROM, to: TO });
      // Full, 10 kWh serve 10 × √0.95 kWh.
      expect(r.indicators.discharge_kwh).toBeCloseTo(10 * Math.sqrt(0.95), 6);
    });
  });
});

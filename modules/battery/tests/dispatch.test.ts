// The dispatch rule of the `battery` module on days checked by hand, and
// its parity with the rule it was taken from, on that rule's own fixtures.
import { describe, expect, it } from 'vitest';
import { dispatchBattery, dispatchChain, indicators, type Battery, type Flows } from '../src/dispatch.js';

const hours = (values: Record<number, number>, n = 24) => Array.from({ length: n }, (_, h) => values[h] ?? 0);

/** A sunny day: 4 kWh an hour from 10:00 to 14:00, 3 kWh an hour of evening load from 18:00 to 22:00. */
const DAY: Flows = {
  production: hours({ 10: 4, 11: 4, 12: 4, 13: 4 }),
  consumption: hours({ 18: 3, 19: 3, 20: 3, 21: 3 }),
  stepHours: 1,
};
const BATTERY: Battery = { capacityKwh: 10, chargePowerKw: 5, dischargePowerKw: 5, efficiency: 1, minLevel: 0, maxLevel: 1, objective: 'self_consumption' };
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

describe('a battery run for self-consumption, on days checked by hand', () => {
  it('charges from the midday surplus and serves the evening load, starting the day as it ends it', () => {
    const d = dispatchBattery(DAY, BATTERY);
    // From the middle of its band (5 kWh) it ends empty; run again from empty, it ends empty.
    expect(d.converged).toBe(true);
    expect(d.iterations).toBe(2);
    expect(d.startLevelKwh).toBe(0);
    expect(d.charge.slice(10, 14)).toEqual([4, 4, 2, 0]);
    expect(d.injection.slice(10, 14)).toEqual([0, 0, 2, 4]);
    expect(d.discharge.slice(18, 22)).toEqual([3, 3, 3, 1]);
    expect(d.offtake.slice(18, 22)).toEqual([0, 0, 0, 2]);
    expect(d.level[18]).toBe(10);
    const k = indicators(DAY, BATTERY, d);
    expect(k).toMatchObject({
      production_kwh: 16, consumption_kwh: 12, charge_kwh: 10, discharge_kwh: 10, cycles: 1,
      self_consumed_without_kwh: 0, self_consumed_with_kwh: 10,
      self_consumption_rate_without: 0, self_consumption_rate_with: 0.625,
      self_sufficiency_with: 0.833333333, injection_without_kwh: 16, injection_with_kwh: 6, offtake_without_kwh: 12, offtake_with_kwh: 2,
      peak_without_kw: 3, peak_with_kw: 2,
    });
  });

  it('a full battery takes nothing more: the surplus is injected', () => {
    const sunOnly: Flows = { ...DAY, consumption: hours({}) };
    const d = dispatchBattery(sunOnly, BATTERY);
    expect(d.startLevelKwh).toBe(10);
    expect(sum(d.charge)).toBe(0);
    expect(sum(d.injection)).toBe(16);
  });

  it('an empty battery serves nothing: the load is taken from the grid', () => {
    const nightOnly: Flows = { ...DAY, production: hours({}) };
    const d = dispatchBattery(nightOnly, BATTERY);
    expect(d.startLevelKwh).toBe(0);
    expect(sum(d.discharge)).toBe(0);
    expect(sum(d.offtake)).toBe(12);
  });

  it('keeps to its band of state of charge', () => {
    const d = dispatchBattery(DAY, { ...BATTERY, minLevel: 0.2, maxLevel: 0.9 });
    expect(Math.min(...d.level)).toBeCloseTo(2, 12);
    expect(Math.max(...d.level)).toBeCloseTo(9, 12);
    expect(sum(d.discharge)).toBeCloseTo(7, 12);
  });

  it('loses its efficiency on discharge: serving 1 kWh empties it of 1 / efficiency', () => {
    const d = dispatchBattery(DAY, { ...BATTERY, efficiency: 0.9 });
    expect(sum(d.charge)).toBeCloseTo(10, 9);
    // 10 kWh stored serve 9 kWh: 3, 3 and 3, then nothing.
    expect(d.discharge.slice(18, 22).map((v) => +v.toFixed(9))).toEqual([3, 3, 3, 0]);
    expect(indicators(DAY, { ...BATTERY, efficiency: 0.9 }, d).cycles).toBeCloseTo(1, 6);
  });

  it('chains two batteries: the second sees only the surplus and the load the first left', () => {
    const [first, second] = dispatchChain(DAY, [BATTERY, BATTERY]);
    expect(sum(first.discharge)).toBe(10);
    // Left: 6 kWh of surplus, 2 kWh of evening load. The second settles at 8 kWh, takes 2 and serves 2.
    expect(second.startLevelKwh).toBe(8);
    expect(sum(second.charge)).toBe(2);
    expect(sum(second.discharge)).toBe(2);
    expect(sum(second.offtake)).toBe(0);
    expect(sum(second.injection)).toBe(4);
  });

  it('refuses by name what it cannot run', () => {
    expect(() => dispatchBattery({ ...DAY, production: [] }, BATTERY)).toThrow(/period_empty/);
    expect(() => dispatchBattery({ ...DAY, consumption: [1] }, BATTERY)).toThrow(/series_misaligned/);
    expect(() => dispatchBattery({ ...DAY, production: hours({ 3: -1 }) }, BATTERY)).toThrow(/series_invalid/);
    expect(() => dispatchBattery(DAY, { ...BATTERY, capacityKwh: 0 })).toThrow(/capacity_required/);
    expect(() => dispatchBattery(DAY, { ...BATTERY, efficiency: 1.2 })).toThrow(/efficiency_invalid/);
    expect(() => dispatchBattery(DAY, { ...BATTERY, minLevel: 0.6, maxLevel: 0.5 })).toThrow(/charge_levels_invalid/);
    expect(() => dispatchBattery(DAY, { ...BATTERY, objective: 'peak_shaving' })).toThrow(/peak_threshold_required/);
    expect(() => dispatchBattery(DAY, { ...BATTERY, objective: 'arbitrage' })).toThrow(/prices_required/);
    expect(() => dispatchBattery(DAY, { ...BATTERY, objective: 'spot' as never })).toThrow(/objective_unknown/);
  });
});

describe('a battery run for peak shaving', () => {
  it('serves what the load takes above the threshold, and charges from the grid under it', () => {
    const load: Flows = { production: [0, 0, 0, 0], consumption: [2, 2, 8, 2], stepHours: 1 };
    const d = dispatchBattery(load, { ...BATTERY, objective: 'peak_shaving', peakThresholdKw: 5 });
    expect(d.converged).toBe(true);
    expect(d.discharge).toEqual([0, 0, 3, 0]);
    expect(d.chargeFromGrid).toEqual([0, 0, 0, 3]);
    expect(d.offtake).toEqual([2, 2, 5, 5]);
    const k = indicators(load, { ...BATTERY, objective: 'peak_shaving', peakThresholdKw: 5 }, d);
    expect([k.peak_without_kw, k.peak_with_kw]).toEqual([8, 5]);
    // Energy charged from the grid is not self-consumed.
    expect(k.self_consumed_with_kwh).toBe(0);
  });

  it('reads the threshold as a power: at a quarter-hour step it holds a quarter of the energy', () => {
    const load: Flows = { production: [0, 0], consumption: [0.5, 1.5], stepHours: 0.25 };
    const d = dispatchBattery(load, { ...BATTERY, objective: 'peak_shaving', peakThresholdKw: 4 });
    expect(d.offtake[1]).toBeCloseTo(1, 12);
  });
});

describe('a battery run for arbitrage', () => {
  it('charges in the cheapest interval of the day and serves the load in the dearest', () => {
    const flows: Flows = { production: [0, 0, 0, 0], consumption: [5, 5, 5, 5], stepHours: 1, prices: [0.1, 0.5, 0.2, 1], days: [1, 1, 1, 1] };
    const battery: Battery = { ...BATTERY, capacityKwh: 5, efficiency: 0.9, objective: 'arbitrage' };
    const d = dispatchBattery(flows, battery);
    expect(d.chargeFromGrid).toEqual([5, 0, 0, 0]);
    expect(d.discharge.map((v) => +v.toFixed(9))).toEqual([0, 0, 0, 4.5]);
    expect(d.offtake.map((v) => +v.toFixed(9))).toEqual([10, 5, 5, 0.5]);
  });

  it('does nothing when the spread does not pay its losses', () => {
    const flows: Flows = { production: [0, 0], consumption: [5, 5], stepHours: 1, prices: [1, 1.05], days: ['d', 'd'] };
    const d = dispatchBattery(flows, { ...BATTERY, capacityKwh: 5, efficiency: 0.9, objective: 'arbitrage' });
    expect(sum(d.discharge)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Parity with the rule this one was taken from, written here line for line
// as it was published, in MWh and on a typical day of 24 hours.
// ---------------------------------------------------------------------------

function referenceDay(production24: number[], consumption24: number[], p: { capacityMwh: number; chargeMw: number; dischargeMw: number; efficiency: number }) {
  let initialLevel = p.capacityMwh * 0.5;
  let result = { aci: 0, injection: [] as number[], offtake: [] as number[], charge: 0, discharge: 0 };
  for (let iteration = 0; iteration < 20; iteration++) {
    let level = initialLevel;
    result = { aci: 0, injection: [], offtake: [], charge: 0, discharge: 0 };
    for (let i = 0; i < 24; i++) {
      const prod = production24[i];
      const conso = consumption24[i];
      const net = prod - conso;
      let hCharge = 0;
      let hDischarge = 0;
      if (net > 0) hCharge = Math.min(net, p.chargeMw, p.capacityMwh - level);
      else hDischarge = Math.min(-net, p.dischargeMw, level) * p.efficiency;
      level = level + hCharge - hDischarge;
      result.aci += Math.min(prod, conso) + Math.min(hDischarge, Math.max(conso - prod, 0));
      result.injection.push(Math.max(prod - conso - hCharge, 0));
      result.offtake.push(Math.max(conso - prod - hDischarge, 0));
      result.charge += hCharge;
      result.discharge += hDischarge;
    }
    if (Math.abs(level - initialLevel) < 0.0001) break;
    initialLevel = level;
  }
  return result;
}

/** The reference's fixtures: 0.2 MWh of surplus an hour from 10:00 to 15:00, 0.15 MWh of load an hour from 18:00 to 23:00. */
const PROD_24 = Array.from({ length: 24 }, (_, h) => (h >= 10 && h <= 15 ? 0.2 : 0));
const CONSO_24 = Array.from({ length: 24 }, (_, h) => (h >= 18 && h <= 23 ? 0.15 : 0));
const KWH = (mwh: number[]) => mwh.map((v) => v * 1000);
const FIXTURE: Flows = { production: KWH(PROD_24), consumption: KWH(CONSO_24), stepHours: 1 };
/** The reference's battery: 400 kWh, its power half its capacity. */
const battery = (capacityKwh: number, efficiency: number): Battery =>
  ({ capacityKwh, chargePowerKw: capacityKwh * 0.5, dischargePowerKw: capacityKwh * 0.5, efficiency, minLevel: 0, maxLevel: 1, objective: 'self_consumption' });
const reference = (capacityKwh: number, efficiency: number) =>
  referenceDay(PROD_24, CONSO_24, { capacityMwh: capacityKwh / 1000, chargeMw: capacityKwh / 2000, dischargeMw: capacityKwh / 2000, efficiency });

describe('parity with the reference rule, on its own fixtures', () => {
  it('without losses, serves what it serves to 1e-9 kWh, hour by hour: 400 kWh a day for a 400 kWh battery', () => {
    for (const capacity of [100, 200, 400, 800]) {
      const ours = dispatchBattery(FIXTURE, battery(capacity, 1));
      const ref = reference(capacity, 1);
      expect(sum(ours.discharge)).toBeCloseTo(ref.discharge * 1000, 9);
      ours.injection.forEach((v, i) => expect(v).toBeCloseTo(ref.injection[i] * 1000, 9));
      ours.offtake.forEach((v, i) => expect(v).toBeCloseTo(ref.offtake[i] * 1000, 9));
    }
    expect(sum(dispatchBattery(FIXTURE, battery(400, 1)).discharge)).toBeCloseTo(400, 9);
  });

  it('with losses, serves efficiency times what the reference serves when the battery empties every day, within 0.1 kWh', () => {
    // The reference takes the loss off what it serves, not off what it holds;
    // it stops iterating within 1e-4 MWh, 0.1 kWh, which bounds the difference.
    // Up to 400 kWh the evening load of 900 kWh empties both; an 800 kWh
    // battery is emptied here and not by the reference, which serves 0.9 of
    // each hour's load and keeps the rest.
    for (const capacity of [100, 200, 400]) {
      const ours = sum(dispatchBattery(FIXTURE, battery(capacity, 0.9)).discharge);
      const ref = reference(capacity, 0.9).discharge * 1000;
      expect(Math.abs(ours - ref * 0.9)).toBeLessThan(0.1);
    }
  });

  it('chains as the reference chains: decreasing returns, never more than the daily deficit', () => {
    const [a, b, c] = dispatchChain(FIXTURE, [battery(400, 1), battery(400, 1), battery(400, 1)]);
    const first = reference(400, 1);
    const second = referenceDay(first.injection, first.offtake, { capacityMwh: 0.4, chargeMw: 0.2, dischargeMw: 0.2, efficiency: 1 });
    expect(sum(a.discharge)).toBeCloseTo(first.discharge * 1000, 9);
    expect(sum(b.discharge)).toBeCloseTo(second.discharge * 1000, 9);
    expect(sum(a.discharge) + sum(b.discharge) + sum(c.discharge)).toBeLessThanOrEqual(900 + 1e-6);
    expect(sum(c.discharge)).toBeLessThan(sum(a.discharge));
  });

  it('a bigger battery serves at least as much', () => {
    expect(sum(dispatchBattery(FIXTURE, battery(800, 0.9)).discharge)).toBeGreaterThanOrEqual(sum(dispatchBattery(FIXTURE, battery(200, 0.9)).discharge));
  });
});

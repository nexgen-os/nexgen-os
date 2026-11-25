// The consumption of a participant is computed along one path
// (decision 0065, a value is written once): `participant_curve()` of the
// core. The consumption curve (`consumption.curve()`), the indicators
// (`kpis.series_of()`) and the battery dispatch all read it, so a simulated
// device — a planned heat pump — enters the one aggregate they all read, and
// a measured participant reads the same with or without it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { store } from '@nexgen-os/core';
import { USER_A, freshDatabase, insert, one, organisation } from './helpers/db.js';
import { dispatch } from '../modules/battery/src/estimates.js';

const FROM = '2026-06-01T00:00:00.000Z';
const TO = '2026-06-02T00:00:00.000Z';
const at = (h: number) => new Date(Date.parse(FROM) + h * 3_600_000).toISOString();
const day = (value: (h: number) => number) => Array.from({ length: 24 }, (_, h) => ({ at: at(h), value: value(h) }));
/** 3 kWh an hour of evening load from 18:00 to 22:00 UTC: 12 kWh over the day. */
const EVENING = day((h) => (h >= 18 && h < 22 ? 3 : 0));
const SUN = day((h) => (h >= 10 && h < 14 ? 4 : 0));

let db: PGlite;
let org: string;
let project: string;

async function place(name: string): Promise<string> {
  const id = await insert(db, 'participants', { organisation_id: org, project_id: project, name, country: 'BE', time_zone: 'Europe/Brussels', segment: 'individual' });
  await store(db, { object_kind: 'participant', object_id: id, quantity_code: 'production_energy', kind: 'measured', value_kind: 'interval', step: '1 hour' }, SUN);
  const battery = (await one<{ id: string }>(db, `select install_device($1, 'battery', 'Home battery', null, 5, '2026-01-01') id`, [id])).id;
  await insert(db, 'battery.devices', { id: battery, usable_capacity_kwh: 10, round_trip_efficiency: 1 });
  return id;
}

async function device(participant: string, type: string, name: string, status: 'planned' | 'in_service'): Promise<string> {
  return (await one<{ id: string }>(db, `select install_device($1, $2, $3, null, null, null, null, 1, '{}', $4) id`, [participant, type, name, status])).id;
}

async function consumption(objectKind: string, objectId: string, kind: 'measured' | 'simulated', values: { at: string; value: number }[], source?: string): Promise<string> {
  return (await store(db, { object_kind: objectKind, object_id: objectId, quantity_code: 'consumption_energy', kind, value_kind: 'interval', step: '1 hour', ...(source ? { source } : {}) }, values)).seriesId;
}

/** What every reader of the model reads of a participant's consumption over the day. */
async function readers(participant: string) {
  const core = (await db.query<{ value: number; series: Record<string, string> }>(
    `select value, series from participant_curve($1, 'consumption_energy', $2, $3, '1 hour')`, [participant, FROM, TO])).rows;
  const curve = (await db.query<{ value: number; series: Record<string, string> }>(
    `select value, series from consumption.curve($1, $2, $3, '1 hour')`, [participant, FROM, TO])).rows;
  const kind = Object.values(core[0]?.series ?? {})[0] ?? 'measured';
  const indicators = (await db.query<{ s: string }>(
    `select s from kpis.series_of('participant', $1, 'consumption_energy', $2, $3, $4) s order by s`, [participant, kind, FROM, TO])).rows.map((r) => r.s);
  const [battery] = await dispatch(db, { perimeter: { kind: 'participant', id: participant }, from: FROM, to: TO });
  const inputs = (await one<{ inputs: any }>(db, 'select inputs from battery.estimates where id = $1', [battery.estimateId])).inputs;
  return {
    values: core.map((r) => r.value),
    kwh: core.reduce((s, r) => s + r.value, 0),
    series: core[0]?.series ?? {},
    curve: { values: curve.map((r) => r.value), series: curve[0]?.series ?? {} },
    indicators,
    battery: { kwh: battery.indicators.consumption_kwh, series: inputs.series.consumption },
  };
}

/** Every reader reads the one aggregate of the core. */
function onePath(r: Awaited<ReturnType<typeof readers>>): void {
  expect(r.curve).toEqual({ values: r.values, series: r.series });
  expect(r.indicators).toEqual(Object.keys(r.series).sort());
  expect(r.battery).toEqual({ kwh: r.kwh, series: r.series });
}

beforeAll(async () => {
  db = await freshDatabase(['grid', 'actions', 'consumption', 'kpis', 'battery'], ['be']);
  await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [USER_A]);
  org = await organisation(db, 'A study office', USER_A);
  for (const [property, value] of [['energy_price_household', 200], ['grid_fees_and_taxes', 100], ['injection_price_reference', 50]] as const) {
    await db.query(`select set_attribute('organisation', $1, $2, $3::jsonb, null, null, 'assumptions of the study')`, [org, property, JSON.stringify(value)]);
  }
  project = await insert(db, 'projects', { organisation_id: org, name: 'Homes', kind: 'individual_self_consumption', country: 'BE' });
});

afterAll(async () => {
  await db.close();
});

describe('the consumption of a participant, along one path', () => {
  it('is the same with a simulated device as without when it is measured', async () => {
    const home = await place('Measured home');
    const meter = (await one<{ id: string }>(db, `select declare_meter($1, '541448000000000001', 'gs1_gsrn') id`, [home])).id;
    const measured = await consumption('meter', meter, 'measured', EVENING);
    const without = await readers(home);
    expect(without.kwh).toBe(12);
    expect(without.series).toEqual({ [measured]: 'measured' });
    onePath(without);

    // A planned heat pump and an electric vehicle charger, each simulated,
    // and the charger's own sub-meter: none of them is the participant's
    // measured consumption, which reads the same, by every reader.
    const heatPump = await device(home, 'heat_pump', 'Planned heat pump', 'planned');
    const charger = await device(home, 'charger', 'Charger', 'in_service');
    await consumption('device', heatPump, 'simulated', day(() => 2), 'heat pump sizing');
    await consumption('device', charger, 'simulated', day(() => 1), 'charging sessions model');
    await consumption('device', charger, 'measured', day(() => 1));
    const withDevices = await readers(home);
    expect(withDevices).toEqual(without);
  });

  it('adds a planned device\'s simulation to the estimate in the one aggregate every reader reads', async () => {
    const home = await place('Estimated home');
    const estimate = await consumption('participant', home, 'simulated', EVENING, 'an annual estimate');
    const without = await readers(home);
    expect(without.kwh).toBe(12);
    expect(without.series).toEqual({ [estimate]: 'simulated' });
    onePath(without);

    // A planned heat pump whose simulation is zero: the same figures, to the
    // kWh, and the device is named among the series read.
    const heatPump = await device(home, 'heat_pump', 'Planned heat pump', 'planned');
    const zero = await consumption('device', heatPump, 'simulated', day(() => 0), 'heat pump sizing, first run');
    const withZero = await readers(home);
    expect(withZero.values).toEqual(without.values);
    expect(withZero.series).toEqual({ [estimate]: 'simulated', [zero]: 'simulated' });
    onePath(withZero);

    // Its next simulation replaces the first and adds 2 kWh an hour, for
    // every reader alike.
    const sized = await consumption('device', heatPump, 'simulated', day(() => 2), 'heat pump sizing, second run');
    const withHeatPump = await readers(home);
    expect(withHeatPump.kwh).toBe(12 + 48);
    expect(withHeatPump.values).toEqual(without.values.map((v) => v + 2));
    expect(withHeatPump.series).toEqual({ [estimate]: 'simulated', [sized]: 'simulated' });
    onePath(withHeatPump);

    // A device in service is in what the estimate describes already: its
    // simulation is its own, never added a second time.
    const boiler = await device(home, 'boiler', 'Electric boiler', 'in_service');
    await consumption('device', boiler, 'simulated', day(() => 5), 'boiler model');
    expect(await readers(home)).toEqual(withHeatPump);
  });

  it('is read nowhere else: a participant with nothing of its own or of its meters has no consumption', async () => {
    const home = await place('Sub-metered home');
    const heatPump = await device(home, 'heat_pump', 'Heat pump', 'in_service');
    await consumption('device', heatPump, 'measured', EVENING);
    expect((await db.query(`select * from participant_curve($1, 'consumption_energy', $2, $3, '1 hour')`, [home, FROM, TO])).rows).toEqual([]);
    // The battery reads the same path: no consumption, refused by name.
    await expect(dispatch(db, { perimeter: { kind: 'participant', id: home }, from: FROM, to: TO })).rejects.toThrow(/^series_not_found/);
  });
});

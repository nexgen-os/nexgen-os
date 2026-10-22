// The `charging` module on a database: two chargers that speak OCPP 1.6J
// and 2.0.1 whose recorded logs become sessions and series of the device,
// once; a charging profile asked as a command, accepted then refused; the
// charge points of a small car park sized by a named criterion; and what
// each gesture refuses, by name.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { LogEntry } from '@nexgen-os/ocpp';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from '../../../tests/helpers/db.js';
import { importStationLog } from '../src/import.js';
import { simulate, size } from '../src/size.js';

const log = (version: string) =>
  JSON.parse(readFileSync(new URL(`../../../packages/formats/ocpp/tests/fixtures/station-${version}.json`, import.meta.url), 'utf8')) as LogEntry[];

let db: PGlite;
let org: string;
let project: string;
let carPark: string;
let meter: string;
let ac: string;
let dc: string;

async function charger(name: string, fields: Record<string, unknown>): Promise<string> {
  const id = (await one<{ id: string }>(db, `select install_device($1, 'charger', $2, null, 22, '2026-01-01') id`, [carPark, name])).id;
  await insert(db, 'charging.devices', { id, ...fields });
  return id;
}

const refusal = async (sql: string, params: unknown[]) => {
  try {
    await db.query(sql, params);
  } catch (e) {
    return (e as Error).message.split(':')[0];
  }
  return 'accepted';
};

beforeAll(async () => {
  db = await freshDatabase(['actions', 'charging']);
  org = await organisation(db, 'A car park operator', USER_A);
  await organisation(db, 'Another company', USER_B);
  await db.query(`insert into currencies (code, name) values ('ZZZ', 'Testland currency') on conflict do nothing`);
  await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by)
                  values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz')`);
  await db.query(`insert into identifier_schemes (code, name, pattern) values ('zz_ean', 'Testland connection point', '^[0-9]+$')`);
  project = await insert(db, 'projects', { organisation_id: org, name: 'An office car park', kind: 'individual_self_consumption', country: 'ZZ' });
  carPark = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'The car park', country: 'ZZ', time_zone: 'UTC', segment: 'individual' });
  meter = await insert(db, 'meters', { organisation_id: org, participant_id: carPark, identifier: '2001', scheme: 'zz_ean' });
  await db.query(`select set_attribute('meter', $1, 'subscribed_power', '40'::jsonb, null, null, 'the connection contract')`, [meter]);
  ac = await charger('AC wallbox', { charge_point_id: 'CP-AC-1', ocpp_version: '1.6', meter_id: meter, max_power_kw: 22 });
  dc = await charger('DC charger', { charge_point_id: 'CP-DC-1', ocpp_version: '2.0.1', meter_id: meter });
  await insert(db, 'charging.connectors', { device_id: ac, evse_id: 1, connector_id: 1, standard: 'iec_62196_type_2_socket', current_type: 'ac', phases: 3, max_power_kw: 22, max_current_a: 32 });
  await insert(db, 'charging.connectors', { device_id: dc, evse_id: 1, connector_id: 1, standard: 'ccs2', current_type: 'dc', max_power_kw: 50 });
});

afterAll(async () => {
  await db.close();
});

describe('a charger and its connectors', () => {
  it('enriches a device of type charger, in its organisation, behind a meter of its participant', async () => {
    const row = await one<Record<string, unknown>>(db, 'select d.device_type, c.organisation_id, c.meter_id from devices d join charging.devices c using (id) where id = $1', [ac]);
    expect(row).toEqual({ device_type: 'charger', organisation_id: org, meter_id: meter });
    const battery = (await one<{ id: string }>(db, `select install_device($1, 'battery', 'Not a charger') id`, [carPark])).id;
    expect(await refusal('insert into charging.devices (id) values ($1)', [battery])).toBe('device_type_mismatch');
    expect(await refusal(`insert into charging.connectors (device_id, evse_id, standard, current_type, phases) values ($1, 2, 'ccs2', 'dc', 3)`, [dc]))
      .toMatch(/connectors_phases/);
  });
});

describe('sessions from the logs of two stations', () => {
  it('records a 1.6 session and its readings as series of the device, once', async () => {
    const first = await importStationLog(db, ac, log('1.6'), '1.6', { sourceRef: 'CP-AC-1' });
    expect(first.sessions).toHaveLength(1);
    const s = await one<Record<string, unknown>>(db, 'select transaction_id, evse_id, started_at, ended_at, energy_kwh, peak_power_kw, id_token, stop_reason, source from charging.sessions where id = $1', [first.sessions[0]]);
    expect(s).toMatchObject({ transaction_id: '4711', evse_id: 1, energy_kwh: 12.5, peak_power_kw: 11.04, id_token: 'TAG-EXAMPLE-01', stop_reason: 'EVDisconnected', source: 'station' });
    expect(new Date(s.started_at as string).toISOString()).toBe('2026-06-01T08:00:00.000Z');
    // The power in W and kW lands in kW, the register in Wh in kWh.
    const power = first.series.find((x) => x.quantity === 'consumption_power')!;
    const values = (await db.query<{ value: number }>('select value from series_values where series_id = $1 order by at', [power.seriesId])).rows.map((r) => r.value);
    expect(values).toEqual([11.04, 7.36]);
    const energy = first.series.find((x) => x.quantity === 'consumption_energy')!;
    const kwh = (await db.query<{ value: number }>('select value from series_values where series_id = $1 order by at', [energy.seriesId])).rows.map((r) => r.value);
    expect(kwh).toEqual([1252.75, 1255.5, 1262.5]);
    expect(first.skipped).toBe(2);
    // Twice is once.
    const again = await importStationLog(db, ac, log('1.6'), '1.6', { sourceRef: 'CP-AC-1' });
    expect(again.sessions).toEqual(first.sessions);
    expect((await one<{ n: number }>(db, 'select count(*)::int n from charging.sessions where device_id = $1', [ac])).n).toBe(1);
    expect((await one<{ m: Record<string, unknown> }>(db, 'select metadata->\'boot\' m from charging.devices where id = $1', [ac])).m).toMatchObject({ vendor: 'ExampleVendor', model: 'AC22-2' });
  });

  it('records a 2.0.1 session folded from its transaction events, and completes it from a later message', async () => {
    const r = await importStationLog(db, dc, log('2.0.1'), '2.0.1');
    const s = await one<Record<string, unknown>>(db, 'select transaction_id, energy_kwh, peak_power_kw, id_token_type, vehicle from charging.sessions where id = $1', [r.sessions[0]]);
    expect(s).toEqual({ transaction_id: 'tx-2026-06-02-a', energy_kwh: 28.25, peak_power_kw: 48.2, id_token_type: 'ISO14443', vehicle: null });
    await db.query(`select charging.record($1, '{"transaction_id": "tx-2026-06-02-a", "vehicle": "a vehicle the operator knows"}'::jsonb)`, [dc]);
    expect((await one<{ vehicle: string; energy_kwh: number }>(db, 'select vehicle, energy_kwh from charging.sessions where id = $1', [r.sessions[0]])))
      .toEqual({ vehicle: 'a vehicle the operator knows', energy_kwh: 28.25 });
    const soc = r.series.find((x) => x.quantity === 'charge_level');
    expect(soc?.values).toBe(1);
  });

  it('keeps the same transaction id from another source apart', async () => {
    await db.query(`select charging.record($1, '{"transaction_id": "4711", "started_at": "2026-06-01T08:00:00Z", "energy_kwh": 12.4}'::jsonb, 'file', 'export.csv')`, [ac]);
    expect((await one<{ n: number }>(db, 'select count(*)::int n from charging.sessions where device_id = $1', [ac])).n).toBe(2);
  });

  it('refuses by name', async () => {
    expect(await refusal(`select charging.record($1, '{"transaction_id": "1"}'::jsonb)`, [carPark])).toBe('charger_not_described');
    expect(await refusal(`select charging.record($1, '{"started_at": "2026-06-01T08:00:00Z"}'::jsonb)`, [ac])).toBe('transaction_id_required');
    expect(await refusal(`select charging.record($1, '{"transaction_id": "new"}'::jsonb)`, [ac])).toBe('session_start_required');
    expect(await refusal(`select charging.record($1, '{"transaction_id": "x", "started_at": "2026-06-01T08:00:00Z", "evse_id": 9}'::jsonb)`, [ac])).toBe('connector_unknown');
  });

  it('is read by its organisation only', async () => {
    expect(await asUser(db, USER_A, async () => (await db.query('select id from charging.sessions')).rows.length)).toBe(3);
    expect(await asUser(db, USER_B, async () => (await db.query('select id from charging.sessions')).rows.length)).toBe(0);
  });
});

describe('a charging profile is a command', () => {
  const schedule = {
    evse_id: 1, purpose: 'tx_default', stack_level: 1, kind: 'absolute', rate_unit: 'W',
    starts_at: '2026-06-03T17:00:00Z', periods: [{ start_s: 0, limit: 11000 }, { start_s: 3600, limit: 7400 }, { start_s: 7200, limit: 22000 }],
  };

  it('is asked as a command action on a setpoint series of the charger', async () => {
    const action = (await one<{ id: string }>(db, `select charging.limit($1, $2::jsonb, 'agent', 'a smart charging rule') id`, [ac, JSON.stringify(schedule)])).id;
    const a = await one<Record<string, unknown>>(db, 'select object_kind, object_id, kind, status, value, source from actions.actions where id = $1', [action]);
    expect(a).toEqual({ object_kind: 'device', object_id: ac, kind: 'command', status: 'proposed', value: 11, source: 'agent' });
    const series = await one<Record<string, unknown>>(db, 'select s.kind, s.quantity_code, s.name from charging.profiles p join series s on s.id = p.series_id where p.action_id = $1', [action]);
    expect(series).toEqual({ kind: 'setpoint', quantity_code: 'power', name: 'charging limit, EVSE 1' });
  });

  it('acknowledged, is done and its schedule is the effect in the setpoint series', async () => {
    const action = (await one<{ id: string }>(db, 'select charging.limit($1, $2::jsonb) id', [ac, JSON.stringify(schedule)])).id;
    await db.query(`select actions.move($1, 'validated')`, [action]);
    // The station answers while the second period is running.
    await db.query(`select charging.report($1, '2026-06-03T18:10:00Z')`, [action]);
    expect(await one(db, 'select status, acknowledged_at is not null ack from actions.actions where id = $1', [action])).toEqual({ status: 'done', ack: true });
    const values = (await db.query<{ at: Date; value: number }>(
      'select v.at, v.value from series_values v join charging.profiles p on p.series_id = v.series_id where p.action_id = $1 order by v.at', [action])).rows;
    expect(values.map((v) => [v.at.toISOString(), v.value])).toEqual([['2026-06-03T18:10:00.000Z', 7.4], ['2026-06-03T19:00:00.000Z', 22]]);
  });

  it('refused or unanswered, failed and says why', async () => {
    const amps = { ...schedule, rate_unit: 'A', periods: [{ start_s: 0, limit: 16, phases: 3 }] };
    const refused = (await one<{ id: string }>(db, 'select charging.limit($1, $2::jsonb) id', [ac, JSON.stringify(amps)])).id;
    await db.query(`select actions.move($1, 'validated')`, [refused]);
    await db.query(`select charging.report($1, '2026-06-03T16:59:00Z', 'rejected')`, [refused]);
    expect(await one(db, 'select status, failure from actions.actions where id = $1', [refused])).toEqual({ status: 'failed', failure: 'rejected' });
    expect((await one<{ q: string }>(db, 'select s.quantity_code q from charging.profiles p join series s on s.id = p.series_id where p.action_id = $1', [refused])).q).toBe('current');
    const silent = (await one<{ id: string }>(db, 'select charging.limit($1, $2::jsonb) id', [dc, JSON.stringify({ ...schedule, evse_id: 0 })])).id;
    await db.query(`select actions.move($1, 'validated')`, [silent]);
    await db.query(`select charging.report($1, '2026-06-03T17:01:00Z', 'timeout: the station did not answer')`, [silent]);
    expect((await one<{ status: string }>(db, 'select status from actions.actions where id = $1', [silent])).status).toBe('failed');
    expect((await one<{ n: number }>(db, 'select count(*)::int n from series_values v join charging.profiles p on p.series_id = v.series_id where p.action_id = $1', [silent])).n).toBe(0);
  });

  it('refuses by name', async () => {
    const limit = (device: string, s: unknown) => refusal('select charging.limit($1, $2::jsonb)', [device, JSON.stringify(s)]);
    expect(await limit(carPark, schedule)).toBe('charger_not_described');
    expect(await limit(ac, { ...schedule, periods: [] })).toBe('schedule_periods_required');
    expect(await limit(ac, { ...schedule, periods: [{ start_s: 60, limit: 1000 }] })).toBe('schedule_periods_invalid');
    expect(await limit(ac, { ...schedule, periods: [{ start_s: 0, limit: 1000 }, { start_s: 0, limit: 500 }] })).toBe('schedule_periods_invalid');
    expect(await limit(ac, { ...schedule, rate_unit: 'kW' })).toBe('rate_unit_invalid');
    expect(await limit(ac, { ...schedule, evse_id: 3 })).toBe('connector_unknown');
    expect(await refusal(`select charging.report(gen_random_uuid(), now())`, [])).toBe('profile_not_found');
    const proposed = (await one<{ id: string }>(db, 'select charging.limit($1, $2::jsonb) id', [ac, JSON.stringify(schedule)])).id;
    expect(await refusal(`select charging.report($1, now())`, [proposed])).toBe('action_status_invalid');
  });
});

describe('the charge points of a small car park', () => {
  // Six cars of the office from 08:00 to 17:00 asking for 20 kWh, two
  // visitors from 10:00 to 12:00 asking for 10 kWh, one car overnight.
  const vehicles = [
    { arrival: '08:00', departure: '17:00', energyKwh: 20, count: 6 },
    { arrival: '10:00', departure: '12:00', energyKwh: 10, count: 2 },
    { arrival: '19:00', departure: '07:00', energyKwh: 30 },
  ];

  it('runs a candidate over a day, a vehicle staying overnight counted once', () => {
    expect(simulate([{ arrival: '22:00', departure: '06:00', energyKwh: 30 }], 1, 7.4, 40)).toEqual({ demand_served: 1, vehicles_refused: 0, peak_kw: 7.4 });
    // One point for two cars at once: the second is refused.
    expect(simulate([{ arrival: '08:00', departure: '12:00', energyKwh: 10, count: 2 }], 1, 11, 40)).toMatchObject({ demand_served: 0.5, vehicles_refused: 1 });
  });

  it('recommends the smallest installation that serves the demand asked, within the subscribed power of its meter', async () => {
    const r = await size(db, { subject: { kind: 'participant', id: carPark }, criterion: 'demand_served', target: 1, vehicles, bounds: { powersKw: [3.7, 7.4, 11], maxPoints: 9 } });
    expect(r.recommended).toMatchObject({ demand_served: 1, vehicles_refused: 0 });
    expect(r.recommended!.points).toBe(8);
    expect(r.recommended!.peak_kw).toBeLessThanOrEqual(40);
    const row = await one<Record<string, any>>(db, 'select criterion, provenance, inputs from charging.estimates where id = $1', [r.estimateId]);
    expect(row.provenance).toBe('charging-size-0.3.0');
    expect(row.inputs.connection_kw).toBe(40);
    expect(row.inputs.connection_from).toEqual([{ meter_id: meter, attribute: 'subscribed_power', value: 40 }]);
  });

  it('recommends the largest installed power the connection allows for max_power', async () => {
    const r = await size(db, { subject: { kind: 'project', id: project }, criterion: 'max_power', vehicles, bounds: { powersKw: [7.4, 11, 22], maxPoints: 6, baseLoadKw: 5 } });
    expect(r.recommended).toMatchObject({ points: 3, power_kw: 11, installed_kw: 33 });
    expect(r.curve.every((p) => p.peak_kw <= 35 + 1e-9)).toBe(true);
  });

  it('refuses by name', async () => {
    const base = { subject: { kind: 'participant' as const, id: carPark }, vehicles, bounds: { powersKw: [7.4] } };
    const err = (p: Promise<unknown>) => p.then(() => 'accepted', (e: Error) => e.message.split(':')[0]);
    expect(await err(size(db, { ...base, criterion: 'payback' as never }))).toBe('criterion_unsupported');
    expect(await err(size(db, { ...base, criterion: 'nothing' as never }))).toBe('sizing_criterion_unknown');
    expect(await err(size(db, { ...base, criterion: 'demand_served' }))).toBe('target_required');
    expect(await err(size(db, { ...base, criterion: 'max_power', vehicles: [] }))).toBe('vehicles_required');
    expect(await err(size(db, { ...base, criterion: 'max_power', bounds: { powersKw: [] } }))).toBe('bounds_required');
    expect(await err(size(db, { ...base, criterion: 'max_power', vehicles: [{ arrival: '25:00', departure: '08:00', energyKwh: 1 }] }))).toBe('vehicles_invalid');
    expect(await err(size(db, { ...base, criterion: 'max_power', bounds: { powersKw: [7.4], baseLoadKw: 40 } }))).toBe('connection_exhausted');
    const empty = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'No meter', country: 'ZZ', time_zone: 'UTC', segment: 'individual' });
    expect(await err(size(db, { ...base, subject: { kind: 'participant', id: empty }, criterion: 'max_power' }))).toBe('connection_power_required');
  });
});

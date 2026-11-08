// A device connector reads series of a device and carries out the commands
// asked of it (decision 0061): a heat pump reached through its maker's
// platform, known there by a serial in a scheme, its power read into a
// measured series of the device, and the setpoints a person validated sent
// to it, the answer reported through actions.report().
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  carryCommands, collectDeviceReadings, registerSource,
  type CommandCarrier, type DeviceCommand, type DeviceReadingsProvider,
} from '@nexgen-os/core';
import { USER_A, USER_B, freshDatabase, insert, one, organisation, participant } from './helpers/db.js';

const SOURCE = 'example_heat_pumps';
const SCHEME = 'example_heat_pump_serial';

let db: PGlite;
let org: string;
let other: string;
let pump: string;
let strangersPump: string;
let connector: string;
let setpoint: string;

/** A platform that knows one heat pump and answers its power in watts, every quarter of an hour. */
const provider = (asked: unknown[] = []): DeviceReadingsProvider => ({
  source_code: SOURCE,
  scheme: SCHEME,
  async readings(device, from, to, options) {
    asked.push({ device, from, to, options });
    return [{
      quantity_code: 'power', value_kind: 'interval', step: '15 minutes', unit: 'W',
      values: [{ at: `${from}T00:00:00Z`, value: 1800 }, { at: `${from}T00:15:00Z`, value: 2400 }],
    }];
  },
});

/** A carrier that answers each command by its value: 0 is refused, a negative value throws, anything else is acknowledged two seconds after its instant. */
const carrier = (sent: DeviceCommand[]): CommandCarrier => ({
  source_code: SOURCE,
  scheme: SCHEME,
  async carry(command) {
    sent.push(command);
    if (command.value < 0) throw new Error('platform unreachable');
    if (command.value === 0) return { failure: 'refused: the pump is in defrost' };
    return { acknowledged_at: new Date(Date.parse(command.due_at) + 2000).toISOString() };
  },
});

const command = async (value: number, dueAt: string, fields: { connector?: string | null; validate?: boolean } = {}) => {
  const id = (await one<{ id: string }>(db, `select actions.command($1, $2, $3, null, 'person', null, $4) id`,
    [setpoint, value, dueAt, fields.connector === undefined ? connector : fields.connector])).id;
  if (fields.validate !== false) await db.query(`select actions.move($1, 'validated')`, [id]);
  return id;
};
const statusOf = async (id: string) => one<{ status: string; failure: string | null }>(db, `select status, failure from actions.actions where id = $1`, [id]);

beforeAll(async () => {
  db = await freshDatabase(['actions']);
  org = await organisation(db, 'A cooperative', USER_A);
  other = await organisation(db, 'Another', USER_B);
  const home = await participant(db, { organisation_id: org, name: 'House', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  const away = await participant(db, { organisation_id: other, name: 'Elsewhere', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.4, 50.9] } });
  await registerSource(db, { code: SOURCE, name: 'Example heat pump platform', kind: 'api', auth: 'oauth2', published_by: '@nexgen-os/example-heat-pumps' });
  await db.query(`insert into identifier_schemes (code, name, source_code) values ($1, 'Example heat pump serial', $2)`, [SCHEME, SOURCE]);
  pump = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Heat pump', device_type: 'heat_pump', rated_power_kw: 6 });
  strangersPump = await insert(db, 'devices', { organisation_id: other, participant_id: away, name: 'Their heat pump', device_type: 'heat_pump' });
  await db.query(`insert into identifiers (organisation_id, object_kind, object_id, scheme, value) values ($1, 'device', $2, $3, 'HP-0001')`, [org, pump, SCHEME]);
  connector = await insert(db, 'connectors', { organisation_id: org, source_code: SOURCE, name: 'Heat pumps of the cooperative', secret_ref: 'example_heat_pumps_token' });
  setpoint = await insert(db, 'series', { organisation_id: org, object_kind: 'device', object_id: pump, quantity_code: 'power', kind: 'setpoint', value_kind: 'instant', name: 'Power limit' });
});

afterAll(async () => {
  await db.close();
});

describe('reading a device', () => {
  it('finds the device by its identifier in the platform scheme and keeps what it measured on the device, in the unit of its quantity', async () => {
    const asked: unknown[] = [];
    const { stored } = await collectDeviceReadings(db, provider(asked), { connectorId: connector, deviceId: pump, from: '2026-11-01', to: '2026-11-02', step: 'PT15M' });
    expect(asked).toEqual([{ device: { identifier: 'HP-0001', scheme: SCHEME, device_type: 'heat_pump' }, from: '2026-11-01', to: '2026-11-02', options: { step: 'PT15M' } }]);
    expect(stored).toEqual([{ quantity_code: 'power', seriesId: expect.any(String), inserted: 2 }]);
    const series = await one(db, `select object_kind, object_id, kind, source_code, step::text from series where id = $1`, [stored[0]!.seriesId]);
    expect(series).toEqual({ object_kind: 'device', object_id: pump, kind: 'measured', source_code: SOURCE, step: '00:15:00' });
    const values = await db.query<{ value: number }>(`select value from "window"($1, '2026-11-01', '2026-11-02')`, [stored[0]!.seriesId]);
    expect(values.rows.map((r) => r.value)).toEqual([1.8, 2.4]);

    const again = await collectDeviceReadings(db, provider(), { connectorId: connector, deviceId: pump, from: '2026-11-01', to: '2026-11-02' });
    expect(again.stored[0]).toMatchObject({ seriesId: stored[0]!.seriesId, inserted: 0 });
  });

  it('refuses by name a connector of another source, a device of another organisation and a device the platform has no identifier for', async () => {
    const other = { ...provider(), source_code: 'open_meteo' };
    await expect(collectDeviceReadings(db, other, { connectorId: connector, deviceId: pump, from: '2026-11-01', to: '2026-11-02' }))
      .rejects.toThrow(/^connector_source_mismatch/);
    await expect(collectDeviceReadings(db, provider(), { connectorId: connector, deviceId: strangersPump, from: '2026-11-01', to: '2026-11-02' }))
      .rejects.toThrow(/^device_in_other_organisation/);
    const bare = await insert(db, 'devices', { organisation_id: org, participant_id: (await one<{ participant_id: string }>(db, 'select participant_id from devices where id = $1', [pump])).participant_id, name: 'Boiler', device_type: 'heat_pump' });
    await expect(collectDeviceReadings(db, provider(), { connectorId: connector, deviceId: bare, from: '2026-11-01', to: '2026-11-02' }))
      .rejects.toThrow(/^identifier_missing: device .* has no example_heat_pump_serial identifier/);
    await expect(collectDeviceReadings(db, provider(), { connectorId: '00000000-0000-4000-8000-0000000000ff', deviceId: pump, from: '2026-11-01', to: '2026-11-02' }))
      .rejects.toThrow(/^connector_not_found/);
  });
});

describe('carrying commands', () => {
  it('sends the validated commands of its connector that are due, the earliest first, and reports each answer', async () => {
    const late = await command(4.5, '2026-11-02T18:00:00Z');
    const early = await command(3, '2026-11-02T06:00:00Z');
    const refused = await command(0, '2026-11-02T12:00:00Z');
    const later = await command(2, '2026-11-30T06:00:00Z');
    const proposed = await command(5, '2026-11-02T07:00:00Z', { validate: false });
    const elsewhere = await command(5, '2026-11-02T08:00:00Z', { connector: null });

    const sent: DeviceCommand[] = [];
    const { carried } = await carryCommands(db, carrier(sent), { connectorId: connector, until: '2026-11-02T23:59:59Z' });
    expect(sent.map((c) => [c.id, c.value, c.due_at])).toEqual([
      [early, 3, '2026-11-02T06:00:00.000Z'], [refused, 0, '2026-11-02T12:00:00.000Z'], [late, 4.5, '2026-11-02T18:00:00.000Z'],
    ]);
    expect(sent[0]).toMatchObject({
      device: { identifier: 'HP-0001', scheme: SCHEME, device_type: 'heat_pump' },
      quantity_code: 'power', series_kind: 'setpoint', series_name: 'Power limit', unit: 'KiloW',
    });
    expect(carried.map((c) => [c.id, c.status, c.failure])).toEqual([
      [early, 'done', null], [refused, 'failed', 'refused: the pump is in defrost'], [late, 'done', null],
    ]);

    // Acknowledged, the value is the effect: stored in the setpoint series at the instant the device answered.
    const effect = await db.query<{ at: string; value: number }>(
      `select to_char(at at time zone 'UTC', 'HH24:MI:SS') at, value from "window"($1, '2026-11-02', '2026-11-03')`, [setpoint]);
    expect(effect.rows).toEqual([{ at: '06:00:02', value: 3 }, { at: '18:00:02', value: 4.5 }]);
    expect(await statusOf(refused)).toEqual({ status: 'failed', failure: 'refused: the pump is in defrost' });
    for (const untouched of [later, proposed, elsewhere]) expect((await statusOf(untouched)).status).not.toBe('done');
    expect((await statusOf(later)).status).toBe('validated');

    // Carried again, nothing is sent twice.
    const twice: DeviceCommand[] = [];
    expect((await carryCommands(db, carrier(twice), { connectorId: connector, until: '2026-11-02T23:59:59Z' })).carried).toEqual([]);
    expect(twice).toEqual([]);
  });

  it('fails a command it could not send, and a failed command can be proposed again', async () => {
    const unreachable = await command(-1, '2026-11-04T06:00:00Z');
    const { carried } = await carryCommands(db, carrier([]), { connectorId: connector, until: '2026-11-04T06:00:00Z' });
    expect(carried).toEqual([{ id: unreachable, device_id: pump, status: 'failed', acknowledged_at: null, failure: 'platform unreachable' }]);
    await db.query(`select actions.move($1, 'proposed')`, [unreachable]);
    expect((await statusOf(unreachable)).status).toBe('proposed');
  });

  it('hands the answer to the report a module passes, and refuses without the actions module', async () => {
    const id = await command(1, '2026-11-05T06:00:00Z');
    const reported: unknown[] = [];
    await carryCommands(db, carrier([]), {
      connectorId: connector, until: '2026-11-05T06:00:00Z',
      report: async (d, actionId, at, failure) => {
        reported.push([actionId, at, failure]);
        await d.query(`select actions.report($1, $2::timestamptz, $3)`, [actionId, at, failure]);
      },
    });
    expect(reported).toEqual([[id, '2026-11-05T06:00:02.000Z', null]]);

    const alone = await freshDatabase();
    try {
      await expect(carryCommands(alone, carrier([]), { connectorId: connector })).rejects.toThrow(/^module_not_installed/);
    } finally {
      await alone.close();
    }
  });
});

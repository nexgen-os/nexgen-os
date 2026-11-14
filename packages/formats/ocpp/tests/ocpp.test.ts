// Three recorded exchanges between a station and its central system, in
// OCPP 1.6J, 2.0.1 and 2.1, read into plain shapes with no database: the
// identity, the states, the readings in their units, the sessions folded
// from their messages, the profiles, the sessions started and stopped from
// afar, and what the station answered.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_ACTIONS, MEASURANDS, SUBPROTOCOLS, readAnswer, readFrame, readProfileAnswer, readRemoteStart, readRemoteStop, readSetChargingProfile,
  readStationLog, versionOfSubprotocol, writeFrame, writeRemoteStart, writeRemoteStop, writeSetChargingProfile,
  type LogEntry, type Schedule, type StartRequest,
} from '@nexgen-os/ocpp';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as LogEntry[];
const v16 = fixture('station-1.6.json');
const v201 = fixture('station-2.0.1.json');
const v21 = fixture('station-2.1.json');

describe('frames', () => {
  it('reads a call, a result and an error, and writes each back as it came', () => {
    for (const e of v16.concat(v201, v21)) expect(writeFrame(readFrame(e.frame))).toEqual(e.frame);
    expect(readFrame(JSON.stringify([4, 'zz', 'NotImplemented', 'Unknown action', {}]))).toMatchObject({ type: 'error', code: 'NotImplemented' });
  });

  it('refuses what is not a frame, by name', () => {
    expect(() => readFrame([5, 'a', {}])).toThrow(/^frame_invalid/);
    expect(() => readFrame('{"a":1}')).toThrow(/^frame_invalid/);
  });
});

describe('a station speaking OCPP 1.6J', () => {
  const log = readStationLog(v16, '1.6');

  it('gives its identity and its meter', () => {
    expect(log.identity).toEqual({
      vendor: 'ExampleVendor', model: 'AC22-2', serialNumber: 'SN-0001', firmwareVersion: '1.4.2',
      meter: { type: 'Example DIN rail meter', serialNumber: 'M-0001' }, reason: null,
    });
  });

  it('gives the states of its connector, each connector its own EVSE', () => {
    expect(log.states.map((s) => [s.evseId, s.connectorId, s.status])).toEqual([[1, 1, 'available'], [1, 1, 'preparing'], [1, 1, 'charging'], [1, 1, 'available']]);
  });

  it('reads meter values in the unit the station says, per measurand, phase and context', () => {
    const at815 = log.readings.filter((r) => r.at === '2026-06-01T08:15:00Z');
    expect(at815.map((r) => [r.measurand, r.phase, r.value, r.unit])).toEqual([
      ['Energy.Active.Import.Register', null, 1252750, 'Wh'], ['Power.Active.Import', null, 11040, 'W'],
      ['Current.Import', 'L1', 16, 'A'], ['Voltage', 'L1-N', 231.2, 'V'],
    ]);
    expect(log.readings.find((r) => r.at === '2026-06-01T08:30:00Z' && r.measurand === 'Power.Active.Import')).toMatchObject({ value: 7.36, unit: 'kW', transactionId: '4711', evseId: 1 });
    expect(MEASURANDS['Energy.Active.Import.Register']).toEqual({ quantity: 'consumption_energy', valueKind: 'cumulative', unit: 'Wh' });
    expect(MEASURANDS.Voltage).toBeUndefined();
  });

  it('folds StartTransaction, its result, the meter values and StopTransaction into one session', () => {
    expect(log.sessions).toEqual([{
      transaction_id: '4711', evse_id: 1, connector_id: 1,
      started_at: '2026-06-01T08:00:00Z', ended_at: '2026-06-01T09:30:00Z',
      energy_kwh: 12.5, peak_power_kw: 11.04,
      id_token: 'TAG-EXAMPLE-01', id_token_type: 'idTag', stop_reason: 'EVDisconnected',
      metadata: { meter_start_wh: 1250000, meter_stop_wh: 1262500 },
    }]);
  });

  it('reads the profiles asked and what the station answered', () => {
    expect(log.profiles.map((p) => [p.profileId, p.schedule.purpose, p.schedule.kind, p.schedule.rate_unit, p.failure])).toEqual([
      [7, 'tx', 'absolute', 'A', null], [8, 'station_max', 'recurring', 'W', 'rejected'],
    ]);
    expect(log.profiles[0].schedule.periods).toEqual([{ start_s: 0, limit: 16, phases: 3 }, { start_s: 1800, limit: 10, phases: 3 }]);
  });
});

describe('a station speaking OCPP 2.0.1', () => {
  const log = readStationLog(v201, '2.0.1');

  it('gives its identity and why it booted', () => {
    expect(log.identity).toMatchObject({ vendor: 'ExampleVendor', model: 'DC50', serialNumber: 'SN-0201', reason: 'PowerUp', meter: null });
    expect(log.states.map((s) => [s.evseId, s.connectorId, s.status, s.errorCode])).toEqual([[1, 1, 'available', null], [1, 1, 'occupied', null]]);
  });

  it('scales a value by its multiplier and names its unit', () => {
    const power = log.readings.find((r) => r.measurand === 'Power.Active.Import')!;
    expect([power.value, power.unit, power.evseId, power.transactionId]).toEqual([48200, 'W', 1, 'tx-2026-06-02-a']);
    expect(log.readings.find((r) => r.measurand === 'SoC')).toMatchObject({ value: 62, unit: '%', location: 'EV' });
  });

  it('folds the TransactionEvents of a transaction into one session, its energy from the register at its begin and end', () => {
    expect(log.sessions).toEqual([{
      transaction_id: 'tx-2026-06-02-a', evse_id: 1, connector_id: 1,
      started_at: '2026-06-02T12:00:05Z', ended_at: '2026-06-02T12:40:00Z',
      energy_kwh: 28.25, peak_power_kw: 48.2,
      id_token: 'TOKEN-EXAMPLE-02', id_token_type: 'ISO14443', stop_reason: 'EVDisconnected',
      metadata: { meter_start_wh: 8400000, meter_stop_wh: 8428250 },
    }]);
  });

  it('reads a refusal with its reason, and a profile left unanswered', () => {
    expect(log.profiles.map((p) => [p.profileId, p.schedule.purpose, p.failure])).toEqual([
      [21, 'tx', 'rejected: TxNotFound'], [22, 'external_constraints', undefined],
    ]);
    expect(readProfileAnswer(null)).toEqual({ failure: 'timeout: the station did not answer' });
    expect(readProfileAnswer(readFrame([4, 'q', 'InternalError', 'busy', {}]))).toEqual({ failure: 'error: InternalError (busy)' });
  });
});

describe('a schedule asked of a station', () => {
  const schedule: Schedule = {
    evse_id: 1, purpose: 'tx_default', stack_level: 1, kind: 'absolute', rate_unit: 'W',
    starts_at: '2026-06-03T17:00:00Z', duration_s: 7200, periods: [{ start_s: 0, limit: 7400 }, { start_s: 3600, limit: 3700, phases: 1 }],
  };

  it('is written as the SetChargingProfile of each version and read back the same', () => {
    for (const version of ['1.6', '2.0.1'] as const) {
      const request = writeSetChargingProfile(schedule, version, 31);
      expect(readSetChargingProfile(request, version)).toEqual({ profileId: 31, schedule });
    }
    expect(writeSetChargingProfile(schedule, '1.6', 31)).toMatchObject({ connectorId: 1, csChargingProfiles: { chargingProfileId: 31, chargingProfilePurpose: 'TxDefaultProfile' } });
    expect(writeSetChargingProfile(schedule, '2.0.1', 31)).toMatchObject({ evseId: 1, chargingProfile: { id: 31, chargingSchedule: [{ id: 31, chargingRateUnit: 'W' }] } });
  });

  it('refuses what a version cannot say, by name', () => {
    expect(() => writeSetChargingProfile({ ...schedule, purpose: 'external_constraints' }, '1.6', 1)).toThrow(/^purpose_unsupported/);
    expect(() => writeSetChargingProfile({ ...schedule, purpose: 'tx', transaction_id: 'tx-a' }, '1.6', 1)).toThrow(/^transaction_id_invalid/);
  });
});

describe('the version a station asks for', () => {
  it('is named by its WebSocket subprotocol, and an unknown one is refused by name', () => {
    expect(SUBPROTOCOLS).toEqual({ '1.6': 'ocpp1.6', '2.0.1': 'ocpp2.0.1', '2.1': 'ocpp2.1' });
    expect(versionOfSubprotocol('ocpp2.1')).toBe('2.1');
    expect(versionOfSubprotocol('OCPP1.6')).toBe('1.6');
    expect(() => versionOfSubprotocol('ocpp2.0')).toThrow(/^subprotocol_unknown/);
  });
});

describe('a station speaking OCPP 2.1, its session started and stopped from afar', () => {
  const log = readStationLog(v21.slice(0, -1), '2.1');

  it('reads its identity, states and readings as 2.0.1 does', () => {
    expect(log.identity).toMatchObject({ vendor: 'ExampleVendor', model: 'AC11-BIDI', reason: 'PowerUp' });
    expect(log.states.map((s) => [s.evseId, s.status])).toEqual([[1, 'occupied']]);
    expect(log.readings.find((r) => r.measurand === 'Power.Active.Import')).toMatchObject({ value: 3.68, unit: 'kW', transactionId: 'tx-2026-06-04-r' });
  });

  it('folds the session the remote start opened and the remote stop closed', () => {
    expect(log.sessions).toEqual([{
      transaction_id: 'tx-2026-06-04-r', evse_id: 1, connector_id: 1,
      started_at: '2026-06-04T18:00:00Z', ended_at: '2026-06-04T19:00:02Z',
      energy_kwh: 3.68, peak_power_kw: 3.68,
      id_token: 'CENTRAL-EXAMPLE-03', id_token_type: 'Central', stop_reason: 'Remote',
      metadata: { meter_start_wh: 3120500, meter_stop_wh: 3124180 },
    }]);
  });

  it('gives each command with its answer, the start linked to the transaction it opened by its remote start id', () => {
    expect(log.commands).toEqual([
      {
        command: 'start', transaction_id: 'tx-2026-06-04-r', failure: null,
        start: {
          evse_id: 1, id_token: 'CENTRAL-EXAMPLE-03', id_token_type: 'Central', remote_start_id: 501,
          profile: { id: 41, schedule: { purpose: 'tx', stack_level: 0, kind: 'relative', rate_unit: 'A', periods: [{ start_s: 0, limit: 16, phases: 1 }] } },
        },
      },
      { command: 'stop', transaction_id: 'tx-2026-06-04-r', failure: null },
      { command: 'start', transaction_id: null, failure: 'rejected: OccupiedEVSE', start: { id_token: 'CENTRAL-EXAMPLE-03', id_token_type: 'Central', remote_start_id: 502 } },
    ]);
  });

  it('refuses by name a profile purpose only 2.1 has', () => {
    expect(() => readStationLog(v21, '2.1')).toThrow(/^purpose_unsupported: LocalGeneration/);
    const period = { evseId: 0, chargingProfile: { id: 1, stackLevel: 0, chargingProfilePurpose: 'TxDefaultProfile', chargingProfileKind: 'Absolute', chargingSchedule: [{ id: 1, chargingRateUnit: 'W', chargingSchedulePeriod: [{ startPeriod: 0, operationMode: 'CentralSetpoint' }] }] } };
    expect(() => readSetChargingProfile(period, '2.1')).toThrow(/^limit_required/);
  });
});

describe('a session asked of a station from afar', () => {
  const start: StartRequest = {
    evse_id: 2, id_token: 'CENTRAL-EXAMPLE-04', id_token_type: 'Central', remote_start_id: 7,
    profile: { id: 12, schedule: { purpose: 'tx', stack_level: 0, kind: 'relative', rate_unit: 'W', periods: [{ start_s: 0, limit: 7400 }, { start_s: 3600, limit: 3700 }] } },
  };

  it('is written as the call of each version and read back the same', () => {
    for (const version of ['2.0.1', '2.1'] as const) {
      const call = writeRemoteStart(start, version);
      expect(call.action).toBe('RequestStartTransaction');
      expect(call.payload).toMatchObject({ evseId: 2, remoteStartId: 7, idToken: { idToken: 'CENTRAL-EXAMPLE-04', type: 'Central' }, chargingProfile: { id: 12, chargingProfilePurpose: 'TxProfile' } });
      expect(readRemoteStart(call.payload, version)).toEqual(start);
    }
    const v16start: StartRequest = { evse_id: 1, id_token: 'TAG-EXAMPLE-05', id_token_type: 'idTag', profile: start.profile };
    const call = writeRemoteStart(v16start, '1.6');
    expect(call).toMatchObject({ action: 'RemoteStartTransaction', payload: { connectorId: 1, idTag: 'TAG-EXAMPLE-05', chargingProfile: { chargingProfileId: 12, chargingProfilePurpose: 'TxProfile' } } });
    expect(readRemoteStart(call.payload, '1.6')).toEqual(v16start);
    expect(writeRemoteStart({ id_token: 'TAG-EXAMPLE-05', id_token_type: 'idTag' }, '1.6').payload).toEqual({ idTag: 'TAG-EXAMPLE-05' });
  });

  it('stops a transaction in the type of id each version gives it', () => {
    expect(writeRemoteStop('4711', '1.6')).toEqual({ action: 'RemoteStopTransaction', payload: { transactionId: 4711 } });
    expect(writeRemoteStop('tx-a', '2.1')).toEqual({ action: 'RequestStopTransaction', payload: { transactionId: 'tx-a' } });
    expect(readRemoteStop({ transactionId: 4711 }, '1.6')).toEqual({ transaction_id: '4711' });
    expect(COMMAND_ACTIONS.stop['2.0.1']).toBe('RequestStopTransaction');
  });

  it('refuses what a version cannot say, by name', () => {
    expect(() => writeRemoteStart({ ...start, remote_start_id: undefined }, '2.0.1')).toThrow(/^remote_start_id_required/);
    expect(() => writeRemoteStart({ ...start, profile: undefined }, '1.6')).toThrow(/^id_token_type_invalid/);
    expect(() => writeRemoteStart({ ...start, profile: { id: 1, schedule: { ...start.profile!.schedule, purpose: 'tx_default' } } }, '2.1')).toThrow(/^profile_invalid/);
    expect(() => writeRemoteStop('tx-a', '1.6')).toThrow(/^transaction_id_invalid/);
  });

  it('reads the answer to any command, the old name kept', () => {
    expect(readAnswer(readFrame([3, 'x', { status: 'Rejected' }]))).toEqual({ failure: 'rejected' });
    expect(readProfileAnswer).toBe(readAnswer);
  });
});

describe('a station speaking OCPP 1.6J, asked from afar', () => {
  it('gives the commands of its log, a start never linked to its transaction', () => {
    const log = readStationLog([
      { frame: [2, 'r1', 'RemoteStartTransaction', { connectorId: 1, idTag: 'TAG-EXAMPLE-05' }] },
      { frame: [3, 'r1', { status: 'Accepted' }] },
      { frame: [2, 'r2', 'RemoteStopTransaction', { transactionId: 4712 }] },
    ], '1.6');
    expect(log.commands).toEqual([
      { command: 'start', start: { evse_id: 1, id_token: 'TAG-EXAMPLE-05', id_token_type: 'idTag' }, transaction_id: null, failure: null },
      { command: 'stop', transaction_id: '4712' },
    ]);
  });
});

// Two recorded exchanges between a station and its central system, one in
// OCPP 1.6J and one in 2.0.1, read into plain shapes with no database: the
// identity, the states, the readings in their units, the sessions folded
// from their messages, the profiles and what the station answered.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MEASURANDS, readFrame, readProfileAnswer, readSetChargingProfile, readStationLog, writeFrame, writeSetChargingProfile,
  type LogEntry, type Schedule,
} from '@nexgen-os/ocpp';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as LogEntry[];
const v16 = fixture('station-1.6.json');
const v201 = fixture('station-2.0.1.json');

describe('frames', () => {
  it('reads a call, a result and an error, and writes each back as it came', () => {
    for (const e of v16.concat(v201)) expect(writeFrame(readFrame(e.frame))).toEqual(e.frame);
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

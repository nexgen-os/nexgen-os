// A recorded S2 session between the resource manager of a home battery and
// an energy manager, read and checked against the S2 JSON schemas with no
// database: the device it describes, what it measures and expects, what it
// is asked, and the answer a receiver gives to what it cannot read.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMMODITY_QUANTITIES, CONTROL_TYPE_OF_PREFIX, ENUMS, MESSAGE_TYPES, problemsOf, readMessage, readPowerForecast, readPowerMeasurement,
  readResourceManagerDetails, receptionStatusOf, writeMessage, writePowerEnvelopeInstruction, type S2Message,
} from '@nexgen-os/s2';

const session = JSON.parse(readFileSync(new URL('./fixtures/battery-session.json', import.meta.url), 'utf8')) as S2Message[];
const of = (type: string) => session.find((m) => m.message_type === type)!;

describe('the schemas', () => {
  it('know every message type of S2 1.0.0 and the five control types', () => {
    expect(MESSAGE_TYPES).toHaveLength(36);
    expect(Object.values(CONTROL_TYPE_OF_PREFIX).sort()).toEqual(ENUMS.ControlType.filter((c) => !['NOT_CONTROLABLE', 'NO_SELECTION'].includes(c)).sort());
    for (const type of MESSAGE_TYPES) {
      const prefix = type.split('.')[0];
      if (type.includes('.')) expect(CONTROL_TYPE_OF_PREFIX[prefix]).toBeDefined();
    }
  });

  it('give every commodity quantity a unit', () => {
    expect(Object.keys(COMMODITY_QUANTITIES).sort()).toEqual([...ENUMS.CommodityQuantity].sort());
  });
});

describe('a session of a home battery', () => {
  it('reads every message, and writes each back as it came', () => {
    for (const m of session) {
      expect(problemsOf(m)).toEqual([]);
      expect(JSON.parse(writeMessage(readMessage(JSON.stringify(m))))).toEqual(m);
    }
  });

  it('reads the device its resource manager describes', () => {
    expect(readResourceManagerDetails(of('ResourceManagerDetails'))).toEqual({
      resourceId: 'battery-garage', name: 'Home battery', manufacturer: 'Example Storage', model: 'ES-10', serialNumber: 'ES10-000123',
      firmwareVersion: '2.4.1', roles: [{ role: 'ENERGY_STORAGE', commodity: 'ELECTRICITY' }],
      controlTypes: ['POWER_ENVELOPE_BASED_CONTROL', 'FILL_RATE_BASED_CONTROL'], instructionDelayMs: 2000, providesForecast: true,
      measures: ['ELECTRIC.POWER.3_PHASE_SYMMETRIC'], currency: null,
    });
  });

  it('reads a measurement in UTC, in its unit, with the sign the device gives', () => {
    expect(readPowerMeasurement(of('PowerMeasurement'))).toEqual([
      { at: '2026-11-10T12:00:05.000Z', quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: -2350.5, unit: 'W' },
    ]);
  });

  it('dates each step of a forecast at its start, its durations added up', () => {
    const steps = readPowerForecast(of('PowerForecast'));
    expect(steps.map((s) => [s.start, s.end, s.expected])).toEqual([
      ['2026-11-10T12:00:00.000Z', '2026-11-10T12:15:00.000Z', -2000],
      ['2026-11-10T12:15:00.000Z', '2026-11-10T12:45:00.000Z', 500],
    ]);
    expect(steps[0].lower).toEqual({ limit: null, p95: -2600, p68: null });
    expect(steps[1].upper).toEqual({ limit: 3000, p95: null, p68: null });
    expect(() => readPowerForecast(of('PowerMeasurement'))).toThrow(/^message_type_unexpected/);
  });
});

describe('a message that does not hold', () => {
  it('names every problem with its path', () => {
    const details = structuredClone(of('ResourceManagerDetails'));
    delete details.provides_forecast;
    details.instruction_processing_delay = 1.5;
    details.available_control_types = ['POWER_ENVELOPE_BASED_CONTROL', 'SOMETHING_ELSE'];
    details.colour = 'blue';
    expect(problemsOf(details)).toEqual([
      '$.instruction_processing_delay: a whole number of milliseconds, 1.5 given',
      '$.available_control_types[1]: one of POWER_ENVELOPE_BASED_CONTROL, POWER_PROFILE_BASED_CONTROL, OPERATION_MODE_BASED_CONTROL, FILL_RATE_BASED_CONTROL, DEMAND_DRIVEN_BASED_CONTROL, NOT_CONTROLABLE, NO_SELECTION, "SOMETHING_ELSE" given',
      '$.provides_forecast: required',
      '$.colour: not a field of this object',
    ]);
    expect(() => readMessage(details)).toThrow(/^message_invalid: ResourceManagerDetails: /);
  });

  it('checks the objects a message carries, down to the lists and their bounds', () => {
    const system = structuredClone(of('FRBC.SystemDescription')) as unknown as { actuators: { operation_modes: { elements: { power_ranges: unknown[] }[] }[] }[] };
    system.actuators[0].operation_modes[1].elements[0].power_ranges = [];
    expect(problemsOf(system)).toEqual(['$.actuators[0].operation_modes[1].elements[0].power_ranges: at least 1 item(s), 0 given']);
    expect(problemsOf({ ...of('PowerMeasurement'), measurement_timestamp: '2026-11-10 13:00' })).toEqual([
      '$.measurement_timestamp: a date and time with its offset, "2026-11-10 13:00" given',
    ]);
  });

  it('refuses what is no message, by name', () => {
    expect(() => readMessage('not json')).toThrow(/^message_unreadable/);
    expect(() => readMessage({ message_id: 'ab' })).toThrow(/^message_unreadable/);
    expect(problemsOf({ message_type: 'Hello', message_id: 'ab' })).toEqual(['$.message_type: "Hello" is not a message type of S2']);
  });

  it('is answered with the reception status S2 defines', () => {
    expect(receptionStatusOf(JSON.stringify(of('SelectControlType')))).toEqual({
      message_type: 'ReceptionStatus', subject_message_id: '9a7e0c10-0003-4000-8000-000000000003', status: 'OK',
    });
    expect(receptionStatusOf('{"message_type":"PowerMeasurement"')).toMatchObject({ status: 'INVALID_DATA' });
    expect(receptionStatusOf(JSON.stringify({ ...of('SelectControlType'), control_type: 'ANY' }))).toMatchObject({
      subject_message_id: '9a7e0c10-0003-4000-8000-000000000003', status: 'INVALID_MESSAGE',
    });
    expect(receptionStatusOf(JSON.stringify(of('ReceptionStatus')))).toBeNull();
    for (const answer of [receptionStatusOf('[]'), receptionStatusOf('{"message_type":"Hello","message_id":"x1"}')]) expect(problemsOf(answer)).toEqual([]);
  });
});

describe('a power envelope sent to a device', () => {
  const steps = [
    { start: '2026-11-10T12:00:00Z', end: '2026-11-10T12:15:00Z', lower: -5000, upper: 0 },
    { start: '2026-11-10T12:15:00Z', end: '2026-11-10T13:15:00Z', lower: -1000, upper: 1000 },
  ];

  it('is written from dated steps as durations that add up to the period', () => {
    const m = writePowerEnvelopeInstruction({
      messageId: '9a7e0c10-0010-4000-8000-000000000010', id: 'instruction-1', powerConstraintsId: 'constraints-1',
      envelopes: [{ id: 'envelope-1', quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', steps }],
    });
    expect(problemsOf(m)).toEqual([]);
    expect(m).toMatchObject({
      message_type: 'PEBC.Instruction', execution_time: '2026-11-10T12:00:00.000Z', abnormal_condition: false,
      power_envelopes: [{ power_envelope_elements: [{ duration: 900000, upper_limit: 0, lower_limit: -5000 }, { duration: 3600000, upper_limit: 1000, lower_limit: -1000 }] }],
    });
  });

  it('refuses a gap, an inverted limit or an envelope that starts elsewhere, by name', () => {
    const base = { messageId: 'm1', id: 'i1', powerConstraintsId: 'c1' };
    const one = (s: typeof steps) => writePowerEnvelopeInstruction({ ...base, envelopes: [{ id: 'e1', quantity: 'ELECTRIC.POWER.L1', steps: s }] });
    expect(() => one([steps[0], { ...steps[1], start: '2026-11-10T12:20:00Z' }])).toThrow(/^envelope_invalid: the step at .* does not follow/);
    expect(() => one([{ ...steps[0], lower: 1, upper: 0 }])).toThrow(/^envelope_invalid: .* lower limit/);
    expect(() => one([])).toThrow(/^envelope_invalid/);
    expect(() => writePowerEnvelopeInstruction({
      ...base,
      envelopes: [{ id: 'e1', quantity: 'ELECTRIC.POWER.L1', steps }, { id: 'e2', quantity: 'ELECTRIC.POWER.L2', steps: steps.slice(1) }],
    })).toThrow(/^envelope_invalid: every envelope/);
  });
});

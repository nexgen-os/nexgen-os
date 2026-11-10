// S2, the European standard EN 50491-12-2 for energy management in homes
// and buildings: the messages a customer energy manager (CEM) and the
// resource manager (RM) of a device exchange, in the JSON the S2 JSON
// schemas define (version 1.0.0). A resource manager says what its device
// is and what it can do (`ResourceManagerDetails`), what it measures
// (`PowerMeasurement`) and expects (`PowerForecast`), and how it may be
// steered, by one of five control types (power envelope, power profile,
// operation mode, fill rate, demand driven); the energy manager selects one
// and sends instructions within it.
//
// Everything here is a pure function: no connection, no clock, no database.
// A message is checked against the schemas field by field, every problem
// named with its path; a value stays in the unit of its commodity quantity
// and with the sign the device gives it.

import { ENUMS, MESSAGES, OBJECTS } from './schema.js';

export { ENUMS, MESSAGES, OBJECTS };

export type MessageType = keyof typeof MESSAGES & string;
export type CommodityQuantity = (typeof ENUMS)['CommodityQuantity'][number];
export type ControlType = (typeof ENUMS)['ControlType'][number];
export type ReceptionStatusValue = (typeof ENUMS)['ReceptionStatusValues'][number];
export type InstructionStatus = (typeof ENUMS)['InstructionStatus'][number];

/** A message of S2, checked: its type, and its fields as the schema names them. */
export interface S2Message {
  message_type: string;
  message_id?: string;
  [field: string]: unknown;
}

/** The message types the schemas define, `FRBC.Instruction` and the others. */
export const MESSAGE_TYPES = Object.keys(MESSAGES) as MessageType[];

/** The control type of each prefix of a message type (`FRBC.` → fill rate based control). */
export const CONTROL_TYPE_OF_PREFIX: Record<string, ControlType> = {
  PEBC: 'POWER_ENVELOPE_BASED_CONTROL',
  PPBC: 'POWER_PROFILE_BASED_CONTROL',
  OMBC: 'OPERATION_MODE_BASED_CONTROL',
  FRBC: 'FILL_RATE_BASED_CONTROL',
  DDBC: 'DEMAND_DRIVEN_BASED_CONTROL',
};

/**
 * The unit each commodity quantity is given in, as the schema of
 * `CommodityQuantity` defines it, and the phase of an electric power.
 */
export const COMMODITY_QUANTITIES: Record<CommodityQuantity, { commodity: string; unit: string; phase: 'L1' | 'L2' | 'L3' | 'symmetric' | null }> = {
  'ELECTRIC.POWER.L1': { commodity: 'ELECTRICITY', unit: 'W', phase: 'L1' },
  'ELECTRIC.POWER.L2': { commodity: 'ELECTRICITY', unit: 'W', phase: 'L2' },
  'ELECTRIC.POWER.L3': { commodity: 'ELECTRICITY', unit: 'W', phase: 'L3' },
  'ELECTRIC.POWER.3_PHASE_SYMMETRIC': { commodity: 'ELECTRICITY', unit: 'W', phase: 'symmetric' },
  'NATURAL_GAS.FLOW_RATE': { commodity: 'GAS', unit: 'l/s', phase: null },
  'HYDROGEN.FLOW_RATE': { commodity: 'GAS', unit: 'g/s', phase: null },
  'HEAT.TEMPERATURE': { commodity: 'HEAT', unit: '°C', phase: null },
  'HEAT.FLOW_RATE': { commodity: 'HEAT', unit: 'l/s', phase: null },
  'HEAT.THERMAL_POWER': { commodity: 'HEAT', unit: 'W', phase: null },
  'OIL.FLOW_RATE': { commodity: 'OIL', unit: 'l/h', phase: null },
};

// ---------------------------------------------------------------------------
// Checking a message against the schemas
// ---------------------------------------------------------------------------

const ID = /^[a-zA-Z0-9\-_:]{2,64}$/;
// RFC 3339: a date, a time, and an offset or Z.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const CURRENCY = /^[A-Z]{3}$/;
const LIST = /^\[(.+)\](?:\{(\d*),(\d*)\})?$/;

/**
 * Every way a message departs from the S2 JSON schemas, each a line
 * `<path>: <what is wrong>`; empty when the message holds. Fields the schema
 * does not know are problems, as its `additionalProperties: false` says.
 */
export function problemsOf(message: unknown): string[] {
  if (!isObject(message)) return ['$: a message is a JSON object'];
  const type = message.message_type;
  if (typeof type !== 'string' || !(type in MESSAGES)) return [`$.message_type: ${JSON.stringify(type)} is not a message type of S2`];
  const problems: string[] = [];
  checkObject(message, MESSAGES[type], '$', problems, ['message_type']);
  return problems;
}

function checkObject(value: Record<string, unknown>, fields: Record<string, string>, path: string, problems: string[], known: string[] = []): void {
  for (const [name, spec] of Object.entries(fields)) {
    const optional = spec.endsWith('?');
    const kind = optional ? spec.slice(0, -1) : spec;
    if (value[name] === undefined) {
      if (!optional) problems.push(`${path}.${name}: required`);
      continue;
    }
    checkValue(value[name], kind, `${path}.${name}`, problems);
  }
  for (const name of Object.keys(value)) {
    if (!(name in fields) && !known.includes(name)) problems.push(`${path}.${name}: not a field of this object`);
  }
}

function checkValue(value: unknown, kind: string, path: string, problems: string[]): void {
  const list = LIST.exec(kind);
  if (list) {
    if (!Array.isArray(value)) return void problems.push(`${path}: a list is expected`);
    const [, item, min, max] = list;
    if (min && value.length < Number(min)) problems.push(`${path}: at least ${min} item(s), ${value.length} given`);
    if (max && value.length > Number(max)) problems.push(`${path}: at most ${max} item(s), ${value.length} given`);
    value.forEach((v, i) => checkValue(v, item, `${path}[${i}]`, problems));
    return;
  }
  const fail = (what: string) => problems.push(`${path}: ${what}, ${JSON.stringify(value)} given`);
  switch (kind) {
    case 'id': if (typeof value !== 'string' || !ID.test(value)) fail('an id of 2 to 64 letters, digits, -, _ or :'); return;
    case 'date-time': if (typeof value !== 'string' || !DATE_TIME.test(value) || Number.isNaN(Date.parse(value))) fail('a date and time with its offset'); return;
    case 'Duration': if (!Number.isInteger(value) || (value as number) < 0) fail('a whole number of milliseconds'); return;
    case 'Currency': if (typeof value !== 'string' || !CURRENCY.test(value)) fail('an ISO 4217 currency code'); return;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) fail('a number'); return;
    case 'boolean': if (typeof value !== 'boolean') fail('true or false'); return;
    case 'string': if (typeof value !== 'string') fail('a string'); return;
  }
  if (kind in ENUMS) {
    const words = ENUMS[kind as keyof typeof ENUMS] as readonly string[];
    if (typeof value !== 'string' || !words.includes(value)) fail(`one of ${words.join(', ')}`);
    return;
  }
  const fields = OBJECTS[kind];
  if (!fields) throw new Error(`schema_kind_unknown: ${kind}`);
  if (!isObject(value)) return void problems.push(`${path}: an object ${kind} is expected`);
  checkObject(value, fields, path, problems);
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

/**
 * Reads a message from its text or its parsed JSON; refuses `message_unreadable`
 * when it is no JSON object with a message type, `message_invalid` with every
 * problem when it does not hold to its schema.
 */
export function readMessage(input: string | unknown): S2Message {
  let message: unknown = input;
  if (typeof input === 'string') {
    try {
      message = JSON.parse(input);
    } catch {
      throw new Error('message_unreadable: the text is not JSON');
    }
  }
  if (!isObject(message) || typeof message.message_type !== 'string') throw new Error('message_unreadable: an S2 message is a JSON object with a message_type');
  const problems = problemsOf(message);
  if (problems.length) throw new Error(`message_invalid: ${message.message_type}: ${problems.join('; ')}`);
  return message as S2Message;
}

/** Writes a message as the text S2 sends, after checking it; refuses `message_invalid`. */
export function writeMessage(message: S2Message): string {
  const problems = problemsOf(message);
  if (problems.length) throw new Error(`message_invalid: ${message.message_type}: ${problems.join('; ')}`);
  return JSON.stringify(message);
}

/**
 * The `ReceptionStatus` a receiver answers to a text it got, before it acts
 * on it: `INVALID_DATA` when the text is no JSON object or carries no
 * message id, `INVALID_MESSAGE` when the message does not hold to its
 * schema, `OK` otherwise. Whether its content can be acted on
 * (`INVALID_CONTENT`, an unknown id) is the receiver's to say. Null for a
 * `ReceptionStatus`, which is never answered.
 */
export function receptionStatusOf(text: string): S2Message | null {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    message = undefined;
  }
  if (isObject(message) && message.message_type === 'ReceptionStatus') return null;
  const id = isObject(message) ? message.message_id : undefined;
  if (typeof id !== 'string' || !ID.test(id)) {
    // No message id to refer to: the schema still wants one, the nil one.
    return { message_type: 'ReceptionStatus', subject_message_id: '00000000-0000-0000-0000-000000000000', status: 'INVALID_DATA', diagnostic_label: 'no JSON object with a message_id' };
  }
  const problems = problemsOf(message);
  if (problems.length) return { message_type: 'ReceptionStatus', subject_message_id: id, status: 'INVALID_MESSAGE', diagnostic_label: problems.join('; ').slice(0, 1000) };
  return { message_type: 'ReceptionStatus', subject_message_id: id, status: 'OK' };
}

// ---------------------------------------------------------------------------
// What a resource manager says: its device, its measurements, its forecast
// ---------------------------------------------------------------------------

export interface ResourceDetails {
  resourceId: string;
  name: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  /** What the device does with each commodity: produce, consume, store. */
  roles: { role: string; commodity: string }[];
  controlTypes: ControlType[];
  /** How long the device takes to act on an instruction, in milliseconds. */
  instructionDelayMs: number;
  providesForecast: boolean;
  measures: CommodityQuantity[];
  currency: string | null;
}

/** The device a `ResourceManagerDetails` describes. */
export function readResourceManagerDetails(input: string | unknown): ResourceDetails {
  const m = expect(input, 'ResourceManagerDetails');
  return {
    resourceId: m.resource_id as string,
    name: str(m.name),
    manufacturer: str(m.manufacturer),
    model: str(m.model),
    serialNumber: str(m.serial_number),
    firmwareVersion: str(m.firmware_version),
    roles: (m.roles as { role: string; commodity: string }[]).map((r) => ({ role: r.role, commodity: r.commodity })),
    controlTypes: m.available_control_types as ControlType[],
    instructionDelayMs: m.instruction_processing_delay as number,
    providesForecast: m.provides_forecast as boolean,
    measures: m.provides_power_measurement_types as CommodityQuantity[],
    currency: str(m.currency),
  };
}

export interface Measurement {
  /** When it was measured, in UTC. */
  at: string;
  quantity: CommodityQuantity;
  /** In `unit`, with the sign the device gives it. */
  value: number;
  unit: string;
}

/** The values of a `PowerMeasurement`, one per commodity quantity, each with its unit. */
export function readPowerMeasurement(input: string | unknown): Measurement[] {
  const m = expect(input, 'PowerMeasurement');
  const at = utc(m.measurement_timestamp as string);
  return (m.values as { commodity_quantity: CommodityQuantity; value: number }[]).map((v) => ({
    at,
    quantity: v.commodity_quantity,
    value: v.value,
    unit: COMMODITY_QUANTITIES[v.commodity_quantity].unit,
  }));
}

export interface ForecastStep {
  /** Start of the step, in UTC: a value is dated at the start of its interval. */
  start: string;
  end: string;
  quantity: CommodityQuantity;
  unit: string;
  expected: number;
  /** The bounds the device gives, null where it gives none. */
  lower: { limit: number | null; p95: number | null; p68: number | null };
  upper: { limit: number | null; p95: number | null; p68: number | null };
}

/**
 * The steps of a `PowerForecast`, each dated at its start: the elements
 * follow one another from `start_time`, each lasting its duration.
 */
export function readPowerForecast(input: string | unknown): ForecastStep[] {
  const m = expect(input, 'PowerForecast');
  let t = Date.parse(m.start_time as string);
  const steps: ForecastStep[] = [];
  for (const e of m.elements as { duration: number; power_values: Record<string, unknown>[] }[]) {
    const start = new Date(t).toISOString();
    t += e.duration;
    const end = new Date(t).toISOString();
    for (const v of e.power_values) {
      const quantity = v.commodity_quantity as CommodityQuantity;
      steps.push({
        start, end, quantity,
        unit: COMMODITY_QUANTITIES[quantity].unit,
        expected: v.value_expected as number,
        lower: { limit: numOrNull(v.value_lower_limit), p95: numOrNull(v.value_lower_95PPR), p68: numOrNull(v.value_lower_68PPR) },
        upper: { limit: numOrNull(v.value_upper_limit), p95: numOrNull(v.value_upper_95PPR), p68: numOrNull(v.value_upper_68PPR) },
      });
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// What an energy manager sends: a power envelope
// ---------------------------------------------------------------------------

export interface EnvelopeStep {
  start: string;
  end: string;
  /** In the unit of the quantity; the lower is never above the upper. */
  lower: number;
  upper: number;
}

/**
 * A `PEBC.Instruction`: power envelopes, one per commodity quantity, written
 * from dated steps that follow one another (each step's start is the end of
 * the one before), so that the durations S2 carries add up to the period.
 * Refuses `envelope_invalid` for a gap, an overlap or a lower limit above
 * its upper one. The ids are the caller's: S2 wants them unique in a session.
 */
export function writePowerEnvelopeInstruction(input: {
  messageId: string;
  id: string;
  powerConstraintsId: string;
  abnormalCondition?: boolean;
  envelopes: { id: string; quantity: CommodityQuantity; steps: EnvelopeStep[] }[];
}): S2Message {
  const first = input.envelopes[0]?.steps[0];
  if (!first) throw new Error('envelope_invalid: an instruction carries at least one envelope with one step');
  const executionTimes = input.envelopes.map((e) => Date.parse(e.steps[0]?.start ?? ''));
  if (executionTimes.some((t) => t !== executionTimes[0])) throw new Error('envelope_invalid: every envelope of an instruction starts at its execution time');
  const message: S2Message = {
    message_type: 'PEBC.Instruction',
    message_id: input.messageId,
    id: input.id,
    execution_time: new Date(executionTimes[0]).toISOString(),
    abnormal_condition: input.abnormalCondition ?? false,
    power_constraints_id: input.powerConstraintsId,
    power_envelopes: input.envelopes.map((e) => {
      let at = Date.parse(e.steps[0].start);
      return {
        id: e.id,
        commodity_quantity: e.quantity,
        power_envelope_elements: e.steps.map((s) => {
          const start = Date.parse(s.start);
          const end = Date.parse(s.end);
          if (start !== at) throw new Error(`envelope_invalid: the step at ${s.start} does not follow the one before`);
          if (!(end > start)) throw new Error(`envelope_invalid: the step at ${s.start} ends before it starts`);
          if (s.lower > s.upper) throw new Error(`envelope_invalid: at ${s.start} the lower limit ${s.lower} is above the upper ${s.upper}`);
          at = end;
          return { duration: end - start, upper_limit: s.upper, lower_limit: s.lower };
        }),
      };
    }),
  };
  writeMessage(message);
  return message;
}

// ---------------------------------------------------------------------------

function expect(input: string | unknown, type: MessageType): S2Message {
  const m = readMessage(input);
  if (m.message_type !== type) throw new Error(`message_type_unexpected: ${type} expected, ${m.message_type} given`);
  return m;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function utc(v: string): string {
  return new Date(Date.parse(v)).toISOString();
}

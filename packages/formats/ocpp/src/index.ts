// The Open Charge Point Protocol (OCPP), versions 1.6J, 2.0.1 and 2.1, read
// into plain shapes: the identity of a station, the state of its
// connectors, the values its meters sample, its charging sessions, the
// charging profiles it is asked to keep, and the sessions it is asked to
// start and stop from afar, with the answers it gives.
//
// OCPP-J carries JSON frames over a WebSocket between a charging station
// and its central system (CSMS): a call `[2, id, action, payload]`, its
// result `[3, id, payload]` or its error `[4, id, code, description,
// details]`. The payloads follow the JSON schemas the Open Charge Alliance
// publishes with each version; the types below are written from them and
// keep their field names. OCPP 2.1 keeps the messages of 2.0.1 read here
// and adds fields to them: a 2.1 message is read as a 2.0.1 one, and what
// 2.1 alone can say (its new profile purposes, a period without a limit)
// is refused by name.
//
// Everything here is a pure function: no connection, no clock, no database.
// A value is read in the unit the station says, scaled only as the protocol
// defines (the `multiplier` of 2.0.1); a register stays a register.

export type OcppVersion = '1.6' | '2.0.1' | '2.1';

/** The WebSocket subprotocol a station asks for, per version (`Sec-WebSocket-Protocol`). */
export const SUBPROTOCOLS: Record<OcppVersion, string> = { '1.6': 'ocpp1.6', '2.0.1': 'ocpp2.0.1', '2.1': 'ocpp2.1' };

/** The version a WebSocket subprotocol names; refuses `subprotocol_unknown`. */
export function versionOfSubprotocol(subprotocol: string): OcppVersion {
  const found = (Object.entries(SUBPROTOCOLS) as [OcppVersion, string][]).find(([, name]) => name === subprotocol.trim().toLowerCase());
  if (!found) throw new Error(`subprotocol_unknown: ${subprotocol} is not ${Object.values(SUBPROTOCOLS).join(', ')}`);
  return found[0];
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export type Frame =
  | { type: 'call'; id: string; action: string; payload: Record<string, unknown> }
  | { type: 'result'; id: string; payload: Record<string, unknown> }
  | { type: 'error'; id: string; code: string; description: string; details: Record<string, unknown> };

/** Reads an OCPP-J frame from its text or its parsed array; refuses `frame_invalid`. */
export function readFrame(input: string | unknown[]): Frame {
  const a = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!Array.isArray(a) || typeof a[1] !== 'string') throw new Error('frame_invalid: an OCPP-J frame is an array [type, id, …]');
  if (a[0] === 2 && typeof a[2] === 'string' && isObject(a[3])) return { type: 'call', id: a[1], action: a[2], payload: a[3] };
  if (a[0] === 3 && isObject(a[2])) return { type: 'result', id: a[1], payload: a[2] };
  if (a[0] === 4 && typeof a[2] === 'string') {
    return { type: 'error', id: a[1], code: a[2], description: String(a[3] ?? ''), details: isObject(a[4]) ? a[4] : {} };
  }
  throw new Error(`frame_invalid: message type ${String(a[0])} is not 2, 3 or 4, or its payload is not an object`);
}

/** Writes a frame as the array OCPP-J sends, `JSON.stringify` of which is the text on the wire. */
export function writeFrame(frame: Frame): unknown[] {
  if (frame.type === 'call') return [2, frame.id, frame.action, frame.payload];
  if (frame.type === 'result') return [3, frame.id, frame.payload];
  return [4, frame.id, frame.code, frame.description, frame.details];
}

// ---------------------------------------------------------------------------
// BootNotification → the identity of the station
// ---------------------------------------------------------------------------

export interface StationIdentity {
  vendor: string;
  model: string;
  serialNumber: string | null;
  firmwareVersion: string | null;
  /** The meter of the station, when it says one (1.6 only). */
  meter: { type: string | null; serialNumber: string | null } | null;
  /** Why it booted (2.0.1 and later). */
  reason: string | null;
}

/** The identity a station gives in its BootNotification request. */
export function readBootNotification(payload: Record<string, unknown>, version: OcppVersion): StationIdentity {
  if (version === '1.6') {
    const meterType = str(payload.meterType);
    const meterSerial = str(payload.meterSerialNumber);
    return {
      vendor: req(payload.chargePointVendor, 'chargePointVendor'),
      model: req(payload.chargePointModel, 'chargePointModel'),
      serialNumber: str(payload.chargePointSerialNumber) ?? str(payload.chargeBoxSerialNumber),
      firmwareVersion: str(payload.firmwareVersion),
      meter: meterType || meterSerial ? { type: meterType, serialNumber: meterSerial } : null,
      reason: null,
    };
  }
  const station = obj(payload.chargingStation, 'chargingStation');
  return {
    vendor: req(station.vendorName, 'chargingStation.vendorName'),
    model: req(station.model, 'chargingStation.model'),
    serialNumber: str(station.serialNumber),
    firmwareVersion: str(station.firmwareVersion),
    meter: null,
    reason: str(payload.reason),
  };
}

// ---------------------------------------------------------------------------
// StatusNotification → the state of a connector
// ---------------------------------------------------------------------------

/**
 * The state of a connector, in one vocabulary for every version: the 1.6
 * statuses, and the connector statuses of 2.0.1 and 2.1 (`Available`, `Occupied`,
 * `Reserved`, `Unavailable`, `Faulted`), in snake case.
 */
export type ConnectorStatus =
  | 'available' | 'preparing' | 'charging' | 'suspended_ev' | 'suspended_evse' | 'finishing'
  | 'occupied' | 'reserved' | 'unavailable' | 'faulted';

export interface ConnectorState {
  /** 0 is the station as a whole. In 1.6, the connector is its own EVSE. */
  evseId: number;
  connectorId: number;
  status: ConnectorStatus;
  /** The error a 1.6 station states (`NoError` when none); null in 2.0.1 and 2.1. */
  errorCode: string | null;
  at: string | null;
}

const STATUSES: Record<string, ConnectorStatus> = {
  Available: 'available', Preparing: 'preparing', Charging: 'charging', SuspendedEV: 'suspended_ev', SuspendedEVSE: 'suspended_evse',
  Finishing: 'finishing', Occupied: 'occupied', Reserved: 'reserved', Unavailable: 'unavailable', Faulted: 'faulted',
};

/** The state a StatusNotification request gives; refuses `status_unknown`. */
export function readStatusNotification(payload: Record<string, unknown>, version: OcppVersion): ConnectorState {
  const word = version === '1.6' ? str(payload.status) : str(payload.connectorStatus);
  const status = word ? STATUSES[word] : undefined;
  if (!status) throw new Error(`status_unknown: ${String(word)} is not a status of OCPP ${version}`);
  const connectorId = num(payload.connectorId, 'connectorId');
  return {
    evseId: version === '1.6' ? connectorId : num(payload.evseId, 'evseId'),
    connectorId,
    status,
    errorCode: version === '1.6' ? str(payload.errorCode) : null,
    at: str(payload.timestamp),
  };
}

// ---------------------------------------------------------------------------
// MeterValues → readings, each in the unit of a quantity
// ---------------------------------------------------------------------------

export interface Reading {
  at: string;
  /** The measurand, as OCPP names it; `Energy.Active.Import.Register` when the station omits it. */
  measurand: string;
  phase: string | null;
  location: string | null;
  /** Why it was sampled: `Sample.Periodic`, `Transaction.Begin`, `Transaction.End`… */
  context: string | null;
  value: number;
  /** The unit symbol the value is in, as the protocol defines it (Wh when omitted for energy). */
  unit: string;
}

/**
 * Where a measurand goes in a model of devices and series: the quantity
 * that holds it, whether the value is a register (cumulative) or an
 * instant, and the unit symbol it is read in. A measurand absent here is
 * read and kept in the readings, with no quantity.
 */
export const MEASURANDS: Record<string, { quantity: string; valueKind: 'cumulative' | 'instant'; unit: string }> = {
  'Energy.Active.Import.Register': { quantity: 'consumption_energy', valueKind: 'cumulative', unit: 'Wh' },
  'Energy.Active.Export.Register': { quantity: 'production_energy', valueKind: 'cumulative', unit: 'Wh' },
  'Power.Active.Import': { quantity: 'consumption_power', valueKind: 'instant', unit: 'W' },
  'Power.Active.Export': { quantity: 'production_power', valueKind: 'instant', unit: 'W' },
  'Current.Import': { quantity: 'current', valueKind: 'instant', unit: 'A' },
  'Current.Offered': { quantity: 'current', valueKind: 'instant', unit: 'A' },
  SoC: { quantity: 'charge_level', valueKind: 'instant', unit: '%' },
  Temperature: { quantity: 'temperature', valueKind: 'instant', unit: '°C' },
};

/** The symbols OCPP writes, as the symbols of the units they are. */
const UNIT_SYMBOLS: Record<string, string> = {
  Wh: 'Wh', kWh: 'kWh', varh: 'varh', kvarh: 'kvarh', W: 'W', kW: 'kW', VA: 'VA', kVA: 'kVA', var: 'var', kvar: 'kvar',
  A: 'A', V: 'V', Celsius: '°C', Fahrenheit: '°F', K: 'K', Percent: '%',
};

const DEFAULT_MEASURAND = 'Energy.Active.Import.Register';

/** The readings of the `meterValue` array of a MeterValues request, a StopTransaction's `transactionData` or a TransactionEvent. */
export function readMeterValues(meterValue: unknown, version: OcppVersion): Reading[] {
  if (!Array.isArray(meterValue)) return [];
  const out: Reading[] = [];
  for (const mv of meterValue) {
    const m = obj(mv, 'meterValue');
    const at = req(m.timestamp, 'meterValue.timestamp');
    const sampled = m.sampledValue;
    if (!Array.isArray(sampled)) continue;
    for (const sv of sampled) {
      const s = obj(sv, 'sampledValue');
      const measurand = str(s.measurand) ?? DEFAULT_MEASURAND;
      let value: number;
      let unit: string;
      if (version === '1.6') {
        if (s.format === 'SignedData') continue;
        value = Number(s.value);
        unit = str(s.unit) ?? (MEASURANDS[measurand]?.unit === 'Wh' ? 'Wh' : MEASURANDS[measurand]?.unit ?? '');
      } else {
        const u = isObject(s.unitOfMeasure) ? s.unitOfMeasure : {};
        value = Number(s.value) * 10 ** Number(u.multiplier ?? 0);
        unit = str(u.unit) ?? (MEASURANDS[measurand]?.unit === 'Wh' ? 'Wh' : MEASURANDS[measurand]?.unit ?? '');
      }
      if (!Number.isFinite(value)) throw new Error(`value_invalid: ${String(s.value)} of ${measurand} at ${at} is not a number`);
      out.push({ at, measurand, phase: str(s.phase), location: str(s.location), context: str(s.context), value, unit: UNIT_SYMBOLS[unit] ?? unit });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transactions → sessions
// ---------------------------------------------------------------------------

/**
 * A charging session, as far as the messages read so far say it, in the
 * plain shape a recorder of sessions reads (snake case, as JSON): a later
 * message of the same transaction completes it.
 */
export interface SessionRecord {
  transaction_id: string;
  evse_id?: number;
  connector_id?: number;
  started_at?: string;
  ended_at?: string;
  energy_kwh?: number;
  peak_power_kw?: number;
  id_token?: string;
  id_token_type?: string;
  stop_reason?: string;
  /** The register at the start and at the end, in Wh, when the messages say them. */
  metadata?: { meter_start_wh?: number; meter_stop_wh?: number };
}

/** A 1.6 StartTransaction: its request, and the result where the central system gave the transaction its id. */
export function readStartTransaction(request: Record<string, unknown>, result: Record<string, unknown>): SessionRecord {
  const connector = num(request.connectorId, 'connectorId');
  return {
    transaction_id: String(num(result.transactionId, 'transactionId')),
    evse_id: connector,
    connector_id: connector,
    started_at: req(request.timestamp, 'timestamp'),
    id_token: req(request.idTag, 'idTag'),
    id_token_type: 'idTag',
    metadata: { meter_start_wh: num(request.meterStart, 'meterStart') },
  };
}

/** A 1.6 StopTransaction request; the energy once the register at the start is known (`meterStartWh`). */
export function readStopTransaction(request: Record<string, unknown>, meterStartWh?: number): SessionRecord {
  const stop = num(request.meterStop, 'meterStop');
  const readings = readMeterValues(request.transactionData, '1.6');
  const peak = peakKw(readings);
  return {
    transaction_id: String(num(request.transactionId, 'transactionId')),
    ended_at: req(request.timestamp, 'timestamp'),
    ...(meterStartWh !== undefined ? { energy_kwh: round((stop - meterStartWh) / 1000) } : {}),
    ...(peak !== null ? { peak_power_kw: peak } : {}),
    ...(str(request.idTag) ? { id_token: str(request.idTag)! } : {}),
    stop_reason: str(request.reason) ?? 'Local',
    metadata: { ...(meterStartWh !== undefined ? { meter_start_wh: meterStartWh } : {}), meter_stop_wh: stop },
  };
}

/** A TransactionEvent request (2.0.1 and 2.1): started, updated or ended, with what its meter values say. */
export function readTransactionEvent(request: Record<string, unknown>): SessionRecord {
  const info = obj(request.transactionInfo, 'transactionInfo');
  const event = req(request.eventType, 'eventType');
  const evse = isObject(request.evse) ? request.evse : null;
  const token = isObject(request.idToken) ? request.idToken : null;
  const readings = readMeterValues(request.meterValue, '2.0.1');
  const register = readings.filter((r) => r.measurand === DEFAULT_MEASURAND && r.phase === null);
  const begin = register.find((r) => r.context === 'Transaction.Begin');
  const end = register.find((r) => r.context === 'Transaction.End');
  const peak = peakKw(readings);
  const meta: { meter_start_wh?: number; meter_stop_wh?: number } = {};
  if (begin) meta.meter_start_wh = inWh(begin);
  if (end) meta.meter_stop_wh = inWh(end);
  return {
    transaction_id: req(info.transactionId, 'transactionInfo.transactionId'),
    ...(evse ? { evse_id: num(evse.id, 'evse.id') } : {}),
    ...(evse && evse.connectorId !== undefined ? { connector_id: num(evse.connectorId, 'evse.connectorId') } : {}),
    ...(event === 'Started' ? { started_at: req(request.timestamp, 'timestamp') } : {}),
    ...(event === 'Ended' ? { ended_at: req(request.timestamp, 'timestamp'), stop_reason: str(info.stoppedReason) ?? 'Local' } : {}),
    ...(token ? { id_token: req(token.idToken, 'idToken.idToken'), id_token_type: req(token.type, 'idToken.type') } : {}),
    ...(peak !== null ? { peak_power_kw: peak } : {}),
    ...(Object.keys(meta).length ? { metadata: meta } : {}),
  };
}

// ---------------------------------------------------------------------------
// SetChargingProfile ⇄ a schedule
// ---------------------------------------------------------------------------

/** What a charging profile limits, in one vocabulary for every version. */
export type ProfilePurpose = 'station_max' | 'tx_default' | 'tx' | 'external_constraints';

/** A charging profile in the plain shape a steering gesture reads (snake case, as JSON). */
export interface Schedule {
  /** 0 is the whole station; in 1.6, the connector. */
  evse_id: number;
  purpose: ProfilePurpose;
  stack_level: number;
  kind: 'absolute' | 'relative' | 'recurring';
  recurrency?: 'daily' | 'weekly';
  rate_unit: 'W' | 'A';
  starts_at?: string;
  duration_s?: number;
  valid_from?: string;
  valid_to?: string;
  transaction_id?: string;
  min_rate?: number;
  periods: { start_s: number; limit: number; phases?: number }[];
}

const PURPOSES: Record<OcppVersion, Record<ProfilePurpose, string | null>> = {
  '1.6': { station_max: 'ChargePointMaxProfile', tx_default: 'TxDefaultProfile', tx: 'TxProfile', external_constraints: null },
  '2.0.1': { station_max: 'ChargingStationMaxProfile', tx_default: 'TxDefaultProfile', tx: 'TxProfile', external_constraints: 'ChargingStationExternalConstraints' },
  '2.1': { station_max: 'ChargingStationMaxProfile', tx_default: 'TxDefaultProfile', tx: 'TxProfile', external_constraints: 'ChargingStationExternalConstraints' },
};
const KINDS = { absolute: 'Absolute', relative: 'Relative', recurring: 'Recurring' } as const;
const RECURRENCIES = { daily: 'Daily', weekly: 'Weekly' } as const;

/**
 * The SetChargingProfile request that asks a station to keep a schedule,
 * under the number the station will know the profile by. Refuses
 * `purpose_unsupported` (external constraints in 1.6) and
 * `transaction_id_invalid` (a 1.6 transaction id is an integer).
 */
export function writeSetChargingProfile(schedule: Schedule, version: OcppVersion, profileId: number): Record<string, unknown> {
  const profile = writeProfile(schedule, version, profileId);
  if (version === '1.6') return { connectorId: schedule.evse_id, csChargingProfiles: profile };
  return { evseId: schedule.evse_id, chargingProfile: profile };
}

/** The ChargingProfile of a version, as SetChargingProfile and a remote start carry it (the EVSE stays outside it). */
function writeProfile(schedule: Schedule, version: OcppVersion, profileId: number): Record<string, unknown> {
  const purpose = PURPOSES[version][schedule.purpose];
  if (!purpose) throw new Error(`purpose_unsupported: OCPP ${version} has no profile purpose for ${schedule.purpose}`);
  const periods = schedule.periods.map((p) => ({ startPeriod: p.start_s, limit: p.limit, ...(p.phases !== undefined ? { numberPhases: p.phases } : {}) }));
  const chargingSchedule = {
    ...(version !== '1.6' ? { id: profileId } : {}),
    ...(schedule.duration_s !== undefined ? { duration: schedule.duration_s } : {}),
    ...(schedule.starts_at !== undefined ? { startSchedule: schedule.starts_at } : {}),
    chargingRateUnit: schedule.rate_unit,
    chargingSchedulePeriod: periods,
    ...(schedule.min_rate !== undefined ? { minChargingRate: schedule.min_rate } : {}),
  };
  const profile: Record<string, unknown> = {
    [version === '1.6' ? 'chargingProfileId' : 'id']: profileId,
    stackLevel: schedule.stack_level,
    chargingProfilePurpose: purpose,
    chargingProfileKind: KINDS[schedule.kind],
    ...(schedule.recurrency ? { recurrencyKind: RECURRENCIES[schedule.recurrency] } : {}),
    ...(schedule.valid_from ? { validFrom: schedule.valid_from } : {}),
    ...(schedule.valid_to ? { validTo: schedule.valid_to } : {}),
  };
  if (schedule.transaction_id !== undefined) {
    if (version === '1.6' && !/^\d+$/.test(schedule.transaction_id)) {
      throw new Error(`transaction_id_invalid: an OCPP 1.6 transaction id is an integer, not ${schedule.transaction_id}`);
    }
    profile.transactionId = version === '1.6' ? Number(schedule.transaction_id) : schedule.transaction_id;
  }
  return { ...profile, chargingSchedule: version === '1.6' ? chargingSchedule : [chargingSchedule] };
}

/** The schedule a SetChargingProfile request asks for, and the number of the profile. */
export function readSetChargingProfile(request: Record<string, unknown>, version: OcppVersion): { profileId: number; schedule: Schedule } {
  const evseId = num(version === '1.6' ? request.connectorId : request.evseId, version === '1.6' ? 'connectorId' : 'evseId');
  return readProfile(version === '1.6' ? request.csChargingProfiles : request.chargingProfile, version, evseId);
}

/** A ChargingProfile of a version read back as a schedule of the EVSE it is for. */
function readProfile(raw: unknown, version: OcppVersion, evseId: number): { profileId: number; schedule: Schedule } {
  const profile = obj(raw, 'chargingProfile');
  const rawSchedule = version === '1.6' ? profile.chargingSchedule : Array.isArray(profile.chargingSchedule) ? profile.chargingSchedule[0] : undefined;
  const cs = obj(rawSchedule, 'chargingSchedule');
  const purposeWord = req(profile.chargingProfilePurpose, 'chargingProfilePurpose');
  const purpose = (Object.entries(PURPOSES[version]).find(([, w]) => w === purposeWord)?.[0] ?? null) as ProfilePurpose | null;
  if (!purpose) throw new Error(`purpose_unsupported: ${purposeWord} is not a profile purpose of OCPP ${version} read here`);
  const kindWord = req(profile.chargingProfileKind, 'chargingProfileKind');
  const kind = (Object.entries(KINDS).find(([, w]) => w === kindWord)?.[0] ?? null) as Schedule['kind'] | null;
  if (!kind) throw new Error(`kind_unknown: ${kindWord} is not a profile kind`);
  const recurrencyWord = str(profile.recurrencyKind);
  const recurrency = recurrencyWord ? ((Object.entries(RECURRENCIES).find(([, w]) => w === recurrencyWord)?.[0] ?? undefined) as Schedule['recurrency']) : undefined;
  const unit = req(cs.chargingRateUnit, 'chargingRateUnit');
  if (unit !== 'W' && unit !== 'A') throw new Error(`rate_unit_invalid: ${unit} is not W or A`);
  const periods = Array.isArray(cs.chargingSchedulePeriod) ? cs.chargingSchedulePeriod.map((p) => {
    const o = obj(p, 'chargingSchedulePeriod');
    if (o.limit === undefined) throw new Error(`limit_required: a period without a limit (an operation mode of OCPP ${version}) is not read here`);
    return { start_s: num(o.startPeriod, 'startPeriod'), limit: num(o.limit, 'limit'), ...(o.numberPhases !== undefined ? { phases: num(o.numberPhases, 'numberPhases') } : {}) };
  }) : [];
  const schedule: Schedule = {
    evse_id: evseId,
    purpose,
    stack_level: num(profile.stackLevel, 'stackLevel'),
    kind,
    ...(recurrency ? { recurrency } : {}),
    rate_unit: unit,
    ...(str(cs.startSchedule) ? { starts_at: str(cs.startSchedule)! } : {}),
    ...(cs.duration !== undefined ? { duration_s: num(cs.duration, 'duration') } : {}),
    ...(str(profile.validFrom) ? { valid_from: str(profile.validFrom)! } : {}),
    ...(str(profile.validTo) ? { valid_to: str(profile.validTo)! } : {}),
    ...(profile.transactionId !== undefined ? { transaction_id: String(profile.transactionId) } : {}),
    ...(cs.minChargingRate !== undefined ? { min_rate: num(cs.minChargingRate, 'minChargingRate') } : {}),
    periods,
  };
  return { profileId: num(version === '1.6' ? profile.chargingProfileId : profile.id, 'chargingProfileId'), schedule };
}

/**
 * What a station's answer to a command means for the command that asked
 * it — a SetChargingProfile, a remote start or stop: accepted (no
 * failure), or failed and why — rejected, not supported, an error frame,
 * or no answer at all (`null`), which is a timeout.
 */
export function readAnswer(answer: Frame | null): { failure: string | null } {
  if (answer === null) return { failure: 'timeout: the station did not answer' };
  if (answer.type === 'error') return { failure: `error: ${answer.code}${answer.description ? ` (${answer.description})` : ''}` };
  if (answer.type !== 'result') return { failure: 'error: the answer is not a result' };
  const status = str(answer.payload.status);
  if (status === 'Accepted') return { failure: null };
  const info = isObject(answer.payload.statusInfo) ? str(answer.payload.statusInfo.reasonCode) : null;
  return { failure: `${(status ?? 'unknown').toLowerCase()}${info ? `: ${info}` : ''}` };
}

/** @deprecated The same reading as `readAnswer()`, which reads the answer to any command. */
export const readProfileAnswer = readAnswer;

// ---------------------------------------------------------------------------
// A session started and stopped from afar
// ---------------------------------------------------------------------------

/**
 * A session a central system asks a station to start, in the plain shape
 * a steering gesture reads (snake case, as JSON): on which EVSE (the
 * station chooses when absent), for which id token, under which number
 * the central system will recognise the transaction it starts (2.0.1 and
 * later), with the profile the session is to keep.
 */
export interface StartRequest {
  /** In 1.6, the connector. */
  evse_id?: number;
  id_token: string;
  /** `idTag` in 1.6; the type of the token in 2.0.1 and 2.1 (`ISO14443`, `Central`…). */
  id_token_type: string;
  /** Required from 2.0.1: the TransactionEvent of the session it starts carries it back. */
  remote_start_id?: number;
  /** A profile for the session only: purpose `tx`, without a transaction id, which the station gives. */
  profile?: { id: number; schedule: Omit<Schedule, 'evse_id'> };
}

/** The action of each command, per version. */
export const COMMAND_ACTIONS: Record<'start' | 'stop', Record<OcppVersion, string>> = {
  start: { '1.6': 'RemoteStartTransaction', '2.0.1': 'RequestStartTransaction', '2.1': 'RequestStartTransaction' },
  stop: { '1.6': 'RemoteStopTransaction', '2.0.1': 'RequestStopTransaction', '2.1': 'RequestStopTransaction' },
};

/**
 * The call that asks a station to start a session: its action and its
 * payload. Refuses `remote_start_id_required` (2.0.1 and later),
 * `id_token_type_invalid` (a 1.6 token is an `idTag`) and
 * `profile_invalid` (a profile that is not for the session alone).
 */
export function writeRemoteStart(request: StartRequest, version: OcppVersion): { action: string; payload: Record<string, unknown> } {
  const evseId = request.evse_id;
  let profile: Record<string, unknown> | undefined;
  if (request.profile) {
    const { id, schedule } = request.profile;
    if (schedule.purpose !== 'tx' || schedule.transaction_id !== undefined) {
      throw new Error('profile_invalid: the profile of a remote start is a tx profile, without a transaction id');
    }
    profile = writeProfile({ ...schedule, evse_id: evseId ?? 0 }, version, id);
  }
  if (version === '1.6') {
    if (request.id_token_type !== 'idTag') throw new Error(`id_token_type_invalid: an OCPP 1.6 token is an idTag, not ${request.id_token_type}`);
    return {
      action: COMMAND_ACTIONS.start[version],
      payload: { ...(evseId !== undefined ? { connectorId: evseId } : {}), idTag: request.id_token, ...(profile ? { chargingProfile: profile } : {}) },
    };
  }
  if (request.remote_start_id === undefined) throw new Error(`remote_start_id_required: OCPP ${version} names a remote start by a number`);
  return {
    action: COMMAND_ACTIONS.start[version],
    payload: {
      ...(evseId !== undefined ? { evseId } : {}),
      remoteStartId: request.remote_start_id,
      idToken: { idToken: request.id_token, type: request.id_token_type },
      ...(profile ? { chargingProfile: profile } : {}),
    },
  };
}

/** The session a RemoteStartTransaction (1.6) or RequestStartTransaction (2.0.1, 2.1) payload asks for. */
export function readRemoteStart(payload: Record<string, unknown>, version: OcppVersion): StartRequest {
  const evseRaw = version === '1.6' ? payload.connectorId : payload.evseId;
  const evseId = evseRaw !== undefined ? num(evseRaw, version === '1.6' ? 'connectorId' : 'evseId') : undefined;
  const token = version === '1.6' ? null : obj(payload.idToken, 'idToken');
  const profile = payload.chargingProfile !== undefined ? readProfile(payload.chargingProfile, version, evseId ?? 0) : null;
  return {
    ...(evseId !== undefined ? { evse_id: evseId } : {}),
    id_token: token ? req(token.idToken, 'idToken.idToken') : req(payload.idTag, 'idTag'),
    id_token_type: token ? req(token.type, 'idToken.type') : 'idTag',
    ...(version !== '1.6' ? { remote_start_id: num(payload.remoteStartId, 'remoteStartId') } : {}),
    ...(profile ? { profile: { id: profile.profileId, schedule: withoutEvse(profile.schedule) } } : {}),
  };
}

/** The call that asks a station to stop a transaction. Refuses `transaction_id_invalid` (a 1.6 transaction id is an integer). */
export function writeRemoteStop(transactionId: string, version: OcppVersion): { action: string; payload: Record<string, unknown> } {
  if (version === '1.6' && !/^\d+$/.test(transactionId)) {
    throw new Error(`transaction_id_invalid: an OCPP 1.6 transaction id is an integer, not ${transactionId}`);
  }
  return { action: COMMAND_ACTIONS.stop[version], payload: { transactionId: version === '1.6' ? Number(transactionId) : transactionId } };
}

/** The transaction a RemoteStopTransaction (1.6) or RequestStopTransaction (2.0.1, 2.1) payload asks to stop. */
export function readRemoteStop(payload: Record<string, unknown>, version: OcppVersion): { transaction_id: string } {
  return { transaction_id: version === '1.6' ? String(num(payload.transactionId, 'transactionId')) : req(payload.transactionId, 'transactionId') };
}

// ---------------------------------------------------------------------------
// A recorded log of a station
// ---------------------------------------------------------------------------

export interface LogEntry {
  /** The frame as sent on the wire, text or array. */
  frame: string | unknown[];
}

export interface StationLog {
  identity: StationIdentity | null;
  states: ConnectorState[];
  /** Readings of MeterValues, StopTransaction and TransactionEvent, each with the EVSE it came from (0: the station) and its transaction when known. */
  readings: (Reading & { evseId: number; transactionId: string | null })[];
  /** One per transaction, every message of it folded in order. */
  sessions: SessionRecord[];
  /** The profiles asked, each with what the station answered (`failure` null when accepted, undefined when no answer was logged). */
  profiles: { profileId: number; schedule: Schedule; failure?: string | null }[];
  /**
   * The sessions asked to start or stop from afar, in order, each with what
   * the station answered (`failure` as for a profile) and the transaction
   * it concerns: the one stopped, or the one started when the protocol
   * says it — from 2.0.1, the answer or the TransactionEvent carrying the
   * remote start id; 1.6 never links them (null).
   */
  commands: { command: 'start' | 'stop'; start?: StartRequest; transaction_id: string | null; failure?: string | null }[];
}

/**
 * Reads the frames a station and its central system exchanged, in order:
 * a call is paired with its result by its id, so that a 1.6 transaction
 * gets the id the central system gave it.
 */
export function readStationLog(entries: LogEntry[], version: OcppVersion): StationLog {
  const frames = entries.map((e) => readFrame(e.frame));
  const answers = new Map<string, Frame>();
  for (const f of frames) if (f.type !== 'call') answers.set(f.id, f);
  const log: StationLog = { identity: null, states: [], readings: [], sessions: [], profiles: [], commands: [] };
  const remoteStarts = new Map<number, string>();
  const sessions = new Map<string, SessionRecord>();
  const fold = (s: SessionRecord) => {
    const known = sessions.get(s.transaction_id);
    if (!known) {
      sessions.set(s.transaction_id, s);
      return;
    }
    const peak = Math.max(known.peak_power_kw ?? 0, s.peak_power_kw ?? 0);
    const merged: SessionRecord = { ...known, ...s, metadata: { ...known.metadata, ...s.metadata } };
    if (peak > 0) merged.peak_power_kw = peak;
    const m = merged.metadata!;
    if (merged.energy_kwh === undefined && m.meter_start_wh !== undefined && m.meter_stop_wh !== undefined) {
      merged.energy_kwh = round((m.meter_stop_wh - m.meter_start_wh) / 1000);
    }
    sessions.set(s.transaction_id, merged);
  };
  for (const f of frames) {
    if (f.type !== 'call') continue;
    const result = answers.get(f.id);
    switch (f.action) {
      case 'BootNotification':
        log.identity = readBootNotification(f.payload, version);
        break;
      case 'StatusNotification':
        log.states.push(readStatusNotification(f.payload, version));
        break;
      case 'MeterValues': {
        const evseId = num(version === '1.6' ? f.payload.connectorId : f.payload.evseId, 'evseId');
        const tx = f.payload.transactionId !== undefined ? String(f.payload.transactionId) : null;
        for (const r of readMeterValues(f.payload.meterValue, version)) log.readings.push({ ...r, evseId, transactionId: tx });
        if (tx) {
          const peak = peakKw(readMeterValues(f.payload.meterValue, version));
          if (peak !== null) fold({ transaction_id: tx, peak_power_kw: peak });
        }
        break;
      }
      case 'StartTransaction':
        if (result?.type === 'result') fold(readStartTransaction(f.payload, result.payload));
        break;
      case 'StopTransaction': {
        const tx = String(f.payload.transactionId);
        fold(readStopTransaction(f.payload, sessions.get(tx)?.metadata?.meter_start_wh));
        const evseId = sessions.get(tx)?.evse_id ?? 0;
        for (const r of readMeterValues(f.payload.transactionData, version)) log.readings.push({ ...r, evseId, transactionId: tx });
        break;
      }
      case 'TransactionEvent': {
        const s = readTransactionEvent(f.payload);
        const info = obj(f.payload.transactionInfo, 'transactionInfo');
        if (info.remoteStartId !== undefined) remoteStarts.set(num(info.remoteStartId, 'transactionInfo.remoteStartId'), s.transaction_id);
        fold(s);
        const evseId = sessions.get(s.transaction_id)?.evse_id ?? 0;
        for (const r of readMeterValues(f.payload.meterValue, version)) log.readings.push({ ...r, evseId, transactionId: s.transaction_id });
        break;
      }
      case 'SetChargingProfile': {
        const { profileId, schedule } = readSetChargingProfile(f.payload, version);
        log.profiles.push({ profileId, schedule, ...(result ? { failure: readAnswer(result).failure } : {}) });
        break;
      }
      case COMMAND_ACTIONS.start[version]: {
        const start = readRemoteStart(f.payload, version);
        const given = result?.type === 'result' ? str(result.payload.transactionId) : null;
        log.commands.push({ command: 'start', start, transaction_id: given, ...(result ? { failure: readAnswer(result).failure } : {}) });
        break;
      }
      case COMMAND_ACTIONS.stop[version]:
        log.commands.push({ command: 'stop', ...readRemoteStop(f.payload, version), ...(result ? { failure: readAnswer(result).failure } : {}) });
        break;
      default:
        break;
    }
  }
  log.sessions = [...sessions.values()];
  for (const c of log.commands) {
    if (c.command === 'start' && c.transaction_id === null && c.start?.remote_start_id !== undefined) {
      c.transaction_id = remoteStarts.get(c.start.remote_start_id) ?? null;
    }
  }
  return log;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function obj(v: unknown, field: string): Record<string, unknown> {
  if (!isObject(v)) throw new Error(`field_required: ${field}`);
  return v;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
function req(v: unknown, field: string): string {
  const s = typeof v === 'number' ? String(v) : str(v);
  if (s === null) throw new Error(`field_required: ${field}`);
  return s;
}
function num(v: unknown, field: string): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`field_required: ${field} as a number`);
  return n;
}
function withoutEvse(schedule: Schedule): Omit<Schedule, 'evse_id'> {
  const { evse_id: _evse, ...rest } = schedule;
  return rest;
}
function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
function inWh(r: Reading): number {
  return r.unit === 'kWh' ? r.value * 1000 : r.value;
}
/** The greatest active power imported of a set of readings, in kW, all phases together; null when none. */
function peakKw(readings: Reading[]): number | null {
  const power = readings.filter((r) => r.measurand === 'Power.Active.Import' && r.phase === null);
  if (!power.length) return null;
  return round(Math.max(...power.map((r) => (r.unit === 'kW' ? r.value : r.value / 1000))));
}

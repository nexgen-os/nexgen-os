// The Open Charge Point Protocol (OCPP), versions 1.6J and 2.0.1, read into
// plain shapes: the identity of a station, the state of its connectors, the
// values its meters sample, its charging sessions, and the charging
// profiles it is asked to keep, with the answers it gives.
//
// OCPP-J carries JSON frames over a WebSocket between a charging station
// and its central system (CSMS): a call `[2, id, action, payload]`, its
// result `[3, id, payload]` or its error `[4, id, code, description,
// details]`. The payloads follow the JSON schemas the Open Charge Alliance
// publishes with each version; the types below are written from them and
// keep their field names.
//
// Everything here is a pure function: no connection, no clock, no database.
// A value is read in the unit the station says, scaled only as the protocol
// defines (the `multiplier` of 2.0.1); a register stays a register.

export type OcppVersion = '1.6' | '2.0.1';

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
  /** Why it booted (2.0.1 only). */
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
 * The state of a connector, in one vocabulary for both versions: the 1.6
 * statuses, and the 2.0.1 connector statuses (`Available`, `Occupied`,
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
  /** The error a 1.6 station states (`NoError` when none); null in 2.0.1. */
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

/** A 2.0.1 TransactionEvent request: started, updated or ended, with what its meter values say. */
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

/** What a charging profile limits, in one vocabulary for both versions. */
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
  const purpose = PURPOSES[version][schedule.purpose];
  if (!purpose) throw new Error(`purpose_unsupported: OCPP ${version} has no profile purpose for ${schedule.purpose}`);
  const periods = schedule.periods.map((p) => ({ startPeriod: p.start_s, limit: p.limit, ...(p.phases !== undefined ? { numberPhases: p.phases } : {}) }));
  const chargingSchedule = {
    ...(version === '2.0.1' ? { id: profileId } : {}),
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
  if (version === '1.6') return { connectorId: schedule.evse_id, csChargingProfiles: { ...profile, chargingSchedule } };
  return { evseId: schedule.evse_id, chargingProfile: { ...profile, chargingSchedule: [chargingSchedule] } };
}

/** The schedule a SetChargingProfile request asks for, and the number of the profile. */
export function readSetChargingProfile(request: Record<string, unknown>, version: OcppVersion): { profileId: number; schedule: Schedule } {
  const profile = obj(version === '1.6' ? request.csChargingProfiles : request.chargingProfile, 'chargingProfile');
  const raw = version === '1.6' ? profile.chargingSchedule : Array.isArray(profile.chargingSchedule) ? profile.chargingSchedule[0] : undefined;
  const cs = obj(raw, 'chargingSchedule');
  const purposeWord = req(profile.chargingProfilePurpose, 'chargingProfilePurpose');
  const purpose = (Object.entries(PURPOSES[version]).find(([, w]) => w === purposeWord)?.[0] ?? null) as ProfilePurpose | null;
  if (!purpose) throw new Error(`purpose_unsupported: ${purposeWord} is not a profile purpose of OCPP ${version}`);
  const kindWord = req(profile.chargingProfileKind, 'chargingProfileKind');
  const kind = (Object.entries(KINDS).find(([, w]) => w === kindWord)?.[0] ?? null) as Schedule['kind'] | null;
  if (!kind) throw new Error(`kind_unknown: ${kindWord} is not a profile kind`);
  const recurrencyWord = str(profile.recurrencyKind);
  const recurrency = recurrencyWord ? ((Object.entries(RECURRENCIES).find(([, w]) => w === recurrencyWord)?.[0] ?? undefined) as Schedule['recurrency']) : undefined;
  const unit = req(cs.chargingRateUnit, 'chargingRateUnit');
  if (unit !== 'W' && unit !== 'A') throw new Error(`rate_unit_invalid: ${unit} is not W or A`);
  const periods = Array.isArray(cs.chargingSchedulePeriod) ? cs.chargingSchedulePeriod.map((p) => {
    const o = obj(p, 'chargingSchedulePeriod');
    return { start_s: num(o.startPeriod, 'startPeriod'), limit: num(o.limit, 'limit'), ...(o.numberPhases !== undefined ? { phases: num(o.numberPhases, 'numberPhases') } : {}) };
  }) : [];
  const schedule: Schedule = {
    evse_id: num(version === '1.6' ? request.connectorId : request.evseId, version === '1.6' ? 'connectorId' : 'evseId'),
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
 * What a station's answer to a SetChargingProfile means for the command
 * that asked it: accepted (no failure), or failed and why — rejected, not
 * supported, an error frame, or no answer at all (`null`), which is a
 * timeout.
 */
export function readProfileAnswer(answer: Frame | null): { failure: string | null } {
  if (answer === null) return { failure: 'timeout: the station did not answer' };
  if (answer.type === 'error') return { failure: `error: ${answer.code}${answer.description ? ` (${answer.description})` : ''}` };
  if (answer.type !== 'result') return { failure: 'error: the answer is not a result' };
  const status = str(answer.payload.status);
  if (status === 'Accepted') return { failure: null };
  const info = isObject(answer.payload.statusInfo) ? str(answer.payload.statusInfo.reasonCode) : null;
  return { failure: `${(status ?? 'unknown').toLowerCase()}${info ? `: ${info}` : ''}` };
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
  const log: StationLog = { identity: null, states: [], readings: [], sessions: [], profiles: [] };
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
        fold(s);
        const evseId = sessions.get(s.transaction_id)?.evse_id ?? 0;
        for (const r of readMeterValues(f.payload.meterValue, version)) log.readings.push({ ...r, evseId, transactionId: s.transaction_id });
        break;
      }
      case 'SetChargingProfile': {
        const { profileId, schedule } = readSetChargingProfile(f.payload, version);
        log.profiles.push({ profileId, schedule, ...(result ? { failure: readProfileAnswer(result).failure } : {}) });
        break;
      }
      default:
        break;
    }
  }
  log.sessions = [...sessions.values()];
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

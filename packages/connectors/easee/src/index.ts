// Easee — https://easee.com, charging stations reported to their maker's
// cloud, read on its public REST API (https://developer.easee.com) with the
// account of the charger's owner. Source `easee`, shipped with the package.
//
// Three reads, in the core's terms:
//
// - `chargers()`: the chargers the account reaches (`GET /api/chargers`),
//   each by the id the cloud knows it by, its serial number;
// - `observations({ chargerId, from, to })`: the history of what the charger
//   observed (`GET /api/chargers/{id}/observations/{observation}/{from}/{to}`)
//   for the observations of `OBSERVATIONS`: its lifetime energy register
//   (`consumption_energy`, cumulative, kWh) and the power it delivered
//   (`consumption_power`, kW), each value at its own stamp;
// - `sessions({ chargerId, from, to })`: its charging sessions
//   (`GET /api/sessions/charger/{id}/sessions/{from}/{to}`), each as the
//   record `charging.record()` takes.
//
// `collectEasee()` writes a window on a charger described in
// `charging.devices`: the sessions through `charging.record()` (source
// `station`, the charger's serial as `source_ref`), once per session id, and
// the series through `storeSeries()`; a second collection of the same window
// changes nothing.
//
// The cloud limits how often it is asked (two lists of chargers a minute, ten
// lists of sessions an hour): a collection asks each endpoint once per
// charger and window, and a refusal for asking too often is named
// (`source_rate_limited`), never retried here.
//
// Left out, on purpose: the price and the cost of a session (a price is the
// data of a contract, not of the station), the signed payload of a session
// (OCMF, kept by Easee), the operation mode, schedules and settings.
// Commands (start, stop, a current limit) wait for the device connector
// contract of the core, through which a person's validated command is
// carried.
//
// Nothing here reads the environment or the database: the account comes
// from the secret the organisation's `connectors` row names, resolved by the
// installation's vault.

import { readFileSync } from 'node:fs';
import { GestureError, storeSeries, type CollectedSeries, type Db, type SourceRow } from '@nexgen-os/core';

/** The subset of `fetch` the connector uses, so a test or a proxy can stand in. */
export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface EaseeOptions {
  /** The account of the charger's owner, from the secret of the `connectors` row. */
  username: string;
  password: string;
  /** `https://api.easee.com` by default. */
  baseUrl?: string;
  fetch?: HttpFetch;
  /** The clock, in UTC milliseconds, by which the access token expires; `Date.now` by default. */
  now?: () => number;
}

/** A charger as the cloud lists it. */
export interface EaseeCharger {
  /** Its serial number: the id the other calls take. */
  id: string;
  name: string | null;
}

/** The observations read into series: their id in the cloud, the quantity, its kind and the unit the cloud gives. */
export const OBSERVATIONS: Record<number, { quantity: string; value_kind: 'cumulative' | 'instant'; unit: string }> = {
  124: { quantity: 'consumption_energy', value_kind: 'cumulative', unit: 'KiloW-HR' },
  120: { quantity: 'consumption_power', value_kind: 'instant', unit: 'KiloW' },
};

/** A session in the shape `charging.record()` takes. */
export interface EaseeSessionRecord {
  /** The session's id in the cloud. */
  transaction_id: string;
  /** When the car was connected, and disconnected (absent while it is). */
  started_at: string;
  ended_at?: string;
  energy_kwh: number | null;
  /** The token the station read (an RFID card), as given: it may name a person. */
  id_token?: string;
  metadata: {
    /** When energy started and stopped flowing, inside the connection. */
    energy_from: string | null;
    energy_to: string | null;
    /** How long energy flowed, in seconds. */
    charging_s: number | null;
    complete: boolean;
  };
}

export interface EaseeReadings {
  series: CollectedSeries[];
  /** Values left out, with the observation and the name of the reason. */
  skipped: { observation: number; at: unknown; reason: string }[];
}

export interface EaseeSessions {
  sessions: EaseeSessionRecord[];
  skipped: { session: string; reason: string }[];
}

export interface EaseeConnector {
  readonly source_code: 'easee';
  chargers(): Promise<EaseeCharger[]>;
  /** The history of the observations of `OBSERVATIONS` from `from` to `to`, ISO 8601. */
  observations(request: { chargerId: string; from: string; to: string }): Promise<EaseeReadings>;
  /** The sessions of a charger from `from` to `to`, ISO 8601. */
  sessions(request: { chargerId: string; from: string; to: string }): Promise<EaseeSessions>;
}

/** A connector on the cloud API of Easee, with the account of the charger's owner. `source_code` is `easee`. */
export function easee(options: EaseeOptions): EaseeConnector {
  if (!options.username || !options.password) throw new GestureError('secret_not_found: easee needs the account of the charger\'s owner (the secret of its connectors row)');
  const base = (options.baseUrl ?? 'https://api.easee.com').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as HttpFetch);
  const now = options.now ?? Date.now;
  let token: { value: string; refresh: string | null; expires: number } | null = null;

  const send = async (path: string, init: Parameters<HttpFetch>[1]): Promise<Awaited<ReturnType<HttpFetch>>> => {
    try {
      return await doFetch(`${base}${path}`, init);
    } catch (error) {
      throw new GestureError(`source_unavailable: easee does not answer on ${path}: ${(error as Error).message}`);
    }
  };
  const refused = async (response: Awaited<ReturnType<HttpFetch>>, path: string): Promise<never> => {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    if (response.status === 429) throw new GestureError(`source_rate_limited: easee asks to wait before ${path} again: ${detail}`);
    if (response.status === 401 || response.status === 403 || (response.status === 400 && path.startsWith('/api/accounts/'))) {
      throw new GestureError(`source_unauthorised: easee ${response.status} on ${path}: ${detail}`);
    }
    throw new GestureError(`source_unavailable: easee ${response.status} on ${path}: ${detail}`);
  };
  const post = (path: string, body: unknown) =>
    send(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });

  const signIn = async (): Promise<string> => {
    let response = token?.refresh ? await post('/api/accounts/refresh_token', { refreshToken: token.refresh }) : null;
    // A refresh token refused or absent: signed in again.
    if (!response || !response.ok) response = await post('/api/accounts/login', { userName: options.username, password: options.password });
    if (!response.ok) return refused(response, '/api/accounts/login');
    const r = (await response.json()) as { accessToken?: unknown; expiresIn?: unknown; refreshToken?: unknown };
    if (typeof r.accessToken !== 'string' || !r.accessToken) throw new GestureError('source_unauthorised: easee gave no access token');
    // Renewed a minute before it expires.
    const lifetime = typeof r.expiresIn === 'number' ? r.expiresIn : 3600;
    token = { value: r.accessToken, refresh: typeof r.refreshToken === 'string' ? r.refreshToken : null, expires: now() + Math.max(lifetime - 60, 0) * 1000 };
    return token.value;
  };
  const accessToken = async () => (token && token.expires > now() ? token.value : signIn());

  const get = async (path: string): Promise<unknown> => {
    const call = async () => send(path, { method: 'GET', headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' } });
    let response = await call();
    // A token revoked before its time: renewed once.
    if (response.status === 401 && token) {
      token.expires = 0;
      response = await call();
    }
    if (!response.ok) return refused(response, path.replace(/\?.*$/, ''));
    return response.json();
  };
  const window = (from: string, to: string) => `${encodeURIComponent(from)}/${encodeURIComponent(to)}`;

  return {
    source_code: 'easee',
    async chargers() {
      const list = (await get('/api/chargers')) as Json[];
      return (Array.isArray(list) ? list : []).map((c) => ({ id: String(c.id), name: text(c.name) }));
    },
    async observations({ chargerId, from, to }) {
      const out: EaseeReadings = { series: [], skipped: [] };
      for (const id of Object.keys(OBSERVATIONS).map(Number)) {
        const history = await get(`/api/chargers/${encodeURIComponent(chargerId)}/observations/${id}/${window(from, to)}`);
        const read = seriesOfEasee(id, history);
        out.series.push(...read.series);
        out.skipped.push(...read.skipped);
      }
      return out;
    },
    async sessions({ chargerId, from, to }) {
      return sessionsOfEasee((await get(`/api/sessions/charger/${encodeURIComponent(chargerId)}/sessions/${window(from, to)}`)) as unknown[]);
    },
  };
}

type Json = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * A stamp of the cloud as ISO 8601 UTC. The cloud dates in UTC; a stamp
 * without an offset is read as UTC. Null when it is not a date.
 */
export function instantOf(stamp: unknown): string | null {
  if (typeof stamp !== 'string' || stamp === '') return null;
  const s = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(stamp) ? stamp : `${stamp}Z`;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * The history of one observation of `OBSERVATIONS` as one series, sorted
 * and once per instant. A value that is not a number is skipped
 * (`value_invalid`), and so is a stamp that is not a date (`stamp_invalid`).
 */
export function seriesOfEasee(observation: number, history: unknown): EaseeReadings {
  const known = OBSERVATIONS[observation];
  if (!known) throw new GestureError(`observation_unknown: easee reads the observations ${Object.keys(OBSERVATIONS).join(', ')}, not ${observation}`);
  const skipped: EaseeReadings['skipped'] = [];
  const values = new Map<string, number>();
  for (const o of Array.isArray(history) ? (history as Json[]) : []) {
    const at = instantOf(o.timestamp);
    if (at === null) {
      skipped.push({ observation, at: o.timestamp, reason: 'stamp_invalid' });
      continue;
    }
    const value = typeof o.value === 'number' ? o.value : typeof o.value === 'string' && o.value.trim() !== '' ? Number(o.value) : NaN;
    if (!Number.isFinite(value)) {
      skipped.push({ observation, at, reason: 'value_invalid' });
      continue;
    }
    values.set(at, value);
  }
  const points = [...values].sort(([a], [b]) => a.localeCompare(b)).map(([at, value]) => ({ at, value }));
  return {
    series: points.length ? [{ quantity_code: known.quantity, value_kind: known.value_kind, step: null, unit: known.unit, name: null, values: points }] : [],
    skipped,
  };
}

/**
 * Sessions of `GET /api/sessions/charger/{id}/sessions/{from}/{to}` as
 * records: started when the car was connected, ended when it was
 * disconnected. A session without an id or a start is skipped
 * (`stamp_invalid`).
 */
export function sessionsOfEasee(sessions: unknown[]): EaseeSessions {
  const out: EaseeSessions = { sessions: [], skipped: [] };
  for (const s of (Array.isArray(sessions) ? sessions : []) as Json[]) {
    const id = s.id === undefined || s.id === null ? '' : String(s.id);
    const started = instantOf(s.carConnected);
    if (!id || started === null) {
      out.skipped.push({ session: id, reason: 'stamp_invalid' });
      continue;
    }
    const ended = instantOf(s.carDisconnected);
    const record: EaseeSessionRecord = {
      transaction_id: id,
      started_at: started,
      energy_kwh: typeof s.kiloWattHours === 'number' && Number.isFinite(s.kiloWattHours) ? s.kiloWattHours : null,
      metadata: {
        energy_from: instantOf(s.firstEnergyTransferPeriodStarted),
        energy_to: instantOf(s.lastEnergyTransferPeriodEnd),
        charging_s: typeof s.actualDurationSeconds === 'number' ? s.actualDurationSeconds : null,
        complete: s.isComplete === true,
      },
    };
    if (ended !== null) record.ended_at = ended;
    const tokenRead = text(s.authToken);
    if (tokenRead) record.id_token = tokenRead;
    out.sessions.push(record);
  }
  return out;
}

export interface CollectedEasee {
  /** The sessions recorded, by id in `charging.sessions`, in the order of the cloud. */
  sessions: string[];
  /** The series of the charger written, with the readings each received. */
  series: { quantity: string; seriesId: string; inserted: number }[];
  skipped: { observations: EaseeReadings['skipped']; sessions: EaseeSessions['skipped'] };
}

/**
 * A window of an Easee charger written on its device described in
 * `charging.devices`: each session once by `charging.record()` (source
 * `station`, `source_ref` the charger's serial), the lifetime energy
 * register and the power as `measured` series of the device, source `easee`.
 * Refuses as `charging.record()` does (`charger_not_described`).
 */
export async function collectEasee(
  db: Db,
  connector: Pick<EaseeConnector, 'observations' | 'sessions'>,
  request: { organisationId: string; deviceId: string; chargerId: string; from: string; to: string },
): Promise<CollectedEasee> {
  const window = { chargerId: request.chargerId, from: request.from, to: request.to };
  const sessions = await connector.sessions(window);
  const recorded: string[] = [];
  for (const s of sessions.sessions) {
    const r = await db.query<{ id: string }>('select charging.record($1, $2::jsonb, $3, $4) id', [request.deviceId, JSON.stringify(s), 'station', request.chargerId]);
    recorded.push(r.rows[0]!.id);
  }
  const readings = await connector.observations(window);
  const series: CollectedEasee['series'] = [];
  for (const s of readings.series) {
    const stored = await storeSeries(db, { organisationId: request.organisationId, objectKind: 'device', objectId: request.deviceId, sourceCode: 'easee', kind: 'measured' }, s);
    series.push({ quantity: s.quantity_code, ...stored });
  }
  return { sessions: recorded, series, skipped: { observations: readings.skipped, sessions: sessions.skipped } };
}

/** The `sources` row this package ships (`source.json`): write it with `registerSource()`. */
export const easeeSource: SourceRow = JSON.parse(readFileSync(new URL('../source.json', import.meta.url), 'utf8')) as SourceRow;

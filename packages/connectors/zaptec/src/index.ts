// Zaptec — https://zaptec.com, charging stations reported to their maker's
// cloud, read on its public REST API (https://api.zaptec.com/help/index.html)
// with the account of the charger's owner. Source `zaptec`, shipped with the
// package.
//
// Three reads, in the core's terms:
//
// - `chargers()`: the chargers the account reaches (`GET /api/chargers`),
//   each with the id the cloud knows it by, which the organisation's
//   `connectors` row or the device keeps;
// - `state(chargerId)`: what a charger reported last
//   (`GET /api/chargers/{id}/state`), each value at its own stamp: the
//   power it delivers (`consumption_power`, W), the voltage and the current
//   of each phase (`voltage`, V; `current`, A, the quantity of the
//   `charging` module), and its operation mode;
// - `sessions({ chargerId, from, to })`: the completed sessions that ended in
//   the window (`GET /api/sessions/archived`, every page of its cursor),
//   each as the record `charging.record()` takes and as the readings of the
//   energy it delivered, a register counted from zero at the start of the
//   session (`consumption_energy`, cumulative, kWh). The core reads a
//   register that falls back as a reset, so the sessions of a charger make
//   one series: `resample()` gives the energy of each hour or day.
//
// `collectZaptecSessions()` writes a window of sessions on a charger
// described in `charging.devices`: the sessions through `charging.record()`
// (source `station`, the charger's serial as `source_ref`), once per session
// id, and the energy through `storeSeries()`; a second collection of the
// same window changes nothing.
//
// Left out, on purpose: the user who authorised a session (a person's name
// and e-mail: the token name the station read is kept, as for OCPP), the
// signed payloads of a session (OCMF, kept by Zaptec; `signed` says there is
// one), the price of energy, the installation's settings. Commands (stop,
// resume, a current limit) wait for the device connector contract of the
// core, through which a person's validated command is carried.
//
// Nothing here reads the environment or the database: the account comes
// from the secret the organisation's `connectors` row names, resolved by the
// installation's vault.

import { readFileSync } from 'node:fs';
import { GestureError, storeSeries, type CollectedSeries, type Db, type SeriesPoint, type SourceRow } from '@nexgen-os/core';

/** The subset of `fetch` the connector uses, so a test or a proxy can stand in. */
export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface ZaptecOptions {
  /** The account of the charger's owner (or of a service partner it granted), from the secret of the `connectors` row. */
  username: string;
  password: string;
  /** `https://api.zaptec.com` by default. */
  baseUrl?: string;
  fetch?: HttpFetch;
  /** The clock, in UTC milliseconds, by which the access token expires; `Date.now` by default. */
  now?: () => number;
}

/** A charger as the cloud lists it. */
export interface ZaptecCharger {
  /** The id the cloud knows the charger by: what `state()` and `sessions()` take. */
  id: string;
  /** The serial number of the station. */
  device_id: string | null;
  name: string | null;
  installation_id: string | null;
  installation_name: string | null;
  active: boolean;
  online: boolean | null;
}

/** The operation modes a charger reports (observation 710), in words. */
export const OPERATION_MODES: Record<number, string> = {
  0: 'unknown',
  1: 'disconnected',
  2: 'connected_requesting',
  3: 'connected_charging',
  5: 'connected_finished',
};

/** The observations read into series: their id in the cloud's constants, the quantity, the unit and the name that tells phases apart. */
export const OBSERVATIONS: Record<number, { quantity: string; unit: string; name: string | null }> = {
  513: { quantity: 'consumption_power', unit: 'W', name: null },
  501: { quantity: 'voltage', unit: 'V', name: 'L1' },
  502: { quantity: 'voltage', unit: 'V', name: 'L2' },
  503: { quantity: 'voltage', unit: 'V', name: 'L3' },
  507: { quantity: 'current', unit: 'A', name: 'L1' },
  508: { quantity: 'current', unit: 'A', name: 'L2' },
  509: { quantity: 'current', unit: 'A', name: 'L3' },
};

const OPERATION_MODE = 710;

/** What a charger reported last. */
export interface ZaptecState {
  /** Its operation mode, a word of `OPERATION_MODES`, and when it was reported. */
  operation_mode: { mode: string; at: string } | null;
  /** One series per observation, with the one value it reported, at its own stamp. */
  series: CollectedSeries[];
  skipped: { observation: number; reason: string }[];
}

/** A session in the shape `charging.record()` takes. */
export interface ZaptecSessionRecord {
  /** The session's id in the cloud. */
  transaction_id: string;
  started_at: string;
  ended_at: string;
  energy_kwh: number | null;
  /** The name of the token the station read, as given: it may name a person. */
  id_token?: string;
  metadata: {
    /** The serial number of the station that delivered it. */
    device_id: string | null;
    installation_id: string | null;
    /** The transaction id of a third party that authorised it (OCPP), when there is one. */
    external_id: string | null;
    firmware: string | null;
    /** Recorded while the station was offline; its stamps are its own clock's, trusted or not. */
    offline: boolean;
    reliable_clock: boolean;
    /** Zaptec keeps a signed payload (OCMF) of the session. */
    signed: boolean;
    /** Unplugged before charging started. */
    aborted: boolean;
    stopped_by_rfid: boolean;
  };
}

export interface ZaptecSession {
  record: ZaptecSessionRecord;
  /** The energy delivered, a register from zero at the start of the session, kWh; empty when its stamps cannot be trusted. */
  energy: SeriesPoint[];
}

export interface ZaptecSessions {
  sessions: ZaptecSession[];
  /** Sessions or readings left out, with the name of the reason. */
  skipped: { session: string; reason: string }[];
}

export interface ZaptecConnector {
  readonly source_code: 'zaptec';
  /** Every charger the account reaches, page after page. */
  chargers(): Promise<ZaptecCharger[]>;
  /** What a charger reported last. */
  state(chargerId: string): Promise<ZaptecState>;
  /** The sessions of a charger that ended from `from` (included) to `to` (excluded), ISO 8601. */
  sessions(request: { chargerId: string; from: string; to: string }): Promise<ZaptecSessions>;
}

const PAGE_SIZE = 100;
const SESSIONS_PAGE_SIZE = 200;

/** A connector on the cloud API of Zaptec, with the account of the charger's owner. `source_code` is `zaptec`. */
export function zaptec(options: ZaptecOptions): ZaptecConnector {
  if (!options.username || !options.password) throw new GestureError('secret_not_found: zaptec needs the account of the charger\'s owner (the secret of its connectors row)');
  const base = (options.baseUrl ?? 'https://api.zaptec.com').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as HttpFetch);
  const now = options.now ?? Date.now;
  let token: { value: string; expires: number } | null = null;

  const send = async (path: string, init: Parameters<HttpFetch>[1]): Promise<Awaited<ReturnType<HttpFetch>>> => {
    try {
      return await doFetch(`${base}${path}`, init);
    } catch (error) {
      throw new GestureError(`source_unavailable: zaptec does not answer on ${path}: ${(error as Error).message}`);
    }
  };
  const refused = async (response: Awaited<ReturnType<HttpFetch>>, path: string): Promise<never> => {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    if (response.status === 400 && path === '/oauth/token') throw new GestureError(`source_unauthorised: zaptec refuses the account: ${detail}`);
    if (response.status === 401 || response.status === 403) throw new GestureError(`source_unauthorised: zaptec ${response.status} on ${path}: ${detail}`);
    throw new GestureError(`source_unavailable: zaptec ${response.status} on ${path}: ${detail}`);
  };

  const accessToken = async (): Promise<string> => {
    if (token && token.expires > now()) return token.value;
    const body = new URLSearchParams({ grant_type: 'password', username: options.username, password: options.password }).toString();
    const response = await send('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
    if (!response.ok) return refused(response, '/oauth/token');
    const r = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof r.access_token !== 'string' || !r.access_token) throw new GestureError('source_unauthorised: zaptec gave no access token');
    // Renewed a minute before it expires.
    const lifetime = typeof r.expires_in === 'number' ? r.expires_in : 3600;
    token = { value: r.access_token, expires: now() + Math.max(lifetime - 60, 0) * 1000 };
    return token.value;
  };

  const get = async (path: string, query: Record<string, string | number | undefined> = {}): Promise<unknown> => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
    const url = params.toString() ? `${path}?${params}` : path;
    const call = async () => send(url, { method: 'GET', headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' } });
    let response = await call();
    // A token revoked before its time: asked again once.
    if (response.status === 401) {
      token = null;
      response = await call();
    }
    if (!response.ok) return refused(response, path);
    return response.json();
  };

  return {
    source_code: 'zaptec',
    async chargers() {
      const out: ZaptecCharger[] = [];
      for (let page = 0; ; page++) {
        const r = (await get('/api/chargers', { PageSize: PAGE_SIZE, PageIndex: page })) as { pages?: number; data?: Json[] };
        for (const c of r.data ?? []) out.push(chargerOf(c));
        if (!r.data?.length || page + 1 >= (r.pages ?? 1)) return out;
      }
    },
    async state(chargerId) {
      return stateOfZaptec(await get(`/api/chargers/${encodeURIComponent(chargerId)}/state`));
    },
    async sessions({ chargerId, from, to }) {
      const all: ZaptecSessions = { sessions: [], skipped: [] };
      let cursor: string | undefined;
      do {
        const r = (await get('/api/sessions/archived', { chargerId, from, to, pageSize: SESSIONS_PAGE_SIZE, cursor })) as { sessions?: unknown[]; cursor?: string | null; hasMore?: boolean };
        const page = sessionsOfZaptec(r.sessions ?? []);
        all.sessions.push(...page.sessions);
        all.skipped.push(...page.skipped);
        cursor = r.hasMore && r.cursor ? r.cursor : undefined;
      } while (cursor);
      return all;
    },
  };
}

type Json = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function chargerOf(c: Json): ZaptecCharger {
  return {
    id: String(c.id),
    device_id: text(c.deviceId),
    name: text(c.name),
    installation_id: text(c.installationId),
    installation_name: text(c.installationName),
    active: c.active !== false,
    online: typeof c.isOnline === 'boolean' ? c.isOnline : null,
  };
}

/**
 * A stamp of the cloud as ISO 8601 UTC. The cloud dates in UTC, and some of
 * its answers leave the offset out: a stamp without one is read as UTC.
 * Null when it is not a date.
 */
export function instantOf(stamp: unknown): string | null {
  if (typeof stamp !== 'string' || stamp === '') return null;
  const s = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(stamp) ? stamp : `${stamp}Z`;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** An answer of `GET /api/chargers/{id}/state` in the core's terms: the observations of `OBSERVATIONS` as series, the operation mode in words. */
export function stateOfZaptec(observations: unknown): ZaptecState {
  const state: ZaptecState = { operation_mode: null, series: [], skipped: [] };
  for (const o of Array.isArray(observations) ? (observations as Json[]) : []) {
    const id = Number(o.stateId);
    const known = OBSERVATIONS[id];
    if (!known && id !== OPERATION_MODE) continue;
    const at = instantOf(o.timestamp);
    if (at === null) {
      state.skipped.push({ observation: id, reason: 'stamp_invalid' });
      continue;
    }
    const value = Number(o.valueAsString);
    if (o.valueAsString === null || o.valueAsString === undefined || o.valueAsString === '' || !Number.isFinite(value)) {
      state.skipped.push({ observation: id, reason: 'value_invalid' });
      continue;
    }
    if (id === OPERATION_MODE) {
      state.operation_mode = { mode: OPERATION_MODES[value] ?? 'unknown', at };
      continue;
    }
    state.series.push({ quantity_code: known!.quantity, value_kind: 'instant', step: null, unit: known!.unit, name: known!.name, values: [{ at, value }] });
  }
  return state;
}

/**
 * Sessions of `GET /api/sessions/archived` as records and energy readings.
 * A voided session (replaced by a corrected one) is skipped
 * (`voided`), and so is a session whose start or end is not a date
 * (`stamp_invalid`). An offline session on a clock the station did not
 * trust keeps its record, never its readings (`clock_unreliable`); a reading
 * below the one before it is skipped (`value_invalid`).
 */
export function sessionsOfZaptec(archived: unknown[]): ZaptecSessions {
  const out: ZaptecSessions = { sessions: [], skipped: [] };
  for (const s of archived as Json[]) {
    const id = String(s.id ?? '');
    if (s.voided === true) {
      out.skipped.push({ session: id, reason: 'voided' });
      continue;
    }
    const started = instantOf(s.startDateTime);
    const ended = instantOf(s.endDateTime);
    if (!id || started === null || ended === null) {
      out.skipped.push({ session: id, reason: 'stamp_invalid' });
      continue;
    }
    const energy = typeof s.energy === 'number' && Number.isFinite(s.energy) ? s.energy : null;
    const record: ZaptecSessionRecord = {
      transaction_id: id,
      started_at: started,
      ended_at: ended,
      energy_kwh: energy,
      metadata: {
        device_id: text(s.deviceId),
        installation_id: text(s.installationId),
        external_id: text(s.externalId),
        firmware: text(s.chargerFirmwareVersion),
        offline: s.offline === true,
        reliable_clock: s.reliableClock !== false,
        signed: s.signed === true,
        aborted: s.aborted === true,
        stopped_by_rfid: s.stoppedByRfid === true,
      },
    };
    const tokenName = text(s.tokenName);
    if (tokenName) record.id_token = tokenName;

    if (record.metadata.offline && !record.metadata.reliable_clock) {
      out.skipped.push({ session: id, reason: 'clock_unreliable' });
      out.sessions.push({ record, energy: [] });
      continue;
    }
    // The register starts from zero when the session starts, and ends on the
    // energy of the session when the details stop before it.
    const points = new Map<string, number>([[started, 0]]);
    const details = (Array.isArray(s.energyDetails) ? (s.energyDetails as Json[]) : [])
      .map((d) => ({ at: instantOf(d.timestamp), value: d.energy }))
      .filter((d): d is { at: string; value: number } => d.at !== null && typeof d.value === 'number' && Number.isFinite(d.value))
      .sort((a, b) => a.at.localeCompare(b.at));
    for (const d of details) points.set(d.at, d.value);
    if (energy !== null && !points.has(ended)) points.set(ended, energy);
    let last = -Infinity;
    const readings: SeriesPoint[] = [];
    for (const [at, value] of [...points].sort(([a], [b]) => a.localeCompare(b))) {
      if (at < started || at > ended || value < last) {
        out.skipped.push({ session: id, reason: 'value_invalid' });
        continue;
      }
      readings.push({ at, value });
      last = value;
    }
    out.sessions.push({ record, energy: readings });
  }
  return out;
}

export interface CollectedSessions {
  /** The sessions recorded, by id in `charging.sessions`, in the order of the cloud. */
  sessions: string[];
  /** The energy series of the charger, and the readings it received. */
  energy: { seriesId: string; inserted: number } | null;
  skipped: ZaptecSessions['skipped'];
}

/**
 * The sessions of a Zaptec charger that ended in a window, written on its
 * device described in `charging.devices`: each session once by
 * `charging.record()` (source `station`, `source_ref` the station's serial),
 * the energy as one `consumption_energy` register of the device, `measured`,
 * source `zaptec`. Refuses as `charging.record()` does (`charger_not_described`).
 */
export async function collectZaptecSessions(
  db: Db,
  connector: Pick<ZaptecConnector, 'sessions'>,
  request: { organisationId: string; deviceId: string; chargerId: string; from: string; to: string },
): Promise<CollectedSessions> {
  const read = await connector.sessions({ chargerId: request.chargerId, from: request.from, to: request.to });
  const sessions: string[] = [];
  for (const s of read.sessions) {
    const r = await db.query<{ id: string }>('select charging.record($1, $2::jsonb, $3, $4) id', [
      request.deviceId, JSON.stringify(s.record), 'station', s.record.metadata.device_id,
    ]);
    sessions.push(r.rows[0]!.id);
  }
  // A session that starts at the instant the one before it ended keeps the
  // end of the earlier one: the core counts the next reading below it as a
  // reset, the energy of the new session from zero.
  const byInstant = new Map<string, number>();
  for (const p of read.sessions.flatMap((s) => s.energy)) byInstant.set(p.at, Math.max(byInstant.get(p.at) ?? -Infinity, p.value));
  const values = [...byInstant].sort(([a], [b]) => a.localeCompare(b)).map(([at, value]) => ({ at, value }));
  const energy = values.length
    ? await storeSeries(db, { organisationId: request.organisationId, objectKind: 'device', objectId: request.deviceId, sourceCode: 'zaptec', kind: 'measured' },
      { quantity_code: 'consumption_energy', value_kind: 'cumulative', step: null, unit: 'KiloW-HR', values })
    : null;
  return { sessions, energy, skipped: read.skipped };
}

/** The `sources` row this package ships (`source.json`): write it with `registerSource()`. */
export const zaptecSource: SourceRow = JSON.parse(readFileSync(new URL('../source.json', import.meta.url), 'utf8')) as SourceRow;

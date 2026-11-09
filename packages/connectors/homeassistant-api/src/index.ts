// Home Assistant — https://www.home-assistant.io, a home's local gateway to
// the devices of every brand its integrations reach — as a connector, on its
// WebSocket API (`/api/websocket`; https://developers.home-assistant.io/docs/api/websocket).
// Source `homeassistant`, the one the `building` module registers.
//
// What it does: it opens one connection to an installation, authenticates
// with a long-lived access token, and reads what `@nexgen-os/homeassistant`
// reads from a file — the floors, areas, devices and entities of its
// registries, and the states its recorder kept over a period — as one
// `HaSnapshot`. `readHomeAssistant()` turns the snapshot into plain shapes
// and `importHomeAssistant()` of the `building` module writes them for a
// participant; nothing new is needed between them.
//
//   config/floor_registry/list   → floors   (none before Home Assistant 2024.4)
//   config/area_registry/list    → areas
//   config/device_registry/list  → devices
//   config/entity_registry/list  → entities, with the class, state class and
//   get_states                     unit their current state carries
//   history/history_during_period → states  (or the current ones, without a period)
//
// Nothing here reads the environment or the database: the address and the
// token are given by the caller, the token resolved from the `secret_ref` of
// the organisation's `connectors` row and never stored. It reads only; a
// value asked of a device is a command of the `actions` module.
//
// SPDX-License-Identifier: MIT

import { GestureError } from '@nexgen-os/core';
import type { HaArea, HaDevice, HaEntity, HaFloor, HaSnapshot, HaState } from '@nexgen-os/homeassistant';

/** The part of a WebSocket the connector uses: the standard one of Node 22 and browsers, `ws`, or a test's. */
export interface HaSocket {
  send(data: string): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
}

export type OpenSocket = (url: string) => HaSocket;

export interface HomeAssistantOptions {
  /** The installation's address, `http://homeassistant.local:8123` or `https://…`; its WebSocket is at `/api/websocket`. */
  url: string;
  /** A long-lived access token of a Home Assistant user, resolved by the caller from the connector's `secret_ref`; never stored. */
  token: string;
  /** Opens the socket; default the global `WebSocket` (Node 22 and later). */
  socket?: OpenSocket;
  /** How long one answer may take before `source_timeout`. Default 30 s. */
  timeoutMs?: number;
}

export interface SnapshotRequest {
  /** The entities to read; default every entity of the registry that is not disabled. One the installation does not have is refused, `entity_not_found`. */
  entities?: string[];
  /** The period of the recorder's states, ISO 8601 instants; without `from`, the current state of each entity. */
  from?: string;
  /** Default now. */
  to?: string;
}

/** The WebSocket address of an installation: its scheme turned to `ws`/`wss`, `/api/websocket` added. */
export function websocketUrl(url: string): string {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'ws:' && u.protocol !== 'wss:') {
    throw new GestureError(`invalid_url: homeassistant needs an http(s) address, got ${url}`);
  }
  u.protocol = u.protocol === 'https:' || u.protocol === 'wss:' ? 'wss:' : 'ws:';
  u.pathname = `${u.pathname.replace(/\/+$/, '').replace(/\/api\/websocket$/, '')}/api/websocket`;
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** One authenticated connection; `call()` sends a command and waits for its result. */
export interface HomeAssistantSession {
  /** The version of Home Assistant, as `auth_ok` gives it. */
  version: string | null;
  call<T>(type: string, payload?: Record<string, unknown>): Promise<T>;
  close(): void;
}

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

/** Opens and authenticates a connection: `source_unauthorised` when the token is refused. */
export function connectHomeAssistant(options: HomeAssistantOptions): Promise<HomeAssistantSession> {
  if (!options.token) return Promise.reject(new GestureError('secret_not_found: homeassistant needs the access token its connectors row names'));
  let address: string;
  try {
    address = websocketUrl(options.url);
  } catch (error) {
    return Promise.reject(error as Error);
  }
  const open = options.socket ?? defaultSocket;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pending = new Map<number, Pending>();
  let next = 1;
  let closed = false;

  return new Promise<HomeAssistantSession>((resolveSession, rejectSession) => {
    let ready = false;
    const fail = (error: Error) => {
      if (!ready) rejectSession(error);
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
      pending.clear();
    };
    const authTimer = setTimeout(() => { fail(new GestureError(`source_timeout: homeassistant at ${address} did not authenticate within ${timeoutMs} ms`)); socket.close(); }, timeoutMs);
    const socket = open(address);

    const session: HomeAssistantSession = {
      version: null,
      call<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
        if (closed) return Promise.reject(new GestureError(`source_unavailable: homeassistant connection closed before ${type}`));
        const id = next++;
        return new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new GestureError(`source_timeout: homeassistant gave no answer to ${type} within ${timeoutMs} ms`));
          }, timeoutMs);
          pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
          socket.send(JSON.stringify({ ...payload, id, type }));
        });
      },
      close() {
        closed = true;
        socket.close();
      },
    };

    socket.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (message.type) {
        case 'auth_required':
          socket.send(JSON.stringify({ type: 'auth', access_token: options.token }));
          return;
        case 'auth_ok':
          clearTimeout(authTimer);
          ready = true;
          session.version = typeof message.ha_version === 'string' ? message.ha_version : null;
          resolveSession(session);
          return;
        case 'auth_invalid':
          clearTimeout(authTimer);
          fail(new GestureError(`source_unauthorised: homeassistant refused the token: ${String(message.message ?? 'auth_invalid')}`));
          session.close();
          return;
        case 'result': {
          const p = pending.get(Number(message.id));
          if (!p) return;
          pending.delete(Number(message.id));
          clearTimeout(p.timer);
          if (message.success) p.resolve(message.result);
          else {
            const error = (message.error ?? {}) as { code?: string; message?: string };
            p.reject(new GestureError(`source_refused: homeassistant ${error.code ?? 'error'}: ${error.message ?? 'no reason given'}`));
          }
          return;
        }
        default:
      }
    };
    socket.onerror = () => {
      clearTimeout(authTimer);
      fail(new GestureError(`source_unavailable: homeassistant at ${address} cannot be reached`));
    };
    socket.onclose = () => {
      clearTimeout(authTimer);
      closed = true;
      fail(new GestureError(`source_unavailable: homeassistant at ${address} closed the connection`));
    };
  });
}

function defaultSocket(url: string): HaSocket {
  const Socket = (globalThis as { WebSocket?: new (url: string) => HaSocket }).WebSocket;
  if (!Socket) throw new GestureError('source_unavailable: no WebSocket in this runtime (Node 22 or later has one); pass `socket`');
  return new Socket(url);
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const pairs = (v: unknown): [string, string][] => (Array.isArray(v) ? v.filter(Array.isArray).map((p) => [String(p[0]), String(p[1])] as [string, string]) : []);

/** An instant as the recorder gives it (seconds since the epoch, or ISO 8601), as the ISO 8601 string of the file format. */
function instant(v: unknown): string {
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new GestureError(`source_unreadable: homeassistant gave an instant that is none: ${String(v)}`);
  return d.toISOString();
}

/** A command an older installation does not know answers nothing rather than failing the read. */
async function listOrNone<T>(session: HomeAssistantSession, type: string): Promise<T[]> {
  try {
    return await session.call<T[]>(type);
  } catch (error) {
    if (error instanceof GestureError && /unknown_command/.test(error.message)) return [];
    throw error;
  }
}

/**
 * The installation as the snapshot `@nexgen-os/homeassistant` reads: its
 * registries, and the states of the chosen entities over the period (or now).
 * An entity that only has a state and no registry entry (a YAML entity
 * without a `unique_id`) has no stable identity and is left out.
 */
export async function snapshotOf(session: HomeAssistantSession, request: SnapshotRequest = {}): Promise<HaSnapshot> {
  const floors = await listOrNone<Raw>(session, 'config/floor_registry/list');
  const areas = await session.call<Raw[]>('config/area_registry/list');
  const devices = await session.call<Raw[]>('config/device_registry/list');
  const registry = await session.call<Raw[]>('config/entity_registry/list');
  const current = await session.call<Raw[]>('get_states');
  const now = new Map(current.map((s) => [String(s.entity_id), s]));

  const known = new Map(registry.map((e) => [String(e.entity_id), e]));
  const chosen = request.entities ?? registry.filter((e) => e.disabled_by == null).map((e) => String(e.entity_id));
  const missing = chosen.filter((id) => !known.has(id));
  if (request.entities && missing.length > 0) {
    throw new GestureError(`entity_not_found: homeassistant has no registered entity ${missing.join(', ')}`);
  }

  const entities: HaEntity[] = chosen.map((id) => {
    const e = known.get(id)!;
    const attributes = (now.get(id)?.attributes ?? {}) as Raw;
    return {
      entity_id: id,
      unique_id: String(e.unique_id ?? ''),
      platform: String(e.platform ?? ''),
      name: str(e.name),
      original_name: str(e.original_name),
      device_id: str(e.device_id),
      area_id: str(e.area_id),
      device_class: str(e.device_class),
      original_device_class: str(e.original_device_class) ?? str(attributes.device_class),
      state_class: str(e.state_class) ?? str(attributes.state_class),
      unit_of_measurement: str(e.unit_of_measurement) ?? str(attributes.unit_of_measurement),
      icon: str(e.icon),
      entity_category: str(e.entity_category),
      disabled_by: str(e.disabled_by),
    };
  });

  let states: HaState[];
  if (request.from && chosen.length > 0) {
    const history = await session.call<Record<string, Raw[]>>('history/history_during_period', {
      start_time: instant(request.from),
      end_time: instant(request.to ?? new Date().toISOString()),
      entity_ids: chosen,
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    states = chosen.flatMap((id) => (history[id] ?? []).map((row): HaState => ({
      entity_id: id,
      state: String(row.s ?? row.state),
      last_updated: instant(row.lu ?? row.lc ?? row.last_updated ?? row.last_changed),
    })));
  } else {
    states = chosen.filter((id) => now.has(id)).map((id): HaState => {
      const s = now.get(id)!;
      return { entity_id: id, state: String(s.state), last_updated: instant(s.last_updated ?? s.last_changed) };
    });
  }

  const usedDevices = new Set(entities.map((e) => e.device_id).filter(Boolean));
  return {
    floors: floors.map((f): HaFloor => ({
      floor_id: String(f.floor_id), name: String(f.name), level: typeof f.level === 'number' ? f.level : null,
      icon: str(f.icon), aliases: Array.isArray(f.aliases) ? f.aliases.map(String) : [],
    })),
    areas: areas.map((a): HaArea => ({
      area_id: String(a.area_id), name: String(a.name), floor_id: str(a.floor_id),
      icon: str(a.icon), aliases: Array.isArray(a.aliases) ? a.aliases.map(String) : [],
    })),
    devices: devices.filter((d) => request.entities === undefined || usedDevices.has(String(d.id))).map((d): HaDevice => ({
      id: String(d.id), name: str(d.name), name_by_user: str(d.name_by_user), manufacturer: str(d.manufacturer), model: str(d.model),
      sw_version: str(d.sw_version), hw_version: str(d.hw_version), serial_number: str(d.serial_number), area_id: str(d.area_id),
      via_device_id: str(d.via_device_id), identifiers: pairs(d.identifiers), connections: pairs(d.connections),
    })),
    entities,
    states,
  };
}

/** Connects, reads the snapshot and closes: `readHomeAssistant(await homeAssistantSnapshot(…))` gives the plain shapes. */
export async function homeAssistantSnapshot(options: HomeAssistantOptions, request: SnapshotRequest = {}): Promise<HaSnapshot> {
  const session = await connectHomeAssistant(options);
  try {
    return await snapshotOf(session, request);
  } finally {
    session.close();
  }
}

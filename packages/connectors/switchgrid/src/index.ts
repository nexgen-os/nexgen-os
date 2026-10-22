// Switchgrid — https://www.switchgrid.tech, an intermediary that collects the
// customer's consent and relays the meter data of the operators it serves,
// as a connector, on its API v0 (`api.switchgrid.tech`, `x-api-version: v0`;
// spec https://app.switchgrid.tech/docs/fr/v0/spec). Source `switchgrid`.
//
// The path of a load curve: a consent is asked (`POST /ask`) and signed on
// Switchgrid's page; the data opens when a contract is granted
// (`ask.contract_access_granted`, not `ask.accepted`, which only says the
// mandate is signed); an R63 is ordered (`POST /integration/enedis/order`);
// the order lists the operator's raw files behind links valid 15 minutes
// (`dataUrls`); each file is read by `@nexgen-os/enedis-r6x` with the zone
// and the quality table of the operator's hub, and comes back as the series
// of the meter. `collectMeterReadings()` of `@nexgen-os/core` checks the
// mandate first and stores them.
//
// Nothing here reads the environment or the database: the token is given by
// the caller, resolved from the `secret_ref` of the organisation's
// `connectors` row; the hub's conventions come from its pack row.

import { readFileSync } from 'node:fs';
import {
  GestureError, meterSeriesOfR6x, readMeterFile, requireMandate,
  type CollectedSeries, type MeterDataHub, type MeterDataProvider, type MeterOfHub, type MeterReadingOptions, type SourceRow,
} from '@nexgen-os/core';

/** The subset of `fetch` the connector uses, so a test or a proxy can stand in. */
export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface SwitchgridOptions {
  /** The API token, resolved by the caller from the connector's `secret_ref`; never stored. */
  token: string;
  /** Switchgrid's test world (`switchgrid-test-env: true`): no operator called, nothing billed, dummy data. From `connectors.config.environment`. */
  test?: boolean;
  /** Default `https://api.switchgrid.tech`. */
  baseUrl?: string;
  fetch?: HttpFetch;
  /** How long to wait between two looks at an order, and how many looks before giving up. Default 20 s, 30 looks. */
  poll?: { intervalMs?: number; attempts?: number };
  /** Waits; a test passes one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
}

/** A contract the consent covers: the one `search_contract` found, or the point with its holder and address. */
export type AskContract =
  | { contractId: string }
  | { _energyType: 'ELECTRICITY' | 'GAS'; deliveryPointId: string; holder: Record<string, unknown>; address: Record<string, unknown> };

/** A consent request as Switchgrid answers it. */
export interface AskState {
  id: string;
  /** `CREATED`, `PENDING_USER_ACTION`, `ACCEPTED`, `REVOKED`… as Switchgrid writes it. */
  status: string;
  /** The page where the customer signs, while the request waits for them. */
  signingUrl: string | null;
  /** The contracts whose data is open (`GRANTED`). */
  granted: string[];
  raw: unknown;
}

/** An order type of the v0 API: R63 a load curve (R63_SYNC up to 7 days), R64 an index, C68 technical data. */
export type OrderType = 'R63' | 'R63_SYNC' | 'R64' | 'R64_SYNC' | 'R65' | 'R65_SYNC' | 'R66' | 'R66_SYNC' | 'R67' | 'C68' | 'C68_ASYNC';

export interface OrderRequest {
  prms: string[];
  type: OrderType;
  /** `SOUTIRAGE` (offtake) or `INJECTION`, for the R6x types. */
  direction?: 'SOUTIRAGE' | 'INJECTION';
  /** `YYYY-MM-DDT00:00:00[Zone]` as the spec recommends, or a date. */
  since?: string;
  until?: string;
}

export interface OrderState {
  id: string;
  /** `PENDING`, `SUCCESS`, `SOME_REQUESTS_FAILED`, `FAILED`… */
  status: string;
  requests: { id: string; type: string; status: string; dataUrls: string[]; errorMessage: string | null }[];
  raw: unknown;
}

/** The webhook events a mandate follows, and what each one means for it. */
export const SWITCHGRID_EVENTS = {
  /** The data of a contract opens: the mandate is approved, an order may be placed. */
  'ask.contract_access_granted': 'approved',
  /** The customer withdrew: the mandate is revoked, and Switchgrid may erase the data. */
  'ask.revoked': 'revoked',
} as const;

/**
 * What a webhook event means for the mandate of an ask: `approved` on
 * `ask.contract_access_granted`, `revoked` on `ask.revoked`, null for the
 * others (`ask.accepted` says the mandate is signed, not that the data is
 * open: ordering then is refused upstream). Unknown events are ignored.
 */
export function mandateStatusOf(event: { tag?: unknown; type?: unknown }): 'approved' | 'revoked' | null {
  const tag = String(event.tag ?? event.type ?? '');
  return (SWITCHGRID_EVENTS as Record<string, 'approved' | 'revoked'>)[tag] ?? null;
}

/**
 * Switchgrid signs no webhook: the URL carries a token the installation
 * chose, compared here in constant time.
 */
export function webhookTokenMatches(received: string | null | undefined, expected: string): boolean {
  if (!received || !expected) return false;
  const a = new TextEncoder().encode(received);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export interface SwitchgridConnector extends MeterDataProvider {
  readonly source_code: 'switchgrid';
  /** Asks the customer's consent (`POST /ask`); the body is the spec's, passed as given. */
  ask(body: { contracts: AskContract[] } & Record<string, unknown>): Promise<AskState>;
  askStatus(id: string): Promise<AskState>;
  revoke(id: string): Promise<void>;
  order(requests: OrderRequest[], askId?: string): Promise<OrderState>;
  orderStatus(id: string): Promise<OrderState>;
  /** Waits until an order is done, then gives it; refuses `order_failed`, `order_timeout`. */
  awaitOrder(id: string): Promise<OrderState>;
  /** The files behind a done request, each read at once: its links last 15 minutes. */
  download(urls: string[]): Promise<string[]>;
}

const DAY = 86_400_000;

/** A connector on Switchgrid's API v0. `source_code` is `switchgrid`. */
export function switchgrid(options: SwitchgridOptions): SwitchgridConnector {
  if (!options.token) throw new GestureError('secret_not_found: switchgrid needs the token its connectors row names');
  const base = (options.baseUrl ?? 'https://api.switchgrid.tech').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as HttpFetch);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = options.poll?.intervalMs ?? 20_000;
  const attempts = options.poll?.attempts ?? 30;

  const call = async (path: string, method = 'GET', body?: unknown): Promise<unknown> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.token}`, 'x-api-version': 'v0', Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.test) headers['switchgrid-test-env'] = 'true';
    const response = await doFetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      if (response.status === 401 || response.status === 403) throw new GestureError(`source_unauthorised: switchgrid ${response.status} on ${path}: ${detail}`);
      throw new GestureError(`source_unavailable: switchgrid ${response.status} on ${method} ${path}: ${detail}`);
    }
    return response.status === 204 ? null : response.json();
  };

  const connector: SwitchgridConnector = {
    source_code: 'switchgrid',

    async ask(body) {
      return askState(await call('/ask', 'POST', body));
    },
    async askStatus(id) {
      return askState(await call(`/ask/${encodeURIComponent(id)}`));
    },
    async revoke(id) {
      await call(`/ask/${encodeURIComponent(id)}/revoke`, 'POST');
    },
    async order(requests, askId) {
      return orderState(await call('/integration/enedis/order', 'POST', { ...(askId ? { askId } : {}), requests }));
    },
    async orderStatus(id) {
      return orderState(await call(`/integration/enedis/order/${encodeURIComponent(id)}`));
    },
    async awaitOrder(id) {
      for (let i = 0; i < attempts; i++) {
        const state = await connector.orderStatus(id);
        if (state.status === 'SUCCESS' || state.status === 'SOME_REQUESTS_FAILED') return state;
        if (state.status === 'FAILED') {
          throw new GestureError(`order_failed: switchgrid order ${id}: ${state.requests.map((r) => r.errorMessage).filter(Boolean).join('; ') || 'no reason given'}`);
        }
        await sleep(interval);
      }
      throw new GestureError(`order_timeout: switchgrid order ${id} not done after ${attempts} looks`);
    },
    async download(urls) {
      const files: string[] = [];
      for (const url of urls) {
        const response = await doFetch(url, { method: 'GET' });
        if (!response.ok) throw new GestureError(`source_unavailable: switchgrid file ${response.status}; its links last 15 minutes, order again`);
        files.push(await response.text());
      }
      return files;
    },

    async readings(meter: MeterOfHub, from: string, to: string, readOptions: MeterReadingOptions = {}): Promise<CollectedSeries[]> {
      const mandate = requireMandate('switchgrid', readOptions.mandate, readOptions.scope ?? 'load_curve');
      if (!mandate.external_reference) {
        throw new GestureError(`mandate_missing: mandate ${mandate.id} names no Switchgrid ask (external_reference)`);
      }
      const hub: Pick<MeterDataHub, 'time_zone' | 'quality_codes'> = readOptions.hub ?? { time_zone: null, quality_codes: {} };
      const days = (Date.parse(to) - Date.parse(from)) / DAY;
      const type: OrderType = days <= 7 ? 'R63_SYNC' : 'R63';
      const directions = meter.direction === 'both' ? ['SOUTIRAGE', 'INJECTION'] as const
        : meter.direction === 'injection' ? ['INJECTION'] as const : ['SOUTIRAGE'] as const;
      // One order per direction: an injection request on a meter without an
      // injection contract fails, and must not take the offtake down with it.
      const out: CollectedSeries[] = [];
      for (const direction of directions) {
        const placed = await connector.order([{ prms: [meter.identifier], type, direction, since: from, until: to }], mandate.external_reference);
        let done: OrderState;
        try {
          done = await connector.awaitOrder(placed.id);
        } catch (error) {
          // A meter that injects nothing under contract has no injection to read.
          if (direction === 'INJECTION' && meter.direction === 'both' && /^order_failed/.test((error as Error).message)) continue;
          throw error;
        }
        const urls = done.requests.filter((r) => r.status === 'SUCCESS').flatMap((r) => r.dataUrls);
        if (urls.length === 0) {
          if (direction === 'INJECTION' && meter.direction === 'both') continue;
          throw new GestureError(`order_failed: switchgrid order ${placed.id} gave no file: ${done.requests.map((r) => r.errorMessage).filter(Boolean).join('; ') || 'no reason given'}`);
        }
        // Each order answers for its own direction: CONS for offtake, PROD for injection.
        const business = direction === 'INJECTION' ? 'PROD' : 'CONS';
        for (const text of await connector.download(urls)) {
          const file = readMeterFile(text, hub);
          out.push(...meterSeriesOfR6x({ ...file, series: file.series.filter((s) => s.business === business) }, meter.identifier));
        }
      }
      return out;
    },
  };
  return connector;
}

type Json = Record<string, unknown>;

function askState(raw: unknown): AskState {
  const r = (raw ?? {}) as Json;
  const contracts = [...list(r.contracts), ...list(r.electricityContracts)] as Json[];
  const details = (r.consentCollectionDetails ?? {}) as Json;
  return {
    id: String(r.id ?? ''),
    status: String(r.status ?? ''),
    signingUrl: typeof details.userUrl === 'string' ? details.userUrl : null,
    granted: contracts.filter((c) => c.status === 'GRANTED').map((c) => String(c.deliveryPointId ?? c.prm ?? c.id ?? '')),
    raw,
  };
}

function orderState(raw: unknown): OrderState {
  const r = (raw ?? {}) as Json;
  return {
    id: String(r.id ?? ''),
    status: String(r.status ?? ''),
    requests: (list(r.requests) as Json[]).map((q) => ({
      id: String(q.id ?? ''),
      type: String(q.type ?? ''),
      status: String(q.status ?? ''),
      // Always the list: a single `dataUrl` is the older form of the same.
      dataUrls: [...list(q.dataUrls), ...list(q.dataUrl)].map(String),
      errorMessage: typeof q.errorMessage === 'string' ? q.errorMessage : null,
    })),
    raw,
  };
}

function list(v: unknown): unknown[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

/** The `sources` row this package ships (`source.json`): write it with `registerSource()`. */
export const switchgridSource: SourceRow = JSON.parse(readFileSync(new URL('../source.json', import.meta.url), 'utf8')) as SourceRow;

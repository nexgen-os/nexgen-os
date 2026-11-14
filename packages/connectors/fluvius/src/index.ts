// Fluvius — the Flemish distribution operator's API for service providers
// (dienstverleners), as a connector, on its version 3 (`apihub.fluvius.be`,
// `esco-live` or `esco-sbx`). Source `fluvius_service_provider_api`, the be
// pack's.
//
// The path of a load curve: the service provider asks a consent link
// (`POST /shortUrlIdentifier`) under its data access contract; the customer
// signs it on the operator's page; the mandate appears in `GET /mandate`
// with the status `Approved`; the quarter-hour energy of the meter is read
// by EAN (`GET /mandate/energy`), offtake and injection in one answer.
// `collectMeterReadings()` of `@nexgen-os/core` checks the mandate first
// and stores what comes back on the meter.
//
// Authentication is Microsoft Entra ID's client credentials: a client
// secret in the sandbox, a client assertion signed by the certificate the
// operator registered in live, and the gateway's subscription key on every
// call. Nothing here reads the environment or the database: the secrets are
// given by the caller, resolved from the `secret_ref` of the organisation's
// `connectors` row; the hub's conventions (its zone, its quality table, its
// steps) come from its pack row.

import { X509Certificate, createHash, createSign, randomUUID } from 'node:crypto';
import {
  GestureError, requireMandate,
  type CollectedSeries, type MeterDataHub, type MeterDataProvider, type MeterOfHub, type MeterReadingOptions,
} from '@nexgen-os/core';
import { instantsOf } from '@nexgen-os/enedis-r6x';

/** The subset of `fetch` the connector uses, so a test or a proxy can stand in. */
export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** What the operator gave the service provider at its onboarding, resolved by the caller from the connector's `secret_ref`; never stored. */
export interface FluviusCredentials {
  /** The application's client id in the operator's tenant. */
  clientId: string;
  /** The gateway's subscription key (`Ocp-Apim-Subscription-Key`). */
  subscriptionKey: string;
  /** The sandbox's client secret. */
  clientSecret?: string;
  /** Live: the PEM of the certificate the operator registered, and of its private key (PKCS#1 or PKCS#8). */
  certificate?: string;
  privateKey?: string;
}

export interface FluviusOptions {
  credentials: FluviusCredentials;
  /** `live` (`esco-live`, certificate) or `sandbox` (`esco-sbx`, secret); from `connectors.config.environment`, `live` by default. */
  environment?: 'live' | 'sandbox';
  /** The tenant and the scope of the API, as the onboarding document gives them; from `connectors.config`. */
  tenantId: string;
  scope: string;
  /** The service provider's data access contract number, for the consent link; from `connectors.config`. */
  contractNumber?: string;
  /** Default `https://apihub.fluvius.be`. */
  baseUrl?: string;
  /** Default `https://login.microsoftonline.com`. */
  authorityUrl?: string;
  /** Default the operator's page `https://mijn.fluvius.be/verbruik/dienstverlener`, which the link's id is appended to. */
  consentPageUrl?: string;
  fetch?: HttpFetch;
  /** The clock, in milliseconds; a test passes a fixed one. */
  now?: () => number;
}

/** The status of a mandate as the operator writes it. */
export type FluviusMandateStatus = 'Requested' | 'Approved' | 'Rejected' | 'Finished';

/** A mandate as `GET /mandate` lists it. */
export interface FluviusMandate {
  referenceNumber: string;
  status: string;
  ean: string | null;
  /** `VH_kwartier_uur` (quarter hours), `VH_dag`, `VH_maand`. */
  dataServiceType: string | null;
  dataPeriodFrom: string | null;
  dataPeriodTo: string | null;
}

/** What the consent link is asked for: the reference the mandate will carry, the customer's flow, the data and its period. */
export interface ConsentRequest {
  /** The reference the mandate carries at the operator, kept as the mandate's `external_reference`. */
  referenceNumber: string;
  /** `B2C` for a household, `B2B` for a company. */
  flow: 'B2C' | 'B2B';
  /** `VH_kwartier_uur` by default. */
  dataServiceType?: string;
  /** The readings the mandate covers, ISO 8601 instants. */
  dataPeriodFrom: string;
  dataPeriodTo: string;
}

export interface ConsentLink {
  id: string;
  /** The operator's page where the customer signs. */
  url: string;
  /** Until when the link can be signed, as the operator answers it. */
  validTo: string | null;
}

/** The statuses of the operator, and what each one means for a mandate of the grid module. */
export const FLUVIUS_MANDATE_STATUSES = {
  Approved: 'approved',
  Rejected: 'refused',
  Finished: 'expired',
} as const;

/**
 * What the operator's status means for the mandate: `approved`, `refused`
 * or `expired`; null for `Requested` (the customer has not signed yet) and
 * for a status it does not know.
 */
export function mandateStatusOf(status: string | null | undefined): 'approved' | 'refused' | 'expired' | null {
  return (FLUVIUS_MANDATE_STATUSES as Record<string, 'approved' | 'refused' | 'expired'>)[String(status ?? '')] ?? null;
}

export interface FluviusConnector extends MeterDataProvider {
  readonly source_code: 'fluvius_service_provider_api';
  /** The mandates the service provider holds, every status. */
  mandates(): Promise<FluviusMandate[]>;
  /** A link the customer signs on the operator's page; refuses `contract_number_required` without the contract number. */
  consentLink(request: ConsentRequest): Promise<ConsentLink>;
}

const QUARTER_HOUR = 'PT15M';

/** A connector on the operator's API for service providers, version 3. `source_code` is `fluvius_service_provider_api`. */
export function fluvius(options: FluviusOptions): FluviusConnector {
  const { credentials } = options;
  const environment = options.environment ?? 'live';
  if (!credentials?.clientId || !credentials.subscriptionKey) {
    throw new GestureError('secret_not_found: fluvius needs the client id and the subscription key its connectors row names');
  }
  if (environment === 'live' && (!credentials.certificate || !credentials.privateKey)) {
    throw new GestureError('secret_not_found: fluvius live needs the certificate and the private key its connectors row names');
  }
  if (environment === 'sandbox' && !credentials.clientSecret) {
    throw new GestureError('secret_not_found: fluvius sandbox needs the client secret its connectors row names');
  }
  if (!options.tenantId || !options.scope) {
    throw new GestureError('config_invalid: fluvius needs the tenant and the scope of the API in its connectors row');
  }
  const base = `${(options.baseUrl ?? 'https://apihub.fluvius.be').replace(/\/+$/, '')}/${environment === 'live' ? 'esco-live' : 'esco-sbx'}/v3/api`;
  const authority = (options.authorityUrl ?? 'https://login.microsoftonline.com').replace(/\/+$/, '');
  const tokenUrl = `${authority}/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`;
  const consentPage = options.consentPageUrl ?? 'https://mijn.fluvius.be/verbruik/dienstverlener';
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as HttpFetch);
  const now = options.now ?? Date.now;
  let token: { value: string; until: number } | null = null;

  const accessToken = async (): Promise<string> => {
    if (token && now() < token.until) return token.value;
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.clientId, scope: options.scope });
    if (environment === 'live') {
      form.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      form.set('client_assertion', clientAssertion(credentials, tokenUrl, now()));
    } else {
      form.set('client_secret', credentials.clientSecret!);
    }
    const response = await doFetch(tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString(),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new GestureError(`source_unauthorised: fluvius token ${response.status}: ${detail}`);
    }
    const answer = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!answer.access_token) throw new GestureError('source_unauthorised: fluvius token answer carries no access_token');
    // A minute short of its end, so that no call leaves with a token about to lapse.
    token = { value: answer.access_token, until: now() + (Number(answer.expires_in ?? 3600) - 60) * 1000 };
    return token.value;
  };

  const call = async (path: string, method = 'GET', body?: unknown): Promise<{ status: number; data: unknown }> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`, 'Ocp-Apim-Subscription-Key': credentials.subscriptionKey, Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await doFetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 404) return { status: 404, data: null };
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      if (response.status === 401 || response.status === 403) throw new GestureError(`source_unauthorised: fluvius ${response.status} on ${path.replace(/\?.*$/, '')}: ${detail}`);
      throw new GestureError(`source_unavailable: fluvius ${response.status} on ${method} ${path.replace(/\?.*$/, '')}: ${detail}`);
    }
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };

  return {
    source_code: 'fluvius_service_provider_api',

    async mandates() {
      const { data } = await call('/mandate');
      const list = ((data as { data?: { mandates?: unknown[] } } | null)?.data?.mandates ?? []) as Record<string, unknown>[];
      return list.map((m) => ({
        referenceNumber: String(m.referenceNumber ?? ''),
        status: String(m.status ?? ''),
        ean: typeof m.ean === 'string' ? m.ean : null,
        dataServiceType: typeof m.dataServiceType === 'string' ? m.dataServiceType : null,
        dataPeriodFrom: typeof m.dataPeriodFrom === 'string' ? m.dataPeriodFrom : null,
        dataPeriodTo: typeof m.dataPeriodTo === 'string' ? m.dataPeriodTo : null,
      }));
    },

    async consentLink(request) {
      if (!options.contractNumber) {
        throw new GestureError('contract_number_required: a consent link names the data access contract; set contract_number in the connectors row');
      }
      const { data } = await call('/shortUrlIdentifier', 'POST', {
        dataAccessContractNumber: options.contractNumber,
        referenceNumber: request.referenceNumber,
        flow: request.flow,
        dataServices: [{
          dataServiceType: request.dataServiceType ?? 'VH_kwartier_uur',
          dataPeriodFrom: seconds(request.dataPeriodFrom),
          dataPeriodTo: seconds(request.dataPeriodTo),
        }],
      });
      const answer = ((data as { data?: Record<string, unknown> } | null)?.data ?? data ?? {}) as Record<string, unknown>;
      const id = typeof answer.shortUrlIdentifier === 'string' ? answer.shortUrlIdentifier : '';
      if (!id) throw new GestureError('source_unavailable: fluvius answered no shortUrlIdentifier');
      return { id, url: `${consentPage}?id=${encodeURIComponent(id)}`, validTo: typeof answer.validTo === 'string' ? answer.validTo : null };
    },

    async readings(meter: MeterOfHub, from: string, to: string, readOptions: MeterReadingOptions = {}): Promise<CollectedSeries[]> {
      requireMandate('fluvius_service_provider_api', readOptions.mandate, readOptions.scope ?? 'load_curve');
      if (readOptions.step && readOptions.step !== QUARTER_HOUR) {
        throw new GestureError(`step_unsupported: fluvius reads quarter hours (${QUARTER_HOUR}), not ${readOptions.step}`);
      }
      if (!/^\d{18}$/.test(meter.identifier)) {
        throw new GestureError(`invalid_identifier: ${meter.identifier} is not an EAN of 18 digits`);
      }
      const hub: Pick<MeterDataHub, 'time_zone' | 'quality_codes'> = readOptions.hub ?? { time_zone: null, quality_codes: {} };
      if (!hub.time_zone) {
        throw new GestureError('time_zone_required: the days asked are the hub\'s; its pack row names no time_zone');
      }
      const params = new URLSearchParams({
        ean: meter.identifier, periodType: 'readTime', from: startOfDay(from, hub.time_zone), to: startOfDay(to, hub.time_zone),
      });
      const { data } = await call(`/mandate/energy?${params.toString()}`);
      return energySeries(data, meter, hub);
    },
  };
}

/**
 * Each quarter hour of the answer, offtake and injection, as the series of
 * the meter; a state the hub's table does not hold is refused by name.
 *
 * The answer is the one of the API for service providers the Belgian
 * distribution operators run, read the same for each of them: `headpoint`
 * is one metering point or a list of them (the one of the meter is kept),
 * and its quarter hours sit under its physical meters (a digital meter) or
 * on the point itself (a meter read remotely, whose values the operator
 * gives for the whole point). `operator` names the hub in a refusal.
 */
export function energySeries(
  answer: unknown, meter: Pick<MeterOfHub, 'identifier' | 'direction'>, hub: Pick<MeterDataHub, 'time_zone' | 'quality_codes'>, operator = 'fluvius',
): CollectedSeries[] {
  type Measurement = { total?: { value?: unknown; validationState?: unknown } };
  type Quarter = { start?: unknown; measurements?: { offtake?: Measurement; injection?: Measurement }[] };
  type Physical = { quarterHourlyEnergy?: Quarter[] };
  // `physiclaMeters` is how one operator's guide spells the field; both spellings are read.
  type Headpoint = { ean?: unknown; quarterHourlyEnergy?: Quarter[]; physicalMeters?: Physical[]; physiclaMeters?: Physical[] };
  const given = (answer as { data?: { headpoint?: Headpoint | Headpoint[] } } | null)?.data?.headpoint;
  const points = given === undefined || given === null ? [] : Array.isArray(given) ? given : [given];
  const headpoints = points.filter((point) => point.ean === undefined || String(point.ean) === meter.identifier);
  if (points.length > 0 && headpoints.length === 0) {
    throw new GestureError(`source_unavailable: ${operator} answered for ${points.map((point) => String(point.ean)).join(', ')}, not ${meter.identifier}`);
  }
  const quarters = headpoints.flatMap((point) => [
    ...(point.quarterHourlyEnergy ?? []),
    ...(point.physicalMeters ?? point.physiclaMeters ?? []).flatMap((physical) => physical.quarterHourlyEnergy ?? []),
  ]);
  const directions = meter.direction === 'offtake' ? ['offtake'] as const
    : meter.direction === 'injection' ? ['injection'] as const : ['offtake', 'injection'] as const;
  const out: CollectedSeries[] = [];
  for (const direction of directions) {
    const values: { at: string; value: number; quality: number }[] = [];
    for (const quarter of quarters) {
      const total = quarter.measurements?.[0]?.[direction]?.total;
      if (!total || typeof total.value !== 'number') continue;
      const state = typeof total.validationState === 'string' && total.validationState !== '' ? total.validationState : 'none';
      const quality = hub.quality_codes[state];
      if (quality === undefined) {
        throw new GestureError(`quality_unknown: ${operator} state ${JSON.stringify(state)} at ${String(quarter.start)} is not in the hub's quality table; add it to the pack row`);
      }
      values.push({ at: instant(String(quarter.start ?? ''), hub.time_zone, operator), value: total.value, quality });
    }
    if (values.length === 0) continue;
    values.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    out.push({ quantity_code: `${direction}_energy`, value_kind: 'interval', step: '15 minutes', unit: 'kWh', values });
  }
  return out;
}

/** A stamp of the answer in UTC: its own offset, else the hub's zone; a stamp the zone skips or repeats is refused. */
function instant(text: string, timeZone: string | null, operator: string): string {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) throw new GestureError(`date_unreadable: ${operator} stamp ${JSON.stringify(text)}`);
    return new Date(ms).toISOString();
  }
  const wall = Date.parse(`${text}Z`);
  if (Number.isNaN(wall)) throw new GestureError(`date_unreadable: ${operator} stamp ${JSON.stringify(text)}`);
  if (!timeZone) throw new GestureError(`time_zone_required: ${operator} stamp ${text} carries no offset and the hub names no time_zone`);
  const found = instantsOf(timeZone, wall);
  if (found.length !== 1) throw new GestureError(`date_unreadable: ${operator} stamp ${text} is ${found.length === 0 ? 'skipped' : 'repeated'} in ${timeZone}`);
  return new Date(found[0]!).toISOString();
}

/** The first instant of a day (`YYYY-MM-DD`) in a zone, to the second, as the operator wants it. */
export function startOfDay(day: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new GestureError(`date_unreadable: ${JSON.stringify(day)} is not YYYY-MM-DD`);
  const wall = Date.parse(`${day}T00:00:00Z`);
  const found = instantsOf(timeZone, wall);
  if (found.length === 0) throw new GestureError(`date_unreadable: midnight of ${day} does not exist in ${timeZone}`);
  return seconds(new Date(found[0]!).toISOString());
}

/** An instant to the second, without milliseconds: the operator refuses them. */
export function seconds(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new GestureError(`date_unreadable: ${JSON.stringify(iso)}`);
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The client assertion of the live environment: a JWT signed RS256 by the registered certificate's key, its thumbprint in `x5t`, ten minutes long. */
export function clientAssertion(credentials: Pick<FluviusCredentials, 'clientId' | 'certificate' | 'privateKey'>, audience: string, nowMs: number): string {
  let der: Buffer;
  try {
    der = new X509Certificate(credentials.certificate!).raw;
  } catch {
    throw new GestureError('certificate_unreadable: fluvius live needs the PEM of the certificate the operator registered');
  }
  const issued = Math.floor(nowMs / 1000);
  const header = { alg: 'RS256', typ: 'JWT', x5t: base64url(createHash('sha1').update(der).digest()) };
  const payload = { aud: audience, iss: credentials.clientId, sub: credentials.clientId, jti: randomUUID(), nbf: issued, iat: issued, exp: issued + 600 };
  const input = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(Buffer.from(JSON.stringify(payload)))}`;
  let signature: Buffer;
  try {
    signature = createSign('RSA-SHA256').update(input).sign(credentials.privateKey!);
  } catch {
    throw new GestureError('certificate_unreadable: fluvius live needs the PEM of the certificate\'s private key');
  }
  return `${input}.${base64url(signature)}`;
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

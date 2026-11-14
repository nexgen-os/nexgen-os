// ORES — the main Walloon distribution operator's API for energy service
// providers (third-party data access, `edap.ores.be/b2b/tpda`), as a
// connector. Source `ores_service_provider_api`, the be pack's.
//
// The path of a load curve: the service provider asks a consent link
// (`POST /shortUrlIdentifier`) under its data access contract; the customer
// follows it to My ORES and consents, per metering point, direction and
// granularity; the mandates appear in `GET /mandates` under the reference of
// the request, with the status `Approved`; the quarter-hour energy of the
// meter is read by reference and EAN (`GET /mandates/energy`), offtake and
// injection in one answer, seven days at most per call.
// `collectMeterReadings()` of `@nexgen-os/core` checks the mandate first and
// stores what comes back on the meter.
//
// The answers have the shape of the API the Flemish operator runs, so they
// are read by the same reader (`energySeries()` of `@nexgen-os/fluvius`).
// What differs is here: the paths, the reference every call carries, the
// seven-day window, and the authentication — the gateway's subscription key
// on every call and the certificate the operator registered, presented on
// the connection. Nothing here reads the environment or the database: the
// secrets are given by the caller, resolved from the `secret_ref` of the
// organisation's `connectors` row; the hub's conventions (its zone, its
// quality table, its steps) come from its pack row.

import { X509Certificate } from 'node:crypto';
import { Agent, request as httpsRequest } from 'node:https';
import {
  GestureError, requireMandate,
  type CollectedSeries, type MeterDataHub, type MeterDataProvider, type MeterOfHub, type MeterReadingOptions,
} from '@nexgen-os/core';
import { energySeries, mandateStatusOf, seconds, startOfDay, type ConsentLink, type HttpFetch } from '@nexgen-os/fluvius';

export type { ConsentLink, HttpFetch };

/** What the operator gave the service provider at its onboarding, resolved by the caller from the connector's `secret_ref`; never stored. */
export interface OresCredentials {
  /** The gateway's subscription key (`Ocp-Apim-Subscription-Key`). */
  subscriptionKey: string;
  /** The PEM of the certificate the operator registered, and of its private key: presented on the connection when given. */
  certificate?: string;
  privateKey?: string;
}

export interface OresOptions {
  credentials: OresCredentials;
  /** The service provider's data access contract number, for the consent link; from `connectors.config`. */
  contractNumber?: string;
  /** Where My ORES sends the customer back, consent given or not; each on a domain the operator validated at the contract. From `connectors.config`. */
  returnUrlSuccess?: string;
  returnUrlFailed?: string;
  /** Default `https://edap.ores.be`. */
  baseUrl?: string;
  /** Default the operator's page `https://www.myores.be/tpda/`, which the link's id is appended to. */
  consentPageUrl?: string;
  /** A stand-in for the transport; by default the connection presents the certificate when one is given. */
  fetch?: HttpFetch;
}

/** The granularity a customer consents to, as the consent link asks it. */
export type OresDataService = 'HOURLY_QUARTER_HOURLY' | 'DAILY' | 'UNDEFINED';

/** What the consent link is asked for: the reference the mandates will carry, the customer's flow, the data and its period. */
export interface OresConsentRequest {
  /** The reference the mandates carry at the operator, 35 characters at most, one customer per reference; kept as the mandate's `external_reference`. */
  referenceNumber: string;
  /** `B2C` for a household, `B2B` for a company. */
  flow: 'B2C' | 'B2B';
  /** `HOURLY_QUARTER_HOURLY` by default: quarter hours for electricity. */
  dataServiceType?: OresDataService;
  /** The readings the mandate covers, ISO 8601 instants; left out, the customer chooses. The start may reach three years back. */
  dataPeriodFrom?: string;
  dataPeriodTo?: string;
  /** How many metering points the customer may share under this reference, 1 to 1000; the operator's default (1000) when absent. */
  numberOfEans?: number;
}

/** A mandate as `GET /mandates` lists it: one per metering point, direction and granularity. */
export interface OresMandate {
  referenceNumber: string;
  /** `Approved`, `Rejected` or `Finished`. */
  status: string;
  /** `ToBeRenew`, `RenewalRequested` or `Expired`, when a renewal is under way; a mandate is renewed every three years. */
  renewalStatus: string | null;
  ean: string | null;
  /** `E` electricity, `G` gas. */
  energyType: string | null;
  /** `HourlyQuarterHourly` or `Daily`. */
  dataServiceType: string | null;
  dataPeriodFrom: string | null;
  dataPeriodTo: string | null;
  mandateExpirationDate: string | null;
}

/**
 * What the operator's statuses mean for the mandate: `approved`, `refused`
 * or `expired`; null for a status it does not know. A renewal the customer
 * let pass (`Expired`) ends the mandate for new readings, whatever its
 * status still says.
 */
export function oresMandateStatus(mandate: Pick<OresMandate, 'status' | 'renewalStatus'>): 'approved' | 'refused' | 'expired' | null {
  if (mandate.renewalStatus === 'Expired') return 'expired';
  return mandateStatusOf(mandate.status);
}

export interface OresConnector extends MeterDataProvider {
  readonly source_code: 'ores_service_provider_api';
  /** The mandates given under a reference, every status; narrowed to one metering point when its EAN is given. */
  mandates(referenceNumber: string, ean?: string): Promise<OresMandate[]>;
  /** A link the customer follows to My ORES, valid five days; refuses `contract_number_required` without the contract number. */
  consentLink(request: OresConsentRequest): Promise<ConsentLink>;
}

const SOURCE = 'ores_service_provider_api';
const QUARTER_HOUR = 'PT15M';
/** The longest period one call of the energy service answers, in days: the operator's limit. */
export const ORES_DAYS_PER_CALL = 7;

/** A connector on the operator's API for energy service providers. `source_code` is `ores_service_provider_api`. */
export function ores(options: OresOptions): OresConnector {
  const { credentials } = options;
  if (!credentials?.subscriptionKey) {
    throw new GestureError('secret_not_found: ores needs the subscription key its connectors row names');
  }
  if (Boolean(credentials.certificate) !== Boolean(credentials.privateKey)) {
    throw new GestureError('secret_not_found: ores needs the certificate and its private key together');
  }
  const base = `${(options.baseUrl ?? 'https://edap.ores.be').replace(/\/+$/, '')}/b2b/tpda/v1/api/external/v1`;
  const consentPage = (options.consentPageUrl ?? 'https://www.myores.be/tpda/').replace(/\/*$/, '/');
  const doFetch = options.fetch
    ?? (credentials.certificate ? certificateFetch(credentials.certificate, credentials.privateKey!) : (globalThis.fetch as unknown as HttpFetch));

  const call = async (path: string, method = 'GET', body?: unknown): Promise<unknown> => {
    const headers: Record<string, string> = { 'Ocp-Apim-Subscription-Key': credentials.subscriptionKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await doFetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      const where = path.replace(/\?.*$/, '');
      if (response.status === 401 || response.status === 403) throw new GestureError(`source_unauthorised: ores ${response.status} on ${where}: ${detail}`);
      throw new GestureError(`source_unavailable: ores ${response.status} on ${method} ${where}: ${detail}`);
    }
    return response.json();
  };

  return {
    source_code: SOURCE,

    async mandates(referenceNumber, ean) {
      const params = new URLSearchParams({ referenceNumber: reference(referenceNumber) });
      if (ean) params.set('ean', ean);
      const data = await call(`/mandates?${params.toString()}`);
      const list = ((data as { data?: { mandates?: unknown[] } } | null)?.data?.mandates ?? []) as Record<string, unknown>[];
      const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
      return list.map((m) => ({
        referenceNumber: String(m.referenceNumber ?? ''),
        status: String(m.status ?? ''),
        renewalStatus: text(m.renewalStatus),
        ean: text(m.ean),
        energyType: text(m.energyType),
        dataServiceType: text(m.dataServiceType),
        dataPeriodFrom: text(m.dataPeriodFrom),
        dataPeriodTo: text(m.dataPeriodTo),
        mandateExpirationDate: text(m.mandateExpirationDate),
      }));
    },

    async consentLink(request) {
      if (!options.contractNumber) {
        throw new GestureError('contract_number_required: a consent link names the data access contract; set contract_number in the connectors row');
      }
      if (request.numberOfEans !== undefined && (!Number.isInteger(request.numberOfEans) || request.numberOfEans < 1 || request.numberOfEans > 1000)) {
        throw new GestureError(`invalid_parameter: ores shares 1 to 1000 metering points under a reference, not ${request.numberOfEans}`);
      }
      const data = await call('/shortUrlIdentifier', 'POST', {
        dataAccessContractNumber: options.contractNumber,
        referenceNumber: reference(request.referenceNumber),
        flow: request.flow,
        dataServices: [{
          dataServiceType: request.dataServiceType ?? 'HOURLY_QUARTER_HOURLY',
          ...(request.dataPeriodFrom ? { dataPeriodFrom: seconds(request.dataPeriodFrom) } : {}),
          ...(request.dataPeriodTo ? { dataPeriodTo: seconds(request.dataPeriodTo) } : {}),
        }],
        ...(request.numberOfEans !== undefined ? { numberOfEans: request.numberOfEans } : {}),
        ...(options.returnUrlSuccess ? { returnUrlSuccess: options.returnUrlSuccess } : {}),
        ...(options.returnUrlFailed ? { returnUrlFailed: options.returnUrlFailed } : {}),
      });
      const answer = ((data as { data?: Record<string, unknown> } | null)?.data ?? data ?? {}) as Record<string, unknown>;
      const id = typeof answer.shortUrlIdentifier === 'string' ? answer.shortUrlIdentifier : '';
      if (!id) throw new GestureError('source_unavailable: ores answered no shortUrlIdentifier');
      return { id, url: `${consentPage}${encodeURIComponent(id)}`, validTo: typeof answer.validTo === 'string' ? answer.validTo : null };
    },

    async readings(meter: MeterOfHub, from: string, to: string, readOptions: MeterReadingOptions = {}): Promise<CollectedSeries[]> {
      const mandate = requireMandate(SOURCE, readOptions.mandate, readOptions.scope ?? 'load_curve');
      if (readOptions.step && readOptions.step !== QUARTER_HOUR) {
        throw new GestureError(`step_unsupported: ores reads quarter hours (${QUARTER_HOUR}), not ${readOptions.step}`);
      }
      if (!/^\d{18}$/.test(meter.identifier)) {
        throw new GestureError(`invalid_identifier: ${meter.identifier} is not an EAN of 18 digits`);
      }
      if (!mandate.external_reference) {
        throw new GestureError(`mandate_reference_missing: ores reads by the reference of the consent; mandate ${mandate.id} carries none`);
      }
      const hub: Pick<MeterDataHub, 'time_zone' | 'quality_codes'> = readOptions.hub ?? { time_zone: null, quality_codes: {} };
      if (!hub.time_zone) {
        throw new GestureError('time_zone_required: the days asked are the hub\'s; its pack row names no time_zone');
      }
      const merged = new Map<string, CollectedSeries>();
      for (const [start, end] of windows(from, to)) {
        const params = new URLSearchParams({
          referenceNumber: reference(mandate.external_reference), ean: meter.identifier, granularity: 'hourlyQuarterHourly',
          periodType: 'readTime', from: startOfDay(start, hub.time_zone), to: startOfDay(end, hub.time_zone),
        });
        for (const series of energySeries(await call(`/mandates/energy?${params.toString()}`), meter, hub, 'ores')) {
          const known = merged.get(series.quantity_code);
          if (known) known.values.push(...series.values);
          else merged.set(series.quantity_code, series);
        }
      }
      return [...merged.values()];
    },
  };
}

/** The reference of a consent as the operator takes it: 35 characters at most. */
function reference(value: string): string {
  const text = String(value ?? '').trim();
  if (text === '' || text.length > 35) {
    throw new GestureError(`invalid_reference: ores takes a reference of 1 to 35 characters, not ${JSON.stringify(value)}`);
  }
  return text;
}

/** The days `[from, to)` cut into periods one call answers, each `[start, end)` in `YYYY-MM-DD`. */
export function windows(from: string, to: string, days = ORES_DAYS_PER_CALL): [string, string][] {
  const day = (text: string): number => {
    const ms = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : Number.NaN;
    if (Number.isNaN(ms)) throw new GestureError(`date_unreadable: ${JSON.stringify(text)} is not YYYY-MM-DD`);
    return ms;
  };
  const end = day(to);
  const out: [string, string][] = [];
  for (let start = day(from); start < end; start += days * 86_400_000) {
    const stop = Math.min(start + days * 86_400_000, end);
    out.push([new Date(start).toISOString().slice(0, 10), new Date(stop).toISOString().slice(0, 10)]);
  }
  return out;
}

/** A transport that presents the registered certificate on the connection; a certificate that does not read is refused by name. */
export function certificateFetch(certificate: string, privateKey: string): HttpFetch {
  try {
    new X509Certificate(certificate);
  } catch {
    throw new GestureError('certificate_unreadable: ores needs the PEM of the certificate the operator registered');
  }
  const agent = new Agent({ cert: certificate, key: privateKey, keepAlive: true });
  return (url, init = {}) => new Promise((resolve, reject) => {
    const sent = httpsRequest(url, { method: init.method ?? 'GET', headers: init.headers, agent }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const status = response.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text) as unknown, text: async () => text });
      });
    });
    sent.on('error', reject);
    if (init.body !== undefined) sent.write(init.body);
    sent.end();
  });
}

// Enedis SGE — the operator's own web services for a third party under
// contract with it, as a connector. Source `enedis_sge` (the fr pack's).
//
// A skeleton until homologation: the SOAP requests and the readers of the
// answers follow the public homologation samples; the endpoints, the
// versions in force, the error codes, the call limits and the channel of
// the files are named in the README as what the contract and homologation
// settle. Everything else runs now, offline, on an injected transport.
//
// Authentication is a client certificate (mutual TLS) and the gateway's
// login and password (HTTP Basic), the login repeated in the body. Every
// call declares the customer's agreement, which the third party collects,
// keeps and proves itself: `readings()` refuses without the mandate the one
// check returned, and the collection order without the holder it names.

import {
  GestureError, requireMandate,
  type CollectedSeries, type MeterDataHub, type MeterDataProvider, type MeterMandate, type MeterOfHub, type MeterReadingOptions,
} from '@nexgen-os/core';
import { durationMs } from '@nexgen-os/enedis-r6x';
import {
  SGE_SERVICES, collectionOrderRequest, detailedMeasuresRequest, searchPointRequest, technicalDataRequest,
  type Holder, type PointSearch, type SgeDirection, type SgeService,
} from './services.js';
import { collectionCase, detailedMeasures, foundPoints, technicalData, type FoundPoint, type MeasureSeries, type TechnicalData } from './answers.js';

export * from './services.js';
export * from './answers.js';

/** One SOAP call: where, which action, the envelope. */
export interface SoapCall {
  url: string;
  soapAction: string;
  body: string;
}

/** Sends one call and answers the HTTP status and body; a test passes a recorder, an installation `mutualTlsTransport()`. */
export type SoapTransport = (call: SoapCall) => Promise<{ status: number; body: string }>;

/** The credentials of the gateway, resolved by the caller from the connector's `secret_ref`; never stored. */
export interface SgeCredentials {
  login: string;
  password: string;
  /** PEM of the client certificate the operator recognises, and of its key. */
  certificate: string;
  privateKey: string;
}

/**
 * The transport an installation uses: HTTPS from Node with the client
 * certificate and HTTP Basic. Built lazily: nothing connects before the
 * first call.
 */
export function mutualTlsTransport(credentials: SgeCredentials): SoapTransport {
  return async (call) => {
    const { request } = await import('node:https');
    const basic = Buffer.from(`${credentials.login}:${credentials.password}`).toString('base64');
    return new Promise((resolve, reject) => {
      const req = request(call.url, {
        method: 'POST', cert: credentials.certificate, key: credentials.privateKey,
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: call.soapAction, Authorization: `Basic ${basic}` },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', (error) => reject(new GestureError(`source_unavailable: enedis_sge ${error.message}`)));
      req.end(call.body);
    });
  };
}

/** The homologation gateway, as the public samples name it; the production one comes with the contract. */
export const SGE_HOMOLOGATION_URL = 'https://sge-homologation-b2b.enedis.fr';

export interface EnedisSgeOptions {
  /** The gateway, from `connectors.config.base_url`: no default, homologation and production are two worlds. */
  baseUrl: string;
  /** The login, repeated in the body of each call (`initiateurLogin`, `loginUtilisateur`). */
  login: string;
  transport: SoapTransport;
  /** The days asked per call of detailed measures; 7 until homologation says otherwise. */
  windowDays?: number;
}

export interface EnedisSgeConnector extends MeterDataProvider {
  readonly source_code: 'enedis_sge';
  searchPoint(criteria: PointSearch): Promise<FoundPoint[]>;
  technicalData(pointId: string, mandate: MeterMandate | null | undefined): Promise<TechnicalData>;
  /** Turns on the collection of a load curve and subscribes its publication; refuses without the mandate and its holder. */
  orderCollection(order: { pointId: string; contractId: string; to: string; from: string; holder: Holder; direction: SgeDirection }, mandate: MeterMandate | null | undefined): Promise<string>;
  /** The raw series of one call of detailed measures, steps at their start in UTC. */
  detailedMeasures(pointId: string, from: string, to: string, direction: SgeDirection, physical?: 'PA' | 'PRI' | 'PRC'): Promise<MeasureSeries[]>;
}

const DAY = 86_400_000;

/** A connector on the operator's gateway. `source_code` is `enedis_sge`. */
export function enedisSge(options: EnedisSgeOptions): EnedisSgeConnector {
  if (!options.baseUrl) throw new GestureError('connector_config_required: enedis_sge needs base_url in its connectors row');
  if (!options.login) throw new GestureError('secret_not_found: enedis_sge needs the login its connectors row names');
  const base = options.baseUrl.replace(/\/+$/, '');
  const windowDays = options.windowDays ?? 7;
  const send = async (service: SgeService, body: string) =>
    options.transport({ url: `${base}${service.path}`, soapAction: service.operation, body });

  const connector: EnedisSgeConnector = {
    source_code: 'enedis_sge',

    async searchPoint(criteria) {
      const answer = await send(SGE_SERVICES.searchPoint, searchPointRequest(options.login, criteria));
      return foundPoints(answer.status, answer.body);
    },

    async technicalData(pointId, mandate) {
      requireMandate('enedis_sge', mandate, 'technical_data');
      const answer = await send(SGE_SERVICES.technicalData, technicalDataRequest(options.login, pointId));
      return technicalData(answer.status, answer.body);
    },

    async orderCollection(order, mandate) {
      requireMandate('enedis_sge', mandate, 'load_curve');
      const named = order.holder.kind === 'company' ? order.holder.name : order.holder.lastName;
      if (!named?.trim()) throw new GestureError('mandate_holder_required: the operator is told who gave the agreement');
      const answer = await send(SGE_SERVICES.collectionOrder, collectionOrderRequest(options.login, order));
      return collectionCase(answer.status, answer.body);
    },

    async detailedMeasures(pointId, from, to, direction, physical = 'PA') {
      const answer = await send(SGE_SERVICES.detailedMeasures, detailedMeasuresRequest(options.login, {
        pointId, measureType: 'COURBE', physicalQuantity: physical, from, to, direction,
      }));
      return detailedMeasures(answer.status, answer.body);
    },

    async readings(meter: MeterOfHub, from: string, to: string, readOptions: MeterReadingOptions = {}): Promise<CollectedSeries[]> {
      requireMandate('enedis_sge', readOptions.mandate, readOptions.scope ?? 'load_curve');
      const hub: Pick<MeterDataHub, 'quality_codes'> = readOptions.hub ?? { quality_codes: {} };
      const directions: SgeDirection[] = meter.direction === 'both' ? ['SOUTIRAGE', 'INJECTION'] : meter.direction === 'injection' ? ['INJECTION'] : ['SOUTIRAGE'];
      const out: CollectedSeries[] = [];
      for (const direction of directions) {
        const points: MeasureSeries['points'] = [];
        let unit: string | null = null;
        for (let start = Date.parse(from); start < Date.parse(to); start += windowDays * DAY) {
          const end = Math.min(start + windowDays * DAY, Date.parse(to));
          for (const s of await connector.detailedMeasures(meter.identifier, day(start), day(end), direction)) {
            unit ??= s.unit;
            points.push(...s.points);
          }
        }
        if (points.length === 0) continue;
        out.push(toSeries(direction === 'INJECTION' ? 'injection_power' : 'offtake_power', unit, points, hub.quality_codes));
      }
      return out;
    },
  };
  return connector;
}

/** One curve of the gateway as the series of a meter: missing steps kept as missing, letters by the hub's table. */
function toSeries(quantity: string, unit: string | null, points: MeasureSeries['points'], codes: Record<string, number>): CollectedSeries {
  const steps = new Set(points.map((p) => p.step).filter(Boolean));
  const step = steps.size === 1 ? [...steps][0]! : null;
  const ms = step ? durationMs(step) : null;
  const quality = (p: MeasureSeries['points'][number]) => {
    const code = Number.isNaN(p.value) ? codes.missing : p.nature === null ? codes.none : codes[p.nature];
    if (code === undefined) throw new GestureError(`quality_unknown: nature ${JSON.stringify(p.nature)} of enedis_sge is not in the hub's table`);
    return code;
  };
  const byStart = new Map(points.map((p) => [Date.parse(p.start), p]));
  const values = [];
  if (ms) {
    const first = Math.min(...byStart.keys());
    const last = Math.max(...byStart.keys());
    for (let t = first; t <= last; t += ms) {
      const p = byStart.get(t);
      if (p) values.push({ at: p.start, value: p.value, quality: quality(p) });
      else if (codes.missing !== undefined) values.push({ at: new Date(t).toISOString(), value: Number.NaN, quality: codes.missing });
    }
  } else {
    for (const p of points) values.push({ at: p.start, value: p.value, quality: quality(p) });
  }
  return {
    quantity_code: quantity, value_kind: 'interval', step: ms ? `${ms / 60_000} minutes` : null,
    ...(unit ? { unit } : {}), values,
  };
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

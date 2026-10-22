// Reading a meter at its operator's data hub, under the customer's mandate.
//
// The decision whether an organisation may read a meter is taken in one
// place, the SQL function `grid.authorise_reading()` of the `grid` module:
// the approved mandate on the meter, in force on the day, covering the
// period, the scope and the step, or a refusal by name (`mandate_missing`,
// `mandate_expired`, `mandate_scope`). `authoriseReading()` is its twin for
// code that runs outside the database: it asks that function and never
// decides on its own. `collectMeterReadings()` is the one path from a
// `MeterDataProvider` to the series of a meter: it asks first, hands the
// mandate and the conventions of the hub to the connector, and writes what
// comes back through `storeSeries()`.
//
// A connector whose source reads under mandate refuses to read without the
// mandate this check returned (`requireMandate()`): it cannot see the
// database, so it holds the caller to having asked.

import type { Db } from '../db.js';
import { GestureError } from '../refusal.js';
import { storeSeries, type CollectedSeries, type MeterDataProvider, type MeterOfHub } from './interfaces.js';

/** What a mandate allows to be read: the values of `grid.mandates.scope`. */
export type MandateScope = 'load_curve' | 'daily_index' | 'energy_history' | 'technical_data';

/** The approved mandate `grid.authorise_reading()` found: what a connector under mandate reads with. */
export interface MeterMandate {
  id: string;
  /** The operator whose hub the data is read at (`grid.operators.code`). */
  operator: string;
  scope: MandateScope[];
  /** The finest step it allows, an ISO 8601 duration. */
  granularity: string;
  /** The readings it covers, `YYYY-MM-DD`, null when open. */
  data_from: string | null;
  data_to: string | null;
  valid_to: string | null;
  /** The reference the operator or the intermediary gave the consent. */
  external_reference: string | null;
}

/**
 * The conventions of an operator's data hub, read from its pack row
 * (`grid.operators.meter_data`): never written in a connector.
 */
export interface MeterDataHub {
  operator: string;
  /** The IANA time zone the hub's files date their steps in, when they carry no offset. */
  time_zone: string | null;
  /** The hub's quality flags mapped to the core's codes (0–3) and the pack's (100 and up). */
  quality_codes: Record<string, number>;
  /** The sources that read this hub, in the pack's order. */
  sources: string[];
  /** How far back the hub serves readings, in months, when it says. */
  history_months: number | null;
  /** The steps the hub publishes load curves at, ISO 8601 durations. */
  steps: string[];
}

export interface ReadingRequest {
  /** The organisation's `connectors` row: its source says whether a mandate is needed. */
  connectorId: string;
  meterId: string;
  /** The readings asked for, `YYYY-MM-DD`, `to` excluded. */
  from: string;
  to: string;
  /** What is read; `load_curve` by default. */
  scope?: MandateScope;
  /** The step asked, an ISO 8601 duration (`PT30M`); the hub's own when absent. */
  step?: string;
  /** The day the mandate must be in force; today by default. */
  on?: string;
}

/**
 * The twin of `grid.authorise_reading()`: the approved mandate that allows
 * the reading, null when the connector's source reads without one. Refuses
 * as the function does (`mandate_missing`, `mandate_expired`,
 * `mandate_scope`, `connector_not_found`, `meter_not_found`).
 */
export async function authoriseReading(db: Db, request: ReadingRequest): Promise<MeterMandate | null> {
  const { rows } = await db.query<{ id: string | null }>(
    `select grid.authorise_reading($1, $2, $3::date, $4::date, coalesce($5::date, current_date), $6, $7) id`,
    [request.connectorId, request.meterId, request.from, request.to, request.on ?? null, request.scope ?? 'load_curve', request.step ?? null],
  );
  const id = rows[0]?.id ?? null;
  if (id === null) return null;
  const mandate = await db.query<MeterMandate>(
    `select id, operator, scope, granularity, data_from::text, data_to::text, valid_to::text, external_reference
       from grid.mandates where id = $1`, [id]);
  return mandate.rows[0]!;
}

/**
 * Refuses a reading under mandate without the mandate the check returned:
 * what every connector whose source has `auth = 'mandate'` calls first.
 */
export function requireMandate(sourceCode: string, mandate: MeterMandate | null | undefined, scope: MandateScope = 'load_curve'): MeterMandate {
  if (!mandate) {
    throw new GestureError(`mandate_missing: ${sourceCode} reads under mandate; pass the mandate grid.authorise_reading() returned`);
  }
  if (!mandate.scope.includes(scope)) {
    throw new GestureError(`mandate_scope: mandate ${mandate.id} does not allow ${scope}`);
  }
  return mandate;
}

/** The conventions of the hub of the operator that runs a meter, from its pack row. */
export async function meterDataHub(db: Db, meterId: string, operator?: string): Promise<MeterDataHub> {
  const { rows } = await db.query<{ code: string; meter_data: Record<string, unknown> }>(
    `select o.code, o.meter_data from grid.operators o
      where o.code = coalesce($2, grid.operator_of($1)->>'operator')`, [meterId, operator ?? null]);
  const row = rows[0];
  if (!row) throw new GestureError(`grid_operator_not_found: meter ${meterId}`);
  const data = row.meter_data ?? {};
  return {
    operator: row.code,
    time_zone: typeof data.time_zone === 'string' ? data.time_zone : null,
    quality_codes: (data.quality_codes ?? {}) as Record<string, number>,
    sources: Array.isArray(data.sources) ? (data.sources as string[]) : [],
    history_months: typeof data.history_months === 'number' ? data.history_months : null,
    steps: Array.isArray(data.steps) ? (data.steps as string[]) : [],
  };
}

/**
 * Reads a meter through a connector and keeps what it brought as the
 * measured series of the meter, each carrying the connector's source: the
 * mandate is checked first (`authoriseReading()`), the provider is given
 * the meter's identifier, the mandate and the conventions of its hub, and
 * nothing is written when the check refuses.
 */
export async function collectMeterReadings(
  db: Db,
  provider: MeterDataProvider,
  request: ReadingRequest,
): Promise<{ mandate: MeterMandate | null; stored: { quantity_code: string; seriesId: string; inserted: number }[] }> {
  const connector = (await db.query<{ organisation_id: string; source_code: string }>(
    `select organisation_id, source_code from connectors where id = $1`, [request.connectorId])).rows[0];
  if (!connector) throw new GestureError(`connector_not_found: ${request.connectorId}`);
  if (connector.source_code !== provider.source_code) {
    throw new GestureError(`connector_source_mismatch: connector ${request.connectorId} reads ${connector.source_code}, not ${provider.source_code}`);
  }
  const mandate = await authoriseReading(db, request);
  const meter = (await db.query<MeterOfHub>(
    `select identifier, scheme, direction from meters where id = $1`, [request.meterId])).rows[0]!;
  const hub = await meterDataHub(db, request.meterId, mandate?.operator);
  const collected: CollectedSeries[] = await provider.readings(meter, request.from, request.to, {
    ...(request.step ? { step: request.step } : {}), mandate, hub, scope: request.scope ?? 'load_curve',
  });
  const stored = [];
  for (const series of collected) {
    const { seriesId, inserted } = await storeSeries(db, {
      organisationId: connector.organisation_id, objectKind: 'meter', objectId: request.meterId,
      sourceCode: provider.source_code, kind: 'measured',
    }, series);
    stored.push({ quantity_code: series.quantity_code, seriesId, inserted });
  }
  return { mandate, stored };
}

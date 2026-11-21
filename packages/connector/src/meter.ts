// What a connector of a meter data hub speaks: the meter as the hub knows
// it, what a reading is given, the mandate it reads under and the
// conventions of the hub, read from its pack row. `collectMeterReadings()`
// of the core finds the mandate and stores what the connector returns.

import { GestureError } from './refusal.js';
import type { CollectedSeries } from './weather.js';

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

/** A meter as its operator's hub knows it: its identifier in a scheme, and what it can do. */
export interface MeterOfHub {
  identifier: string;
  scheme: string;
  /** Take from the grid, inject into it, or both (`meters.direction`). */
  direction?: 'offtake' | 'injection' | 'both';
}

/** What a reading of a meter is given beside the meter and the period. */
export interface MeterReadingOptions {
  /** The step asked, an ISO 8601 duration (`PT30M`); the hub's own when absent. */
  step?: string;
  /** What is read; `load_curve` by default. */
  scope?: MandateScope;
  /**
   * The mandate `grid.authorise_reading()` returned: a connector whose
   * source reads under mandate refuses without it (`requireMandate()`).
   */
  mandate?: MeterMandate | null;
  /** The conventions of the operator's hub, from its pack row: its time zone and its quality flags. */
  hub?: MeterDataHub;
}

/**
 * Readings of a meter from the grid operator's hub or a data hub, by its
 * identifier and scheme, from `from` to `to` (`YYYY-MM-DD`, `to` excluded).
 * `collectMeterReadings()` checks the mandate, calls it and stores what it
 * returns on the meter.
 */
export interface MeterDataProvider {
  readonly source_code: string;
  readings(meter: MeterOfHub, from: string, to: string, options?: MeterReadingOptions): Promise<CollectedSeries[]>;
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

// The meters and devices a stream of readings lands on, as a connector that
// receives them speaks to its caller: it names the object by an identifier
// the installation recorded, and hands the series it read to be written.
// The caller is the core (`measuredObjects()`), which reads the database
// under the connection's rights and writes through `store()`, with the
// provenance; the connector itself reaches neither (decision 0064).

import type { CollectedSeries } from './weather.js';

/** The object a stream's readings land on, with the time zone of its participant, which dates a meter's clock. */
export interface MeasuredTarget {
  organisationId: string;
  objectKind: 'meter' | 'device';
  objectId: string;
  timeZone: string;
}

/**
 * The object an identifier names, or why it names none, by name:
 * `identifier_unknown`, `identifier_ambiguous`, `object_not_measured`,
 * `time_zone_required`.
 */
export type MeasuredFound =
  | { target: MeasuredTarget; problem?: undefined }
  | { target?: undefined; problem: { code: string; detail: string } };

/** What a connector that streams readings asks of its caller. */
export interface MeasuredObjects {
  /**
   * The meter or the device known now by `value` in `scheme`, in
   * `organisationId` when given, among the objects the connection reads.
   */
  byIdentifier(scheme: string, value: string, options?: { organisationId?: string }): Promise<MeasuredFound>;
  /** Writes one series measured on the target, under the source; `inserted` counts the values that changed. */
  write(target: MeasuredTarget, sourceCode: string, series: CollectedSeries): Promise<{ seriesId: string; inserted: number }>;
}

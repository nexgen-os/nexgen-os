/**
 * `@nexgen-os/enedis-r6x` — the R63 (load curve) and R64 (index) files of
 * Enedis, JSON and XML, read into plain series: every step at its start in
 * UTC, the zone and the quality table given by the caller, problems by name.
 * No database, no network. The small XML reader is exported for the SOAP
 * answers of the same operator.
 */
export { readR6x } from './read.js';
export { parseXml, findFirst, findAll, childText, escapeXml, decodeEntities, type XmlNode } from './xml.js';
export { instantsOf, offsetAt, durationMs } from './time.js';
export type { R6xFile, R6xOptions, R6xPoint, R6xProblem, R6xSeries } from './types.js';

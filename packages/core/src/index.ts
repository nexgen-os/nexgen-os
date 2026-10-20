/**
 * `@nexgen-os/core` — what the code of Nexgen OS shares: the database seam,
 * the standard shape of a place and the geocoder chain, the interfaces of
 * the connectors, the series API (`store()` and the reads), the shared
 * geometry, the glue to the engines of other languages, and the importers
 * that write what a format library reads into the model.
 */
export type { Db } from './db.js';
export { orientation, polygonWkt, closed, type Point as Vertex } from './geometry.js';
export * from './address.js';
export * from './series.js';
export * from './time.js';
export * from './connectors.js';
export * from './engines/runner.js';
export * from './engines/pvlib.js';
export * from './engines/settlement.js';
export * from './files/index.js';

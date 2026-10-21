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
export * from './connectors/interfaces.js';
export * from './connectors/runner.js';
export * from './connectors/pvlib.js';
export * from './connectors/settlement.js';
export * from './connectors/sharing.js';
export * from './files/index.js';

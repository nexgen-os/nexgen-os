/**
 * `@nexgen-os/core` — what the code of Nexgen OS shares: the database seam,
 * the standard shape of a place and the geocoder chain, the interfaces of
 * the connectors, the series API (`store()` and the reads), the shared
 * geometry, the runner of the program connectors in other languages, the importers
 * that write what a format library reads into the model, and the gestures the
 * command line and the MCP server share, each acting as a person (`session.ts`).
 */
export type { Db } from './db.js';
export { orientation, polygonWkt, closed, type Point as Vertex } from './geometry.js';
export * from './address.js';
export * from './series.js';
export * from './time.js';
export * from './connectors/interfaces.js';
export * from './connectors/meter-data.js';
export * from './connectors/runner.js';
export * from './connectors/pvlib.js';
export * from './connectors/settlement.js';
export * from './connectors/sharing.js';
export * from './files/index.js';
export * from './sql.js';
export * from './identity.js';
export * from './refusal.js';
export * from './session.js';
export * from './gestures.js';
export * from './version.js';
export * from './geocoders.js';
export * from './surface.js';

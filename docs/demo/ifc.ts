// From an architect's IFC model to the places of a participant, and back
// out as GeoJSON: the file read by `@nexgen-os/ifc`, written by `importIfc()`
// of the `building` module (the building, its floors and rooms, its roof
// faces with azimuth and tilt, the equipment a device type names), then the
// participant exported by `exportGeoJson()` of the core — one transaction,
// acting as the person who runs it.
//
//   export NEXGEN_DB_URL=…            # the connection string, never written to a file
//   export NEXGEN_API_KEY=ngk_…       # a key with `write`, or NEXGEN_ACCESS_TOKEN / NEXGEN_ACT_AS_USER_ID with NEXGEN_WRITE=1
//   npx tsx docs/demo/ifc.ts <participant id> <model.ifc> <source code> [--open] > participant.geojson
//
// The participant exists (`participant add`), and so does the source the
// model comes from (`sources.code`, with its licence): an export `--open`
// leaves out what a source's licence does not let pass on. A model without a
// map conversion nor the IfcSite's coordinates is refused as
// `georeference_missing`; one imported already, as `already_imported`.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readIfc, type ReadOptions } from '@nexgen-os/ifc';
import { exportGeoJson, openPersonSession, readSurfaceConfig, type Db, type GeoJsonExport } from '@nexgen-os/core';
import { importIfc, type IfcImport, type IfcImportOptions } from '../../modules/building/src/index.js';

export interface IfcToGeoJsonOptions extends IfcImportOptions, ReadOptions {
  /** The export meant for the public (see `exportGeoJson()`). Default: false. */
  open?: boolean;
}

/** Reads `file`, writes its buildings and equipment under `participantId`, and exports the participant as it now stands. */
export async function ifcToGeoJson(
  db: Db,
  participantId: string,
  file: Uint8Array,
  options: IfcToGeoJsonOptions,
): Promise<{ imported: IfcImport; geojson: GeoJsonExport }> {
  const { open, origin, ...importOptions } = options;
  const model = await readIfc(file, { origin });
  const imported = await importIfc(db, { participantId }, model, importOptions);
  const geojson = await exportGeoJson(db, { participantId }, { open });
  return { imported, geojson };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const open = args.includes('--open');
  const [participantId, path, sourceCode] = args.filter((a) => a !== '--open');
  if (!participantId || !path || !sourceCode) {
    console.error('usage: NEXGEN_DB_URL=… NEXGEN_API_KEY=… npx tsx docs/demo/ifc.ts <participant id> <model.ifc> <source code> [--open]');
    process.exit(2);
  }
  const file = new Uint8Array(await readFile(path));
  const session = await openPersonSession(readSurfaceConfig(process.env, 'docs/demo/ifc.ts'));
  try {
    const { imported, geojson } = await session.run((db) => ifcToGeoJson(db, participantId, file, { sourceCode, open }));
    const c = imported.counts;
    console.error(`${imported.schema}, placed by ${imported.georeference} (${imported.crs}): ${c.buildings} building(s), ${c.floors} floor(s), ${c.spaces} space(s), ${c.roofs} roof face(s), ${c.devices} device(s)`);
    for (const s of imported.skipped) console.error(`  skipped ${s.count} ${s.entity}: ${s.reason}`);
    console.error(`${geojson.features.length} feature(s)${open ? `, ${geojson.nexgen_os.withheld} withheld` : ''}`);
    console.log(JSON.stringify(geojson, null, 2));
  } finally {
    await session.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

// The IFC path of docs/demo/ifc.ts, on PGlite: the house of the `building`
// module's IFC fixture with its equipment, read, written under a participant
// and exported again as GeoJSON — once as its organisation sees it, once
// open, where the model of a source that may not be passed on is left out.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ifcToGeoJson } from '../docs/demo/ifc.js';
import { USER_A, freshDatabase, organisation, participant, repoRoot } from './helpers/db.js';

const fixture = (name: string) => readFile(join(repoRoot, 'packages', 'formats', 'ifc', 'tests', 'fixtures', name)).then((b) => new Uint8Array(b));

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase(['building']);
  await db.query(`insert into sources (code, name, kind, license, attribution, redistributable, countries)
                  values ('architect_model', 'Architect model', 'file', 'Proprietary', '© The architect', false, '{NL}'),
                         ('open_model', 'Open model', 'file', 'CC-BY-4.0', '© The open architect', true, '{NL}')`);
});

afterAll(async () => {
  await db.close();
});

// One organisation per model: the fixtures describe the same house, and its rooms keep their GlobalIds.
const newParticipant = async (name: string) =>
  participant(db, { organisation_id: await organisation(db, `The owner of ${name}`, USER_A), name, country: 'NL', time_zone: 'Europe/Amsterdam' });

describe('an IFC model of a house with its equipment, to the model and back out as GeoJSON', () => {
  it('exports the participant with the building, its roof face and the equipment the file named', async () => {
    const home = await newParticipant('Canal house');
    const { imported, geojson } = await ifcToGeoJson(db, home, await fixture('ifc-house-equipment.ifc'), { sourceCode: 'open_model' });

    expect(imported.counts).toEqual({ buildings: 1, floors: 2, spaces: 3, roofs: 1, devices: 4 });
    expect(geojson.features.map((f) => f.properties.kind)).toEqual(['participant', 'building', 'surface', 'device', 'device', 'device', 'device']);

    // The participant is placed by the file's map conversion, at rooftop precision.
    const person = geojson.features[0]!;
    expect(person.id).toBe(home);
    expect(person.geometry?.type).toBe('Point');
    expect(person.properties).toMatchObject({ location_precision: 'rooftop' });

    // The building and its roof face in WGS 84, the face against true north.
    const building = geojson.features.find((f) => f.properties.kind === 'building')!;
    expect(building.id).toBe(imported.buildings[0]!.id);
    expect(building.geometry?.type).toMatch(/Polygon$/);
    expect(building.properties.global_id).toBe(imported.buildings[0]!.globalId);
    const roof = geojson.features.find((f) => f.properties.kind === 'surface')!;
    expect(roof.properties).toMatchObject({ surface_kind: 'roof', building_id: building.id });
    expect(roof.properties.azimuth_deg as number).toBeCloseTo(150, 0);

    // The equipment as devices, unplaced, each known by its GlobalId.
    const devices = geojson.features.filter((f) => f.properties.kind === 'device');
    expect(devices.map((d) => [d.properties.name, d.properties.device_type, d.geometry]).sort()).toEqual([
      ['Electricity meter', 'meter', null],
      ['Garden turbine', 'generator', null],
      ['Home battery', 'battery', null],
      ['Roof array', 'solar', null],
    ]);
    for (const d of devices) expect(d.properties.identifiers.map((i) => i.scheme)).toEqual(['ifc_guid']);

    expect(geojson.nexgen_os.sources).toEqual([{ code: 'open_model', name: 'Open model', license: 'CC-BY-4.0', attribution: '© The open architect' }]);
  });

  it('leaves the model out of the open export when its source may not be passed on, and refuses it a second time', async () => {
    const home = await newParticipant('Canal house, proprietary model');
    const file = await fixture('ifc-house-map-conversion.ifc');
    const { imported, geojson } = await ifcToGeoJson(db, home, file, { sourceCode: 'architect_model', open: true });
    expect(imported.counts).toMatchObject({ buildings: 1, roofs: 1 });
    expect(geojson.nexgen_os).toMatchObject({ open: true, withheld: 2 });
    expect(geojson.features.map((f) => f.properties.kind)).toEqual(['participant']);
    expect(geojson.nexgen_os.sources).toEqual([]);

    // A model is imported once: the same file again is refused before anything is written.
    await expect(ifcToGeoJson(db, home, file, { sourceCode: 'architect_model' })).rejects.toThrow(/already_imported/);
  });
});

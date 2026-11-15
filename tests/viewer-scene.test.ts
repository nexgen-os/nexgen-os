// The scene of a place, read from the description of the building module.
//
// A plot of 30 m by 20 m holds a block of 20 m by 12 m, raised from 2 m to
// 11 m above sea level, and two models of it: one in millimetres in a local
// frame at the block's south-west corner, turned by 30°, and the house of
// the IFC fixtures (packages/formats/ifc/tests/fixtures/), placed in RD New
// by its map conversion. Each model's matrix must put its points where
// building.model_to_world() puts them; the scene is what the person may read.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readIfc } from '@nexgen-os/ifc';
import { addModel, importIfc, placementOfIfc } from '../modules/building/src/index.js';
import { USER_A, USER_B, asUser, freshDatabase, one, organisation, participant, repoRoot, square } from './helpers/db.js';
import { localFrame, placeScene, readPlace, sceneOf, transform, type Wgs84 } from '@nexgen-os/viewer';

const sha256 = (bytes: Uint8Array | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const [LON, LAT] = [4.9, 52.37];

let db: PGlite;
let owner: string;
let block: string;
let plot: string;
let local: string;
let mapped: string;

/** Where building.model_to_world() puts a point of a model, in WGS 84. */
const placed = async (model: string, [x, y, z]: number[]): Promise<Wgs84> => {
  const g = await one<{ g: string }>(db, 'select ST_AsGeoJSON(building.model_to_world($1, ST_MakePoint($2, $3, $4))) g', [model, x, y, z]);
  const [lon, lat, h] = (JSON.parse(g.g) as { coordinates: number[] }).coordinates;
  return [lon, lat, h];
};

const length = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const perimeter = (ring: number[][]) => ring.reduce((sum, p, i) => sum + length(p, ring[(i + 1) % ring.length]), 0);
/** The perimeter of a row's outline, as PostGIS measures it in its UTM zone. */
const measured = async (table: string, column: string, id: string) =>
  (await one<{ m: number }>(
    db, `select ST_Perimeter(ST_Transform(ST_Force2D(${column}), metric_srid(${column}))) m from building.${table} where id = $1`, [id])).m;

beforeAll(async () => {
  db = await freshDatabase(['building']);
  const org = await organisation(db, 'A surveyor', USER_A);
  await db.query(`insert into sources (code, name, kind, license, attribution, countries) values
    ('survey', 'Survey', 'file', 'proprietary', '© The surveyor', '{NL}')`);
  owner = await participant(db, { organisation_id: org, name: 'Canal house', country: 'NL', time_zone: 'Europe/Amsterdam' });
  plot = (await one<{ id: string }>(
    db, `select building.add_site($1, 'Canal plot', ST_GeomFromGeoJSON($2), p_use => 'land') id`,
    [owner, JSON.stringify(square(LON - 0.0001, LAT - 0.0001, 30, 20, 2))])).id;
  block = (await one<{ id: string }>(
    db, `select building.add_building($1, 'Block A', ST_GeomFromGeoJSON($2), 2, 9, p_site_id => $3) id`,
    [owner, JSON.stringify(square(LON, LAT, 20, 12)), plot])).id;
  local = await addModel(db, {
    hostId: block, name: 'Block A, survey', format: 'gltf', sourceCode: 'survey',
    file: { uri: 'storage://models/block-a.glb', checksum: sha256('block-a') },
    placement: {
      srid: null, origin: [LON, LAT, 2], headingDeg: 30, scale: 1, unitM: 0.001, upAxis: 'z',
      verticalDatum: null, bounds: [0, 0, 0, 20000, 12000, 9000], lod: null, georeference: {},
    },
  });
  const mapFile = new Uint8Array(await readFile(join(repoRoot, 'packages', 'formats', 'ifc', 'tests', 'fixtures', 'ifc-house-map-conversion.ifc')));
  const ifc = await readIfc(mapFile);
  const house = (await importIfc(db, { participantId: owner }, ifc, { sourceCode: 'survey' })).buildings[0].id;
  mapped = await addModel(db, {
    hostId: house, name: 'Canal house, architect', format: 'ifc', sourceCode: 'survey',
    file: { uri: 'storage://models/canal-house.ifc', checksum: sha256(mapFile) },
    placement: placementOfIfc(ifc),
  });
});

afterAll(async () => {
  await db.close();
});

describe('the local frame', () => {
  it('keeps a metre a metre east, north and up', () => {
    const frame = localFrame([LON, LAT, 10]);
    expect(frame.toLocal([LON, LAT, 10]).map((v) => Math.abs(v))).toEqual([0, 0, 0]);
    // One second of latitude is about 30.9 m at 52° N, one of longitude about 18.9 m.
    const [e1, n1, u1] = frame.toLocal([LON, LAT + 1 / 3600, 10]);
    expect(Math.abs(e1)).toBeLessThan(1e-6);
    expect(n1).toBeCloseTo(30.91, 1);
    expect(u1).toBe(0);
    expect(frame.toLocal([LON + 1 / 3600, LAT, 10])[0]).toBeCloseTo(18.92, 1);
    expect(frame.toLocal([LON, LAT, 25])[2]).toBeCloseTo(15, 9);
  });
});

describe('the scene of a place', () => {
  it('starts at the centre of the place, at the lowest elevation of its buildings', async () => {
    const rows = await readPlace(db, owner);
    expect(rows.participant).toEqual({ id: owner, name: 'Canal house' });
    const lowest = Math.min(...rows.buildings.map((b) => b.elevationM ?? Infinity));
    expect(rows.origin[2]).toBe(lowest);
    expect(lowest).toBeLessThanOrEqual(2);
    expect(rows.sites.map((s) => s.id)).toEqual([plot]);
    expect(rows.buildings.map((b) => b.name)).toContain('Block A');
  });

  it('raises a building from its elevation to its height, on its footprint', async () => {
    const scene = await placeScene(db, owner);
    const a = scene.buildings.find((b) => b.id === block)!;
    expect(a.base).toBeCloseTo(2 - scene.origin[2], 9);
    expect(a.top).toBeCloseTo(a.base + 9, 9);
    expect(a.siteId).toBe(plot);
    const [ring] = a.polygons[0];
    expect(ring).toHaveLength(4);
    // The sides of the footprint, against PostGIS measuring it in its UTM
    // zone, whose scale differs from the ground by up to 0.04 %.
    expect(length(ring[0], ring[1])).toBeCloseTo(20, 0);
    expect(Math.abs(perimeter(ring) - (await measured('buildings', 'footprint', block)))).toBeLessThan(perimeter(ring) * 5e-4);
    expect(ring.every((p) => Math.abs(p[2] - a.base) < 0.01)).toBe(true);
    const site = scene.sites[0].polygons[0][0];
    expect(Math.abs(perimeter(site) - (await measured('sites', 'geometry', plot)))).toBeLessThan(perimeter(site) * 5e-4);
  });

  it('places each model by the matrix model_to_world() gives, to the millimetre', async () => {
    const scene = await placeScene(db, owner);
    const frame = localFrame(scene.origin);
    for (const id of [local, mapped]) {
      const model = scene.models.find((m) => m.id === id)!;
      const [x0, y0, z0, x1, y1, z1] = model.bounds!;
      for (const corner of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1]]) {
        const expected = frame.toLocal(await placed(id, corner));
        expect(length(transform(model.matrix, corner as [number, number, number]), expected)).toBeLessThan(0.001);
      }
    }
    const survey = scene.models.find((m) => m.id === local)!;
    expect(survey).toMatchObject({ hostKind: 'building', hostId: block, format: 'gltf', uri: 'storage://models/block-a.glb' });
    // 20 m of the model's X axis stay 20 m, and its top 9 m above its base.
    expect(length(transform(survey.matrix, [0, 0, 0]), transform(survey.matrix, [20000, 0, 0]))).toBeCloseTo(20, 3);
    expect(transform(survey.matrix, [0, 0, 9000])[2] - transform(survey.matrix, [0, 0, 0])[2]).toBeCloseTo(9, 3);
  });

  it('is what the person may read, and nothing for anyone else', async () => {
    const seen = await asUser(db, USER_A, () => placeScene(db, owner));
    expect(seen.models).toHaveLength(2);
    await expect(asUser(db, USER_B, () => placeScene(db, owner))).rejects.toThrow(/^participant_not_found:/);
  });

  it('refuses a place nothing of which has a geometry', async () => {
    const org = await organisation(db, 'Nowhere', USER_A);
    const bare = await participant(db, { organisation_id: org, name: 'No place', country: 'NL', time_zone: 'Europe/Amsterdam' });
    await expect(readPlace(db, bare)).rejects.toThrow(/^place_required:/);
  });

  it('draws from rows alone, with no database', () => {
    const scene = sceneOf({
      participant: { id: 'p', name: 'P' },
      origin: [LON, LAT, 0],
      sites: [],
      buildings: [{ id: 'b', name: 'B', siteId: null, footprint: null, elevationM: null, heightM: null }],
      models: [],
    });
    expect(scene.buildings[0]).toMatchObject({ polygons: [], base: 0, top: null });
  });
});

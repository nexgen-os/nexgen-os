// The georeferenced models of a building: the file stays where it is, its
// row says how it sits on the globe, and one function places any of them.
//
// The house of the IFC fixtures (packages/formats/ifc/tests/fixtures/), a
// base slab of 10 m by 6 m whose model X axis is 30° counter-clockwise from
// the grid east of RD New, at (121000, 487000), is described twice more:
// - by the same house in millimetres placed by its IfcSite's coordinates, a
//   local frame whose north is true north;
// - by a CityJSON of it, the gabled house of the CityJSON fixture
//   (packages/formats/cityjson/tests/fixtures/) turned by the same 30° about
//   its translation, its vertices in millimetres of RD New.
// Each lands as a model of the one building the IFC wrote, and each places
// the house on that building's footprint.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { CityJsonDocument } from '@nexgen-os/cityjson';
import { readIfc } from '@nexgen-os/ifc';
import { addModel, importIfc, placementOfCityJson, placementOfIfc } from '../src/index.js';
import { USER_A, USER_B, asUser, freshDatabase, one, organisation, participant, repoRoot } from '../../../tests/helpers/db.js';

const ifcFixture = (name: string) => readFile(join(repoRoot, 'packages', 'formats', 'ifc', 'tests', 'fixtures', name)).then((b) => new Uint8Array(b));
const sha256 = (bytes: Uint8Array | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** The CityJSON fixture turned by `deg` counter-clockwise about its translation, in its own vertex units. */
async function turnedCityJson(deg: number): Promise<CityJsonDocument> {
  const doc = JSON.parse(await readFile(join(repoRoot, 'packages', 'formats', 'cityjson', 'tests', 'fixtures', 'gabled-house.city.json'), 'utf8')) as CityJsonDocument;
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  doc.vertices = doc.vertices.map(([x, y, z]) => [Math.round(c * x - s * y), Math.round(s * x + c * y), z]);
  return doc;
}

/** A polygon in a model's coordinates, as WKT. */
const polygon = (ring: number[][]) => `POLYGON Z((${[...ring, ring[0]].map((p) => p.join(' ')).join(',')}))`;

let db: PGlite;
let org: string;
let owner: string;
let house: string;
let mapped: string;
let sited: string;
let city: string;
let cityDoc: CityJsonDocument;

/** How far apart two plans are, in metres: the Hausdorff distance in their UTM zone. */
const apart = async (a: string, b: string) =>
  (await one<{ m: number }>(
    db,
    `select ST_HausdorffDistance(ST_Transform(ST_Force2D(a), s), ST_Transform(ST_Force2D(b), s)) m
       from (select ($1)::geometry a, ($2)::geometry b) g, lateral (select metric_srid(g.a) s) z`,
    [a, b],
  )).m;
const footprintOf = async (buildingId: string) =>
  (await one<{ g: string }>(db, 'select footprint::text g from building.buildings where id = $1', [buildingId])).g;
const placed = async (modelId: string, wkt: string) =>
  (await one<{ g: string }>(db, 'select building.model_to_world($1, ST_GeomFromText($2))::text g', [modelId, wkt])).g;

beforeAll(async () => {
  db = await freshDatabase(['building']);
  org = await organisation(db, 'An architect', USER_A);
  await db.query(`insert into sources (code, name, kind, license, attribution, countries) values
    ('architect_model', 'Architect model', 'file', 'proprietary', '© The architect', '{NL}'),
    ('city_model', 'City model', 'file', 'CC-BY-4.0', '© The city', '{NL}')`);
  owner = await participant(db, { organisation_id: org, name: 'Canal house', country: 'NL', time_zone: 'Europe/Amsterdam' });

  const mapFile = await ifcFixture('ifc-house-map-conversion.ifc');
  const mapModel = await readIfc(mapFile);
  house = (await importIfc(db, { participantId: owner }, mapModel, { sourceCode: 'architect_model' })).buildings[0].id;
  mapped = await addModel(db, {
    hostId: house, name: 'Canal house, architect', format: 'ifc', sourceCode: 'architect_model',
    file: { uri: 'storage://models/canal-house.ifc', checksum: sha256(mapFile), byteSize: mapFile.byteLength, mediaType: 'application/x-step' },
    placement: placementOfIfc(mapModel),
  });

  const siteFile = await ifcFixture('ifc-house-site-coordinates.ifc');
  sited = await addModel(db, {
    hostId: house, name: 'Canal house, millimetres', format: 'ifc', sourceCode: 'architect_model',
    file: { uri: 'storage://models/canal-house-mm.ifc', checksum: sha256(siteFile) },
    placement: placementOfIfc(await readIfc(siteFile)),
  });

  cityDoc = await turnedCityJson(30);
  city = await addModel(db, {
    hostId: house, name: 'Canal house, city model', format: 'cityjson', sourceCode: 'city_model',
    file: { uri: 'https://city.example/tiles/canal-house.city.json', checksum: sha256(JSON.stringify(cityDoc)) },
    placement: placementOfCityJson(cityDoc),
  });
});

afterAll(async () => {
  await db.close();
});

describe('a model is a row that points to its file', () => {
  it('is registered by the module at 0.4.0, under the security of its organisation', async () => {
    expect((await one<{ version: string }>(db, `select version from modules where code = 'building'`)).version).toBe('0.4.0');
    const t = await one<{ rls: boolean }>(db, `select relrowsecurity rls from pg_class where oid = 'building.models'::regclass`);
    expect(t.rls).toBe(true);
    const seen = async (user: string) => asUser(db, user, async () => (await one<{ n: number }>(db, 'select count(*)::int n from building.models')).n);
    expect(await seen(USER_A)).toBe(3);
    expect(await seen(USER_B)).toBe(0);
  });

  it('keeps the file by address, size and checksum, never its bytes, and the georeferencing block as it came', async () => {
    const m = await one<Record<string, unknown>>(
      db, `select building_id, format, uri, byte_size::int, checksum, srid, heading_deg::float8 heading, scale::float8, unit_m::float8,
                  up_axis, georeference -> 'mapConversion' ->> 'Eastings' eastings, georeference ->> 'kind' kind
             from building.models where id = $1`, [mapped]);
    expect(m).toMatchObject({ building_id: house, format: 'ifc', uri: 'storage://models/canal-house.ifc', srid: 28992, up_axis: 'z', kind: 'map_conversion' });
    expect(m.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(m.byte_size).toBeGreaterThan(0);
    // The X axis 30° counter-clockwise from grid east puts the model's north 30° west of grid north.
    expect(m.heading).toBeCloseTo(330, 6);
    expect(m.scale).toBeCloseTo(1, 9);
    expect(m.unit_m).toBe(1);
    expect(Number(m.eastings)).toBe(121000);
    const columns = await db.query<{ data_type: string }>(
      `select data_type from information_schema.columns where table_schema = 'building' and table_name = 'models' and data_type = 'bytea'`);
    expect(columns.rows).toEqual([]);
  });

  it('reads the frame, units and bounds of a CityJSON from its transform and vertices', async () => {
    const m = await one<Record<string, unknown>>(
      db, `select srid, unit_m::float8, heading_deg::float8 heading, bounds::float8[], lod,
                  round(ST_X(ST_Transform(origin, 28992))::numeric, 3)::float8 x, round(ST_Y(ST_Transform(origin, 28992))::numeric, 3)::float8 y
             from building.models where id = $1`, [city]);
    expect(m).toMatchObject({ srid: 28992, unit_m: 0.001, heading: 0, lod: '2.2', x: 121000, y: 487000 });
    expect((m.bounds as number[]).slice(2)).toEqual([2000, expect.any(Number), expect.any(Number), 11500]);
  });

  it('is the participant\'s, through its building', async () => {
    expect((await one<{ p: string }>(db, `select building.participant_of('model', $1) p`, [city])).p).toBe(owner);
  });
});

describe('one function places every model', () => {
  it('lands an IFC and a CityJSON of one house on the footprint of its building', async () => {
    const footprint = await footprintOf(house);
    const slab = await placed(mapped, polygon([[0, 0, 0], [10, 0, 0], [10, 6, 0], [0, 6, 0]]));
    expect(await apart(slab, footprint)).toBeLessThan(0.01);
    // The CityJSON's ground ring, in its vertex units: the first four vertices.
    const ground = await placed(city, polygon(cityDoc.vertices.slice(0, 4)));
    expect(await apart(ground, footprint)).toBeLessThan(0.01);
    expect(await apart(ground, slab)).toBeLessThan(0.01);
    // Heights: the CityJSON's ground is 2 m above its datum, the IFC slab's top at 0.
    const z = await one<{ ifc: number; cj: number }>(
      db, `select ST_ZMin(building.model_to_world($1, ST_GeomFromText($3)))::float8 ifc,
                  ST_ZMin(building.model_to_world($2, ST_GeomFromText($4)))::float8 cj`,
      [mapped, city, polygon([[0, 0, 0], [10, 0, 0], [10, 6, 0]]), polygon(cityDoc.vertices.slice(0, 3))]);
    expect(z).toEqual({ ifc: 0, cj: 2 });
  });

  it('places the house in millimetres, by its site\'s coordinates in a local frame, where the map conversion does', async () => {
    const m = await one<{ srid: number | null; unit_m: number }>(db, 'select srid, unit_m::float8 from building.models where id = $1', [sited]);
    expect(m).toEqual({ srid: null, unit_m: 0.001 });
    const slab = await placed(sited, polygon([[0, 0, 0], [10000, 0, 0], [10000, 6000, 0], [0, 6000, 0]]));
    // The site's latitude and longitude name RD New's false origin to the datum shift between the two.
    expect(await apart(slab, await placed(mapped, polygon([[0, 0, 0], [10, 0, 0], [10, 6, 0], [0, 6, 0]])))).toBeLessThan(0.5);
  });

  it('gives the plan of a model\'s bounds, which holds its building', async () => {
    const covers = await one<{ ok: boolean }>(
      db, `select ST_Covers(ST_Buffer(ST_Transform(ST_Force2D(building.model_footprint($1)), 28992), 0.01),
                            ST_Transform(ST_Force2D(b.footprint), 28992)) ok
             from building.buildings b where b.id = $2`, [city, house]);
    expect(covers.ok).toBe(true);
    expect((await one<{ g: string | null }>(db, 'select building.model_footprint($1) g', [mapped])).g).toBeNull();
  });

  it('turns a y-up model in a local frame: its north is -z, its heading clockwise from true north', async () => {
    const layout = await addModel(db, {
      hostId: house, name: 'PV layout', format: 'glb', sourceCode: 'architect_model',
      file: { uri: 'storage://models/pv-layout.glb', checksum: 'sha256:00ff' },
      placement: {
        srid: null, origin: [4.9, 52.37, 3], headingDeg: 90, scale: 1, unitM: 1, upAxis: 'y',
        verticalDatum: 'ellipsoid', bounds: [0, 0, -1, 1, 5, 0], lod: null, georeference: {},
      },
    });
    const r = await one<{ azimuth: number; metres: number; z: number }>(
      db, `select degrees(ST_Azimuth(m.origin::geography, p::geography))::float8 azimuth,
                  ST_Distance(m.origin::geography, p::geography)::float8 metres, ST_Z(building.model_to_world(m.id, 'POINT Z(0 5 0)'))::float8 z
             from building.models m, lateral (select building.model_to_world(m.id, 'POINT Z(0 0 -1)') p) w where m.id = $1`, [layout]);
    expect(r.azimuth).toBeCloseTo(90, 3);
    expect(r.metres).toBeCloseTo(1, 4);
    expect(r.z).toBeCloseTo(8, 9);
  });
});

describe('what a model refuses, by name', () => {
  const placement = { srid: null, origin: [4.9, 52.37, 0] as [number, number, number], headingDeg: 0, scale: 1, unitM: 1, upAxis: 'z' as const, verticalDatum: null, bounds: null, lod: null, georeference: {} };

  it('a file imported twice, a host that is neither a building nor a ground, a frame the installation cannot transform', async () => {
    const checksum = (await one<{ c: string }>(db, 'select checksum c from building.models where id = $1', [mapped])).c;
    await expect(addModel(db, { hostId: house, name: 'Again', format: 'ifc', sourceCode: 'architect_model', file: { uri: 'storage://again.ifc', checksum }, placement }))
      .rejects.toThrow(/already_imported/);
    await expect(addModel(db, { hostId: owner, name: 'Nowhere', format: 'ifc', sourceCode: 'architect_model', file: { uri: 'storage://nowhere.ifc' }, placement }))
      .rejects.toThrow(/model_host_kind/);
    await expect(addModel(db, { hostId: house, name: 'Unknown grid', format: 'ifc', sourceCode: 'architect_model', file: { uri: 'storage://grid.ifc' }, placement: { ...placement, srid: 999999 } }))
      .rejects.toThrow(/^crs_unknown/);
    await expect(db.query(`select building.add_model($1, 'No origin', 'ifc', 'storage://x.ifc', null)`, [house])).rejects.toThrow(/model_origin_required/);
    await expect(db.query(`select building.model_to_world(gen_random_uuid(), 'POINT(0 0)')`)).rejects.toThrow(/model_not_found/);
  });
});

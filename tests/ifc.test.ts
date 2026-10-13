// An IFC4 model of a house — the way an architect hands it over — lands as
// a building on its site, with its floors, its spaces and their areas, its
// roof face with azimuth and tilt against true north, the GlobalId of each
// row and every property set the core has no column for.
//
// The two fixtures under tests/fixtures/ describe the same house, written by
// hand and commented in the files themselves:
// - ifc-house-map-conversion.ifc: lengths in metres, an IfcMapConversion to
//   RD New (EPSG:28992) with its false origin at (121000, 487000) and the
//   model's X axis 30° counter-clockwise from grid east; a base slab of
//   10 m × 6 m under the ground floor; storeys at 0 m and 3 m; a living
//   room (net 32.5 m²) and a kitchen (net 18 m²) downstairs, a bedroom
//   (gross 40 m² only) upstairs; a mono-pitch roof slab of four vertices
//   rising 30° towards the model's +Y, so facing the model's −Y; a tree.
// - ifc-house-site-coordinates.ifc: the same in millimetres, without a map
//   conversion: IfcSite's RefLatitude and RefLongitude name the point RD New
//   calls (121000, 487000), the context's TrueNorth turns the model by the
//   same 30°, and four exterior walls stand where the base slab was.
// Facing the model's −Y with its X axis 30° counter-clockwise from east,
// the roof faces 150° (south-south-east).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { importIfc } from '../formats/ifc/index.js';
import { USER_A, freshDatabase, insert, one, organisation, repoRoot } from './helpers/db.js';

const fixture = (name: string) => readFile(join(repoRoot, 'tests', 'fixtures', name)).then((b) => new Uint8Array(b));

let db: PGlite;
let org: string;
let mapFile: Uint8Array;
let siteFile: Uint8Array;

beforeAll(async () => {
  db = await freshDatabase(['architecture']);
  org = await organisation(db, 'An architect', USER_A);
  await db.query(`insert into sources (code, name, kind, license, attribution, countries) values ('architect_model', 'Architect model', 'file', 'proprietary', '© The architect', '{NL}')`);
  mapFile = await fixture('ifc-house-map-conversion.ifc');
  siteFile = await fixture('ifc-house-site-coordinates.ifc');
});

afterAll(async () => {
  await db.close();
});

const newSite = (organisationId: string, name: string) =>
  insert(db, 'sites', { organisation_id: organisationId, name, country: 'NL', time_zone: 'Europe/Amsterdam' });

interface BuildingRow {
  name: string; elevation: number; height: number; above: number; below: number; built: number; area: number; source: string;
  lon: number; lat: number; guid: string; landmarked: boolean; schema: string; file: string; site_precision: string; site_lon: number; site_lat: number;
}

const building = (id: string) =>
  one<BuildingRow>(
    db,
    `select b.name, b.elevation_m::float elevation, b.height_m::float height, b.floors_above_ground above, b.floors_below_ground below,
            b.year_built built, area_m2(b.footprint)::float area, b.source_code source,
            ST_X(ST_Centroid(b.footprint)) lon, ST_Y(ST_Centroid(b.footprint)) lat,
            (select value from external_ids where object_id = b.id and scheme = 'ifc_guid') guid,
            (b.metadata->'ifc'->'psets'->'Pset_BuildingCommon'->>'IsLandmarked')::boolean landmarked,
            b.metadata->'ifc'->'header'->>'schema' schema, b.metadata->'ifc'->'header'->>'name' file,
            s.location_precision site_precision, ST_X(s.geometry) site_lon, ST_Y(s.geometry) site_lat
       from buildings b join sites s on s.id = b.site_id where b.id = $1`,
    [id],
  );

const floors = (buildingId: string) =>
  db.query<{ name: string; level: number; elevation: number; height: number | null; guid: string; above: boolean }>(
    `select f.name, f.level, f.elevation_m::float elevation, f.height_m::float height,
            (select value from external_ids where object_id = f.id and scheme = 'ifc_guid') guid,
            (f.metadata->'ifc'->'psets'->'Pset_BuildingStoreyCommon'->>'AboveGround')::boolean above
       from architecture.floors f where f.building_id = $1 order by f.level`,
    [buildingId],
  ).then((r) => r.rows);

const spaces = (buildingId: string) =>
  db.query<{ name: string; level: number; area: number; guid: string; finish: string | null; number: string }>(
    `select s.name, f.level, s.area_m2::float area,
            (select value from external_ids where object_id = s.id and scheme = 'ifc_guid') guid,
            s.metadata->'ifc'->'psets'->'Pset_SpaceCoveringRequirements'->>'FloorFinish' finish,
            s.metadata->'ifc'->'attributes'->>'Name' number
       from architecture.spaces s join architecture.floors f on f.id = s.floor_id where f.building_id = $1 order by s.name`,
    [buildingId],
  ).then((r) => r.rows);

const roofs = (buildingId: string) =>
  db.query<{ name: string; azimuth: number; tilt: number; zmin: number; zmax: number; area: number; guid: string; source: string }>(
    `select f.name, f.azimuth_deg::float azimuth, f.tilt_deg::float tilt, ST_ZMin(f.geometry)::float zmin, ST_ZMax(f.geometry)::float zmax,
            area_m2(f.geometry)::float area, (select value from external_ids where object_id = f.id and scheme = 'ifc_guid') guid, f.source_code source
       from surfaces f where f.building_id = $1 and f.kind = 'roof'`,
    [buildingId],
  ).then((r) => r.rows);

describe('an IFC4 model with an IfcMapConversion', () => {
  let site: string;
  let id: string;

  it('lands as a building near 4.89° E, 52.37° N at rooftop precision, with its footprint from the base slab', async () => {
    site = await newSite(org, 'Canal house');
    const r = await importIfc(db, { organisationId: org, siteId: site }, mapFile, { sourceCode: 'architect_model', profile: 'residential' });
    expect(r.georeference).toBe('map_conversion');
    expect(r.crs).toBe('EPSG:28992');
    expect(r.locationPrecision).toBe('rooftop');
    expect(r.siteUpdated).toBe(true);
    expect(r.schema).toBe('IFC4');
    expect(r.counts).toEqual({ buildings: 1, floors: 2, spaces: 3, roofs: 1 });
    expect(r.buildings).toEqual([{ id: expect.any(String), globalId: '0K7w7JWBL5QOdBzu3Yz7Ts', footprint: 'slabs' }]);
    id = r.buildings[0].id;

    const b = await building(id);
    expect(b.name).toBe('Canal house');
    expect(b.source).toBe('architect_model');
    expect(b.elevation).toBe(0);
    expect(b.height).toBeCloseTo(9.464, 3);
    expect([b.above, b.below]).toEqual([2, 0]);
    expect(b.built).toBe(1962);
    expect(b.area).toBeCloseTo(60, 0);
    expect(b.lon).toBeCloseTo(4.89, 2);
    expect(b.lat).toBeCloseTo(52.37, 2);
    expect(b.guid).toBe('0K7w7JWBL5QOdBzu3Yz7Ts');
    expect(b.site_precision).toBe('rooftop');
    expect(b.site_lon).toBeCloseTo(4.88797, 4);
    expect(b.site_lat).toBeCloseTo(52.36983, 4);
  });

  it('keeps the property sets, the header and the georeferencing block in metadata.ifc', async () => {
    const b = await building(id);
    expect(b.landmarked).toBe(true);
    expect(b.schema).toBe('IFC4');
    expect(b.file).toBe('ifc-house-map-conversion.ifc');
    const m = await one<{ ifc: Record<string, any> }>(db, `select metadata->'ifc' ifc from buildings where id = $1`, [id]);
    expect(m.ifc.attributes).toMatchObject({ Name: 'Canal house', LongName: 'Het Grachtenhuis', Description: 'A narrow house on a canal', ElevationOfRefHeight: 0 });
    expect(m.ifc.psets.Pset_BuildingCommon.YearOfConstruction).toBe('1962');
    expect(m.ifc.georeference.mapConversion).toMatchObject({ Eastings: 121000, Northings: 487000, XAxisOrdinate: 0.5 });
    expect(m.ifc.georeference.projectedCrs).toMatchObject({ Name: 'EPSG:28992' });
    expect(m.ifc.header.description).toEqual(['ViewDefinition [ReferenceView_V1.2]']);
    expect(m.ifc.site).toMatchObject({ globalId: '1xS3BCk291UvhgP2dvNsgp', entity: 'IfcSite' });
  });

  it('gives each storey a floor, level 0 at the building’s reference height, and each space its area', async () => {
    expect(await floors(id)).toEqual([
      { name: '00 Ground floor', level: 0, elevation: 0, height: 3, guid: '3Tq9Gb8Hz7Rf2cW0aLmPkS', above: true },
      { name: '01 First floor', level: 1, elevation: 3, height: 6.464, guid: '1Nc4Tf6Uy0Hd8bQ2eVwXrJ', above: true },
    ]);
    expect(await spaces(id)).toEqual([
      // No LongName: the space keeps its Name, the room number.
      { name: '1.01', level: 1, area: 40, guid: '0Lv1Rm2Kt3Ws4Xy5Za6Bc9', finish: null, number: '1.01' },
      { name: 'Kitchen', level: 0, area: 18, guid: '0Lv1Rm2Kt3Ws4Xy5Za6Bc8', finish: null, number: '0.02' },
      { name: 'Living room', level: 0, area: 32.5, guid: '0Lv1Rm2Kt3Ws4Xy5Za6Bc7', finish: 'Oak parquet', number: '0.01' },
    ]);
  });

  it('turns the roof slab into a roof surface facing 150° against true north, tilted 30°', async () => {
    const [roof, ...others] = await roofs(id);
    expect(others).toEqual([]);
    expect(roof.name).toBe('Roof');
    // 150° on RD New's grid; its grid north is 0.4° off true north at Amsterdam.
    expect(roof.azimuth).toBeGreaterThan(149);
    expect(roof.azimuth).toBeLessThan(150.5);
    expect(roof.tilt).toBeCloseTo(30, 1);
    expect(roof.zmin).toBeCloseTo(6, 3);
    expect(roof.zmax).toBeCloseTo(9.464, 3);
    expect(roof.area).toBeCloseTo(60, 0); // the plan of a 10 m × 6.93 m face at 30°
    expect(roof.guid).toBe('3Rf0Sl1Ab2Cd3Ef4Gh5Ij6');
    expect(roof.source).toBe('architect_model');
  });

  it('reports what it left out, by entity type and reason, and refuses the same file twice', async () => {
    const again = await newSite(org, 'Canal house, again');
    await expect(importIfc(db, { organisationId: org, siteId: again }, mapFile, { sourceCode: 'architect_model' })).rejects.toThrow(/already_imported/);
    const other = await organisation(db, 'Another architect', USER_A);
    const r = await importIfc(db, { organisationId: other, siteId: await newSite(other, 'Canal house') }, mapFile, { sourceCode: 'architect_model' });
    expect(r.skipped).toEqual([
      { entity: 'IfcGeographicElement', count: 1, reason: 'no place in the core for this entity type' },
      { entity: 'IfcSlab', count: 1, reason: 'read for the footprint only' },
    ]);
  });
});

describe('an IFC4 model in millimetres placed by its site’s coordinates', () => {
  let id: string;
  let mapBuilding: BuildingRow;

  it('lands at parcel precision, at the same place as the map conversion puts it, with its footprint from the exterior walls', async () => {
    const other = await organisation(db, 'A surveyor', USER_A);
    const site = await newSite(other, 'Canal house');
    const r = await importIfc(db, { organisationId: other, siteId: site }, siteFile, { sourceCode: 'architect_model' });
    expect(r.georeference).toBe('site_coordinates');
    expect(r.crs).toMatch(/^\+proj=tmerc \+lat_0=52\.369826/);
    expect(r.locationPrecision).toBe('parcel');
    expect(r.counts).toEqual({ buildings: 1, floors: 2, spaces: 3, roofs: 1 });
    expect(r.buildings[0].footprint).toBe('walls');
    expect(r.skipped).toEqual([
      { entity: 'IfcGeographicElement', count: 1, reason: 'no place in the core for this entity type' },
      { entity: 'IfcWall', count: 4, reason: 'read for the footprint only' },
    ]);
    id = r.buildings[0].id;

    const b = await building(id);
    mapBuilding = await building((await one<{ id: string }>(db, `select object_id id from external_ids where scheme = 'ifc_guid' and value = '0K7w7JWBL5QOdBzu3Yz7Ts' and organisation_id = $1`, [org])).id);
    expect(b.site_precision).toBe('parcel');
    expect(b.area).toBeCloseTo(60, 0);
    expect(b.height).toBeCloseTo(9.464, 3);
    expect(b.built).toBe(1962);
    const apart = await one<{ m: number }>(
      db,
      `select ST_Distance(ST_MakePoint($1, $2)::geography, ST_MakePoint($3, $4)::geography) m`,
      [b.lon, b.lat, mapBuilding.lon, mapBuilding.lat],
    );
    expect(apart.m).toBeLessThan(0.5);
  });

  it('reads millimetres as metres: storey elevations, floor heights, the roof', async () => {
    expect((await floors(id)).map((f) => [f.level, f.elevation, f.height])).toEqual([[0, 0, 3], [1, 3, 6.464]]);
    expect((await spaces(id)).map((s) => [s.name, s.area])).toEqual([['1.01', 40], ['Kitchen', 18], ['Living room', 32.5]]);
    const [roof] = await roofs(id);
    // The local grid's north is true north: the 30° of TrueNorth exactly.
    expect(roof.azimuth).toBeCloseTo(150, 1);
    expect(roof.tilt).toBeCloseTo(30, 1);
    expect(roof.zmax).toBeCloseTo(9.464, 3);
  });
});

describe('an IFC model with no georeference', () => {
  const placeless = () => {
    const text = new TextDecoder().decode(siteFile).replace('(52,22,11,374355),(4,53,16,694753),0.', '$,$,$');
    return new TextEncoder().encode(text);
  };

  it('is refused by name', async () => {
    const other = await organisation(db, 'A draughtsman', USER_A);
    await expect(importIfc(db, { organisationId: other, siteId: await newSite(other, 'Somewhere') }, placeless(), { sourceCode: 'architect_model' }))
      .rejects.toThrow(/georeference_missing/);
  });

  it('lands where options.origin says, and leaves the site’s position alone', async () => {
    const other = await organisation(db, 'A draughtsman, with a map', USER_A);
    const site = await newSite(other, 'Canal house');
    const r = await importIfc(db, { organisationId: other, siteId: site }, placeless(), {
      sourceCode: 'architect_model',
      origin: { lon: 4.887971, lat: 52.369826, rotationDeg: 30 },
    });
    expect(r.georeference).toBe('none');
    expect(r.locationPrecision).toBeNull();
    expect(r.siteUpdated).toBe(false);
    const b = await building(r.buildings[0].id);
    expect(b.lon).toBeCloseTo(4.89, 2);
    expect(b.lat).toBeCloseTo(52.37, 2);
    expect(b.site_precision).toBeNull();
    const [roof] = await roofs(r.buildings[0].id);
    expect(roof.azimuth).toBeCloseTo(150, 1);
  });

  it('is refused by name when it is not IFC at all', async () => {
    await expect(importIfc(db, { organisationId: org, siteId: await newSite(org, 'Nowhere') }, new TextEncoder().encode('not a STEP file'), { sourceCode: 'architect_model' }))
      .rejects.toThrow(/not_ifc/);
  });
});

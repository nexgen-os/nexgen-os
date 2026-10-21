// A CityJSON 2.0 building — the way 3DBAG or a city publishes it — lands as
// a building with its footprint, height and roof faces, keeps the file's
// own attributes and identifier, and comes back out as CityJSON that lands
// the same way again.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readCityJson, sridOf, writeCityJson, type CityJsonDocument } from '@nexgen-os/cityjson';
import { orientation } from '@nexgen-os/core';
import { exportCityJson, importCityJson as importModel, type CityJsonImportOptions, type CityJsonTarget } from '../modules/building/src/index.js';
import { USER_A, freshDatabase, one, organisation, participant } from './helpers/db.js';

// A gabled house, 10 m by 6 m, ground at 2 m, eaves at 8 m, ridge at 11.5 m,
// in RD New (EPSG:28992), with the ridge along the x axis: the south pitch
// faces 180°, the north pitch 0°, both at atan(3.5 / 3) ≈ 49.4°.
const V = {
  0: [0, 0, 2000], 1: [10000, 0, 2000], 2: [10000, 6000, 2000], 3: [0, 6000, 2000],
  4: [0, 0, 8000], 5: [10000, 0, 8000], 6: [10000, 6000, 8000], 7: [0, 6000, 8000],
  8: [0, 3000, 11500], 9: [10000, 3000, 11500],
};
const house: CityJsonDocument = {
  type: 'CityJSON',
  version: '2.0',
  transform: { scale: [0.001, 0.001, 0.001], translate: [121000, 487000, 0] },
  metadata: { referenceSystem: 'https://www.opengis.net/def/crs/EPSG/0/28992' },
  CityObjects: {
    'NL.IMBAG.Pand.0363100012345678': {
      type: 'Building',
      attributes: { measuredHeight: 9.5, storeysAboveGround: 2, yearOfConstruction: 1962, b3_dak_type: 'multiple horizontal', identificatie: 'NL.IMBAG.Pand.0363100012345678' },
      geometry: [
        {
          type: 'Solid',
          lod: '2.2',
          boundaries: [[
            [[0, 3, 2, 1]],          // ground
            [[0, 1, 5, 4]],          // south wall
            [[2, 3, 7, 6]],          // north wall
            [[3, 0, 4, 7]],          // west wall
            [[1, 2, 6, 5]],          // east wall
            [[4, 5, 9, 8]],          // south pitch
            [[7, 8, 9, 6]],          // north pitch
            [[4, 8, 7]],             // west gable
            [[6, 9, 5]],             // east gable
          ]],
          semantics: {
            surfaces: [
              { type: 'GroundSurface' },
              { type: 'WallSurface' },
              { type: 'RoofSurface', b3_azimut: 180, b3_hellingshoek: 49.4 },
              { type: 'RoofSurface', b3_azimut: 0, b3_hellingshoek: 49.4 },
            ],
            values: [[0, 1, 1, 1, 1, 2, 3, 1, 1]],
          },
        },
      ],
    },
    'NL.IMBAG.Pand.0363100012345678-0': { type: 'BuildingPart', parents: ['NL.IMBAG.Pand.0363100012345678'] },
    'some-tree': { type: 'SolitaryVegetationObject', geometry: [] },
  },
  vertices: Object.values(V),
};

// The file through the format library, then the model through the core's importer.
const importCityJson = async (target: CityJsonTarget, doc: CityJsonDocument, options: CityJsonImportOptions & { srid?: number }) =>
  importModel(db, target, readCityJson(doc, { srid: options.srid }), options);

let db: PGlite;
let org: string;
let owner: string;

beforeAll(async () => {
  db = await freshDatabase(['building']);
  org = await organisation(db, 'A city', USER_A);
  await db.query(`insert into sources (code, name, kind, license, attribution, countries) values ('city_model', 'City 3D model', 'file', 'CC-BY-4.0', '© The city', '{NL}')`);
  owner = await participant(db, { organisation_id: org, name: 'Canal house', country: 'NL', time_zone: 'Europe/Amsterdam' });
});

afterAll(async () => {
  await db.close();
});

describe('orientation of a face', () => {
  it('reads azimuth and tilt from the outward normal', () => {
    const south = orientation([[0, 0, 8], [10, 0, 8], [10, 3, 11.5], [0, 3, 11.5]]);
    expect(Math.round(south.azimuth)).toBe(180);
    expect(south.tilt).toBeCloseTo(49.4, 0);
    const flat = orientation([[0, 0, 5], [10, 0, 5], [10, 6, 5], [0, 6, 5]]);
    expect(flat.tilt).toBeCloseTo(0, 5);
    expect(sridOf('https://www.opengis.net/def/crs/EPSG/0/7415')).toBe(7415);
    expect(sridOf('EPSG:28992')).toBe(28992);
    expect(sridOf(undefined)).toBeNull();
  });
});

describe('a CityJSON building', () => {
  let buildingId: string;

  it('lands as a building with its footprint, height, floors, year, identifier and the attributes the core has no column for', async () => {
    const r = await importCityJson({ participantId: owner }, house, { sourceCode: 'city_model', profile: 'residential' });
    expect(r.buildings).toHaveLength(1);
    expect(r.surfaces).toBe(8);
    expect(r.skipped).toEqual(['some-tree']);
    buildingId = r.buildings[0].id;
    const b = await one<{ name: string; elevation: number; height: number; floors: number; built: number; area: number; source: string; dak: string; ext: string; lon: number; lat: number }>(
      db,
      `select b.name, b.elevation_m::float elevation, b.height_m::float height, (attributes_of(b.id)->>'floors_above_ground')::int floors,
              (attributes_of(b.id)->>'year_built')::int built,
              area_m2(b.footprint)::float area, b.source_code source, b.metadata->'cityjson'->'attributes'->>'b3_dak_type' dak,
              (select value from external_ids where object_id = b.id and scheme = 'cityjson') ext,
              ST_X(ST_Centroid(b.footprint)) lon, ST_Y(ST_Centroid(b.footprint)) lat
         from building.buildings b where b.id = $1`,
      [buildingId],
    );
    expect(b.name).toBe('NL.IMBAG.Pand.0363100012345678');
    expect(b.elevation).toBe(2);
    expect(b.height).toBe(9.5);
    expect(b.floors).toBe(2);
    expect(b.built).toBe(1962);
    expect(b.area).toBeCloseTo(60, 0);
    expect(b.source).toBe('city_model');
    expect(b.dak).toBe('multiple horizontal');
    expect(b.ext).toBe('NL.IMBAG.Pand.0363100012345678');
    expect(b.lon).toBeCloseTo(4.89, 1);
    expect(b.lat).toBeCloseTo(52.37, 1);
  });

  it('turns roof and wall faces into building.surfaces with azimuth and tilt, the ground face into the footprint only', async () => {
    const r = await db.query<{ kind: string; azimuth: number | null; tilt: number; type: string; zmax: number }>(
      `select kind, azimuth_deg::float azimuth, tilt_deg::float tilt, metadata->'cityjson'->>'type' type, ST_ZMax(geometry)::float zmax
         from building.surfaces where building_id = $1 order by kind, azimuth_deg nulls first, name`,
      [buildingId],
    );
    // Against true north: RD New's grid north is 0.4° off at Amsterdam, so the pitches read 179.6° and 359.6°.
    const roofs = r.rows.filter((x) => x.kind === 'roof').map((x) => [Math.round(x.azimuth ?? 0) % 360, Math.round(x.tilt), x.zmax]).sort((a, b) => a[0] - b[0]);
    expect(roofs).toEqual([[0, 49, 11.5], [180, 49, 11.5]]);
    expect(r.rows.filter((x) => x.kind === 'facade')).toHaveLength(6);
    expect(r.rows.filter((x) => x.kind === 'facade').every((x) => Math.round(x.tilt) === 90)).toBe(true);
    expect(r.rows.some((x) => x.type === 'GroundSurface')).toBe(false);
  });

  it('comes back out as CityJSON 2.0 with LoD 1 and LoD 2, and lands the same way when imported again', async () => {
    const out = writeCityJson(await exportCityJson(db, { participantId: owner }));
    expect(out.version).toBe('2.0');
    expect(out.metadata?.referenceSystem).toBe('https://www.opengis.net/def/crs/EPSG/0/32631');
    const object = out.CityObjects['NL.IMBAG.Pand.0363100012345678'];
    expect(object.type).toBe('Building');
    expect(object.attributes).toMatchObject({ measuredHeight: 9.5, storeysAboveGround: 2, yearOfConstruction: 1962, b3_dak_type: 'multiple horizontal' });
    expect(object.geometry?.map((g) => [g.type, g.lod])).toEqual([['Solid', '1'], ['MultiSurface', '2']]);
    expect((object.geometry?.[0].boundaries[0] as unknown[]).length).toBe(6); // floor, roof, four walls
    expect(object.geometry?.[1].semantics?.surfaces.map((s) => s.type).sort()).toEqual(['GroundSurface', 'RoofSurface', 'RoofSurface', 'WallSurface', 'WallSurface', 'WallSurface', 'WallSurface', 'WallSurface', 'WallSurface']);
    expect(out.vertices.every((v) => v.every(Number.isInteger))).toBe(true);

    await expect(importCityJson({ participantId: owner }, out, { sourceCode: 'city_model' })).rejects.toThrow(/already_imported/);
    const other = await organisation(db, 'Another city', USER_A);
    const again = await participant(db, { organisation_id: other, name: 'Canal house, again', country: 'NL', time_zone: 'Europe/Amsterdam' });
    const r = await importCityJson({ participantId: again }, out, { sourceCode: 'city_model' });
    expect(r.surfaces).toBe(8);
    const b = await one<{ height: number; area: number; ext: string; dak: string; roofs: string }>(
      db,
      `select b.height_m::float height, area_m2(b.footprint)::float area,
              (select value from external_ids where object_id = b.id and scheme = 'cityjson') ext,
              b.metadata->'cityjson'->'attributes'->>'b3_dak_type' dak,
              (select string_agg((round(azimuth_deg)::int % 360)::text || '/' || round(tilt_deg)::int::text, ',' order by round(azimuth_deg)::int % 360) from building.surfaces where building_id = b.id and kind = 'roof') roofs
         from building.buildings b where b.id = $1`,
      [r.buildings[0].id],
    );
    expect(b.height).toBe(9.5);
    expect(b.area).toBeCloseTo(60, 0);
    expect(b.ext).toBe('NL.IMBAG.Pand.0363100012345678');
    expect(b.dak).toBe('multiple horizontal');
    expect(b.roofs).toBe('0/49,180/49');
  });

  it('refuses a file without a reference system, and one the installation cannot transform, by name', async () => {
    const { metadata, ...withoutCrs } = house;
    await expect(importCityJson({ participantId: owner }, withoutCrs as CityJsonDocument, { sourceCode: 'city_model' })).rejects.toThrow(/crs_required/);
    await expect(importCityJson({ participantId: owner }, house, { sourceCode: 'city_model', srid: 999999 })).rejects.toThrow(/crs_unknown/);
    expect(metadata?.referenceSystem).toBeDefined();
  });
});

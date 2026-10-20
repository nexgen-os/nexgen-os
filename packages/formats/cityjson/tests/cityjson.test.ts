// A CityJSON building read into plain shapes and written back, with no
// database: the shapes say what the file says, in its reference system, and
// a written document reads back the same.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCityJson, sridOf, writeCityJson, type CityJsonDocument } from '@nexgen-os/cityjson';

// A gabled house, 10 m by 6 m, ground at 2 m, eaves at 8 m, ridge at 11.5 m,
// in RD New (EPSG:28992), with a BuildingPart and a tree beside it.
const house = JSON.parse(readFileSync(new URL('./fixtures/gabled-house.city.json', import.meta.url), 'utf8')) as CityJsonDocument;
const ID = 'NL.IMBAG.Pand.0363100012345678';

describe('reading a CityJSON document', () => {
  const model = readCityJson(house);
  const b = model.buildings[0];

  it('names the reference system, the buildings and what it left alone', () => {
    expect(model.srid).toBe(28992);
    expect(model.buildings.map((x) => x.id)).toEqual([ID]);
    expect(model.skipped).toEqual(['some-tree']);
    expect(b.lods).toEqual([2.2]);
  });

  it('carries the CityGML attributes as the file says them, the others as they came', () => {
    expect(b).toMatchObject({ name: null, measuredHeight: 9.5, storeysAboveGround: 2, storeysBelowGround: null, yearOfConstruction: 1962 });
    expect(b.attributes).toEqual({ b3_dak_type: 'multiple horizontal', identificatie: ID });
  });

  it('resolves the vertices through the transform, and computes nothing', () => {
    expect(b.zRange).toEqual([2, 11.5]);
    expect(b.footprint).toEqual([[[[121000, 487000, 2], [121000, 487006, 2], [121010, 487006, 2], [121010, 487000, 2]]]]);
    expect(b.surfaces.map((s) => s.type)).toEqual(['GroundSurface', 'WallSurface', 'WallSurface', 'WallSurface', 'WallSurface', 'RoofSurface', 'RoofSurface', 'WallSurface', 'WallSurface']);
    expect(b.surfaces[5].attributes).toEqual({ b3_azimut: 180, b3_hellingshoek: 49.4 });
    expect(b.surfaces[5]).not.toHaveProperty('azimuth');
  });

  it('refuses what is not CityJSON, and a file without a reference system, by name', () => {
    expect(() => readCityJson({ type: 'FeatureCollection' } as unknown as CityJsonDocument)).toThrow(/^not_cityjson/);
    const { metadata: _, ...withoutCrs } = house;
    expect(() => readCityJson(withoutCrs as CityJsonDocument)).toThrow(/^crs_required/);
    expect(readCityJson(withoutCrs as CityJsonDocument, { srid: 7415 }).srid).toBe(7415);
  });

  it('reads EPSG codes from CRS names and URIs', () => {
    expect(sridOf('https://www.opengis.net/def/crs/EPSG/0/7415')).toBe(7415);
    expect(sridOf('EPSG:28992')).toBe(28992);
    expect(sridOf(undefined)).toBeNull();
  });
});

describe('writing a CityJSON document', () => {
  const read = readCityJson(house).buildings[0];
  const out = writeCityJson({
    srid: 28992,
    buildings: [{ ...read, surfaces: read.surfaces.filter((s) => s.type !== 'GroundSurface'), solid: read.surfaces.map((s) => s.polygon) }],
  });

  it('writes CityJSON 2.0: a LoD 1 solid, LoD 2 surfaces with the footprint as ground, integer vertices', () => {
    expect(out.version).toBe('2.0');
    expect(out.metadata?.referenceSystem).toBe('https://www.opengis.net/def/crs/EPSG/0/28992');
    const object = out.CityObjects[ID];
    expect(object.geometry?.map((g) => [g.type, g.lod])).toEqual([['Solid', '1'], ['MultiSurface', '2']]);
    expect(object.geometry?.[1].semantics?.surfaces[0]).toEqual({ type: 'GroundSurface' });
    expect(object.attributes).toEqual({ b3_dak_type: 'multiple horizontal', identificatie: ID, measuredHeight: 9.5, storeysAboveGround: 2, yearOfConstruction: 1962 });
    expect(out.vertices.every((v) => v.every(Number.isInteger))).toBe(true);
  });

  it('reads back the same building', () => {
    const again = readCityJson(out).buildings[0];
    expect(again).toMatchObject({ id: ID, measuredHeight: 9.5, storeysAboveGround: 2, yearOfConstruction: 1962, attributes: read.attributes, zRange: [2, 11.5] });
    expect(again.surfaces.map((s) => s.type).sort()).toEqual(read.surfaces.map((s) => s.type).sort());
    expect(again.footprint[0][0].map((p) => p.map((c) => Math.round(c * 1000) / 1000)).sort()).toEqual([...read.footprint[0][0]].sort());
  });
});

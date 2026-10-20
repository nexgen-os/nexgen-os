// GeoJSON written from plain features and read back, with no database: the
// bounding box around every position, the foreign members kept, and what a
// document holds that is not a feature reported rather than corrected.
import { describe, expect, it } from 'vitest';
import { bbox, readGeoJson, writeGeoJson, type Feature } from '@nexgen-os/geojson';

const place: Feature = {
  type: 'Feature',
  id: 'site-1',
  geometry: { type: 'Point', coordinates: [4.3517, 50.8466, 56] },
  properties: { name: 'Town hall', city: 'Brussels', location_precision: 'rooftop', location_source_code: 'urbis' },
};
const roof: Feature = {
  type: 'Feature',
  id: 'roof-1',
  geometry: { type: 'Polygon', coordinates: [[[4.351, 50.846, 70], [4.352, 50.846, 70], [4.352, 50.847, 72], [4.351, 50.846, 70]]] },
  properties: { name: 'South roof' },
};

describe('writing GeoJSON', () => {
  it('writes one FeatureCollection with its bbox, the features in order, then the foreign members', () => {
    const fc = writeGeoJson([place, roof], { source: { code: 'urbis' } });
    expect(Object.keys(fc)).toEqual(['type', 'bbox', 'features', 'source']);
    expect(fc.bbox).toEqual([4.351, 50.846, 4.352, 50.847]);
    expect(fc.features.map((f) => f.id)).toEqual(['site-1', 'roof-1']);
  });

  it('leaves the bbox out when no feature has a shape', () => {
    expect(bbox([{ ...place, geometry: null }])).toBeNull();
    expect(writeGeoJson([{ ...place, geometry: null }])).not.toHaveProperty('bbox');
  });

  it('walks geometry collections', () => {
    expect(bbox([{ ...place, geometry: { type: 'GeometryCollection', geometries: [place.geometry!, roof.geometry!] } }])).toEqual([4.351, 50.846, 4.352, 50.847]);
  });
});

describe('reading GeoJSON', () => {
  it('reads back what it wrote, the foreign members apart', () => {
    const text = JSON.stringify(writeGeoJson([place, roof], { source: { code: 'urbis' } }));
    const r = readGeoJson(text);
    expect(r.features).toEqual([place, roof]);
    expect(r.members).toEqual({ source: { code: 'urbis' } });
    expect(r.warnings).toEqual([]);
  });

  it('takes a Feature or a bare geometry as one feature', () => {
    expect(readGeoJson(place).features).toEqual([place]);
    expect(readGeoJson(place.geometry).features).toEqual([{ type: 'Feature', geometry: place.geometry, properties: {} }]);
  });

  it('reports a member that is not a feature, and a geometry of no RFC 7946 type, and keeps the rest', () => {
    const r = readGeoJson({ type: 'FeatureCollection', features: [place, { type: 'Point' }, { ...roof, geometry: { type: 'Circle' } }] });
    expect(r.features).toEqual([place]);
    expect(r.warnings.map((w) => [w.code, w.index])).toEqual([['not_a_feature', 1], ['geometry_unknown', 2]]);
  });

  it('refuses what is not GeoJSON, by name', () => {
    expect(() => readGeoJson({ type: 'CityJSON' })).toThrow(/^not_geojson/);
    expect(() => readGeoJson('42')).toThrow(/^not_geojson/);
  });
});

// GeoJSON (RFC 7946) ⇄ plain features.
//
// GeoJSON is what every web map, every GIS and every open-data portal
// reads, and the one interchange format of places: a place travels as a
// Feature whose properties carry its address, its precision and its source.
// This library declares the shapes of RFC 7946, writes features as one
// FeatureCollection with its bounding box and the foreign members a writer
// adds, and reads a document — a FeatureCollection, a Feature or a bare
// geometry — back into features, reporting what it cannot read rather than
// correcting it. It imports nothing, opens no connection and calls no
// network.
//
// SPDX-License-Identifier: MIT

export type Position = number[];

export interface Geometry {
  type: 'Point' | 'MultiPoint' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon' | 'GeometryCollection';
  coordinates?: unknown;
  geometries?: Geometry[];
}

export interface Feature<P = Record<string, unknown>> {
  type: 'Feature';
  id?: string | number;
  geometry: Geometry | null;
  properties: P;
}

export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  bbox?: number[];
  features: Feature<P>[];
  /** Foreign members (RFC 7946 §6.1): what a writer says of the document. */
  [member: string]: unknown;
}

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);

/**
 * Features as one FeatureCollection: a `bbox` around every position when
 * there is one, then the features in the order given, then the foreign
 * members. Coordinates are written as given: WGS 84 longitude, latitude
 * and height, outer rings counter-clockwise, are the writer's to give.
 */
export function writeGeoJson<P, M extends Record<string, unknown> = Record<string, never>>(
  features: Feature<P>[],
  members?: M,
): FeatureCollection<P> & M {
  const box = bbox(features);
  return { type: 'FeatureCollection', ...(box ? { bbox: box } : {}), features, ...(members ?? {}) } as FeatureCollection<P> & M;
}

export interface GeoJsonWarning {
  code: 'not_a_feature' | 'geometry_unknown';
  /** The position of the feature in the document. */
  index: number;
  message: string;
}

/**
 * A GeoJSON document as features: a FeatureCollection gives its features,
 * a Feature itself, a bare geometry a feature without properties. A member
 * that is not a feature, or a geometry of no RFC 7946 type, is left out and
 * reported. Refuses `not_geojson` for anything else.
 */
export function readGeoJson(input: string | unknown): { features: Feature[]; members: Record<string, unknown>; warnings: GeoJsonWarning[] } {
  const doc = (typeof input === 'string' ? JSON.parse(input) : input) as Record<string, unknown> | null;
  const warnings: GeoJsonWarning[] = [];
  if (!doc || typeof doc !== 'object') throw new Error('not_geojson: the document is not a GeoJSON object');
  if (doc.type === 'FeatureCollection' && Array.isArray(doc.features)) {
    const { type: _t, features, bbox: _b, ...members } = doc;
    const out: Feature[] = [];
    (features as unknown[]).forEach((f, index) => {
      const feature = f as Feature | null;
      if (!feature || feature.type !== 'Feature') {
        warnings.push({ code: 'not_a_feature', index, message: `member ${index} of the collection is not a Feature` });
      } else if (feature.geometry && !GEOMETRY_TYPES.has(feature.geometry.type)) {
        warnings.push({ code: 'geometry_unknown', index, message: `feature ${index} has a geometry of type ${String(feature.geometry.type)}` });
      } else {
        out.push({ ...feature, geometry: feature.geometry ?? null, properties: feature.properties ?? {} });
      }
    });
    return { features: out, members, warnings };
  }
  if (doc.type === 'Feature') {
    const feature = doc as unknown as Feature;
    return { features: [{ ...feature, geometry: feature.geometry ?? null, properties: feature.properties ?? {} }], members: {}, warnings };
  }
  if (typeof doc.type === 'string' && GEOMETRY_TYPES.has(doc.type)) {
    return { features: [{ type: 'Feature', geometry: doc as unknown as Geometry, properties: {} }], members: {}, warnings };
  }
  throw new Error('not_geojson: neither a FeatureCollection, a Feature nor a geometry');
}

/** West, south, east, north of every position of the features (RFC 7946 §5), or null when none has a shape. */
export function bbox(features: Feature<unknown>[]): number[] | null {
  let box: number[] | null = null;
  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      const [x, y] = c as number[];
      box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
      return;
    }
    for (const inner of c) visit(inner);
  };
  const walk = (g: Geometry | null): void => {
    if (!g) return;
    if (g.type === 'GeometryCollection') (g.geometries ?? []).forEach(walk);
    else visit(g.coordinates);
  };
  for (const f of features) walk(f.geometry);
  return box;
}

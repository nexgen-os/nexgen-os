// CityJSON 2.0 ⇄ plain shapes.
//
// CityJSON (https://www.cityjson.org, OGC community standard) is how cities
// and national 3D models publish buildings: 3DBAG for the Netherlands, UrbIS
// for Brussels, the CityGML LoD2 datasets of German states once converted.
// This library reads the Buildings of a document — with their
// BuildingParts — into plain shapes: the CityGML attributes, the faces that
// make the footprint, the semantic faces of the finest level of detail,
// every coordinate resolved in the file's reference system. It writes such
// shapes back as a CityJSON 2.0 document: a LoD 1 solid, LoD 2 semantic
// surfaces, the attributes. It computes no figure: a height, an azimuth or
// a tilt is the reader's business. It imports nothing, opens no connection
// and calls no network.
//
// SPDX-License-Identifier: MIT

export interface CityJsonTransform {
  scale: [number, number, number];
  translate: [number, number, number];
}

export interface SemanticSurface {
  type: string;
  [attribute: string]: unknown;
}

export interface CityJsonGeometry {
  type: 'MultiSurface' | 'CompositeSurface' | 'Solid' | 'MultiSolid' | 'CompositeSolid' | 'MultiPoint' | 'MultiLineString';
  lod: string | number;
  boundaries: unknown[];
  semantics?: { surfaces: SemanticSurface[]; values: unknown[] };
}

export interface CityObject {
  type: string;
  attributes?: Record<string, unknown>;
  geometry?: CityJsonGeometry[];
  children?: string[];
  parents?: string[];
  geographicalExtent?: number[];
}

export interface CityJsonDocument {
  type: 'CityJSON';
  version: string;
  transform?: CityJsonTransform;
  metadata?: { referenceSystem?: string; geographicalExtent?: number[]; [key: string]: unknown };
  CityObjects: Record<string, CityObject>;
  vertices: number[][];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// The plain shapes
// ---------------------------------------------------------------------------

/** A point in the document's reference system: x, y, z. */
export type Point = [number, number, number];
/** A ring, not closed (CityJSON's convention: the last point is not the first repeated). */
export type Ring = Point[];
/** An outer ring, then its holes. */
export type Polygon = Ring[];

/** A face with its semantics: `RoofSurface`, `WallSurface`, `GroundSurface`… */
export interface CitySurface {
  /** The CityGML type of the semantic surface. */
  type: string;
  lod: number;
  polygon: Polygon;
  /** The semantic surface's attributes (3DBAG's `b3_*`, a `name`), its type left out. */
  attributes: Record<string, unknown>;
}

/** A Building, as the file says it. */
export interface CityBuilding {
  /** The CityObject id. */
  id: string;
  /** `attributes.name`, when the file gives one. */
  name: string | null;
  measuredHeight: number | null;
  storeysAboveGround: number | null;
  storeysBelowGround: number | null;
  yearOfConstruction: number | null;
  /** Every other attribute of the CityObject, as the file writes it. */
  attributes: Record<string, unknown>;
  /** The faces whose plan is the footprint: ground surfaces, else the LoD 0 faces, else every face (read); the plan of the building (written as its ground surface). */
  footprint: Polygon[];
  /** The semantic faces of the finest level of detail that has semantics (read); the LoD 2 surfaces (written). */
  surfaces: CitySurface[];
  /** The BuildingParts the building is made of, by id (read only). */
  parts?: string[];
  /** The levels of detail the file gives, in order (read only). */
  lods?: number[];
  /** The lowest and highest z of the building's outer rings (read only); null without geometry. */
  zRange?: [number, number] | null;
  /** The faces of a LoD 1 solid (written only). */
  solid?: Polygon[];
}

export interface CityModel {
  /** The EPSG code of the coordinates. */
  srid: number;
  buildings: CityBuilding[];
  /** CityObjects of other types than Building and BuildingPart, left alone (read only). */
  skipped?: string[];
}

export interface ReadOptions {
  /** EPSG code of the file's coordinates, when its metadata does not say, or says a compound CRS a reader cannot transform. */
  srid?: number;
}

/** The EPSG code of a CRS name or URI (`https://www.opengis.net/def/crs/EPSG/0/7415`, `EPSG:28992`). */
export function sridOf(referenceSystem: string | undefined): number | null {
  if (!referenceSystem) return null;
  const m = /EPSG\/\d+\/(\d+)\s*$/.exec(referenceSystem) ?? /EPSG:+(\d+)\s*$/i.exec(referenceSystem);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** CityGML attributes the shape has a field for. */
const NAMED_ATTRIBUTES = ['measuredHeight', 'storeysAboveGround', 'storeysBelowGround', 'yearOfConstruction', 'name'];

interface Face {
  rings: Ring[];
  semantic: SemanticSurface | null;
  lod: number;
}

/** The Buildings of a document. Refuses `not_cityjson`, and `crs_required` when neither the file nor the options name the reference system. */
export function readCityJson(doc: CityJsonDocument, options: ReadOptions = {}): CityModel {
  if (doc?.type !== 'CityJSON') throw new Error('not_cityjson: the document is not a CityJSON file');
  const srid = options.srid ?? sridOf(doc.metadata?.referenceSystem);
  if (!srid) throw new Error('crs_required: the file names no reference system; give options.srid');
  const vertices = resolveVertices(doc);
  const model: CityModel = { srid, buildings: [], skipped: [] };
  for (const [id, object] of Object.entries(doc.CityObjects)) {
    if (object.type !== 'Building') {
      if (object.type !== 'BuildingPart') model.skipped!.push(id);
      continue;
    }
    const parts = (object.children ?? []).filter((c) => doc.CityObjects[c]?.type === 'BuildingPart');
    const faces = [object, ...parts.map((p) => doc.CityObjects[p])].flatMap((o) => facesOf(o, vertices));
    const all = object.attributes ?? {};
    const attributes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(all)) if (!NAMED_ATTRIBUTES.includes(k)) attributes[k] = v;
    const zs = faces.flatMap((f) => f.rings[0].map((p) => p[2]));
    const semanticLods = [...new Set(faces.filter((f) => f.semantic).map((f) => f.lod))];
    const bestLod = semanticLods.length ? Math.max(...semanticLods) : null;
    model.buildings.push({
      id,
      name: stringOrNull(all.name),
      measuredHeight: numberOrNull(all.measuredHeight),
      storeysAboveGround: numberOrNull(all.storeysAboveGround),
      storeysBelowGround: numberOrNull(all.storeysBelowGround),
      yearOfConstruction: numberOrNull(all.yearOfConstruction),
      attributes,
      footprint: footprintFacesOf(faces).map((f) => f.rings),
      surfaces: faces
        .filter((f) => f.semantic && f.lod === bestLod)
        .map((f) => {
          const { type, ...rest } = f.semantic!;
          return { type, lod: f.lod, polygon: f.rings, attributes: rest };
        }),
      parts,
      lods: [...new Set(faces.map((f) => f.lod))].sort((a, b) => a - b),
      zRange: zs.length ? [Math.min(...zs), Math.max(...zs)] : null,
    });
  }
  return model;
}

function resolveVertices(doc: CityJsonDocument): Point[] {
  const t = doc.transform;
  return doc.vertices.map((v) =>
    t ? [v[0] * t.scale[0] + t.translate[0], v[1] * t.scale[1] + t.translate[1], v[2] * t.scale[2] + t.translate[2]] : [v[0], v[1], v[2]],
  );
}

/** Every polygon of a CityObject's surface geometries, with its semantic surface when the geometry has them. */
function facesOf(object: CityObject, vertices: Point[]): Face[] {
  const faces: Face[] = [];
  for (const g of object.geometry ?? []) {
    const lod = Number(g.lod);
    const semantics = g.semantics;
    const surface = (rings: unknown, value: unknown) => {
      const sem = semantics && typeof value === 'number' ? semantics.surfaces[value] ?? null : null;
      faces.push({ rings: (rings as number[][]).map((ring) => ring.map((i) => vertices[i])), semantic: sem, lod });
    };
    const values = semantics?.values as unknown[] | undefined;
    if (g.type === 'MultiSurface' || g.type === 'CompositeSurface') {
      g.boundaries.forEach((s, i) => surface(s, values?.[i]));
    } else if (g.type === 'Solid') {
      (g.boundaries as unknown[][]).forEach((shell, si) => shell.forEach((s, i) => surface(s, (values?.[si] as unknown[] | undefined)?.[i])));
    } else if (g.type === 'MultiSolid' || g.type === 'CompositeSolid') {
      (g.boundaries as unknown[][][]).forEach((solid, oi) =>
        solid.forEach((shell, si) => shell.forEach((s, i) => surface(s, ((values?.[oi] as unknown[] | undefined)?.[si] as unknown[] | undefined)?.[i]))),
      );
    }
  }
  return faces;
}

/** The faces whose projection is the footprint: ground surfaces, else the LoD0 faces, else every face. */
function footprintFacesOf(faces: Face[]): Face[] {
  const ground = faces.filter((f) => f.semantic?.type === 'GroundSurface');
  if (ground.length) return ground;
  const lod0 = faces.filter((f) => f.lod < 1);
  if (lod0.length) return lod0;
  return faces;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Buildings as a CityJSON 2.0 document: a LoD 1 `Solid` from `solid`, a
 * LoD 2 `MultiSurface` with the footprint as its ground surface and the
 * surfaces with their semantics, the named attributes as CityGML writes
 * them and the others as they came. Vertices are integers in millimetres,
 * through the transform.
 */
export function writeCityJson(model: CityModel): CityJsonDocument {
  const vertexIndex = new Map<string, number>();
  const vertices: number[][] = [];
  const vertex = (p: Point): number => {
    const key = p.map((c) => Math.round(c * 1000)).join(',');
    let i = vertexIndex.get(key);
    if (i === undefined) {
      i = vertices.length;
      vertexIndex.set(key, i);
      vertices.push(key.split(',').map(Number));
    }
    return i;
  };
  const indices = (polygon: Polygon): number[][] => polygon.map((ring) => ring.map(vertex));

  const CityObjects: Record<string, CityObject> = {};
  for (const b of model.buildings) {
    const attributes: Record<string, unknown> = { ...b.attributes };
    if (b.name !== null) attributes.name = b.name;
    if (b.measuredHeight !== null) attributes.measuredHeight = b.measuredHeight;
    if (b.storeysAboveGround !== null) attributes.storeysAboveGround = b.storeysAboveGround;
    if (b.storeysBelowGround !== null) attributes.storeysBelowGround = b.storeysBelowGround;
    if (b.yearOfConstruction !== null) attributes.yearOfConstruction = b.yearOfConstruction;

    const geometry: CityJsonGeometry[] = [];
    if (b.solid?.length) geometry.push({ type: 'Solid', lod: '1', boundaries: [b.solid.map(indices)] });
    if (b.surfaces.length) {
      const semanticSurfaces: SemanticSurface[] = [];
      const values: number[] = [];
      const boundaries: number[][][] = [];
      // A ground surface faces down: its rings run the other way round from its plan.
      for (const plan of b.footprint) {
        boundaries.push(indices(plan.map((ring) => [...ring].reverse())));
        semanticSurfaces.push({ type: 'GroundSurface' });
        values.push(semanticSurfaces.length - 1);
      }
      for (const s of b.surfaces) {
        boundaries.push(indices(s.polygon));
        semanticSurfaces.push({ type: s.type, ...s.attributes });
        values.push(semanticSurfaces.length - 1);
      }
      geometry.push({ type: 'MultiSurface', lod: '2', boundaries, semantics: { surfaces: semanticSurfaces, values } });
    }
    CityObjects[b.id] = { type: 'Building', attributes, geometry };
  }

  const mins = [0, 1, 2].map((k) => Math.min(...vertices.map((v) => v[k])));
  const maxs = [0, 1, 2].map((k) => Math.max(...vertices.map((v) => v[k])));
  return {
    type: 'CityJSON',
    version: '2.0',
    transform: { scale: [0.001, 0.001, 0.001], translate: [mins[0] / 1000, mins[1] / 1000, mins[2] / 1000] },
    metadata: {
      referenceSystem: `https://www.opengis.net/def/crs/EPSG/0/${model.srid}`,
      geographicalExtent: [mins[0] / 1000, mins[1] / 1000, mins[2] / 1000, maxs[0] / 1000, maxs[1] / 1000, maxs[2] / 1000],
    },
    CityObjects,
    vertices: vertices.map((v) => [v[0] - mins[0], v[1] - mins[1], v[2] - mins[2]]),
  };
}

// ---------------------------------------------------------------------------

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

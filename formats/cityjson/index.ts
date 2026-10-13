// CityJSON 2.0 ⇄ Nexgen OS.
//
// CityJSON (https://www.cityjson.org, OGC community standard) is how cities
// and national 3D models publish buildings: 3DBAG for the Netherlands, UrbIS
// for Brussels, the CityGML LoD2 datasets of German states once converted.
// A Building and its BuildingParts become one row of `buildings` — footprint,
// elevation, height, floors, year — and its roof and wall faces become rows
// of `surfaces` with their azimuth and tilt, each with the source it came
// from and the CityObject id it is known by. Attributes the core has no
// column for travel in `metadata.cityjson`, so that the export gives them
// back. MIT, like every format library.

import type { Db } from '../db.js';

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

export interface ImportTarget {
  organisationId: string;
  siteId: string;
  scenarioId?: string | null;
}

export interface ImportOptions {
  /** The `sources.code` the file comes from (a city model, a national dataset). */
  sourceCode: string;
  /** EPSG code of the file's coordinates, when its metadata does not say or says a compound CRS the installation cannot transform. */
  srid?: number;
  /** The profile every imported building gets, when the file does not say. */
  profile?: string | null;
}

export interface ImportResult {
  buildings: { id: string; cityObjectId: string }[];
  surfaces: number;
  /** CityObjects of other types, left alone. */
  skipped: string[];
}

/** CityGML attributes the core has a column for. */
const ATTRIBUTE_COLUMNS = ['measuredHeight', 'storeysAboveGround', 'storeysBelowGround', 'yearOfConstruction', 'name'] as const;

/** Semantic surface types and the kind of `surfaces` they become; the others shape the footprint or are left out. */
const SURFACE_KINDS: Record<string, 'roof' | 'facade'> = {
  RoofSurface: 'roof',
  OuterFloorSurface: 'roof',
  WallSurface: 'facade',
};

type Point = [number, number, number];
interface Face {
  /** Outer ring then holes, each a closed-or-not list of points in the file's CRS. */
  rings: Point[][];
  semantic: SemanticSurface | null;
  lod: number;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function importCityJson(db: Db, target: ImportTarget, doc: CityJsonDocument, options: ImportOptions): Promise<ImportResult> {
  if (doc.type !== 'CityJSON') throw new Error('not_cityjson: the document is not a CityJSON file');
  const srid = options.srid ?? sridOf(doc.metadata?.referenceSystem);
  if (!srid) throw new Error('crs_required: the file names no reference system; give options.srid');
  const known = await db.query<{ n: number }>('select count(*)::int n from spatial_ref_sys where srid = $1', [srid]);
  if (known.rows[0].n === 0) throw new Error(`crs_unknown: EPSG:${srid} is not in spatial_ref_sys`);

  const vertices = resolveVertices(doc);
  const result: ImportResult = { buildings: [], surfaces: 0, skipped: [] };

  for (const [id, object] of Object.entries(doc.CityObjects)) {
    if (object.type !== 'Building') {
      if (object.type !== 'BuildingPart') result.skipped.push(id);
      continue;
    }
    const already = await db.query<{ object_id: string }>(
      `select object_id from external_ids where organisation_id = $1 and scheme = 'cityjson' and value = $2`,
      [target.organisationId, id],
    );
    if (already.rows.length) {
      throw new Error(`already_imported: ${id} is building ${already.rows[0].object_id} of this organisation`);
    }
    const parts = (object.children ?? []).filter((c) => doc.CityObjects[c]?.type === 'BuildingPart');
    const faces = [object, ...parts.map((p) => doc.CityObjects[p])].flatMap((o) => facesOf(o, vertices));
    const attributes = { ...(object.attributes ?? {}) };
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attributes)) if (!(ATTRIBUTE_COLUMNS as readonly string[]).includes(k)) extra[k] = v;

    const zs = faces.flatMap((f) => f.rings[0].map((p) => p[2]));
    const minZ = zs.length ? Math.min(...zs) : null;
    const maxZ = zs.length ? Math.max(...zs) : null;
    const measured = numberOrNull(attributes.measuredHeight);
    const height = measured ?? (minZ !== null && maxZ !== null ? round(maxZ - minZ, 3) : null);
    const elevation = minZ !== null ? round(minZ, 3) : null;

    const footprintFaces = footprintFacesOf(faces);
    const footprintWkts = footprintFaces.map((f) => polygonWkt(f.rings));
    const lods = [...new Set(faces.map((f) => f.lod))].sort((a, b) => a - b);

    const building = await db.query<{ id: string }>(
      `insert into buildings (organisation_id, site_id, scenario_id, name, profile, footprint, elevation_m, height_m,
                              floors_above_ground, floors_below_ground, year_built, source_code, metadata)
       select $1, $2, $3, $4, $5,
              case when g.u is null then null else
                ST_Transform(ST_SetSRID(ST_Force3D(ST_CollectionExtract(ST_MakeValid(g.u), 3), coalesce($7, 0)), $8), 4326) end,
              $7, $9, $10, $11, $12, $13, $14
         from (select ST_Union(ST_Force2D(ST_GeomFromText(w))) u from unnest($6::text[]) w) g
       returning id`,
      [
        target.organisationId, target.siteId, target.scenarioId ?? null,
        stringOrNull(attributes.name) ?? id, options.profile ?? null,
        footprintWkts, elevation, srid, height,
        integerOrNull(attributes.storeysAboveGround), integerOrNull(attributes.storeysBelowGround), integerOrNull(attributes.yearOfConstruction),
        options.sourceCode,
        JSON.stringify({ cityjson: { id, type: object.type, parts, lods, attributes: extra } }),
      ],
    );
    const buildingId = building.rows[0].id;
    result.buildings.push({ id: buildingId, cityObjectId: id });

    await db.query(`insert into external_ids (object_id, scheme, value) values ($1, 'cityjson', $2)`, [buildingId, id]);

    // Roof and wall faces of the finest level of detail that has semantics.
    const semanticLods = [...new Set(faces.filter((f) => f.semantic).map((f) => f.lod))];
    const bestLod = semanticLods.length ? Math.max(...semanticLods) : null;
    let n = 0;
    for (const face of faces) {
      if (face.lod !== bestLod || !face.semantic) continue;
      const kind = SURFACE_KINDS[face.semantic.type];
      if (!kind) continue;
      n += 1;
      const { normal, tilt } = orientation(face.rings[0]);
      const { type, ...semanticAttributes } = face.semantic;
      // The azimuth is measured against true north, not the grid's: a point
      // ten metres down the slope from the face's centre, both taken to
      // WGS 84, give the bearing whatever the projection's convergence.
      const centre = face.rings[0].reduce((acc, p) => [acc[0] + p[0] / face.rings[0].length, acc[1] + p[1] / face.rings[0].length], [0, 0]);
      const horizontal = Math.hypot(normal[0], normal[1]);
      const sloped = tilt !== null && tilt >= 1 && horizontal > 0;
      await db.query(
        `insert into surfaces (organisation_id, building_id, scenario_id, name, kind, geometry, azimuth_deg, tilt_deg, source_code, metadata)
         values ($1, $2, $3, $4, $5, ST_Transform(ST_SetSRID(ST_GeomFromText($6), $7), 4326),
                 case when $8::boolean then round(degrees(ST_Azimuth(
                   ST_Transform(ST_SetSRID(ST_MakePoint($9, $10), $7), 4326)::geography,
                   ST_Transform(ST_SetSRID(ST_MakePoint($11, $12), $7), 4326)::geography))::numeric, 2) end,
                 $13, $14, $15)`,
        [
          target.organisationId, buildingId, target.scenarioId ?? null,
          stringOrNull(semanticAttributes.name) ?? `${type} ${n}`, kind,
          polygonWkt(face.rings), srid,
          sloped, centre[0], centre[1], centre[0] + (10 * normal[0]) / (horizontal || 1), centre[1] + (10 * normal[1]) / (horizontal || 1),
          tilt !== null ? round(tilt, 2) : null,
          options.sourceCode,
          JSON.stringify({ cityjson: { lod: face.lod, type, attributes: semanticAttributes } }),
        ],
      );
    }
    result.surfaces += n;
  }
  return result;
}

/** The EPSG code of a CityJSON `referenceSystem` (`https://www.opengis.net/def/crs/EPSG/0/7415`, `EPSG:28992`). */
export function sridOf(referenceSystem: string | undefined): number | null {
  if (!referenceSystem) return null;
  const m = /EPSG\/\d+\/(\d+)\s*$/.exec(referenceSystem) ?? /EPSG:+(\d+)\s*$/i.exec(referenceSystem);
  return m ? Number(m[1]) : null;
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

function polygonWkt(rings: Point[][]): string {
  return `POLYGON Z (${rings.map((ring) => `(${closed(ring).map((p) => `${p[0]} ${p[1]} ${p[2]}`).join(',')})`).join(',')})`;
}

function closed(ring: Point[]): Point[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] && first[2] === last[2] ? ring : [...ring, first];
}

/**
 * The outward unit normal of a face by Newell's method, its tilt (degrees
 * from horizontal) and its azimuth in the grid of the face's CRS (degrees
 * clockwise from grid north). CityJSON rings are counter-clockwise seen from
 * outside, in a projected CRS in metres. The import measures the azimuth
 * against true north instead, since grid north drifts from it away from a
 * projection's central meridian.
 */
export function orientation(ring: Point[]): { azimuth: number; tilt: number | null; normal: [number, number, number] } {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(nx, ny, nz);
  if (length === 0) return { azimuth: 0, tilt: null, normal: [0, 0, 0] };
  const tilt = (Math.acos(nz / length) * 180) / Math.PI;
  const azimuth = ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360;
  return { azimuth, tilt, normal: [nx / length, ny / length, nz / length] };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** EPSG code of the output; default: the UTM zone of the site. */
  srid?: number;
}

interface BuildingRow {
  id: string;
  name: string;
  elevation_m: string | null;
  height_m: string | null;
  floors_above_ground: number | null;
  floors_below_ground: number | null;
  year_built: number | null;
  metadata: { cityjson?: { id?: string; attributes?: Record<string, unknown> } };
  city_id: string | null;
  srid: number;
  footprint: string | null;
  volume: string[] | null;
}

interface SurfaceRow {
  building_id: string;
  name: string;
  kind: string;
  metadata: { cityjson?: { type?: string; attributes?: Record<string, unknown> } };
  geometry: string;
}

/**
 * The buildings of a site as a CityJSON 2.0 document: LoD 1 solid from the
 * footprint and height, LoD 2 surfaces from `surfaces` when there are any,
 * CityGML attributes from the columns and the file's own attributes back
 * from `metadata.cityjson`.
 */
export async function exportCityJson(db: Db, where: { siteId: string }, options: ExportOptions = {}): Promise<CityJsonDocument> {
  const buildings = await db.query<BuildingRow>(
    `with s as (select coalesce($2::int, (select metric_srid(ST_Collect(footprint)) from buildings where site_id = $1)) srid)
     select b.id, b.name, b.elevation_m, b.height_m, b.floors_above_ground, b.floors_below_ground, b.year_built, b.metadata,
            (select value from external_ids e where e.object_id = b.id and e.scheme = 'cityjson' limit 1) city_id,
            s.srid,
            ST_AsGeoJSON(ST_Transform(b.footprint, s.srid)) footprint,
            (select array_agg(ST_AsGeoJSON(ST_Transform(d.geom, s.srid))) from ST_Dump(building_volume(b.id)) d) volume
       from buildings b, s
      where b.site_id = $1 and b.scenario_id is null
      order by b.created_at, b.id`,
    [where.siteId, options.srid ?? null],
  );
  if (buildings.rows.length === 0) throw new Error('nothing_to_export: the site has no building');
  const srid = buildings.rows[0].srid;
  const surfaces = await db.query<SurfaceRow>(
    `select f.building_id, f.name, f.kind, f.metadata, ST_AsGeoJSON(ST_Transform(f.geometry, $2::int)) geometry
       from surfaces f join buildings b on b.id = f.building_id
      where b.site_id = $1 and f.scenario_id is null and f.geometry is not null
      order by f.created_at, f.id`,
    [where.siteId, srid],
  );

  const vertexIndex = new Map<string, number>();
  const vertices: number[][] = [];
  const vertex = (p: number[]): number => {
    const key = p.map((c) => Math.round(c * 1000)).join(',');
    let i = vertexIndex.get(key);
    if (i === undefined) {
      i = vertices.length;
      vertexIndex.set(key, i);
      vertices.push(key.split(',').map(Number));
    }
    return i;
  };
  const ringIndices = (ring: number[][]): number[] => {
    const pts = ring.slice(0, -1); // GeoJSON rings are closed; CityJSON rings are not
    return pts.map(vertex);
  };
  const polygonIndices = (geojson: string): number[][] => (JSON.parse(geojson) as { coordinates: number[][][] }).coordinates.map(ringIndices);

  const CityObjects: Record<string, CityObject> = {};
  for (const b of buildings.rows) {
    const id = b.city_id ?? b.metadata.cityjson?.id ?? b.id;
    const attributes: Record<string, unknown> = { ...(b.metadata.cityjson?.attributes ?? {}) };
    if (b.name !== id) attributes.name = b.name;
    if (b.height_m !== null) attributes.measuredHeight = Number(b.height_m);
    if (b.floors_above_ground !== null) attributes.storeysAboveGround = b.floors_above_ground;
    if (b.floors_below_ground !== null) attributes.storeysBelowGround = b.floors_below_ground;
    if (b.year_built !== null) attributes.yearOfConstruction = b.year_built;

    const geometry: CityJsonGeometry[] = [];
    if (b.volume && b.volume.length) {
      geometry.push({ type: 'Solid', lod: '1', boundaries: [b.volume.map((face) => polygonIndices(face))] });
    }
    const own = surfaces.rows.filter((s) => s.building_id === b.id);
    if (own.length) {
      const semanticSurfaces: SemanticSurface[] = [];
      const values: number[] = [];
      const boundaries: number[][][] = [];
      if (b.footprint) {
        boundaries.push(polygonIndices(b.footprint).map((ring) => ring.reverse()));
        semanticSurfaces.push({ type: 'GroundSurface' });
        values.push(0);
      }
      for (const s of own) {
        boundaries.push(polygonIndices(s.geometry));
        semanticSurfaces.push({ type: s.metadata.cityjson?.type ?? (s.kind === 'roof' ? 'RoofSurface' : 'WallSurface'), ...(s.metadata.cityjson?.attributes ?? {}), name: s.name });
        values.push(semanticSurfaces.length - 1);
      }
      geometry.push({ type: 'MultiSurface', lod: '2', boundaries, semantics: { surfaces: semanticSurfaces, values } });
    }
    CityObjects[id] = { type: 'Building', attributes, geometry };
  }

  const mins = [0, 1, 2].map((k) => Math.min(...vertices.map((v) => v[k])));
  const maxs = [0, 1, 2].map((k) => Math.max(...vertices.map((v) => v[k])));
  return {
    type: 'CityJSON',
    version: '2.0',
    transform: { scale: [0.001, 0.001, 0.001], translate: [mins[0] / 1000, mins[1] / 1000, mins[2] / 1000] },
    metadata: {
      referenceSystem: `https://www.opengis.net/def/crs/EPSG/0/${srid}`,
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
function integerOrNull(v: unknown): number | null {
  const n = numberOrNull(v);
  return n === null ? null : Math.round(n);
}
function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}
function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

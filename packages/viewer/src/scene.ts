/**
 * The scene of a participant's place: what the `building` module describes
 * of it, in one local frame of metres, ready to be drawn by any renderer.
 *
 * It is read as the person who opens the viewer, through the `Db` seam,
 * under row level security: what they may not read is not in the scene.
 * Nothing is written. The ground of the participant is its sites; a
 * building is its footprint raised from its elevation to its height; a
 * model is the file of its row, placed by the matrix that
 * `building.model_to_world()` gives — the one placement of a model, read
 * from the database, never again from the file
 * ([0008](../../../docs/decisions/0008-the-building-module-describes-what-is-built.md)).
 */
import type { Db } from '@nexgen-os/core';
import { localFrame, type Local, type LocalFrame, type Wgs84 } from './frame.js';

/** A GeoJSON polygon or multipolygon, as `ST_AsGeoJSON()` gives it. */
export type AreaGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/** The rows a scene is made of, as the database gives them. */
export interface PlaceRows {
  participant: { id: string; name: string };
  /** Where the frame starts: longitude, latitude and height in metres. */
  origin: Wgs84;
  sites: { id: string; name: string; geometry: AreaGeometry | null }[];
  buildings: {
    id: string;
    name: string;
    siteId: string | null;
    footprint: AreaGeometry | null;
    elevationM: number | null;
    heightM: number | null;
  }[];
  models: {
    id: string;
    name: string;
    format: string;
    uri: string;
    hostKind: 'building' | 'site';
    hostId: string;
    /** Min x, y, z, max x, y, z, in model units. */
    bounds: number[] | null;
    /** The model's points (0, 0, 0), (s, 0, 0), (0, s, 0) and (0, 0, s) placed in WGS 84. */
    basis: { step: number; placed: [Wgs84, Wgs84, Wgs84, Wgs84] };
  }[];
}

/** A polygon in the frame: its outer ring first, then its holes, each open (no repeated last point). */
export type Polygon = Local[][];

export interface Scene {
  participant: { id: string; name: string };
  /** The point of WGS 84 at (0, 0, 0). */
  origin: Wgs84;
  sites: { id: string; name: string; polygons: Polygon[] }[];
  /** A footprint at the building's base; `top` is its base raised by its height, null when none is described. */
  buildings: { id: string; name: string; siteId: string | null; polygons: Polygon[]; base: number; top: number | null }[];
  /**
   * A model and where it goes: `matrix` takes a point in the model's own
   * coordinates and units to the frame, as a 4 × 4 matrix in column-major
   * order (the order WebGL and three.js read).
   */
  models: {
    id: string;
    name: string;
    format: string;
    uri: string;
    hostKind: 'building' | 'site';
    hostId: string;
    bounds: number[] | null;
    matrix: number[];
  }[];
}

function polygonsOf(frame: LocalFrame, geometry: AreaGeometry | null, height?: number): Polygon[] {
  if (geometry === null) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map((rings) =>
    rings.map((ring) => {
      const open = ring.length > 1 && ring[0].every((v, i) => v === ring[ring.length - 1][i]) ? ring.slice(0, -1) : ring;
      return open.map(([lon, lat, z]) => frame.toLocal([lon, lat, height ?? z ?? 0]));
    }),
  );
}

/** The scene of a place, from its rows: no database, no network. */
export function sceneOf(rows: PlaceRows): Scene {
  const frame = localFrame(rows.origin);
  const h0 = rows.origin[2];
  return {
    participant: rows.participant,
    origin: rows.origin,
    sites: rows.sites.map((s) => ({ id: s.id, name: s.name, polygons: polygonsOf(frame, s.geometry) })),
    buildings: rows.buildings.map((b) => {
      const base = b.elevationM ?? h0;
      const polygons = polygonsOf(frame, b.footprint, base);
      return {
        id: b.id,
        name: b.name,
        siteId: b.siteId,
        polygons,
        base: base - h0,
        top: b.heightM === null ? null : base - h0 + b.heightM,
      };
    }),
    models: rows.models.map((m) => {
      const [o, x, y, z] = m.basis.placed.map((p) => frame.toLocal(p));
      const axis = (p: Local) => p.map((v, i) => (v - o[i]) / m.basis.step);
      return {
        id: m.id,
        name: m.name,
        format: m.format,
        uri: m.uri,
        hostKind: m.hostKind,
        hostId: m.hostId,
        bounds: m.bounds,
        matrix: [...axis(x), 0, ...axis(y), 0, ...axis(z), 0, ...o, 1],
      };
    }),
  };
}

/** Applies a column-major 4 × 4 matrix to a point. */
export function transform(matrix: number[], [x, y, z]: readonly [number, number, number]): Local {
  const m = matrix;
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

const lonLatH = (json: string | null): Wgs84 => {
  const c = (JSON.parse(json ?? 'null') as { coordinates: number[] } | null)?.coordinates;
  if (!c) throw new Error('place_required: a point of the place could not be read');
  return [c[0], c[1], c[2] ?? 0];
};

/**
 * Reads the rows of a participant's place as the connection's person. The
 * frame starts at the centre of the participant's place, at the lowest
 * elevation of its buildings (0 when none is given). Refuses
 * `participant_not_found` (absent, or out of the person's reach),
 * `place_required` (nothing of the place has a geometry) and
 * `module_not_installed` (no `building` schema).
 */
export async function readPlace(db: Db, participantId: string): Promise<PlaceRows> {
  const installed = await db.query<{ ok: boolean }>(`select to_regclass('building.models') is not null ok`);
  if (!installed.rows[0]?.ok) throw new Error('module_not_installed: the building module, with its models, is not installed on this database');
  const found = await db.query<{ id: string; name: string }>('select id, name from participants where id = $1', [participantId]);
  const participant = found.rows[0];
  if (!participant) throw new Error(`participant_not_found: ${participantId}`);

  const origin = await db.query<{ point: string | null; height: number | null }>(
    `select ST_AsGeoJSON(ST_Centroid(ST_Force2D(coalesce(
              (select geometry from participants where id = $1),
              (select ST_Collect(g) from (
                 select footprint g from building.buildings where participant_id = $1
                 union all select geometry from building.sites where participant_id = $1) shapes))))) point,
            (select min(elevation_m)::float8 from building.buildings where participant_id = $1) height`,
    [participantId],
  );
  if (!origin.rows[0]?.point) throw new Error(`place_required: participant ${participantId} has no geometry, nor any of its sites or buildings`);
  const [lon, lat] = lonLatH(origin.rows[0].point);

  const sites = await db.query<{ id: string; name: string; geometry: string | null }>(
    `select id, name, ST_AsGeoJSON(geometry) geometry from building.sites where participant_id = $1 order by name, id`,
    [participantId],
  );
  const buildings = await db.query<{ id: string; name: string; site_id: string | null; footprint: string | null; elevation_m: number | null; height_m: number | null }>(
    `select id, name, site_id, ST_AsGeoJSON(footprint) footprint, elevation_m::float8, height_m::float8
       from building.buildings where participant_id = $1 order by name, id`,
    [participantId],
  );
  // Each model placed at four points 100 m apart in its own frame, so that
  // its matrix is read from the one function that places it.
  const models = await db.query<{
    id: string; name: string; format: string; uri: string; building_id: string | null; site_id: string | null;
    bounds: number[] | null; step: number; o: string; x: string; y: string; z: string;
  }>(
    `select m.id, m.name, m.format, m.uri, m.building_id, m.site_id, m.bounds::float8[] bounds, s.step,
            ST_AsGeoJSON(building.model_to_world(m.id, ST_MakePoint(0, 0, 0))) o,
            ST_AsGeoJSON(building.model_to_world(m.id, ST_MakePoint(s.step, 0, 0))) x,
            ST_AsGeoJSON(building.model_to_world(m.id, ST_MakePoint(0, s.step, 0))) y,
            ST_AsGeoJSON(building.model_to_world(m.id, ST_MakePoint(0, 0, s.step))) z
       from building.models m
       cross join lateral (select 100 / m.unit_m::float8 step) s
      where m.building_id in (select id from building.buildings where participant_id = $1)
         or m.site_id in (select id from building.sites where participant_id = $1)
      order by m.name, m.id`,
    [participantId],
  );

  return {
    participant,
    origin: [lon, lat, origin.rows[0].height ?? 0],
    sites: sites.rows.map((s) => ({ id: s.id, name: s.name, geometry: s.geometry ? (JSON.parse(s.geometry) as AreaGeometry) : null })),
    buildings: buildings.rows.map((b) => ({
      id: b.id,
      name: b.name,
      siteId: b.site_id,
      footprint: b.footprint ? (JSON.parse(b.footprint) as AreaGeometry) : null,
      elevationM: b.elevation_m,
      heightM: b.height_m,
    })),
    models: models.rows.map((m) => ({
      id: m.id,
      name: m.name,
      format: m.format,
      uri: m.uri,
      hostKind: m.building_id ? 'building' : 'site',
      hostId: (m.building_id ?? m.site_id) as string,
      bounds: m.bounds,
      basis: { step: m.step, placed: [lonLatH(m.o), lonLatH(m.x), lonLatH(m.y), lonLatH(m.z)] },
    })),
  };
}

/** The scene of a participant's place, read as the connection's person. */
export async function placeScene(db: Db, participantId: string): Promise<Scene> {
  return sceneOf(await readPlace(db, participantId));
}

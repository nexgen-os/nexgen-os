// GRB and DHM Vlaanderen — the buildings of a place in Flanders from open
// data, as a CityJSON model the `building` module imports.
//
// The Large-scale Reference Database of Flanders (GRB) draws every building
// on the ground (`GBG`) with a persistent object id; the Digital Height
// Model of Flanders II (DHMV II) gives, at 1 m, the surface the laser saw
// (DSM, roofs and trees) and the terrain under it (DTM). Both are services
// of Digitaal Vlaanderen, open, without a key. Sources `grb` and `dhmv`,
// shipped with this package (`sources.json`).
//
//   grb().buildings(area)          the footprints around a point, in Lambert 72 (EPSG:31370)
//   dhmv().grid(model, bbox)       the surface or the terrain model over a box, as a raster
//   heightsInFootprint(…)          ground, eave and ridge of a footprint from the two rasters
//   siteModel(area)                all of it, as a CityModel for `importCityJson()`

import { readFileSync } from 'node:fs';
import type { SourceRow } from '@nexgen-os/core';
import type { CityBuilding, CityModel, Point as CityPoint } from '@nexgen-os/cityjson';
import { readGeoTiff, type Raster } from './geotiff.js';

export { readGeoTiff, type Raster } from './geotiff.js';

/** The reference system of both services: Belgian Lambert 72. */
export const LAMBERT_72 = 31370;

/** A fetch that can read bytes as well as JSON; the platform's by default. */
export type BinaryFetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Around a point: WGS 84 longitude and latitude, and a radius in metres. */
export interface Area {
  lon: number;
  lat: number;
  radiusM: number;
}

/** A box in Lambert 72: west, south, east, north, in metres. */
export type Box = [number, number, number, number];

/** A polygon in Lambert 72: an outer ring, then its holes, each closed. */
export type Rings = [number, number][][];

/** A building on the ground as GRB draws it. */
export interface GrbBuilding {
  /** The persistent object id (`OIDN`): the same building across its versions. */
  oidn: number;
  /** The id of this version of the object (`UIDN`). */
  uidn: number;
  /** What GRB says it is (`hoofdgebouw`, `bijgebouw`…), as written. */
  type: string;
  /** The date of this version (`VERSDATUM`), `YYYY-MM-DD`. */
  versionDate: string | null;
  /** The date the building was surveyed (`OPNDATUM`), `YYYY-MM-DD`. */
  surveyDate: string | null;
  /** Its footprint: one polygon, or several. */
  polygons: Rings[];
}

interface Common {
  fetch?: BinaryFetch;
}

interface GbgFeature {
  properties: { OIDN: number; UIDN: number; LBLTYPE?: string | null; VERSDATUM?: string | null; OPNDATUM?: string | null };
  geometry: { type: 'Polygon'; coordinates: Rings } | { type: 'MultiPolygon'; coordinates: Rings[] } | null;
}

/**
 * The buildings of GRB (layer `GRB:GBG` of its Web Feature Service) whose
 * footprint meets the box around a point. Refuses `too_many_buildings` past
 * `limit` (500 by default) rather than return part of the place, and
 * `grb_unavailable` with the status of the service.
 */
export function grb(options: Common & { baseUrl?: string; limit?: number } = {}) {
  const base = (options.baseUrl ?? 'https://geo.api.vlaanderen.be/GRB/wfs').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as BinaryFetch);
  const limit = options.limit ?? 500;
  return {
    source_code: 'grb',
    async buildings(area: Area): Promise<GrbBuilding[]> {
      const [west, south, east, north] = degreesAround(area);
      const params = new URLSearchParams({
        service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 'GRB:GBG',
        outputFormat: 'application/json', srsName: `EPSG:${LAMBERT_72}`, count: String(limit + 1),
        // WFS 2.0 with a URN reference system: latitude first.
        bbox: `${south},${west},${north},${east},urn:ogc:def:crs:EPSG::4326`,
      });
      const res = await doFetch(`${base}?${params}`);
      if (!res.ok) throw new Error(`grb_unavailable: the GRB service answered ${res.status}`);
      const body = (await res.json()) as { features?: GbgFeature[] };
      const features = body.features ?? [];
      if (features.length > limit) throw new Error(`too_many_buildings: more than ${limit} buildings around the point; take a smaller radius`);
      return features.filter((f) => f.geometry).map(fromGbg);
    },
  };
}

function fromGbg(f: GbgFeature): GrbBuilding {
  const g = f.geometry!;
  return {
    oidn: f.properties.OIDN,
    uidn: f.properties.UIDN,
    type: f.properties.LBLTYPE ?? '',
    versionDate: f.properties.VERSDATUM ?? null,
    surveyDate: f.properties.OPNDATUM ?? null,
    polygons: g.type === 'Polygon' ? [g.coordinates] : g.coordinates,
  };
}

/** The two models of DHM Vlaanderen II at 1 m: what the laser saw (`surface`) and the ground under it (`terrain`). */
export type HeightModel = 'surface' | 'terrain';

const COVERAGES: Record<HeightModel, string> = { surface: 'DHMVII_DSM_1m', terrain: 'DHMVII_DTM_1m' };

/**
 * DHM Vlaanderen II through its Web Coverage Service: a model over a box in
 * Lambert 72, widened to whole metres, as a raster in metres above the
 * Ostend datum (TAW). Refuses `area_too_large` past `maxCells` cells
 * (4 000 000, a box of 2 km by 2 km) and `dhmv_unavailable` with the
 * status of the service.
 */
export function dhmv(options: Common & { baseUrl?: string; maxCells?: number } = {}) {
  const base = (options.baseUrl ?? 'https://geo.api.vlaanderen.be/DHMV/wcs').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as BinaryFetch);
  const maxCells = options.maxCells ?? 4_000_000;
  return {
    source_code: 'dhmv',
    async grid(model: HeightModel, box: Box): Promise<Raster> {
      const [w, s, e, n] = [Math.floor(box[0]), Math.floor(box[1]), Math.ceil(box[2]), Math.ceil(box[3])];
      if ((e - w) * (n - s) > maxCells) throw new Error(`area_too_large: ${e - w} m by ${n - s} m is more than ${maxCells} cells of the height model`);
      const params = new URLSearchParams({ service: 'WCS', version: '2.0.1', request: 'GetCoverage', CoverageId: COVERAGES[model], format: 'image/tiff' });
      const res = await doFetch(`${base}?${params}&subset=x(${w},${e})&subset=y(${s},${n})`);
      if (!res.ok) throw new Error(`dhmv_unavailable: the height model service answered ${res.status}`);
      return readGeoTiff(new Uint8Array(await res.arrayBuffer()));
    },
  };
}

/** Which share of a roof's cells lie below its eave and its ridge: a model, given as data. */
export interface RoofPercentiles {
  /** The percentile of the surface model inside the footprint taken as the eave; 10 by default. */
  eave: number;
  /** The percentile taken as the ridge; 99 by default, so that a chimney or an antenna does not raise it. */
  ridge: number;
}

export const DEFAULT_ROOF_PERCENTILES: RoofPercentiles = { eave: 10, ridge: 99 };

/** What two height models say of a footprint, in metres. */
export interface FootprintHeights {
  /** The terrain under the footprint, its median, above the datum of the models. */
  ground: number;
  /** The eave above the ground. */
  eave: number;
  /** The ridge above the ground. */
  ridge: number;
  /** The cells whose centre lies in the footprint, on both models. */
  cells: number;
}

/**
 * The ground, eave and ridge of a footprint, from a surface model and a
 * terrain model of the same grid: the median of the terrain under it, and
 * two percentiles (`percentiles`, linear between cells) of the surface over
 * it, each above that ground. A cell counts when its centre lies inside the
 * footprint and both models have a value there. Null when no cell does: a
 * footprint smaller than the grid, or outside it.
 */
export function heightsInFootprint(polygons: Rings[], surface: Raster, terrain: Raster, percentiles: RoofPercentiles = DEFAULT_ROOF_PERCENTILES): FootprintHeights | null {
  if (surface.width !== terrain.width || surface.height !== terrain.height || surface.x0 !== terrain.x0 || surface.y0 !== terrain.y0) {
    throw new Error('grid_mismatch: the surface and the terrain models are not on the same grid');
  }
  const tops: number[] = [];
  const grounds: number[] = [];
  const [w, s, e, n] = boxOf(polygons);
  const c0 = Math.max(0, Math.floor((w - surface.x0) / surface.dx));
  const c1 = Math.min(surface.width - 1, Math.ceil((e - surface.x0) / surface.dx));
  const r0 = Math.max(0, Math.floor((surface.y0 - n) / surface.dy));
  const r1 = Math.min(surface.height - 1, Math.ceil((surface.y0 - s) / surface.dy));
  for (let r = r0; r <= r1; r += 1) {
    const y = surface.y0 - (r + 0.5) * surface.dy;
    for (let c = c0; c <= c1; c += 1) {
      const x = surface.x0 + (c + 0.5) * surface.dx;
      if (!polygons.some((p) => inPolygon(x, y, p))) continue;
      const top = surface.values[r * surface.width + c];
      const ground = terrain.values[r * terrain.width + c];
      if (Number.isNaN(top) || Number.isNaN(ground)) continue;
      tops.push(top);
      grounds.push(ground);
    }
  }
  if (tops.length === 0) return null;
  const ground = percentile(grounds, 50);
  return {
    ground: round(ground),
    eave: round(percentile(tops, percentiles.eave) - ground),
    ridge: round(percentile(tops, percentiles.ridge) - ground),
    cells: tops.length,
  };
}

/** The CityObject id of a GRB building: its persistent object id, never the id of a version. */
export const grbObjectId = (oidn: number) => `GRB.GBG.${oidn}`;

/**
 * The buildings around a point as a CityJSON model in Lambert 72, ready for
 * `importCityJson()` of the `building` module: each GRB footprint at the
 * height of its ground, its ridge above the ground as its measured height,
 * and in its attributes its eave and ridge, the cells they were read from,
 * the percentiles used and what GRB says of it. A footprint the height
 * model does not cover keeps no height and is listed in `skipped`.
 */
export async function siteModel(area: Area, options: Common & { percentiles?: RoofPercentiles; grbUrl?: string; dhmvUrl?: string; limit?: number } = {}): Promise<CityModel> {
  const percentiles = options.percentiles ?? DEFAULT_ROOF_PERCENTILES;
  const found = await grb({ fetch: options.fetch, baseUrl: options.grbUrl, limit: options.limit }).buildings(area);
  if (found.length === 0) return { srid: LAMBERT_72, buildings: [], skipped: [] };

  const box = boxOf(found.flatMap((b) => b.polygons));
  const heights = dhmv({ fetch: options.fetch, baseUrl: options.dhmvUrl });
  const surface = await heights.grid('surface', box);
  const terrain = await heights.grid('terrain', box);

  const skipped: string[] = [];
  const buildings = found.map((b): CityBuilding => {
    const id = grbObjectId(b.oidn);
    const h = heightsInFootprint(b.polygons, surface, terrain, percentiles);
    if (!h) skipped.push(`${id}: no cell of the height model inside its footprint`);
    const z = h?.ground ?? 0;
    return {
      id,
      name: null,
      measuredHeight: h?.ridge ?? null,
      storeysAboveGround: null,
      storeysBelowGround: null,
      yearOfConstruction: null,
      attributes: {
        grb: { oidn: b.oidn, uidn: b.uidn, type: b.type, version_date: b.versionDate, survey_date: b.surveyDate },
        ...(h ? { heights: { source: 'dhmv', ground_m: h.ground, eave_m: h.eave, ridge_m: h.ridge, cells: h.cells, percentiles } } : {}),
      },
      footprint: b.polygons.map((rings) => rings.map((ring) => open(ring).map(([x, y]): CityPoint => [x, y, z]))),
      surfaces: [],
      zRange: h ? [h.ground, round(h.ground + h.ridge)] : null,
    };
  });
  return { srid: LAMBERT_72, buildings, skipped };
}

/** The `sources` rows this package ships (`sources.json`): write each with `registerSource()` of the core. */
export const grbSources: SourceRow[] = JSON.parse(readFileSync(new URL('../sources.json', import.meta.url), 'utf8')) as SourceRow[];

// ---------------------------------------------------------------------------

/** A box in degrees around a point: west, south, east, north. */
function degreesAround(area: Area): [number, number, number, number] {
  if (!(area.radiusM > 0)) throw new Error('radius_required: a radius in metres, above zero');
  const dLat = area.radiusM / 111_320;
  const dLon = area.radiusM / (111_320 * Math.cos((area.lat * Math.PI) / 180));
  return [area.lon - dLon, area.lat - dLat, area.lon + dLon, area.lat + dLat];
}

function boxOf(polygons: Rings[]): Box {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of polygons) {
    for (const [x, y] of rings[0] ?? []) {
      w = Math.min(w, x); s = Math.min(s, y); e = Math.max(e, x); n = Math.max(n, y);
    }
  }
  return [w, s, e, n];
}

/** Inside the outer ring and outside every hole, by the even-odd rule. */
function inPolygon(x: number, y: number, rings: Rings): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The p-th percentile, linear between the two closest ranks. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.min(Math.max(p, 0), 100) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** A closed ring as CityJSON writes it: the last point not repeated. */
function open(ring: [number, number][]): [number, number][] {
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return ring.length > 1 && a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * CityJSON buildings in the model, and back.
 *
 * `@nexgen-os/cityjson` reads a document into plain buildings in the
 * file's reference system; this importer writes each through the gestures
 * of the core:
 *
 *   building            → `three_d.add_building()`: the plan of its footprint faces,
 *                         unioned, at its lowest point, in WGS 84; its
 *                         height measured, else from its lowest to its
 *                         highest point
 *   storeys, year       → `set_attribute()`: `floors_above_ground`,
 *                         `floors_below_ground`, `year_built`
 *   CityObject id       → `add_identifier()`, scheme `cityjson`
 *   roof and wall faces → `three_d.add_surface()`, kind `roof` or `facade`, with
 *                         azimuth (true north) and tilt
 *
 * Every row has the source the caller names, and what the file says that
 * no column holds travels in `metadata.cityjson`. The exporter reads a
 * site's buildings back into the same shapes, in the site's UTM zone, for
 * `writeCityJson()`.
 */
import type { CityBuilding, CityModel, Point as CityPoint } from '@nexgen-os/cityjson';
import type { Db } from '@nexgen-os/core';
import { addFace, attributeFromFile, checkSrid, identifierFromFile, organisationOfSite, refuseKnown, round } from './faces.js';

export interface CityJsonTarget {
  siteId: string;
  /** A scenario the buildings belong to; the site's by default. */
  scenarioId?: string | null;
}

export interface CityJsonImportOptions {
  /** The `sources.code` the file comes from (a city model, a national dataset). */
  sourceCode: string;
  /** The profile every imported building gets. */
  profile?: string | null;
}

export interface CityJsonImport {
  buildings: { id: string; cityObjectId: string }[];
  surfaces: number;
  /** CityObjects of other types, left alone, and faces without an area. */
  skipped: string[];
}

/** Semantic surface types and the kind of surface they become; the others shape the footprint or are left out. */
const SURFACE_KINDS: Record<string, 'roof' | 'facade'> = {
  RoofSurface: 'roof',
  OuterFloorSurface: 'roof',
  WallSurface: 'facade',
};

/**
 * Writes the buildings of a CityJSON model on a site. Refuses
 * `crs_unknown` when the installation cannot transform from the file's
 * reference system, and `already_imported` when a building is known to
 * the organisation by its CityObject id — before writing anything.
 */
export async function importCityJson(db: Db, target: CityJsonTarget, model: CityModel, options: CityJsonImportOptions): Promise<CityJsonImport> {
  await checkSrid(db, model.srid);
  const organisationId = await organisationOfSite(db, target.siteId);
  await refuseKnown(db, organisationId, 'cityjson', model.buildings.map((b) => b.id), 'CityObject');
  const scenarioId = target.scenarioId ?? null;
  const result: CityJsonImport = { buildings: [], surfaces: 0, skipped: [...(model.skipped ?? [])] };
  const crs = { srid: model.srid, proj: null };

  for (const b of model.buildings) {
    const minZ = b.zRange ? b.zRange[0] : null;
    const height = b.measuredHeight ?? (b.zRange ? round(b.zRange[1] - b.zRange[0], 3) : null);
    const elevation = minZ !== null ? round(minZ, 3) : null;
    const building = await db.query<{ id: string }>(
      `select three_d.add_building($1, $2,
                (select case when g.u is null then null else
                          ST_Transform(ST_SetSRID(ST_Force3D(ST_CollectionExtract(ST_MakeValid(g.u), 3), coalesce($4, 0)), $5), 4326) end
                   from (select ST_Union(ST_Force2D(ST_GeomFromText(w))) u from unnest($3::text[]) w) g),
                $4, $6, $7, $8, $9, $10) id`,
      [
        target.siteId, b.name ?? b.id, b.footprint.map(planWkt), elevation, model.srid, height,
        options.profile ?? null, options.sourceCode,
        JSON.stringify({ cityjson: { id: b.id, parts: b.parts ?? [], lods: b.lods ?? [], attributes: b.attributes } }),
        scenarioId,
      ],
    );
    const buildingId = building.rows[0].id;
    result.buildings.push({ id: buildingId, cityObjectId: b.id });

    // Floors and year, as the file says them: attributes with their source.
    for (const [property, value] of [
      ['floors_above_ground', b.storeysAboveGround],
      ['floors_below_ground', b.storeysBelowGround],
      ['year_built', b.yearOfConstruction],
    ] as const) {
      if (value !== null) await attributeFromFile(db, buildingId, property, Math.round(value), options.sourceCode, scenarioId);
    }
    await identifierFromFile(db, buildingId, 'cityjson', b.id);

    let n = 0;
    for (const s of b.surfaces) {
      const kind = SURFACE_KINDS[s.type];
      if (!kind) continue;
      n += 1;
      const name = typeof s.attributes.name === 'string' && s.attributes.name.trim() ? s.attributes.name : `${s.type} ${n}`;
      const id = await addFace(db, {
        buildingId, kind, name, rings: s.polygon, crs, sourceCode: options.sourceCode,
        metadata: { cityjson: { lod: s.lod, type: s.type, attributes: s.attributes } },
      });
      if (id) result.surfaces += 1;
      else result.skipped.push(`${b.id}: ${name}, a face without an area`);
    }
  }
  return result;
}

/** The plan of a face: its rings in two dimensions, closed. */
function planWkt(polygon: CityPoint[][]): string {
  return `POLYGON(${polygon.map((ring) => `(${[...ring, ring[0]].map((p) => `${p[0]} ${p[1]}`).join(',')})`).join(',')})`;
}

export interface CityJsonExportOptions {
  /** EPSG code of the output; default: the UTM zone of the site. */
  srid?: number;
}

interface BuildingRow {
  id: string;
  name: string;
  height_m: string | null;
  attributes: { floors_above_ground?: number; floors_below_ground?: number; year_built?: number };
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

/** GeoJSON rings (closed) as CityJSON rings (open). */
const ringsOf = (rings: number[][][]): CityPoint[][] => rings.map((ring) => ring.slice(0, -1).map((p) => [p[0], p[1], p[2] ?? 0] as CityPoint));
const polygonOf = (geojson: string): CityPoint[][] => ringsOf((JSON.parse(geojson) as { coordinates: number[][][] }).coordinates);
/** The polygons of a GeoJSON Polygon or MultiPolygon. */
const polygonsOf = (geojson: string): CityPoint[][][] => {
  const g = JSON.parse(geojson) as { type: string; coordinates: unknown };
  return g.type === 'MultiPolygon' ? (g.coordinates as number[][][][]).map(ringsOf) : [ringsOf(g.coordinates as number[][][])];
};

/**
 * The buildings of a site as a CityJSON model, for `writeCityJson()`: a
 * LoD 1 solid from the footprint and height (`three_d.building_volume()`), the
 * roof and wall surfaces with their semantics, the CityGML attributes from
 * the columns and the attributes, the file's own attributes back from
 * `metadata.cityjson`. Refuses `nothing_to_export` for a site without a
 * building.
 */
export async function exportCityJson(db: Db, where: { siteId: string }, options: CityJsonExportOptions = {}): Promise<CityModel> {
  const buildings = await db.query<BuildingRow>(
    `with s as (select coalesce($2::int, (select metric_srid(ST_Collect(footprint)) from three_d.buildings where site_id = $1)) srid)
     select b.id, b.name, b.height_m, attributes_of(b.id) attributes, b.metadata,
            (select value from external_ids e where e.object_id = b.id and e.scheme = 'cityjson' limit 1) city_id,
            s.srid,
            ST_AsGeoJSON(ST_Transform(b.footprint, s.srid)) footprint,
            (select array_agg(ST_AsGeoJSON(ST_Transform(d.geom, s.srid))) from ST_Dump(three_d.building_volume(b.id)) d) volume
       from three_d.buildings b, s
      where b.site_id = $1 and b.scenario_id is null
      order by b.created_at, b.id`,
    [where.siteId, options.srid ?? null],
  );
  if (buildings.rows.length === 0) throw new Error('nothing_to_export: the site has no building');
  const srid = buildings.rows[0].srid;
  const surfaces = await db.query<SurfaceRow>(
    `select f.building_id, f.name, f.kind, f.metadata, ST_AsGeoJSON(ST_Transform(f.geometry, $2::int)) geometry
       from three_d.surfaces f join three_d.buildings b on b.id = f.building_id
      where b.site_id = $1 and f.scenario_id is null and f.geometry is not null
      order by f.created_at, f.id`,
    [where.siteId, srid],
  );

  return {
    srid,
    buildings: buildings.rows.map((b): CityBuilding => {
      const id = b.city_id ?? b.metadata.cityjson?.id ?? b.id;
      return {
        id,
        name: b.name !== id ? b.name : null,
        measuredHeight: b.height_m !== null ? Number(b.height_m) : null,
        storeysAboveGround: b.attributes.floors_above_ground ?? null,
        storeysBelowGround: b.attributes.floors_below_ground ?? null,
        yearOfConstruction: b.attributes.year_built ?? null,
        attributes: { ...(b.metadata.cityjson?.attributes ?? {}) },
        footprint: b.footprint ? polygonsOf(b.footprint) : [],
        solid: (b.volume ?? []).map(polygonOf),
        surfaces: surfaces.rows
          .filter((s) => s.building_id === b.id)
          .map((s) => ({
            type: s.metadata.cityjson?.type ?? (s.kind === 'roof' ? 'RoofSurface' : 'WallSurface'),
            lod: 2,
            polygon: polygonOf(s.geometry),
            attributes: { ...(s.metadata.cityjson?.attributes ?? {}), name: s.name },
          })),
      };
    }),
  };
}

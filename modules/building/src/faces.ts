/**
 * What the importers of buildings share: a reference system checked
 * against the installation's, a file refused when it was imported before,
 * geometry taken from a file's reference system to WGS 84, and a face
 * written as a surface with its orientation against true north.
 */
import type { Db } from '@nexgen-os/core';
import { orientation, polygonWkt, type Vertex as Point } from '@nexgen-os/core';

/** The reference system of a file's coordinates: an EPSG code, or a PROJ string (a local transverse Mercator). */
export interface Crs {
  srid: number | null;
  proj: string | null;
}

/** Refuses `crs_unknown` when the installation cannot transform from the EPSG code. */
export async function checkSrid(db: Db, srid: number): Promise<void> {
  const known = await db.query<{ n: number }>('select count(*)::int n from spatial_ref_sys where srid = $1', [srid]);
  if (known.rows[0].n === 0) throw new Error(`crs_unknown: EPSG:${srid} is not in spatial_ref_sys`);
}

/** The organisation of a site. Refuses `site_not_found`. */
export async function organisationOfSite(db: Db, siteId: string): Promise<string> {
  const r = await db.query<{ organisation_id: string }>('select organisation_id from sites where id = $1', [siteId]);
  if (!r.rows.length) throw new Error(`site_not_found: ${siteId}`);
  return r.rows[0].organisation_id;
}

/**
 * Refuses `already_imported` when one of the identifiers already names an
 * object of the organisation: a file is imported once
 * ([0036](../../../docs/decisions/0036-a-file-is-imported-once.md)).
 */
export async function refuseKnown(db: Db, organisationId: string, scheme: string, values: string[], label: string): Promise<void> {
  const known = await db.query<{ value: string; object_id: string }>(
    `select value, object_id from external_ids where organisation_id = $1 and scheme = $2 and value = any($3::text[]) order by value limit 1`,
    [organisationId, scheme, values],
  );
  if (known.rows.length) throw new Error(`already_imported: ${label} ${known.rows[0].value} is object ${known.rows[0].object_id} of this organisation`);
}

/**
 * A geometry expression in a file's reference system taken to WGS 84: by
 * its EPSG code, or by its PROJ string. `k` and `p` are the positions of
 * the two parameters.
 */
export function toWgs84(expr: string, k: number, p: number): string {
  return `(case when $${k}::int is not null then ST_Transform(ST_SetSRID(${expr}, $${k}::int), 4326) else ST_Transform(${expr}, $${p}::text, 4326) end)`;
}

export const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * A face of a building as a surface, through `building.add_surface()`: its tilt
 * from the outward normal, its azimuth against true north — the face's
 * centre and a point ten metres down its slope, both taken to WGS 84,
 * whatever the projection's convergence. Returns null for a face without
 * an area, which has no orientation.
 */
export async function addFace(
  db: Db,
  face: { buildingId: string; kind: 'roof' | 'facade'; name: string; rings: Point[][]; crs: Crs; sourceCode: string; metadata: Record<string, unknown> },
): Promise<string | null> {
  const ring = face.rings[0];
  const { normal, tilt } = orientation(ring);
  if (tilt === null) return null;
  const centre = ring.reduce((acc, p) => [acc[0] + p[0] / ring.length, acc[1] + p[1] / ring.length], [0, 0]);
  const horizontal = Math.hypot(normal[0], normal[1]);
  const sloped = tilt >= 1 && horizontal > 0;
  const r = await db.query<{ id: string }>(
    `select building.add_surface($1, $2, $3, ${toWgs84('ST_GeomFromText($4)', 5, 6)},
                        case when $7::boolean then round(degrees(ST_Azimuth(
                          ${toWgs84('ST_MakePoint($8, $9)', 5, 6)}::geography,
                          ${toWgs84('ST_MakePoint($10, $11)', 5, 6)}::geography))::numeric, 2) end,
                        $12, $13, $14) id`,
    [
      face.buildingId, face.kind, face.name, polygonWkt(face.rings), face.crs.srid, face.crs.proj,
      sloped, centre[0], centre[1], centre[0] + (10 * normal[0]) / (horizontal || 1), centre[1] + (10 * normal[1]) / (horizontal || 1),
      round(tilt, 2), face.sourceCode, JSON.stringify(face.metadata),
    ],
  );
  return r.rows[0].id;
}

/** An attribute read from a file, with the file as its source, through `set_attribute()`. */
export async function attributeFromFile(db: Db, objectId: string, property: string, value: unknown, sourceCode: string, scenarioId: string | null): Promise<void> {
  await db.query(`select set_attribute($1, $2, $3::jsonb, null, $4, null, $5)`, [objectId, property, JSON.stringify(value), sourceCode, scenarioId]);
}

/** An identifier an object is known by in a file, through `add_identifier()`. */
export async function identifierFromFile(db: Db, objectId: string, scheme: string, value: string): Promise<void> {
  await db.query(`select add_identifier($1, $2, $3)`, [objectId, scheme, value]);
}

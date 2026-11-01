/**
 * A georeferenced model of a building or a ground, as a row that points to
 * its file and places it on the globe
 * ([0008](../../../docs/decisions/0008-the-building-module-describes-what-is-built.md)).
 *
 * The placement is read from what the file says, the same shape for every
 * format:
 *
 *   IFC       the transform `@nexgen-os/ifc` read from the IfcMapConversion
 *             (in its projected CRS), else from the IfcSite's coordinates or
 *             the caller's origin (a local frame, true north up); the
 *             heading from the direction of the model's X axis, the scale
 *             of the conversion, the file's length unit, the box its
 *             meshes fit in
 *   CityJSON  its `transform`: the translation is the origin and the scale
 *             the length of one vertex unit, in the CRS its metadata names;
 *             its bounds from its vertices
 *
 * and written through `building.add_model()`. The file itself stays where it
 * is: the row holds its address, size and checksum.
 */
import type { CityJsonDocument } from '@nexgen-os/cityjson';
import { sridOf } from '@nexgen-os/cityjson';
import type { Db } from '@nexgen-os/core';
import type { IfcModel } from '@nexgen-os/ifc';
import { checkSrid } from './faces.js';

export type ModelFormat = 'ifc' | 'cityjson' | 'citygml' | 'gltf' | 'glb' | 'obj' | 'las' | 'laz' | 'e57' | 'ply';

/** How a model is placed on the globe, as the columns of `building.models` hold it. */
export interface ModelPlacement {
  /** EPSG code of the projected frame, or null for a local frame at the origin, true north up. */
  srid: number | null;
  /** Where the model's (0, 0, 0) is: in the frame `srid` names, in the PROJ frame `proj` names, else longitude, latitude and height in WGS 84. */
  origin: [number, number, number];
  /** The frame `origin` is written in when it is neither `srid` nor WGS 84 (a local transverse Mercator a reader built). */
  proj?: string | null;
  /** Azimuth of the model's +Y axis, degrees clockwise from the frame's north. */
  headingDeg: number;
  /** Frame units per model metre, in the plane. */
  scale: number;
  /** Metres per model unit. */
  unitM: number;
  upAxis: 'y' | 'z';
  verticalDatum: string | null;
  /** Min x, y, z, max x, y, z, in model units. */
  bounds: [number, number, number, number, number, number] | null;
  lod: string | null;
  /** The source's georeferencing block, as it came. */
  georeference: Record<string, unknown>;
}

/** The file a model is: where it is, and what lets it be known again. */
export interface ModelFile {
  uri: string;
  /** `sha256:<hex>`. */
  checksum?: string | null;
  byteSize?: number | null;
  mediaType?: string | null;
}

export interface ModelInput {
  /** The building, or the ground (a site), the model is of. */
  hostId: string;
  name: string;
  format: ModelFormat;
  file: ModelFile;
  placement: ModelPlacement;
  /** The `sources.code` the file comes from. */
  sourceCode: string;
  capturedAt?: string | null;
  metadata?: Record<string, unknown>;
}

const degrees = (radians: number) => (radians * 180) / Math.PI;
const heading = (deg: number) => ((deg % 360) + 360) % 360;

/**
 * The placement of an IFC model read by `@nexgen-os/ifc`: its frame, the
 * point its origin lands on, the heading of its +Y axis (the X axis turned a
 * quarter counter-clockwise), the scale of its map conversion and its
 * length unit.
 */
export function placementOfIfc(model: IfcModel): ModelPlacement {
  const g = model.georeference;
  const { origin, xAxis, scale } = g.placement;
  const projected = g.block.projectedCrs as Record<string, unknown> | undefined;
  const vertical = projected?.VerticalDatum;
  return {
    srid: g.srid,
    proj: g.srid === null ? g.proj : null,
    origin,
    // +X at θ counter-clockwise from east puts +Y at θ counter-clockwise from north.
    headingDeg: heading(-degrees(Math.atan2(xAxis[1], xAxis[0]))),
    scale,
    unitM: model.units.length,
    upAxis: 'z',
    verticalDatum: typeof vertical === 'string' && vertical.trim() ? vertical : null,
    // In the file's own length unit, as its coordinates are written.
    bounds: model.bounds ? (model.bounds.map((v) => v / model.units.length) as ModelPlacement['bounds']) : null,
    lod: null,
    georeference: { kind: g.kind, crs: g.crs, ...g.block },
  };
}

/**
 * The placement of a CityJSON document: the frame its metadata names (or
 * `options.srid`), its transform's translation as the origin and its scale
 * as the length of a vertex unit, its bounds from its vertices, its highest
 * level of detail. Refuses `crs_required` and `transform_not_uniform` (a
 * vertex unit that is not the same on the three axes).
 */
export function placementOfCityJson(doc: CityJsonDocument, options: { srid?: number } = {}): ModelPlacement {
  const srid = options.srid ?? sridOf(doc.metadata?.referenceSystem);
  if (!srid) throw new Error('crs_required: the file names no reference system; give options.srid');
  const scale = doc.transform?.scale ?? [1, 1, 1];
  const translate = doc.transform?.translate ?? [0, 0, 0];
  if (scale[1] !== scale[0] || scale[2] !== scale[0]) {
    throw new Error(`transform_not_uniform: the vertex unit is ${scale.join(', ')} on x, y, z`);
  }
  let bounds: ModelPlacement['bounds'] = null;
  for (const [x, y, z] of doc.vertices) {
    bounds = bounds
      ? [Math.min(bounds[0], x), Math.min(bounds[1], y), Math.min(bounds[2], z), Math.max(bounds[3], x), Math.max(bounds[4], y), Math.max(bounds[5], z)]
      : [x, y, z, x, y, z];
  }
  const lods = Object.values(doc.CityObjects).flatMap((o) => (o.geometry ?? []).map((g) => String(g.lod)));
  return {
    srid,
    proj: null,
    origin: [translate[0], translate[1], translate[2]],
    headingDeg: 0,
    scale: 1,
    unitM: scale[0],
    upAxis: 'z',
    verticalDatum: null,
    bounds,
    lod: lods.length ? lods.sort().at(-1)! : null,
    georeference: {
      ...(doc.transform ? { transform: doc.transform } : {}),
      ...(doc.metadata?.referenceSystem ? { referenceSystem: doc.metadata.referenceSystem } : {}),
    },
  };
}

/**
 * Writes a model of a building or a ground through `building.add_model()`,
 * its origin taken to WGS 84 when it is in a PROJ frame of its reader's. Refuses
 * `crs_unknown` when the installation cannot transform from the model's
 * frame, and what `add_model()` refuses: `model_host_kind`,
 * `already_imported` for a file whose checksum names a model already.
 */
export async function addModel(db: Db, input: ModelInput): Promise<string> {
  const p = input.placement;
  if (p.srid !== null) await checkSrid(db, p.srid);
  const [x, y, z] = p.origin;
  const r = await db.query<{ id: string }>(
    `select building.add_model($1, $2, $3, $4,
              case when $5::int is not null then ST_MakePoint($6, $7, $8)
                   when $9::text is not null then ST_Transform(ST_MakePoint($6, $7, $8), $9::text, 4326)
                   else ST_SetSRID(ST_MakePoint($6, $7, $8), 4326) end,
              p_srid => $5, p_heading_deg => $10, p_scale => $11, p_unit_m => $12, p_up_axis => $13,
              p_vertical_datum => $14, p_bounds => $15, p_lod => $16,
              p_checksum => $17, p_byte_size => $18, p_media_type => $19,
              p_georeference => $20, p_source_code => $21, p_captured_at => $22, p_metadata => $23) id`,
    [
      input.hostId, input.name, input.format, input.file.uri,
      p.srid, x, y, z, p.srid === null ? (p.proj ?? null) : null,
      p.headingDeg, p.scale, p.unitM, p.upAxis, p.verticalDatum, p.bounds, p.lod,
      input.file.checksum ?? null, input.file.byteSize ?? null, input.file.mediaType ?? null,
      JSON.stringify(p.georeference), input.sourceCode, input.capturedAt ?? null, JSON.stringify(input.metadata ?? {}),
    ],
  );
  return r.rows[0].id;
}

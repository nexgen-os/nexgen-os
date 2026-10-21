/**
 * An IFC model in the model of Nexgen OS.
 *
 * `@nexgen-os/ifc` reads a file into plain shapes in the reference system
 * the model is placed in; this importer writes them through the gestures
 * of the core:
 *
 *   the site's origin   → `locate_site()`, at `rooftop` precision with a map
 *                         conversion, `parcel` with the site's coordinates,
 *                         when the site had no position or a coarser one
 *   building            → `three_d.add_building()`: its footprint in WGS 84, its
 *                         elevation and height; its year (`set_attribute()`)
 *   storey, space       → `three_d.add_space()`, kinds floor and room; a room's
 *                         area as the attribute `floor_area`
 *   roof face           → `three_d.add_surface()`, kind roof, azimuth (true north)
 *                         and tilt
 *   product             → `install_device()`, when a device type names its
 *                         IFC class (`device_types.ifc_class`), in its
 *                         building and room
 *   GlobalId            → `add_identifier()`, scheme `ifc_guid`
 *
 * Every row has the source the caller names, and what the file says that
 * no column holds travels in `metadata.ifc`.
 */
import type { Georeference, IfcModel, IfcRoom, FootprintSource } from '@nexgen-os/ifc';
import type { Db } from '@nexgen-os/core';
import { addFace, attributeFromFile, checkSrid, identifierFromFile, organisationOfSite, refuseKnown, toWgs84, type Crs } from './faces.js';

export interface IfcTarget {
  siteId: string;
  /** A scenario the building belongs to; the site's by default. */
  scenarioId?: string | null;
}

export interface IfcImportOptions {
  /** The `sources.code` the file comes from (an architect's model, a survey). */
  sourceCode: string;
  /** The profile every imported building gets. */
  profile?: string | null;
}

export interface IfcImport {
  georeference: Georeference;
  /** The CRS the model was placed in: `EPSG:28992`, or the local transverse Mercator built from the site's coordinates. */
  crs: string;
  /** What the site's position is worth: `rooftop` with a map conversion, `parcel` with the site's coordinates. */
  locationPrecision: 'rooftop' | 'parcel' | null;
  /** Whether the site's position and precision were set from the file (only when it had none, or a coarser one). */
  siteUpdated: boolean;
  schema: string;
  buildings: { id: string; globalId: string; footprint: FootprintSource }[];
  counts: { buildings: number; floors: number; spaces: number; roofs: number; devices: number };
  /** Products of the file that did not become rows, by entity type and reason. */
  skipped: { entity: string; count: number; reason: string }[];
}

const PRECISION: Record<Georeference, 'rooftop' | 'parcel' | null> = { map_conversion: 'rooftop', site_coordinates: 'parcel', none: null };
const PRECISION_RANK = ['rooftop', 'parcel', 'street', 'postal_code', 'city', 'region'];

/**
 * Writes an IFC model on a site. Refuses `crs_unknown` when the
 * installation cannot transform from the model's EPSG code, and
 * `already_imported` when a building is known to the organisation by its
 * GlobalId — before writing anything.
 */
export async function importIfc(db: Db, target: IfcTarget, model: IfcModel, options: IfcImportOptions): Promise<IfcImport> {
  const { georeference: g } = model;
  if (g.srid !== null) await checkSrid(db, g.srid);
  const organisationId = await organisationOfSite(db, target.siteId);
  await refuseKnown(db, organisationId, 'ifc_guid', model.buildings.map((b) => b.globalId), 'IfcBuilding');
  const scenarioId = target.scenarioId ?? null;
  const crs: Crs = { srid: g.srid, proj: g.proj };
  const precision = PRECISION[g.kind];
  const result: IfcImport = {
    georeference: g.kind,
    crs: g.crs,
    locationPrecision: precision,
    siteUpdated: false,
    schema: model.schema,
    buildings: [],
    counts: { buildings: 0, floors: 0, spaces: 0, roofs: 0, devices: 0 },
    skipped: model.skipped.map((s) => ({ ...s })),
  };
  const skip = (entity: string, reason: string) => {
    const known = result.skipped.find((s) => s.entity === entity && s.reason === reason);
    if (known) known.count += 1;
    else result.skipped.push({ entity, count: 1, reason });
  };

  // The site: its position, at the precision of the georeference, when the
  // site had none or a coarser one.
  if (precision) {
    const [x, y, z] = model.site.origin;
    const coarser = await db.query<{ point: Record<string, unknown> }>(
      `select ST_AsGeoJSON(ST_Force3D(${toWgs84('ST_MakePoint($2, $3, $4)', 5, 6)}), 9)::jsonb point
         from sites where id = $1
          and (geometry is null or array_position($8::text[], location_precision) > array_position($8::text[], $7::text))`,
      [target.siteId, x, y, z, crs.srid, crs.proj, precision, PRECISION_RANK],
    );
    if (coarser.rows.length) {
      await db.query(`select locate_site($1, $2)`, [target.siteId, JSON.stringify({
        geometry: coarser.rows[0].point, location_precision: precision, location_source_code: options.sourceCode,
      })]);
      result.siteUpdated = true;
    }
  }

  const buildingRows = new Map<string, string>();
  const roomRows = new Map<string, string>();
  for (const b of model.buildings) {
    const metadata = {
      ifc: {
        ...b.description,
        header: model.header,
        units: model.units,
        georeference: { kind: g.kind, crs: g.crs, ...g.block },
        ...(model.site.description ? { site: model.site.description } : {}),
      },
    };
    // The pieces of the footprint, unioned; walls' boxes grown by 5 cm while
    // they are joined, so that walls that meet after rounding do, and the
    // holes they leave filled.
    const row = await db.query<{ id: string }>(
      `select three_d.add_building($1, $2,
                (select case when g.u is null then null else
                          ST_Force3D(${toWgs84('ST_CollectionExtract(ST_MakeValid(g.u), 3)', 5, 6)}, coalesce($4, 0)) end
                   from (select case when $11::boolean
                                  then (select ST_Buffer(ST_Collect(ST_MakePolygon(ST_ExteriorRing(d.geom))), -0.05, 'join=mitre') from ST_Dump(x.u) d)
                                  else x.u end u
                           from (select ST_Union(case when $11::boolean then ST_Buffer(ST_GeomFromText(w), 0.05, 'join=mitre')
                                                      else ST_SnapToGrid(ST_GeomFromText(w), 0.001) end) u
                                   from unnest($3::text[]) w) x) g),
                $4, $7, $8, $9, $10, $12) id`,
      [
        target.siteId, b.name, b.footprint.pieces.map(planWkt), b.elevation, crs.srid, crs.proj,
        b.height, options.profile ?? null, options.sourceCode, JSON.stringify(metadata), b.footprint.source === 'walls', scenarioId,
      ],
    );
    const id = row.rows[0].id;
    await identifierFromFile(db, id, 'ifc_guid', b.globalId);
    // The year the file says the building was built, when it reads as a year.
    if (b.yearOfConstruction !== null && b.yearOfConstruction >= 1000 && b.yearOfConstruction <= 2200) {
      await attributeFromFile(db, id, 'year_built', Math.round(b.yearOfConstruction), options.sourceCode, scenarioId);
    }
    result.buildings.push({ id, globalId: b.globalId, footprint: b.footprint.source });
    buildingRows.set(b.globalId, id);
    result.counts.buildings += 1;

    const addRoom = async (room: IfcRoom, floorId: string | null) => {
      const space = await db.query<{ id: string }>(
        `select three_d.add_space($1, 'room', $2, $3, null, null, null, $4, $5, $6) id`,
        [id, room.name, floorId, room.height, options.sourceCode, JSON.stringify({ ifc: room.description })],
      );
      const spaceId = space.rows[0].id;
      if (room.area !== null) await attributeFromFile(db, spaceId, 'floor_area', room.area, options.sourceCode, scenarioId);
      if (room.globalId) {
        await identifierFromFile(db, spaceId, 'ifc_guid', room.globalId);
        roomRows.set(room.globalId, spaceId);
      }
      result.counts.spaces += 1;
    };
    for (const f of b.floors) {
      const floor = await db.query<{ id: string }>(
        `select three_d.add_space($1, 'floor', $2, null, $3, null, $4, $5, $6, $7) id`,
        [id, f.name, f.level, f.elevation, f.height, options.sourceCode, JSON.stringify({ ifc: f.description })],
      );
      if (f.globalId) await identifierFromFile(db, floor.rows[0].id, 'ifc_guid', f.globalId);
      result.counts.floors += 1;
      for (const room of f.rooms) await addRoom(room, floor.rows[0].id);
    }
    for (const room of b.rooms) await addRoom(room, null);

    for (const roof of b.roofs) {
      const surface = await addFace(db, {
        buildingId: id, kind: 'roof', name: roof.name, rings: roof.rings, crs, sourceCode: options.sourceCode, metadata: { ifc: roof.description },
      });
      if (!surface) {
        skip(roof.description.entity, 'no roof face in its geometry');
        continue;
      }
      if (roof.globalId) await identifierFromFile(db, surface, 'ifc_guid', roof.globalId);
      result.counts.roofs += 1;
    }
  }

  // Equipment: the device type is the vocabulary's, read by IFC class. A
  // class several types share is told apart by the element's predefined
  // type when it names one (BATTERY), else it takes the most specific type
  // they all refine (an IfcElectricGenerator is a generator); with none in
  // common, the element is skipped and says why.
  const vocabulary = (await db.query<{ code: string; parent_code: string | null; ifc_class: string | null }>(
    `select code, parent_code, ifc_class from device_types order by code`,
  )).rows;
  const parentOf = new Map(vocabulary.map((t) => [t.code, t.parent_code]));
  const lineage = (code: string): string[] => {
    const out: string[] = [];
    for (let c: string | null | undefined = code; c && !out.includes(c); c = parentOf.get(c)) out.push(c);
    return out;
  };
  const deviceTypeOf = (entity: string, predefined: string | null): string | null | 'ambiguous' => {
    const candidates = vocabulary.filter((t) => t.ifc_class?.toLowerCase() === entity.toLowerCase()).map((t) => t.code);
    if (candidates.length === 0) return null;
    const named = predefined ? candidates.find((c) => c === predefined.toLowerCase()) : undefined;
    if (named) return named;
    if (candidates.length === 1) return candidates[0];
    const lineages = candidates.map(lineage);
    return lineages[0].find((c) => lineages.every((l) => l.includes(c))) ?? 'ambiguous';
  };
  for (const p of model.products) {
    const deviceType = deviceTypeOf(p.entity, p.predefinedType);
    if (deviceType === null) {
      skip(p.entity, 'no place in the core for this entity type');
      continue;
    }
    if (deviceType === 'ambiguous') {
      skip(p.entity, 'several device types share this IFC class');
      continue;
    }
    const at = precision ? p.position : null;
    const device = await db.query<{ id: string }>(
      `select install_device($1, $2, $3,
                case when $4::float8 is null then null
                     else ST_AsGeoJSON(ST_Force3D(${toWgs84('ST_MakePoint($4, $5, $6)', 7, 8)}), 9)::jsonb end,
                p_source_code => $9, p_scenario_id => $10, p_nameplate => $11, p_metadata => $12, p_status => 'in_service') id`,
      [
        target.siteId, deviceType, p.name,
        at?.[0] ?? null, at?.[1] ?? null, at?.[2] ?? null, crs.srid, crs.proj,
        options.sourceCode, scenarioId,
        JSON.stringify({ manufacturer: p.manufacturer, model: p.model, serial_number: p.serialNumber }),
        JSON.stringify({ ifc: { ...p.description, header: model.header } }),
      ],
    );
    const building = (p.building && buildingRows.get(p.building)) || null;
    const room = (p.room && roomRows.get(p.room)) || null;
    if (building || room) await db.query('select three_d.place_device($1, $2, $3)', [device.rows[0].id, building, room]);
    if (p.globalId) await identifierFromFile(db, device.rows[0].id, 'ifc_guid', p.globalId);
    result.counts.devices += 1;
  }
  result.skipped.sort((p, q) => p.entity.localeCompare(q.entity) || p.reason.localeCompare(q.reason));
  return result;
}

/** A plan ring as a closed WKT polygon. */
function planWkt(points: [number, number][]): string {
  return `POLYGON((${[...points, points[0]].map((p) => `${p[0]} ${p[1]}`).join(',')}))`;
}

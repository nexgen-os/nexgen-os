// IFC → plain shapes — the reading half.
//
// IFC (ISO 16739, buildingSMART) is how architects and engineers hand over
// a building model. This library reads a model into plain shapes, every
// coordinate in metres in the reference system the model is placed in:
// each IfcBuilding with its footprint, elevation and height, its storeys
// as floors and its IfcSpaces as rooms under them, the faces of its roofs
// that look up; the equipment the file holds, with the building and the
// room that contain it, its manufacturer, model and serial number; and
// what it did not read, by entity and reason. The model is placed on the
// globe by its IfcMapConversion, else by its site's latitude and
// longitude, else by an origin the caller gives. Property sets and
// quantities travel with each shape, so that nothing the file says about a
// building, a floor, a room or a product is lost. The file is parsed by
// web-ifc (MPL-2.0, WebAssembly).
//
// The library imports nothing of the model, opens no connection and calls
// no network: which device type an IFC class is, and writing the shapes,
// are an importer's.
//
// SPDX-License-Identifier: MIT

import * as WebIFC from 'web-ifc';

export interface ReadOptions {
  /**
   * Where the model's origin is, for a file that carries no georeference:
   * longitude and latitude in WGS 84, the angle in degrees from east to the
   * model's X axis, counter-clockwise (as IfcMapConversion's X axis), and
   * the height of the model's zero above the vertical datum.
   */
  origin?: { lon: number; lat: number; rotationDeg: number; elevation?: number };
}

export type Georeference = 'map_conversion' | 'site_coordinates' | 'none';
export type FootprintSource = 'slabs' | 'walls' | 'none';

/** A point in metres: x, y in the reference system the model is placed in, z above its vertical datum. */
export type Point = [number, number, number];

/** What the file says of an object that no field of its shape holds: its entity, direct attributes, property and quantity sets. */
export interface IfcDescription {
  globalId: string | null;
  entity: string;
  attributes: Record<string, unknown>;
  psets?: Record<string, Record<string, unknown>>;
  quantities?: Record<string, Record<string, unknown>>;
  [more: string]: unknown;
}

export interface IfcRoom {
  globalId: string | null;
  name: string;
  /** Metres, from `Qto_SpaceBaseQuantities.Height`. */
  height: number | null;
  /** Square metres, the net floor area, else the gross one, of `Qto_SpaceBaseQuantities`. */
  area: number | null;
  description: IfcDescription;
}

export interface IfcFloor {
  globalId: string | null;
  name: string;
  /** 0 for the storey closest to the building's 0.00, counted up and down from it. */
  level: number;
  /** Metres from the building's 0.00, as the storey says. */
  elevation: number;
  /** Metres to the next storey, or to the top of the building for the last one. */
  height: number | null;
  rooms: IfcRoom[];
  description: IfcDescription;
}

/** A face of a roof that looks up. */
export interface IfcRoofFace {
  /** The element's GlobalId, on its first face only: a GlobalId names one object. */
  globalId: string | null;
  name: string;
  /** Outer ring then holes, counter-clockwise seen from above. */
  rings: Point[][];
  description: IfcDescription;
}

export interface IfcBuilding {
  globalId: string;
  name: string;
  /** Metres above the vertical datum: `ElevationOfRefHeight`, else the lowest storey's. */
  elevation: number | null;
  /** Metres from the building's 0.00 to its highest element, else between its lowest and highest storeys. */
  height: number | null;
  /** `Pset_BuildingCommon.YearOfConstruction`, as the file says it. */
  yearOfConstruction: number | null;
  /**
   * The plan of the building as pieces to union: the ground-floor slabs'
   * faces (`slabs`), else the exterior walls' boxes (`walls`, whose union
   * leaves gaps where walls meet: grow them before, shrink them after),
   * else nothing.
   */
  footprint: { source: FootprintSource; pieces: [number, number][][] };
  floors: IfcFloor[];
  /** Rooms on no storey: an atrium, a hall across floors. */
  rooms: IfcRoom[];
  roofs: IfcRoofFace[];
  description: IfcDescription;
}

/** A product the shapes above do not hold: a piece of equipment, or what no reader has a place for. */
export interface IfcProduct {
  globalId: string | null;
  entity: string;
  predefinedType: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  /** Its origin. */
  position: Point;
  /** The building and the room that contain it, by GlobalId. */
  building: string | null;
  room: string | null;
  description: IfcDescription;
}

export interface IfcModel {
  schema: string;
  /** FILE_DESCRIPTION, FILE_NAME and FILE_SCHEMA. */
  header: Record<string, unknown>;
  /** The project's length and area units, as factors to metres and square metres. */
  units: { length: number; area: number };
  georeference: {
    kind: Georeference;
    /** `EPSG:28992`, or the PROJ string of a local transverse Mercator built around the site's coordinates. */
    crs: string;
    srid: number | null;
    proj: string | null;
    /** The georeferencing block as the file gave it. */
    block: Record<string, unknown>;
  };
  /** The origin of the first IfcSite (else of the model), and its description. */
  site: { origin: Point; description: IfcDescription | null };
  buildings: IfcBuilding[];
  products: IfcProduct[];
  /** Products read for another shape only, or that are in no building, by entity type and reason. */
  skipped: { entity: string; count: number; reason: string }[];
}

type Line = Record<string, any>;
type Frame = { o: Point; x: Point; y: Point; z: Point };
type Triangle = [Point, Point, Point];

interface Placement {
  kind: Georeference;
  crs: string;
  /** EPSG code of the target CRS, or null when it is a PROJ string. */
  srid: number | null;
  proj: string | null;
  /** Model coordinates in metres → target CRS coordinates. */
  toTarget: (p: Point) => Point;
  /** Height of the model's zero above the vertical datum, in metres. */
  datum: number;
  /** The georeferencing block as the file gave it. */
  block: Record<string, unknown>;
}

interface Mesh {
  triangles: Triangle[];
  min: Point;
  max: Point;
}

const SI_PREFIX: Record<string, number> = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
  DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
};

/** Attributes left out of a description's `attributes`: identity, ownership and geometry, which have their own place. */
const OMITTED_ATTRIBUTES = new Set(['expressID', 'type', 'GlobalId', 'OwnerHistory', 'ObjectPlacement', 'Representation']);

/** The EPSG code of a CRS name or URI (`https://www.opengis.net/def/crs/EPSG/0/7415`, `EPSG:28992`). */
export function sridOf(referenceSystem: string | undefined): number | null {
  if (!referenceSystem) return null;
  const m = /EPSG\/\d+\/(\d+)\s*$/.exec(referenceSystem) ?? /EPSG:+(\d+)\s*$/i.exec(referenceSystem);
  return m ? Number(m[1]) : null;
}

let api: Promise<WebIFC.IfcAPI> | null = null;

/** One web-ifc instance per process: loading the WebAssembly module is the slow part. */
function ifcApi(): Promise<WebIFC.IfcAPI> {
  api ??= (async () => {
    const a = new WebIFC.IfcAPI();
    await a.Init(undefined, true);
    return a;
  })();
  return api;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * An IFC file as plain shapes. Refuses `not_ifc`, `invalid_ifc` (a
 * building without a GlobalId), `crs_unknown` (a map conversion whose CRS
 * is not an EPSG code) and `georeference_missing` (no map conversion, no
 * site coordinates and no `options.origin`).
 */
export async function readIfc(file: Uint8Array, options: ReadOptions = {}): Promise<IfcModel> {
  const ifc = await ifcApi();
  let model: number;
  try {
    model = ifc.OpenModel(file);
  } catch (e) {
    throw new Error(`not_ifc: web-ifc could not open the file (${(e as Error).message})`);
  }
  if (model < 0) throw new Error('not_ifc: web-ifc could not open the file');
  try {
    return read(new Model(ifc, model), options);
  } finally {
    ifc.CloseModel(model);
  }
}

function read(m: Model, options: ReadOptions): IfcModel {
  const schema = m.ifc.GetModelSchema(m.id);
  const projectId = m.ids(WebIFC.IFCPROJECT)[0];
  if (projectId === undefined) throw new Error('not_ifc: the file has no IfcProject');
  const units = unitsOf(m, m.line(projectId));
  const placement = placementOf(m, units, options);

  const relations = relationsOf(m);
  const properties = propertiesOf(m);
  const meshes = meshesOf(m);
  const header = headerOf(m, schema);

  const seen = new Set<number>([projectId]);
  const skipped: IfcModel['skipped'] = [];
  const skip = (id: number, reason: string) => {
    seen.add(id);
    const entity = m.typeName(id);
    const known = skipped.find((s) => s.entity === entity && s.reason === reason);
    if (known) known.count += 1;
    else skipped.push({ entity, count: 1, reason });
  };
  const describe = (id: number): IfcDescription => ({
    globalId: text(m.line(id).GlobalId),
    entity: m.typeName(id),
    attributes: attributesOf(m, m.line(id)),
    ...(properties.get(id) ?? {}),
  });

  const siteIds = m.ids(WebIFC.IFCSITE);
  for (const id of siteIds) seen.add(id);
  const siteFrame = siteIds.length ? frameOf(m, m.line(siteIds[0]).ObjectPlacement, units.length) : null;

  const buildings: IfcBuilding[] = [];
  /** IFC building and room express ids, with the GlobalIds their shapes carry. */
  const buildingIds = new Map<number, string>();
  const roomIds = new Map<number, string | null>();
  for (const buildingId of m.ids(WebIFC.IFCBUILDING)) {
    seen.add(buildingId);
    const b = m.line(buildingId);
    const globalId = text(b.GlobalId);
    if (!globalId) throw new Error(`invalid_ifc: IfcBuilding #${buildingId} has no GlobalId`);

    // Storeys in order of elevation; level 0 is the one closest to the
    // building's 0.00, the reference height storey elevations are given from.
    const storeys = relations
      .childrenOf(buildingId)
      .filter((id) => m.typeName(id) === 'IfcBuildingStorey')
      .map((id) => ({ id, elevation: (num(m.line(id).Elevation) ?? 0) * units.length }))
      .sort((p, q) => p.elevation - q.elevation);
    const ground = storeys.reduce((best, s, i) => (Math.abs(s.elevation) < Math.abs(storeys[best].elevation) ? i : best), 0);

    // Elements of the building, through containment and aggregation.
    const elements = [...relations.descendantsOf(buildingId)].filter((id) => !['IfcBuildingStorey', 'IfcSpace'].includes(m.typeName(id)));
    const zs = elements.flatMap((id) => (meshes.has(id) ? [meshes.get(id)!.min[2], meshes.get(id)!.max[2]] : []));
    const refHeight = num(b.ElevationOfRefHeight);
    const elevation = refHeight !== null ? refHeight * units.length : storeys.length ? placement.datum + storeys[0].elevation : null;
    // In the model's frame, the building's 0.00 is the datum's zero moved to its reference height.
    const zeroInModel = refHeight !== null ? refHeight * units.length - placement.datum : storeys[0]?.elevation ?? 0;
    const top = zs.length ? Math.max(...zs) : null;
    const height = top !== null ? top - zeroInModel : storeys.length > 1 ? storeys[storeys.length - 1].elevation - storeys[0].elevation : null;
    const pset = properties.get(buildingId)?.psets ?? {};

    // Footprint: the ground-floor slabs in plan, else the exterior walls'
    // boxes, else nothing.
    const lowest = storeys[0]?.id;
    const onLowest = lowest === undefined ? [] : [...relations.descendantsOf(lowest)];
    const floorSlabs = onLowest.filter((id) => m.typeName(id) === 'IfcSlab' && ['FLOOR', 'BASESLAB'].includes(enumOf(m.line(id).PredefinedType) ?? '') && meshes.get(id)?.triangles.length);
    const walls = elements.filter((id) => m.typeName(id).startsWith('IfcWall') && meshes.get(id)?.triangles.length);
    const exterior = walls.filter((id) => properties.get(id)?.psets.Pset_WallCommon?.IsExternal === true);
    const footprintWalls = exterior.length ? exterior : walls.filter((id) => onLowest.includes(id));
    const plan = (points: Point[]): [number, number][] => points.map((p) => [p[0], p[1]]);
    let footprint: IfcBuilding['footprint'] = { source: 'none', pieces: [] };
    if (floorSlabs.length) {
      footprint = {
        source: 'slabs',
        pieces: floorSlabs.flatMap((id) => meshes.get(id)!.triangles.filter((t) => Math.abs(normalOf(t)[2]) > 0.05).map((t) => plan(t.map(placement.toTarget)))),
      };
    } else if (footprintWalls.length) {
      footprint = {
        source: 'walls',
        pieces: footprintWalls.map((id) => {
          const { min, max } = meshes.get(id)!;
          return plan([[min[0], min[1], 0], [max[0], min[1], 0], [max[0], max[1], 0], [min[0], max[1], 0]].map((p) => placement.toTarget(p as Point)));
        }),
      };
    }
    for (const s of floorSlabs) skip(s, 'read for the footprint only');
    if (footprint.source === 'walls') for (const w of footprintWalls) skip(w, 'read for the footprint only');

    // Floors and the rooms on them, one tree; rooms that are on no floor
    // (an atrium, a hall across floors) stay at the top of the building.
    const room = (spaceId: number): IfcRoom => {
      seen.add(spaceId);
      const sp = m.line(spaceId);
      const qto = properties.get(spaceId)?.quantities.Qto_SpaceBaseQuantities ?? {};
      const area = num(qto.NetFloorArea) ?? num(qto.GrossFloorArea);
      const roomHeight = num(qto.Height);
      roomIds.set(spaceId, text(sp.GlobalId));
      return {
        globalId: text(sp.GlobalId),
        name: text(sp.LongName) ?? text(sp.Name) ?? 'Space',
        height: roomHeight !== null ? round(roomHeight * units.length, 3) : null,
        area: area !== null ? round(area * units.area, 2) : null,
        description: describe(spaceId),
      };
    };
    const floors: IfcFloor[] = storeys.map((storey, i) => {
      seen.add(storey.id);
      const s = m.line(storey.id);
      const next = storeys[i + 1]?.elevation ?? top;
      return {
        globalId: text(s.GlobalId),
        name: text(s.Name) ?? text(s.LongName) ?? `Level ${i - ground}`,
        level: i - ground,
        elevation: round(storey.elevation, 3),
        height: next !== null && next > storey.elevation ? round(next - storey.elevation, 3) : null,
        rooms: [...relations.descendantsOf(storey.id)].filter((x) => m.typeName(x) === 'IfcSpace').map(room),
        description: describe(storey.id),
      };
    });
    const rooms = [...relations.descendantsOf(buildingId)].filter((x) => m.typeName(x) === 'IfcSpace' && !seen.has(x)).map(room);

    // Roofs: an IfcRoof's own faces, else those of its parts, and every
    // roof slab; the faces that look up.
    const isRoof = (e: number) => m.typeName(e) === 'IfcRoof';
    const roofElements = elements
      .filter((e) => isRoof(e) || (m.typeName(e) === 'IfcSlab' && enumOf(m.line(e).PredefinedType) === 'ROOF'))
      .sort((p, q) => Number(isRoof(q)) - Number(isRoof(p))); // roofs before their parts
    const roofs: IfcRoofFace[] = [];
    const done = new Set<number>();
    for (const roofId of roofElements) {
      if (done.has(roofId)) continue;
      done.add(roofId);
      let sources = [roofId];
      if (m.typeName(roofId) === 'IfcRoof') {
        const parts = relations.childrenOf(roofId);
        if (meshes.get(roofId)?.triangles.length) {
          for (const p of parts) {
            done.add(p);
            skip(p, 'part of a roof read as a whole');
          }
        } else {
          sources = parts;
          seen.add(roofId);
        }
      }
      for (const source of sources) {
        done.add(source);
        const faces = upwardFaces(meshes.get(source)?.triangles ?? []);
        if (!faces.length) {
          skip(source, 'no roof face in its geometry');
          continue;
        }
        seen.add(source);
        const line = m.line(source);
        const name = text(line.Name) ?? m.typeName(source);
        for (const [n, rings] of faces.entries()) {
          roofs.push({
            globalId: n === 0 ? text(line.GlobalId) : null,
            name: faces.length > 1 ? `${name} ${n + 1}` : name,
            rings: rings.map((ring) => ring.map(placement.toTarget)),
            description: { ...describe(source), face: n },
          });
        }
      }
    }

    buildingIds.set(buildingId, globalId);
    buildings.push({
      globalId,
      name: text(b.Name) ?? text(b.LongName) ?? globalId,
      elevation: elevation !== null ? round(elevation, 3) : null,
      height: height !== null && height >= 0 ? round(height, 3) : null,
      yearOfConstruction: num(pset.Pset_BuildingCommon?.YearOfConstruction),
      footprint,
      floors,
      rooms,
      roofs,
      description: describe(buildingId),
    });
  }

  // Every other product, with the building and the room that contain it:
  // equipment, for a reader that knows which device an IFC class is. What is
  // a storey, a room or a roof outside any building is skipped here.
  const within = (ids: Map<number, string | null>, id: number): string | null => {
    for (const [ifcId, globalId] of ids) if (relations.descendantsOf(ifcId).has(id)) return globalId;
    return null;
  };
  const products: IfcProduct[] = [];
  for (const id of m.ids(WebIFC.IFCPRODUCT, true)) {
    if (seen.has(id)) continue;
    const type = m.typeName(id);
    const line = m.line(id);
    if (['IfcBuildingStorey', 'IfcSpace', 'IfcRoof'].includes(type) || (type === 'IfcSlab' && enumOf(line.PredefinedType) === 'ROOF')) {
      skip(id, 'not in a building');
      continue;
    }
    const pset = properties.get(id)?.psets ?? {};
    const product = pset.Pset_ManufacturerTypeInformation ?? {};
    const occurrence = pset.Pset_ManufacturerOccurrence ?? {};
    products.push({
      globalId: text(line.GlobalId),
      entity: type,
      predefinedType: enumOf(line.PredefinedType),
      name: text(line.Name) ?? text(line.ObjectType) ?? type,
      manufacturer: text(product.Manufacturer),
      model: text(product.ModelLabel) ?? text(product.ModelReference),
      serialNumber: text(occurrence.SerialNumber),
      position: placement.toTarget(frameOf(m, line.ObjectPlacement, units.length).o),
      building: within(buildingIds, id),
      room: within(roomIds, id),
      description: describe(id),
    });
  }
  skipped.sort((p, q) => p.entity.localeCompare(q.entity) || p.reason.localeCompare(q.reason));

  return {
    schema,
    header,
    units,
    georeference: { kind: placement.kind, crs: placement.crs, srid: placement.srid, proj: placement.proj, block: placement.block },
    site: { origin: placement.toTarget(siteFrame?.o ?? [0, 0, 0]), description: siteIds.length ? describe(siteIds[0]) : null },
    buildings,
    products,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Georeferencing
// ---------------------------------------------------------------------------

/**
 * Where the model is on the globe. IFC4's IfcMapConversion gives the
 * projected CRS, the false origin, the rotation of the X axis and the
 * scale; without it, IfcSite's latitude, longitude and elevation anchor the
 * site's origin, with north from the model context's TrueNorth, else the
 * site's X axis taken as east. A file with neither needs `options.origin`.
 */
function placementOf(m: Model, units: { length: number }, options: ReadOptions): Placement {
  const conversions = m.ids(WebIFC.IFCMAPCONVERSION).map((id) => m.line(id));
  const conversion =
    conversions.find((c) => c.SourceCRS && text(m.line(c.SourceCRS.value).ContextType) === 'Model') ?? conversions[0];
  if (conversion) {
    const crs = m.line(conversion.TargetCRS.value);
    const name = text(crs.Name) ?? '';
    const srid = sridOf(name);
    if (!srid) throw new Error(`crs_unknown: the map conversion's CRS "${name}" is not an EPSG code`);
    const mapUnit = crs.MapUnit ? unitFactor(m, crs.MapUnit.value) ?? 1 : 1;
    const e0 = num(conversion.Eastings) ?? 0;
    const n0 = num(conversion.Northings) ?? 0;
    const h0 = num(conversion.OrthogonalHeight) ?? 0;
    const ax = num(conversion.XAxisAbscissa) ?? 1;
    const ay = num(conversion.XAxisOrdinate) ?? 0;
    const norm = Math.hypot(ax, ay) || 1;
    const [a, b] = [ax / norm, ay / norm];
    // Scale converts the model's length unit to the map's. Many files put
    // the unit conversion there (0.001 for millimetres); since the model is
    // read in metres already, that factor is not applied twice.
    const declared = num(conversion.Scale) ?? 1;
    const scale = units.length !== 1 && Math.abs(declared - units.length / mapUnit) < 1e-9 ? 1 / mapUnit : declared;
    return {
      kind: 'map_conversion',
      crs: `EPSG:${srid}`,
      srid,
      proj: null,
      datum: h0 * mapUnit,
      toTarget: ([x, y, z]) => [e0 + scale * (a * x - b * y), n0 + scale * (b * x + a * y), h0 + z / mapUnit],
      block: { mapConversion: attributesOf(m, conversion), projectedCrs: attributesOf(m, crs) },
    };
  }

  const site = m.ids(WebIFC.IFCSITE).map((id) => m.line(id)).find((s) => s.RefLatitude && s.RefLongitude);
  if (site) {
    const lat = degrees(site.RefLatitude.value);
    const lon = degrees(site.RefLongitude.value);
    const elevation = (num(site.RefElevation) ?? 0) * units.length;
    const frame = frameOf(m, site.ObjectPlacement, units.length);
    const north = trueNorthOf(m);
    const theta = north !== null ? Math.PI / 2 - Math.atan2(north[1], north[0]) : -Math.atan2(frame.x[1], frame.x[0]);
    return localPlacement('site_coordinates', lon, lat, theta, frame.o, elevation, {
      site: { RefLatitude: site.RefLatitude.value, RefLongitude: site.RefLongitude.value, RefElevation: num(site.RefElevation) },
      ...(north ? { trueNorth: north } : {}),
    });
  }

  if (options.origin) {
    const { lon, lat, rotationDeg, elevation = 0 } = options.origin;
    return localPlacement('none', lon, lat, (rotationDeg * Math.PI) / 180, [0, 0, 0], elevation, { origin: options.origin });
  }
  throw new Error('georeference_missing: the file has neither an IfcMapConversion nor IfcSite coordinates; give options.origin');
}

/** A transverse Mercator centred on the anchor: grid north is true north there, and the grid is in metres. */
function localPlacement(kind: Georeference, lon: number, lat: number, theta: number, anchor: Point, elevation: number, block: Record<string, unknown>): Placement {
  const [c, s] = [Math.cos(theta), Math.sin(theta)];
  const proj = `+proj=tmerc +lat_0=${lat} +lon_0=${lon} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
  return {
    kind,
    crs: proj,
    srid: null,
    proj,
    datum: elevation - anchor[2],
    toTarget: ([x, y, z]) => {
      const [dx, dy] = [x - anchor[0], y - anchor[1]];
      return [c * dx - s * dy, s * dx + c * dy, elevation + z - anchor[2]];
    },
    block,
  };
}

/** IfcCompoundPlaneAngleMeasure: degrees, minutes, seconds, millionths of a second, all of the same sign. */
function degrees(dms: number[]): number {
  const [d = 0, mi = 0, s = 0, u = 0] = dms;
  return d + mi / 60 + s / 3600 + u / 3.6e9;
}

/** The TrueNorth of the 3D model context, as a direction in the model's XY plane. */
function trueNorthOf(m: Model): [number, number] | null {
  for (const id of m.ids(WebIFC.IFCGEOMETRICREPRESENTATIONCONTEXT)) {
    const c = m.line(id);
    if (m.typeName(id) !== 'IfcGeometricRepresentationContext' || !c.TrueNorth) continue;
    const r = m.line(c.TrueNorth.value).DirectionRatios.map(num);
    if (r[0] !== null && r[1] !== null && Math.hypot(r[0], r[1]) > 0) return [r[0], r[1]];
  }
  return null;
}

/** The world frame of an IfcLocalPlacement, origins in metres. */
function frameOf(m: Model, ref: { value: number } | null | undefined, length: number): Frame {
  const identity: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  if (!ref) return identity;
  const placement = m.line(ref.value);
  const parent = frameOf(m, placement.PlacementRelTo, length);
  const rel = placement.RelativePlacement ? m.line(placement.RelativePlacement.value) : null;
  if (!rel) return parent;
  const location = (m.line(rel.Location.value).Coordinates as unknown[]).map((c) => (num(c) ?? 0) * length);
  const dir = (d: { value: number } | null | undefined, fallback: Point): Point => {
    if (!d) return fallback;
    const r = m.line(d.value).DirectionRatios.map((c: unknown) => num(c) ?? 0);
    return unit([r[0], r[1], r[2] ?? 0]);
  };
  const z = dir(rel.Axis, [0, 0, 1]);
  const ref0 = dir(rel.RefDirection, [1, 0, 0]);
  const x = unit(sub(ref0, scale(z, dot(ref0, z))));
  const y = cross(z, x);
  const local: Frame = { o: [location[0] ?? 0, location[1] ?? 0, location[2] ?? 0], x, y, z };
  const apply = (v: Point): Point => add(add(scale(parent.x, v[0]), scale(parent.y, v[1])), scale(parent.z, v[2]));
  return { o: add(parent.o, apply(local.o)), x: apply(local.x), y: apply(local.y), z: apply(local.z) };
}

// ---------------------------------------------------------------------------
// Units, relations, properties, header
// ---------------------------------------------------------------------------

/** The project's length and area units, as factors to metres and square metres. */
function unitsOf(m: Model, project: Line): { length: number; area: number } {
  const units = { length: 1, area: 1 };
  const assignment = project.UnitsInContext ? m.line(project.UnitsInContext.value) : null;
  for (const ref of assignment?.Units ?? []) {
    const u = m.line(ref.value);
    const kind = enumOf(u.UnitType);
    const factor = unitFactor(m, ref.value);
    if (factor === null) continue;
    if (kind === 'LENGTHUNIT') units.length = factor;
    if (kind === 'AREAUNIT') units.area = factor;
  }
  return units;
}

/** An IfcSIUnit or IfcConversionBasedUnit as a factor to its SI base (metre, square metre…). */
function unitFactor(m: Model, id: number): number | null {
  const u = m.line(id);
  const type = m.typeName(id);
  if (type === 'IfcSIUnit') {
    const prefix = SI_PREFIX[enumOf(u.Prefix) ?? ''] ?? 1;
    const name = enumOf(u.Name) ?? '';
    return name.startsWith('SQUARE_') ? prefix ** 2 : name.startsWith('CUBIC_') ? prefix ** 3 : prefix;
  }
  if (type === 'IfcConversionBasedUnit' || type === 'IfcConversionBasedUnitWithOffset') {
    const measure = m.line(u.ConversionFactor.value);
    const value = num(measure.ValueComponent);
    const base = measure.UnitComponent ? unitFactor(m, measure.UnitComponent.value) : 1;
    return value !== null && base !== null ? value * base : null;
  }
  return null;
}

/** Who contains or aggregates whom: IfcRelAggregates, IfcRelContainedInSpatialStructure. */
function relationsOf(m: Model) {
  const children = new Map<number, number[]>();
  const link = (parent: number, child: number) => children.set(parent, [...(children.get(parent) ?? []), child]);
  for (const id of m.ids(WebIFC.IFCRELAGGREGATES)) {
    const r = m.line(id);
    for (const c of r.RelatedObjects ?? []) link(r.RelatingObject.value, c.value);
  }
  for (const id of m.ids(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const r = m.line(id);
    for (const c of r.RelatedElements ?? []) link(r.RelatingStructure.value, c.value);
  }
  return {
    childrenOf: (id: number) => children.get(id) ?? [],
    descendantsOf(id: number): Set<number> {
      const out = new Set<number>();
      const walk = (p: number) => {
        for (const c of children.get(p) ?? []) {
          if (out.has(c)) continue;
          out.add(c);
          walk(c);
        }
      };
      walk(id);
      return out;
    },
  };
}

interface PropertyBag {
  psets: Record<string, Record<string, any>>;
  quantities: Record<string, Record<string, any>>;
}

/** Property sets and quantity sets of every object, by name, values as the file gives them. */
function propertiesOf(m: Model): Map<number, PropertyBag> {
  const out = new Map<number, PropertyBag>();
  for (const id of m.ids(WebIFC.IFCRELDEFINESBYPROPERTIES)) {
    const r = m.line(id);
    const defId = r.RelatingPropertyDefinition?.value;
    if (defId === undefined) continue;
    const def = m.line(defId);
    const type = m.typeName(defId);
    const name = text(def.Name) ?? `#${defId}`;
    let bag: 'psets' | 'quantities';
    let values: Record<string, unknown>;
    if (type === 'IfcPropertySet') {
      bag = 'psets';
      values = Object.fromEntries((def.HasProperties ?? []).map((p: { value: number }) => propertyOf(m, p.value)));
    } else if (type === 'IfcElementQuantity') {
      bag = 'quantities';
      values = Object.fromEntries((def.Quantities ?? []).map((q: { value: number }) => quantityOf(m, q.value)));
    } else continue;
    for (const o of r.RelatedObjects ?? []) {
      const entry = out.get(o.value) ?? { psets: {}, quantities: {} };
      entry[bag][name] = { ...(entry[bag][name] ?? {}), ...values };
      out.set(o.value, entry);
    }
  }
  return out;
}

function propertyOf(m: Model, id: number): [string, unknown] {
  const p = m.line(id);
  const name = text(p.Name) ?? `#${id}`;
  switch (m.typeName(id)) {
    case 'IfcPropertySingleValue':
      return [name, plain(p.NominalValue)];
    case 'IfcPropertyEnumeratedValue':
      return [name, (p.EnumerationValues ?? []).map(plain)];
    case 'IfcPropertyListValue':
      return [name, (p.ListValues ?? []).map(plain)];
    case 'IfcPropertyBoundedValue':
      return [name, { lower: plain(p.LowerBoundValue), upper: plain(p.UpperBoundValue), setPoint: plain(p.SetPointValue) }];
    case 'IfcPropertyTableValue':
      return [name, { defining: (p.DefiningValues ?? []).map(plain), defined: (p.DefinedValues ?? []).map(plain) }];
    case 'IfcComplexProperty':
      return [name, Object.fromEntries((p.HasProperties ?? []).map((c: { value: number }) => propertyOf(m, c.value)))];
    default:
      return [name, attributesOf(m, p)];
  }
}

function quantityOf(m: Model, id: number): [string, unknown] {
  const q = m.line(id);
  const key = Object.keys(q).find((k) => k.endsWith('Value'));
  return [text(q.Name) ?? `#${id}`, key ? plain(q[key]) : attributesOf(m, q)];
}

/** FILE_DESCRIPTION, FILE_NAME and FILE_SCHEMA, as plain values. */
function headerOf(m: Model, schema: string) {
  const line = (type: number) => {
    try {
      return (m.ifc.GetHeaderLine(m.id, type)?.arguments ?? []).map(plain);
    } catch {
      return null;
    }
  };
  const [description, implementationLevel] = line(WebIFC.FILE_DESCRIPTION) ?? [];
  const [name, timeStamp, author, organization, preprocessorVersion, originatingSystem, authorization] = line(WebIFC.FILE_NAME) ?? [];
  return {
    schema,
    fileSchema: (line(WebIFC.FILE_SCHEMA) ?? [])[0] ?? null,
    description, implementationLevel,
    name, timeStamp, author, organization, preprocessorVersion, originatingSystem, authorization,
  };
}

/** The direct attributes of an entity as plain values; references are followed one level, as their entity and attributes. */
function attributesOf(m: Model, line: Line, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(line)) {
    if (OMITTED_ATTRIBUTES.has(k) || v === null || v === undefined) continue;
    out[k] = valueOf(m, v, depth);
  }
  return out;
}

function valueOf(m: Model, v: any, depth: number): unknown {
  if (Array.isArray(v)) return v.map((x) => valueOf(m, x, depth));
  if (v && typeof v === 'object' && v.type === 5 && typeof v.value === 'number') {
    if (depth >= 1) return `#${v.value}`;
    return { entity: m.typeName(v.value), ...attributesOf(m, m.line(v.value), depth + 1) };
  }
  return plain(v);
}

/** A web-ifc value as JSON: labels and numbers as they are, booleans and logicals as booleans (unknown as null), enumerations as their name. */
function plain(v: any): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v !== 'object') return v;
  if ('_representationValue' in v) return v._representationValue;
  if ('value' in v) {
    const x = v.value;
    if ((v.name === 'IFCBOOLEAN' || v.name === 'IFCLOGICAL') && typeof x === 'string') return x === 'T' ? true : x === 'F' ? false : null;
    return Array.isArray(x) ? x.map(plain) : x;
  }
  return null;
}

function text(v: any): string | null {
  const x = plain(v);
  return typeof x === 'string' && x.trim() !== '' ? x : null;
}
function num(v: any): number | null {
  const x = plain(v);
  const n = typeof x === 'string' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
function enumOf(v: any): string | null {
  return v && typeof v === 'object' && typeof v.value === 'string' ? v.value : null;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Every mesh web-ifc computes, as triangles in the model's frame: metres,
 * Z up (web-ifc hands them over Y up, the way 3D viewers draw).
 */
function meshesOf(m: Model): Map<number, Mesh> {
  const out = new Map<number, Mesh>();
  m.ifc.StreamAllMeshes(m.id, (mesh) => {
    const triangles: Triangle[] = [];
    for (let g = 0; g < mesh.geometries.size(); g++) {
      const placed = mesh.geometries.get(g);
      const t = placed.flatTransformation;
      const geometry = m.ifc.GetGeometry(m.id, placed.geometryExpressID);
      const v = m.ifc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const idx = m.ifc.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
      // Column-major 4×4, then Y up back to Z up: (x, y, z) → (x, −z, y).
      const point = (i: number): Point => {
        const [x, y, z] = [v[i * 6], v[i * 6 + 1], v[i * 6 + 2]];
        const wx = t[0] * x + t[4] * y + t[8] * z + t[12];
        const wy = t[1] * x + t[5] * y + t[9] * z + t[13];
        const wz = t[2] * x + t[6] * y + t[10] * z + t[14];
        return [wx, -wz, wy];
      };
      const normal = (i: number): Point => {
        const [x, y, z] = [v[i * 6 + 3], v[i * 6 + 4], v[i * 6 + 5]];
        return [t[0] * x + t[4] * y + t[8] * z, -(t[2] * x + t[6] * y + t[10] * z), t[1] * x + t[5] * y + t[9] * z];
      };
      for (let i = 0; i + 2 < idx.length; i += 3) {
        let tri: Triangle = [point(idx[i]), point(idx[i + 1]), point(idx[i + 2])];
        // Winding from the normals web-ifc gives, which point out of the solid.
        if (dot(normalOf(tri), normal(idx[i])) < 0) tri = [tri[0], tri[2], tri[1]];
        triangles.push(tri);
      }
      geometry.delete();
    }
    if (!triangles.length) return;
    const min: Point = [Infinity, Infinity, Infinity];
    const max: Point = [-Infinity, -Infinity, -Infinity];
    for (const p of triangles.flat()) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
    out.set(mesh.expressID, { triangles, min, max });
  });
  return out;
}

/**
 * The faces of a mesh that look up (tilt below 87°): its triangles grouped
 * by plane, each group's outline traced from the edges only one of its
 * triangles uses. Rings come counter-clockwise seen from above the face,
 * the outer one first.
 */
function upwardFaces(triangles: Triangle[]): Point[][][] {
  const groups = new Map<string, Triangle[]>();
  for (const t of triangles) {
    const n = normalOf(t);
    if (n[2] <= 0.05) continue;
    const key = `${n.map((c) => c.toFixed(2)).join(',')}|${dot(n, t[0]).toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const faces: Point[][][] = [];
  for (const group of groups.values()) {
    const key = (p: Point) => p.map((c) => c.toFixed(4)).join(',');
    const points = new Map<string, Point>();
    const edges = new Map<string, number>();
    for (const t of group) {
      for (let i = 0; i < 3; i++) {
        const [a, b] = [key(t[i]), key(t[(i + 1) % 3])];
        points.set(a, t[i]);
        const reverse = `${b}>${a}`;
        if (edges.has(reverse)) edges.delete(reverse);
        else edges.set(`${a}>${b}`, 1);
      }
    }
    const next = new Map<string, string>();
    for (const e of edges.keys()) {
      const [a, b] = e.split('>');
      next.set(a, b);
    }
    const rings: Point[][] = [];
    while (next.size) {
      const start = next.keys().next().value as string;
      const ring: Point[] = [];
      let at: string | undefined = start;
      while (at !== undefined && next.has(at)) {
        ring.push(points.get(at)!);
        const to: string = next.get(at)!;
        next.delete(at);
        at = to;
      }
      const simple = withoutCollinear(ring);
      if (simple.length >= 3) rings.push(simple);
    }
    if (!rings.length) continue;
    rings.sort((p, q) => planArea(q) - planArea(p));
    faces.push(rings);
  }
  return faces;
}

function withoutCollinear(ring: Point[]): Point[] {
  return ring.filter((p, i) => {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[(i + 1) % ring.length];
    const c = cross(sub(p, a), sub(b, p));
    return Math.hypot(...c) > 1e-6 * Math.max(1, Math.hypot(...sub(b, a)) ** 2);
  });
}

function planArea(ring: Point[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
}

function normalOf(t: Triangle): Point {
  return unit(cross(sub(t[1], t[0]), sub(t[2], t[0])));
}
function add(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a: Point, k: number): Point {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Point, b: Point): Point {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function unit(a: Point): Point {
  const l = Math.hypot(...a);
  return l === 0 ? [0, 0, 0] : scale(a, 1 / l);
}
function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** An open model: its lines by express id, with their types. */
class Model {
  private cache = new Map<number, Line>();
  constructor(readonly ifc: WebIFC.IfcAPI, readonly id: number) {}
  line(expressId: number): Line {
    let l = this.cache.get(expressId);
    if (!l) {
      l = this.ifc.GetLine(this.id, expressId) as Line;
      this.cache.set(expressId, l);
    }
    return l;
  }
  typeName(expressId: number): string {
    return this.ifc.GetNameFromTypeCode(this.ifc.GetLineType(this.id, expressId));
  }
  ids(type: number, includeInherited = false): number[] {
    const v = this.ifc.GetLineIDsWithType(this.id, type, includeInherited);
    const out: number[] = [];
    for (let i = 0; i < v.size(); i++) out.push(v.get(i));
    return out;
  }
}

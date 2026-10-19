// Nexgen OS → GeoJSON (RFC 7946).
//
// GeoJSON is what every web map, every GIS and every open-data portal
// reads. A site — or every site taking part in a project — goes out as one
// FeatureCollection: the project's perimeter, the sites, their buildings,
// their roof faces, facades and ground areas, their devices, each a Feature
// with its columns, its attributes (`attributes_of()`), the identifiers it
// is known by and the runs computed on it, so that a scenario can be shown
// beside the places it is about. Coordinates are WGS 84 longitude, latitude
// and height in metres, polygons wound as RFC 7946 asks. Every source the
// export draws on is listed with its licence and attribution.
//
// `open: true` is the export meant for the public: no street line, no
// serial number, no metadata, and nothing that came from a source whose
// licence forbids passing it on. MIT, like every format library.

import type { Db } from '@nexgen-os/core';

export type Position = number[];

export interface Geometry {
  type: 'Point' | 'MultiPoint' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon' | 'GeometryCollection';
  coordinates?: unknown;
  geometries?: Geometry[];
}

/** A run computed on the object, as `record_run()` recorded it. */
export interface RunSummary {
  id: string;
  module: string;
  engine_version: string;
  inputs_hash: string;
  finished_at: string;
  results: unknown;
}

export type FeatureKind = 'project' | 'site' | 'building' | 'surface' | 'device';

export interface FeatureProperties {
  kind: FeatureKind;
  name: string;
  /** Attributes holding at the export's moment, in its scenario. */
  attributes: Record<string, unknown>;
  /** Identifiers the object is known by elsewhere, scheme by scheme. */
  external_ids: { scheme: string; value: string }[];
  runs: RunSummary[];
  [column: string]: unknown;
}

export interface Feature {
  type: 'Feature';
  id: string;
  geometry: Geometry | null;
  properties: FeatureProperties;
}

export interface SourceAttribution {
  code: string;
  name: string;
  license: string | null;
  attribution: string | null;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  bbox?: number[];
  features: Feature[];
  /** Foreign member: what the export is and what it owes. */
  nexgen_os: {
    schema_version: string;
    scenario_id: string | null;
    at: string | null;
    open: boolean;
    /** Every source a feature, an attribute or an identifier came from. */
    sources: SourceAttribution[];
    /** Objects left out of an open export because their source may not be passed on. */
    withheld: number;
  };
}

export interface ExportTarget {
  siteId?: string;
  /** Every site taking part in the project, and the project's perimeter. */
  projectId?: string;
}

export interface ExportOptions {
  /** A scenario: what it adds and overrides, over the world as it is. Default: the world as it is. */
  scenarioId?: string | null;
  /** The moment attributes and identifiers are read at. Default: now. */
  at?: Date | string;
  /** The export for the public: see the head of this file. Default: false. */
  open?: boolean;
  /** The runs computed on each object. Default: true. */
  runs?: boolean;
}

/** Decimal places of the coordinates: 1 cm of longitude or latitude. */
const PRECISION = 7;

const ADDRESS_LINES = ['street', 'address_extra'];
const PRIVATE_COLUMNS = ['serial_number', 'metadata'];

interface Row {
  id: string;
  name: string;
  geometry: string | null;
  source_code: string | null;
  [column: string]: unknown;
}

interface Attachments {
  id: string;
  attributes: Record<string, unknown>;
  external_ids: { scheme: string; value: string; source_code: string | null }[];
  attribute_sources: string[] | null;
  closed_properties: string[] | null;
}

interface RunRow {
  subject_id: string;
  id: string;
  module_code: string;
  engine_version: string;
  inputs_hash: string;
  finished_at: Date | string;
  results: unknown;
}

export async function exportGeoJson(db: Db, target: ExportTarget, options: ExportOptions = {}): Promise<FeatureCollection> {
  if (!target.siteId === !target.projectId) throw new Error('target_required: give a siteId or a projectId');
  const open = options.open ?? false;
  const scenarioId = options.scenarioId ?? null;
  const at = options.at === undefined ? null : new Date(options.at).toISOString();

  // The scenario and those it builds on: their rows join the world as it is.
  const chain = scenarioId
    ? (await db.query<{ id: string }>(
        `with recursive c as (select id, parent_id from scenarios where id = $1
                              union all select s.id, s.parent_id from scenarios s join c on s.id = c.parent_id)
         select id from c`,
        [scenarioId],
      )).rows.map((r) => r.id)
    : [];
  if (scenarioId && chain.length === 0) throw new Error(`scenario_not_found: ${scenarioId}`);
  const visible = (alias: string) => `(${alias}.scenario_id is null or ${alias}.scenario_id = any($2::uuid[]))`;
  const geojson = (column: string) => `ST_AsGeoJSON(ST_ForcePolygonCCW(${column}), ${PRECISION})`;

  const projects: Row[] = [];
  let siteIds: string[];
  if (target.projectId) {
    const project = await db.query<Row>(
      `select p.id, p.name, p.kind project_kind, p.country, p.status, p.start_date::text, p.end_date::text, p.tags, null source_code,
              ${geojson('p.geometry')} geometry
         from community.projects p where p.id = $1 and ${visible('p')}`,
      [target.projectId, chain],
    );
    if (project.rows.length === 0) throw new Error(`project_not_found: ${target.projectId}`);
    projects.push(...project.rows);
    siteIds = (await db.query<{ site_id: string }>(
      `select distinct p.site_id from community.participants p where p.project_id = $1 and p.site_id is not null and ${visible('p')}`,
      [target.projectId, chain],
    )).rows.map((r) => r.site_id);
  } else {
    siteIds = [target.siteId!];
  }

  const sites = await db.query<Row>(
    `select s.id, s.name, s.country, s.street, s.address_extra, s.postal_code, s.city, s.region,
            s.time_zone, s.location_precision, s.profile, s.tags, s.location_source_code source_code, ${geojson('s.geometry')} geometry
       from sites s where s.id = any($1::uuid[]) and ${visible('s')}
      order by s.created_at, s.id`,
    [siteIds, chain],
  );
  if (target.siteId && sites.rows.length === 0) throw new Error(`site_not_found: ${target.siteId}`);
  const found = sites.rows.map((s) => s.id);

  const buildings = await db.query<Row>(
    `select b.id, b.name, b.site_id, b.profile, b.elevation_m::float8 elevation_m, b.height_m::float8 height_m,
            b.status, b.tags, b.source_code, b.metadata,
            ${geojson('b.footprint')} geometry
       from buildings b where b.site_id = any($1::uuid[]) and ${visible('b')}
      order by b.created_at, b.id`,
    [found, chain],
  );
  const surfaces = await db.query<Row>(
    `select f.id, f.name, f.kind surface_kind, coalesce(f.site_id, b.site_id) site_id, f.building_id,
            f.azimuth_deg::float8 azimuth_deg, f.tilt_deg::float8 tilt_deg, f.tags, f.source_code, f.metadata,
            ${geojson('f.geometry')} geometry
       from surfaces f left join buildings b on b.id = f.building_id
      where coalesce(f.site_id, b.site_id) = any($1::uuid[]) and ${visible('f')}
      order by f.created_at, f.id`,
    [found, chain],
  );
  const devices = await db.query<Row>(
    `select d.id, d.name, d.device_type, d.site_id, d.building_id, d.space_id, d.surface_id, d.manufacturer, d.model, d.serial_number,
            d.rated_power_kw::float8 rated_power_kw, d.unit_count, d.status, d.installation_date::text, d.tags, d.metadata,
            d.source_code, ${geojson('d.geometry')} geometry
       from devices d where d.site_id = any($1::uuid[]) and ${visible('d')}
      order by d.created_at, d.id`,
    [found, chain],
  );

  const all: [FeatureKind, Row][] = [
    ...projects.map((r) => ['project', r] as [FeatureKind, Row]),
    ...sites.rows.map((r) => ['site', r] as [FeatureKind, Row]),
    ...buildings.rows.map((r) => ['building', r] as [FeatureKind, Row]),
    ...surfaces.rows.map((r) => ['surface', r] as [FeatureKind, Row]),
    ...devices.rows.map((r) => ['device', r] as [FeatureKind, Row]),
  ];
  const ids = all.map(([, r]) => r.id);

  // What is attached to each object, read the one way attributes are read.
  // An attribute or an identifier holds at the moment asked, in the scenario.
  const holds = (alias: string) =>
    `(${alias}.valid_from is null or ${alias}.valid_from <= coalesce($3::timestamptz, now()))
     and (${alias}.valid_to is null or ${alias}.valid_to > coalesce($3::timestamptz, now())) and ${visible(alias)}`;
  const attachments = await db.query<Attachments>(
    `select o.id,
            attributes_of(o.id, coalesce($3::timestamptz, now()), $4::uuid) attributes,
            coalesce((select jsonb_agg(jsonb_build_object('scheme', e.scheme, 'value', e.value, 'source_code', i.source_code) order by e.scheme, e.value)
                        from external_ids e join id_schemes i on i.code = e.scheme
                       where e.object_id = o.id and ${holds('e')}), '[]'::jsonb) external_ids,
            (select array_agg(distinct a.source_code) from attributes a
              where a.object_id = o.id and a.source_code is not null and ${holds('a')}) attribute_sources,
            (select array_agg(distinct a.property_code) from attributes a join sources s on s.code = a.source_code
              where a.object_id = o.id and not s.redistributable and ${holds('a')}) closed_properties
       from unnest($1::uuid[]) o(id)`,
    [ids, chain, at, scenarioId],
  );
  const attached = new Map(attachments.rows.map((a) => [a.id, a]));

  const runs = new Map<string, RunSummary[]>();
  if (options.runs ?? true) {
    const rows = await db.query<RunRow>(
      `select r.subject_id, r.id, r.module_code, r.engine_version, r.inputs_hash, r.finished_at, r.results
         from runs r
        where r.subject_id = any($1::uuid[]) and r.status = 'succeeded' and r.scenario_id is not distinct from $2::uuid
        order by r.finished_at, r.id`,
      [ids, scenarioId],
    );
    for (const r of rows.rows) {
      const list = runs.get(r.subject_id) ?? [];
      list.push({
        id: r.id,
        module: r.module_code,
        engine_version: r.engine_version,
        inputs_hash: r.inputs_hash,
        finished_at: new Date(r.finished_at).toISOString(),
        results: r.results,
      });
      runs.set(r.subject_id, list);
    }
  }

  // Every source drawn on, and whether it may be passed on.
  const codes = new Set<string>();
  for (const [, r] of all) if (r.source_code) codes.add(r.source_code);
  for (const a of attachments.rows) {
    for (const c of a.attribute_sources ?? []) codes.add(c);
    for (const e of a.external_ids) if (e.source_code) codes.add(e.source_code);
  }
  const sources = await db.query<SourceAttribution & { redistributable: boolean }>(
    `select code, name, license, attribution, redistributable from sources where code = any($1::text[]) order by code`,
    [[...codes]],
  );
  const closed = new Set(sources.rows.filter((s) => !s.redistributable).map((s) => s.code));

  const withheldIds = new Set<string>();
  const features: Feature[] = [];
  for (const [kind, row] of all) {
    const { id, name, geometry, source_code, ...columns } = row;
    const parentWithheld = ['site_id', 'building_id', 'surface_id'].some((c) => typeof columns[c] === 'string' && withheldIds.has(columns[c] as string));
    let shape: Geometry | null = geometry ? (JSON.parse(geometry) as Geometry) : null;
    if (open && source_code && closed.has(source_code)) {
      // A site keeps its address and loses the point; a described object goes.
      if (kind !== 'site') {
        withheldIds.add(id);
        continue;
      }
      shape = null;
    }
    if (open && parentWithheld) {
      withheldIds.add(id);
      continue;
    }
    const a = attached.get(id);
    const attributes = { ...(a?.attributes ?? {}) };
    let externalIds = (a?.external_ids ?? []).map(({ scheme, value, source_code: s }) => ({ scheme, value, source_code: s }));
    if (open) {
      for (const p of a?.closed_properties ?? []) delete attributes[p];
      externalIds = externalIds.filter((e) => !e.source_code || !closed.has(e.source_code));
      for (const c of [...ADDRESS_LINES, ...PRIVATE_COLUMNS]) delete columns[c];
    }
    const properties: FeatureProperties = {
      kind,
      name,
      ...columns,
      ...(kind === 'site' ? { location_source_code: source_code } : kind === 'building' || kind === 'surface' ? { source_code } : {}),
      attributes,
      external_ids: externalIds.map(({ scheme, value }) => ({ scheme, value })),
      runs: runs.get(id) ?? [],
    };
    features.push({ type: 'Feature', id, geometry: shape, properties });
  }

  const used = new Set<string>();
  for (const f of features) {
    for (const c of [f.properties.source_code, f.properties.location_source_code]) if (typeof c === 'string' && (!open || !closed.has(c))) used.add(c);
    const a = attached.get(f.id);
    for (const c of a?.attribute_sources ?? []) if (!open || !closed.has(c)) used.add(c);
    for (const e of a?.external_ids ?? []) if (e.source_code && (!open || !closed.has(e.source_code))) used.add(e.source_code);
  }

  const version = await db.query<{ v: string }>('select nexgen_schema_version() v');
  const box = bbox(features);
  return {
    type: 'FeatureCollection',
    ...(box ? { bbox: box } : {}),
    features,
    nexgen_os: {
      schema_version: version.rows[0].v,
      scenario_id: scenarioId,
      at,
      open,
      sources: sources.rows.filter((s) => used.has(s.code)).map(({ code, name, license, attribution }) => ({ code, name, license, attribution })),
      withheld: withheldIds.size,
    },
  };
}

/** West, south, east, north of every position of the features (RFC 7946 §5), or null when none has a shape. */
export function bbox(features: Feature[]): number[] | null {
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

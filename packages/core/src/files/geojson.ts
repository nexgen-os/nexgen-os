/**
 * A participant, or every participant taking part in a project, as one
 * GeoJSON FeatureCollection, written by `@nexgen-os/geojson`.
 *
 * The project's perimeter, the participants at their place, their devices
 * (without a geometry: a device is not placed, decision 0026) and — when the
 * `building` module is installed — their ground, their buildings, their
 * roof faces, facades and ground areas, each a feature with its
 * columns, its attributes (`attributes_of()`), the identifiers it is known
 * by and the figures the modules computed on it (each module's table of
 * them: `solar.estimates`, `community.settlements`…), so
 * that a figure can be shown beside the places it is about. Coordinates are WGS 84 longitude, latitude and
 * height in metres, polygons wound as RFC 7946 asks. Every source the
 * export draws on is listed with its licence and attribution.
 *
 * `open: true` is the export meant for the public: no street line, no
 * serial number, no metadata of a described object, and nothing that came from a source whose
 * licence forbids passing it on.
 */
import { writeGeoJson, type Feature, type FeatureCollection, type Geometry } from '@nexgen-os/geojson';
import type { Db } from '../db.js';

/** A figure a module computed on the object, as the module's table keeps it. */
export interface CalculationSummary {
  id: string;
  module: string;
  /** The module's table it is kept in, e.g. `estimates`, `settlements`. */
  table: string;
  /** Where it comes from: the program and the version that computed it. */
  provenance: string;
  updated_at: string;
  results: unknown;
}

export type FeatureKind = 'project' | 'participant' | 'site' | 'building' | 'surface' | 'device';

export interface FeatureProperties {
  kind: FeatureKind;
  name: string;
  /** Attributes holding at the export's moment. */
  attributes: Record<string, unknown>;
  /** Identifiers the object is known by elsewhere, scheme by scheme. */
  identifiers: { scheme: string; value: string }[];
  calculations: CalculationSummary[];
  [column: string]: unknown;
}

export interface SourceAttribution {
  code: string;
  name: string;
  license: string | null;
  attribution: string | null;
}

/** The export: a FeatureCollection of the model's features, and a foreign member that says what it is. */
export type GeoJsonExport = FeatureCollection<FeatureProperties> & {
  /** Foreign member: what the export is and what it owes. */
  nexgen_os: {
    schema_version: string;
    at: string | null;
    open: boolean;
    /** Every source a feature, an attribute or an identifier came from. */
    sources: SourceAttribution[];
    /** Objects left out of an open export because their source may not be passed on. */
    withheld: number;
  };
};

export interface GeoJsonTarget {
  participantId?: string;
  /** Every participant taking part in the project, and the project's perimeter. */
  projectId?: string;
}

export interface GeoJsonExportOptions {
  /** The moment attributes and identifiers are read at. Default: now. */
  at?: Date | string;
  /** The export for the public: see the head of this file. Default: false. */
  open?: boolean;
  /** The figures the modules computed on each object. Default: true. */
  calculations?: boolean;
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
  identifiers: { scheme: string; value: string; source_code: string | null }[];
  attribute_sources: string[] | null;
  closed_properties: string[] | null;
}

interface CalculationRow {
  subject_id: string;
  id: string;
  module_code: string;
  table_name: string;
  provenance: string;
  updated_at: Date | string;
  results: unknown;
}

export async function exportGeoJson(db: Db, target: GeoJsonTarget, options: GeoJsonExportOptions = {}): Promise<GeoJsonExport> {
  if (!target.participantId === !target.projectId) throw new Error('target_required: give a participantId or a projectId');
  const open = options.open ?? false;
  const at = options.at === undefined ? null : new Date(options.at).toISOString();
  const geojson = (column: string) => `ST_AsGeoJSON(ST_ForcePolygonCCW(${column}), ${PRECISION})`;

  const projects: Row[] = [];
  if (target.projectId) {
    const project = await db.query<Row>(
      `select p.id, p.name, p.kind project_kind, p.country, p.status, p.start_date::text, p.end_date::text, null source_code,
              ${geojson('p.geometry')} geometry
         from projects p where p.id = $1`,
      [target.projectId],
    );
    if (project.rows.length === 0) throw new Error(`project_not_found: ${target.projectId}`);
    projects.push(...project.rows);
  }

  // The participants with a place: a group has none, and is not a feature.
  const participants = await db.query<Row>(
    `select p.id, p.name, p.project_id, p.role, p.status, p.country, p.street, p.address_extra, p.postal_code, p.city, p.region,
            p.time_zone, p.location_precision, p.location_source_code source_code, ${geojson('p.geometry')} geometry
       from participants p
      where (p.id = $1::uuid or p.project_id = $2::uuid) and p.country is not null
      order by p.created_at, p.id`,
    [target.participantId ?? null, target.projectId ?? null],
  );
  if (target.participantId && participants.rows.length === 0) throw new Error(`participant_not_found: ${target.participantId}`);
  const found = participants.rows.map((p) => p.id);

  // The physical description of their places is the `building` module's,
  // read only where it is installed.
  const described = (await db.query<{ installed: boolean }>(`select to_regclass('building.buildings') is not null installed`)).rows[0].installed;
  const grounds = described
    ? (await db.query<Row>(
        `select s.id, s.name, s.participant_id, s.profile, s.area_m2::float8 area_m2, s.global_id, s.source_code, s.metadata,
                ${geojson('s.geometry')} geometry
           from building.sites s where s.participant_id = any($1::uuid[])
          order by s.created_at, s.id`,
        [found],
      )).rows
    : [];
  const buildings = described
    ? (await db.query<Row>(
        `select b.id, b.name, b.participant_id, b.site_id, b.profile, b.elevation_m::float8 elevation_m, b.height_m::float8 height_m,
                b.year_built, b.floors_above_ground, b.floors_below_ground, b.floor_area_m2::float8 floor_area_m2, b.energy_label,
                b.status, b.global_id, b.source_code, b.metadata,
                ${geojson('b.footprint')} geometry
           from building.buildings b where b.participant_id = any($1::uuid[])
          order by b.created_at, b.id`,
        [found],
      )).rows
    : [];
  const surfaces = described
    ? (await db.query<Row>(
        `select f.id, f.name, f.kind surface_kind, coalesce(s.participant_id, b.participant_id) participant_id, f.site_id, f.building_id,
                f.azimuth_deg::float8 azimuth_deg, f.tilt_deg::float8 tilt_deg, f.area_m2::float8 area_m2, f.material,
                f.u_value::float8 u_value, f.is_external, f.global_id, f.source_code, f.metadata,
                ${geojson('f.geometry')} geometry
           from building.surfaces f left join building.buildings b on b.id = f.building_id left join building.sites s on s.id = f.site_id
          where coalesce(s.participant_id, b.participant_id) = any($1::uuid[])
          order by f.created_at, f.id`,
        [found],
      )).rows
    : [];
  const devices = await db.query<Row>(
    `select d.id, d.name, d.device_type, d.participant_id,
            d.manufacturer, d.model, d.serial_number,
            d.rated_power_kw::float8 rated_power_kw, d.unit_count, d.status, d.installation_date::text,
            d.source_code, null geometry
       from devices d
      where d.participant_id = any($1::uuid[])
      order by d.created_at, d.id`,
    [found],
  );

  const all: [FeatureKind, Row][] = [
    ...projects.map((r) => ['project', r] as [FeatureKind, Row]),
    ...participants.rows.map((r) => ['participant', r] as [FeatureKind, Row]),
    ...grounds.map((r) => ['site', r] as [FeatureKind, Row]),
    ...buildings.map((r) => ['building', r] as [FeatureKind, Row]),
    ...surfaces.map((r) => ['surface', r] as [FeatureKind, Row]),
    ...devices.rows.map((r) => ['device', r] as [FeatureKind, Row]),
  ];
  const ids = all.map(([, r]) => r.id);

  // What is attached to each object, read the one way attributes are read.
  // An attribute or an identifier holds at the moment asked.
  const holds = (alias: string) =>
    `(${alias}.valid_from is null or ${alias}.valid_from <= coalesce($2::timestamptz, now()))
     and (${alias}.valid_to is null or ${alias}.valid_to > coalesce($2::timestamptz, now()))`;
  const attachments = await db.query<Attachments>(
    `select o.id,
            attributes_of(o.id, coalesce($2::timestamptz, now())) attributes,
            coalesce((select jsonb_agg(jsonb_build_object('scheme', e.scheme, 'value', e.value, 'source_code', i.source_code) order by e.scheme, e.value)
                        from identifiers e join identifier_schemes i on i.code = e.scheme
                       where e.object_id = o.id and ${holds('e')}), '[]'::jsonb) identifiers,
            (select array_agg(distinct a.source_code) from attributes a
              where a.object_id = o.id and a.source_code is not null and ${holds('a')}) attribute_sources,
            (select array_agg(distinct a.attribute_type) from attributes a join sources s on s.code = a.source_code
              where a.object_id = o.id and not s.redistributable and ${holds('a')}) closed_properties
       from unnest($1::uuid[]) o(id)`,
    [ids, at],
  );
  const attached = new Map(attachments.rows.map((a) => [a.id, a]));

  // What every installed module computed, in each of its tables of the
  // shape of a figure (provenance, inputs, results), on an object of the
  // core by its foreign key.
  const calculations = new Map<string, CalculationSummary[]>();
  if (options.calculations ?? true) {
    const tables = await db.query<{ module_code: string; schema_name: string; table_name: string; subject: string }>(
      `select distinct m.code module_code, m.schema_name, cl.relname::text table_name, c.column_name::text subject
         from modules m
         join pg_namespace n on n.nspname = m.schema_name
         join pg_class cl on cl.relnamespace = n.oid
         join information_schema.columns c on c.table_schema = m.schema_name and c.table_name = cl.relname
        where cl.relkind = 'r'
          and c.column_name in ('project_id', 'participant_id', 'device_id', 'meter_id')
          and (select count(*) from information_schema.columns f
                where f.table_schema = m.schema_name and f.table_name = cl.relname
                  and f.column_name in ('provenance', 'inputs', 'results')) = 3
        order by 1, 3`,
    );
    const rows: CalculationRow[] = [];
    for (const t of tables.rows) {
      const found = await db.query<CalculationRow>(
        `select c.${t.subject} subject_id, c.id, $2::text module_code, $3::text table_name, c.provenance, c.updated_at, c.results
           from ${t.schema_name}.${t.table_name} c
          where c.${t.subject} = any($1::uuid[])`,
        [ids, t.module_code, t.table_name],
      );
      rows.push(...found.rows);
    }
    rows.sort((p, q) => new Date(p.updated_at).getTime() - new Date(q.updated_at).getTime() || p.id.localeCompare(q.id));
    for (const r of rows) {
      const list = calculations.get(r.subject_id) ?? [];
      list.push({
        id: r.id,
        module: r.module_code,
        table: r.table_name,
        provenance: r.provenance,
        updated_at: new Date(r.updated_at).toISOString(),
        results: r.results,
      });
      calculations.set(r.subject_id, list);
    }
  }

  // Every source drawn on, and whether it may be passed on.
  const codes = new Set<string>();
  for (const [, r] of all) if (r.source_code) codes.add(r.source_code);
  for (const a of attachments.rows) {
    for (const c of a.attribute_sources ?? []) codes.add(c);
    for (const e of a.identifiers) if (e.source_code) codes.add(e.source_code);
  }
  const sources = await db.query<SourceAttribution & { redistributable: boolean }>(
    `select code, name, license, attribution, redistributable from sources where code = any($1::text[]) order by code`,
    [[...codes]],
  );
  const closed = new Set(sources.rows.filter((s) => !s.redistributable).map((s) => s.code));

  const withheldIds = new Set<string>();
  const features: (Feature<FeatureProperties> & { id: string })[] = [];
  for (const [kind, row] of all) {
    const { id, name, geometry, source_code, ...columns } = row;
    const parentWithheld = ['participant_id', 'site_id', 'building_id'].some((c) => typeof columns[c] === 'string' && withheldIds.has(columns[c] as string));
    let shape: Geometry | null = geometry ? (JSON.parse(geometry) as Geometry) : null;
    if (open && source_code && closed.has(source_code)) {
      // A participant keeps its address and loses the point; a described object goes.
      if (kind !== 'participant') {
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
    let identifiers = (a?.identifiers ?? []).map(({ scheme, value, source_code: s }) => ({ scheme, value, source_code: s }));
    if (open) {
      for (const p of a?.closed_properties ?? []) delete attributes[p];
      identifiers = identifiers.filter((e) => !e.source_code || !closed.has(e.source_code));
      for (const c of [...ADDRESS_LINES, ...PRIVATE_COLUMNS]) delete columns[c];
    }
    const properties: FeatureProperties = {
      kind,
      name,
      ...columns,
      ...(kind === 'participant' ? { location_source_code: source_code } : kind === 'site' || kind === 'building' || kind === 'surface' ? { source_code } : {}),
      attributes,
      identifiers: identifiers.map(({ scheme, value }) => ({ scheme, value })),
      calculations: calculations.get(id) ?? [],
    };
    features.push({ type: 'Feature', id, geometry: shape, properties });
  }

  const used = new Set<string>();
  for (const f of features) {
    for (const c of [f.properties.source_code, f.properties.location_source_code]) if (typeof c === 'string' && (!open || !closed.has(c))) used.add(c);
    const a = attached.get(f.id);
    for (const c of a?.attribute_sources ?? []) if (!open || !closed.has(c)) used.add(c);
    for (const e of a?.identifiers ?? []) if (e.source_code && (!open || !closed.has(e.source_code))) used.add(e.source_code);
  }

  const version = await db.query<{ v: string }>('select nexgen_schema_version() v');
  return writeGeoJson(features, {
    nexgen_os: {
      schema_version: version.rows[0].v,
      at,
      open,
      sources: sources.rows.filter((s) => used.has(s.code)).map(({ code, name, license, attribution }) => ({ code, name, license, attribution })),
      withheld: withheldIds.size,
    },
  });
}

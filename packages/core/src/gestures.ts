/**
 * The gestures a surface offers — one code path for the MCP server and the
 * command line (decision 0046).
 *
 * Each function takes a `Db` that acts as a person (`personSession()`), and
 * either calls the schema's own function for its gesture (`create_project()`,
 * `join_project()`, `declare_meter()`, `install_device()`,
 * `kpis.compute()`, `actions.propose()`…) or reads what row level security
 * lets through. Nothing here computes a figure: sizing, a yield and a
 * settlement are the code of their module, handed in as `Computations` by
 * whoever starts the surface, and they write their own estimate.
 */
import type { Db } from './db.js';
import type { Geocoder, Place } from './address.js';
import { placeFields } from './address.js';
import { GestureError } from './refusal.js';
import { readHomeAssistant, type HaSnapshot } from '@nexgen-os/homeassistant';
import { storeSeries, type SeriesTarget } from './connectors/interfaces.js';
import { resample } from './series.js';

/** The six objects of the core (decision 0006), by the name of their table. */
export const OBJECT_TABLES = {
  organisation: 'organisations',
  project: 'projects',
  participant: 'participants',
  meter: 'meters',
  device: 'devices',
  series: 'series',
} as const;
export type ObjectKind = keyof typeof OBJECT_TABLES;
export const OBJECT_KINDS = Object.keys(OBJECT_TABLES) as ObjectKind[];

/** What a list shows of each object: what a person reads first, never a geometry. */
const LIST_COLUMNS: Record<ObjectKind, string> = {
  organisation: 'id, name',
  project: 'id, organisation_id, name, kind, country, status, start_date',
  participant: 'id, organisation_id, project_id, name, category, segment, country, municipality, time_zone, location_precision',
  meter: 'id, organisation_id, participant_id, name, identifier, scheme, resource, direction, valid_from, valid_to',
  device: 'id, organisation_id, participant_id, name, device_type, product_id, rated_power_kw, unit_count, status, installation_date',
  series: 'id, organisation_id, object_kind, object_id, quantity_code, kind, value_kind, step::text as step, source_code, name',
};

/** The filters each list takes, by column. */
const LIST_FILTERS: Record<ObjectKind, string[]> = {
  organisation: [],
  project: ['organisation_id'],
  participant: ['organisation_id', 'project_id'],
  meter: ['organisation_id', 'participant_id'],
  device: ['organisation_id', 'participant_id'],
  series: ['organisation_id', 'object_id', 'quantity_code'],
};

function kindOf(kind: string): ObjectKind {
  if (!(kind in OBJECT_TABLES)) {
    throw new GestureError(`unknown_object_kind: ${kind} is not one of ${OBJECT_KINDS.join(', ')}`);
  }
  return kind as ObjectKind;
}

async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function first<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await rows<T>(db, sql, params);
  if (row === undefined) throw new GestureError(`nothing_returned: ${sql.split('(')[0]}`);
  return row;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface Status {
  schema_version: string;
  acting_as: string | null;
  modules: { code: string; version: string }[];
  organisations: { id: string; name: string; role: string | null }[];
}

/** The schema version, who this acts as, the modules installed and the organisations visible. */
export async function status(db: Db): Promise<Status> {
  const { schema_version, acting_as } = await first<{ schema_version: string; acting_as: string | null }>(db,
    'select nexgen_schema_version() schema_version, auth.uid()::text acting_as');
  const modules = await rows<{ code: string; version: string }>(db, 'select code, version from modules order by code');
  const organisations = await rows<{ id: string; name: string; role: string | null }>(db,
    'select id, name, organisation_role(id)::text as role from organisations order by name');
  return { schema_version, acting_as, modules, organisations };
}

/** The codes of the modules installed, for a surface that offers their tools. */
export async function installedModules(db: Db): Promise<string[]> {
  return (await rows<{ code: string }>(db, 'select code from modules order by code')).map((m) => m.code);
}

/** Objects of one kind, filtered by the columns its list takes, at most `limit`. */
export async function listObjects(db: Db, kind: string, filters: Record<string, string | undefined> = {}, limit = 100): Promise<Record<string, unknown>[]> {
  const k = kindOf(kind);
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    if (!LIST_FILTERS[k].includes(column)) {
      throw new GestureError(`unknown_filter: ${kind} is filtered by ${LIST_FILTERS[k].join(', ') || 'nothing'}, not ${column}`);
    }
    params.push(value);
    where.push(`${column} = $${params.length}`);
  }
  params.push(Math.min(Math.max(limit, 1), 1000));
  return rows(db, `select ${LIST_COLUMNS[k]} from ${OBJECT_TABLES[k]}${where.length ? ` where ${where.join(' and ')}` : ''}
    order by ${k === 'series' ? 'created_at' : 'name'} limit $${params.length}`, params);
}

/** One object with its attributes in force (`attributes_of()`), or `object_not_found`. */
export async function getObject(db: Db, kind: string, id: string): Promise<Record<string, unknown>> {
  const k = kindOf(kind);
  const [row] = await rows<Record<string, unknown>>(db, `select ${LIST_COLUMNS[k]} from ${OBJECT_TABLES[k]} where id = $1`, [id]);
  if (row === undefined) throw new GestureError(`object_not_found: no ${kind} ${id} visible to you`);
  const { attributes } = await first<{ attributes: unknown }>(db, 'select attributes_of($1) attributes', [id]);
  return { kind, ...row, attributes };
}

/** The values of a series per bucket (`resample()`), in the unit of its quantity. */
export async function readSeries(db: Db, seriesId: string, from: string, to: string, step: string) {
  return resample(db, seriesId, from, to, step);
}

/** The value of a parameter for an object, through the cascade of defaults (`parameter_of()`). */
export async function parameterOf(db: Db, kind: string, id: string, attributeType: string, at?: string): Promise<unknown> {
  const { value } = await first<{ value: unknown }>(db, 'select parameter_of($1, $2, $3, coalesce($4::timestamptz, now())) as value',
    [kindOf(kind), id, attributeType, at ?? null]);
  return value;
}

async function requireModule(db: Db, code: string): Promise<void> {
  const [found] = await rows(db, 'select 1 from modules where code = $1', [code]);
  if (found === undefined) throw new GestureError(`module_not_installed: the ${code} module is not installed on this database`);
}

/** The indicators of an object over a period (`kpis.of()`). */
export async function kpisOf(db: Db, kind: string, id: string, from: string, to: string) {
  await requireModule(db, 'kpis');
  return rows(db, 'select * from kpis.of($1, $2, $3, $4)', [kind, id, from, to]);
}

/** The estimates of a module (`solar.estimates`, `battery.estimates`) about a participant or a device. */
export async function estimatesOf(db: Db, module: 'solar' | 'battery', filters: { participant_id?: string; device_id?: string; kind?: string }, limit = 20) {
  await requireModule(db, module);
  const params: unknown[] = [filters.participant_id ?? null, filters.device_id ?? null, filters.kind ?? null, limit];
  return rows(db, `select id, participant_id, device_id, ${module === 'solar' ? 'kind' : 'criterion as kind'}, provenance, inputs, results, created_at
    from ${module}.estimates
    where ($1::uuid is null or participant_id = $1) and ($2::uuid is null or device_id = $2) and ($3::text is null or ${module === 'solar' ? 'kind' : 'criterion'} = $3)
    order by created_at desc limit $4`, params);
}

/** The settlements of a project (`community.settlements`), latest first. */
export async function settlementsOf(db: Db, projectId: string, limit = 20) {
  await requireModule(db, 'community');
  return rows(db, `select id, project_id, provenance, inputs, results, created_at from community.settlements
    where project_id = $1 order by created_at desc limit $2`, [projectId, limit]);
}

/** The charging sessions of a charger, or of every charger of a participant (`charging.sessions`), latest first. */
export async function chargingSessionsOf(db: Db, filters: { device_id?: string; participant_id?: string; from?: string; to?: string }, limit = 50) {
  await requireModule(db, 'charging');
  return rows(db, `select s.id, s.device_id, s.evse_id, s.connector_id, s.transaction_id, s.started_at, s.ended_at, s.energy_kwh, s.peak_power_kw,
      s.vehicle, s.stop_reason, s.source, s.source_ref
    from charging.sessions s join devices d on d.id = s.device_id
    where ($1::uuid is null or s.device_id = $1) and ($2::uuid is null or d.participant_id = $2)
      and ($3::timestamptz is null or s.started_at >= $3) and ($4::timestamptz is null or s.started_at < $4)
    order by s.started_at desc limit $5`,
    [filters.device_id ?? null, filters.participant_id ?? null, filters.from ?? null, filters.to ?? null, Math.min(Math.max(limit, 1), 1000)]);
}

/** The actions of a project and of its participants (`actions.actions`). */
export async function actionsOf(db: Db, projectId: string) {
  await requireModule(db, 'actions');
  return rows(db, `select id, object_kind, object_id, kind, phase, name, status, source, planned_start, planned_end,
      estimate_kind, estimate_id, expected_gain_per_year, gain_horizon_years
    from actions.actions
    where (object_kind = 'project' and object_id = $1)
       or (object_kind = 'participant' and object_id in (select id from participants where project_id = $1))
    order by created_at`, [projectId]);
}

// ---------------------------------------------------------------------------
// Writing — each through the schema's function for the gesture
// ---------------------------------------------------------------------------

export interface ProjectInput {
  organisation_id: string;
  name: string;
  country: string;
  kind?: string;
  start_date?: string;
}

export async function createProject(db: Db, p: ProjectInput): Promise<{ id: string }> {
  return first(db, 'select create_project($1, $2, $3, $4, $5) id',
    [p.organisation_id, p.name, p.country, p.kind ?? null, p.start_date ?? null]);
}

export interface ParticipantInput {
  project_id: string;
  name: string;
  /** producer, consumer or prosumer; consumer when not given. */
  category?: string;
  time_zone?: string;
  /** A place in the standard shape (`placeFields()`), when the caller has one. */
  place?: Record<string, unknown>;
  /** An address to find through the geocoder chain the person configured. */
  address?: string;
  country?: string;
}

/**
 * A participant joins a project with its place (`join_project()`). An
 * address is found through the geocoder chain the person configured
 * (`geocoderFor()`); the best place is kept, with its source.
 */
export async function addParticipant(db: Db, p: ParticipantInput, geocoder?: Geocoder): Promise<{ id: string; place: Record<string, unknown> | null }> {
  let place = p.place ?? null;
  if (place === null && p.address !== undefined) {
    if (geocoder === undefined) throw new GestureError('geocoder_not_configured: an address is found through a geocoder the person configures');
    const [found]: Place[] = await geocoder.search(p.address, { country: p.country, limit: 1 });
    if (found === undefined) throw new GestureError(`address_not_found: no geocoder of the chain found ${JSON.stringify(p.address)}`);
    place = placeFields(found) as unknown as Record<string, unknown>;
  }
  const { id } = await first<{ id: string }>(db,
    `select join_project($1, $2, $3::jsonb, coalesce($4, 'consumer'), p_time_zone => $5) id`,
    [p.project_id, p.name, place === null ? null : JSON.stringify(place), p.category ?? null, p.time_zone ?? null]);
  return { id, place };
}

export interface MeterInput {
  participant_id: string;
  identifier: string;
  scheme: string;
  resource?: string;
  direction?: string;
  valid_from?: string;
  name?: string;
}

export async function declareMeter(db: Db, m: MeterInput): Promise<{ id: string }> {
  return first(db, `select declare_meter($1, $2, $3, coalesce($4, 'electricity'), coalesce($5, 'both'), $6, $7) id`,
    [m.participant_id, m.identifier, m.scheme, m.resource ?? null, m.direction ?? null, m.valid_from ?? null, m.name ?? null]);
}

export interface DeviceInput {
  participant_id: string;
  device_type: string;
  name: string;
  product_id?: string;
  rated_power_kw?: number;
  installed_on?: string;
  source_code?: string;
  unit_count?: number;
}

export async function installDevice(db: Db, d: DeviceInput): Promise<{ id: string }> {
  return first(db, `select install_device($1, $2, $3, $4, $5, $6, $7, coalesce($8, 1)) id`,
    [d.participant_id, d.device_type, d.name, d.product_id ?? null, d.rated_power_kw ?? null, d.installed_on ?? null,
     d.source_code ?? null, d.unit_count ?? null]);
}

export interface PvArrayInput {
  name: string;
  /** Degrees clockwise from true north: 180 faces south. */
  azimuth_deg: number;
  /** Degrees from horizontal. */
  tilt_deg: number;
  /** The array's DC power; the system's when it has one array. */
  kwp?: number;
  mounting?: string;
}

export interface PvSystemInput {
  participant_id: string;
  name: string;
  /** The DC power of the system, kWp. */
  kwp: number;
  arrays: PvArrayInput[];
  installed_on?: string;
}

/**
 * A PV system of a participant, described as the `solar` module reads it: a
 * device of the core (`install_device()`, type `solar`), its row of
 * `solar.devices` with its DC power, and one row of `solar.pv_arrays` per
 * array with its own orientation. Its yield is then a computation of the
 * module (`solar.yield`).
 */
export async function describePvSystem(db: Db, p: PvSystemInput): Promise<{ device_id: string; arrays: string[] }> {
  await requireModule(db, 'solar');
  if (p.arrays.length === 0) throw new GestureError('pv_array_required: a PV system has at least one array, with its azimuth and tilt');
  const { id } = await installDevice(db, { participant_id: p.participant_id, device_type: 'solar', name: p.name, rated_power_kw: p.kwp, ...(p.installed_on ? { installed_on: p.installed_on } : {}) });
  await db.query('insert into solar.devices (id, kwp_dc) values ($1, $2)', [id, p.kwp]);
  const arrays: string[] = [];
  for (const a of p.arrays) {
    const row = await first<{ id: string }>(db,
      `insert into solar.pv_arrays (organisation_id, device_id, name, azimuth_deg, tilt_deg, mounting, kwp_dc)
       select d.organisation_id, d.id, $2, $3, $4, $5, $6 from devices d where d.id = $1 returning id`,
      [id, a.name, a.azimuth_deg, a.tilt_deg, a.mounting ?? null, a.kwp ?? (p.arrays.length === 1 ? p.kwp : null)]);
    arrays.push(row.id);
  }
  return { device_id: id, arrays };
}

/**
 * The readings of one entity of a Home Assistant export, read by its format
 * library (`@nexgen-os/homeassistant`) and written through `store()` as a
 * series of the object named, in the unit the entity states. Unavailable
 * states are left out, never filled.
 */
export async function importHomeAssistantSeries(
  db: Db,
  target: SeriesTarget,
  snapshot: HaSnapshot,
  entityId: string,
  quantityCode: string,
): Promise<{ seriesId: string; inserted: number }> {
  const point = readHomeAssistant(snapshot).points.find((p) => p.key === entityId);
  if (point === undefined) throw new GestureError(`entity_not_found: ${entityId} is not an entity of this export`);
  const values = point.readings.filter((r): r is { at: string; value: number } => r.value !== null);
  if (values.length === 0) throw new GestureError(`series_values_required: ${entityId} has no reading with a number`);
  return storeSeries(db, target, {
    quantity_code: quantityCode, value_kind: point.valueKind, step: null,
    ...(point.unit === null ? {} : { unit: point.unit }), values,
  });
}

/** An indicator computed and kept as a figure (`kpis.compute()`). */
export async function computeKpi(db: Db, kind: string, id: string, indicator: string, from: string, to: string): Promise<{ figure_id: string }> {
  await requireModule(db, 'kpis');
  return first(db, 'select kpis.compute($1, $2, $3, $4, $5) figure_id', [kind, id, indicator, from, to]);
}

export interface ProposalInput {
  object_kind: string;
  object_id: string;
  phase: string;
  name: string;
  estimate_kind?: string;
  estimate_id?: string;
  gain_per_year?: number;
  horizon_years?: number;
}

/** What an agent recommends: an action proposed, `source = 'agent'`, resting on the estimate that gives its gain. */
export async function proposeAction(db: Db, a: ProposalInput): Promise<{ id: string }> {
  await requireModule(db, 'actions');
  return first(db, `select actions.propose($1, $2, $3, $4, 'agent', null, $5, $6, $7, $8) id`,
    [a.object_kind, a.object_id, a.phase, a.name, a.estimate_kind ?? null, a.estimate_id ?? null, a.gain_per_year ?? null, a.horizon_years ?? null]);
}

/** A charging profile asked of a charger by an agent (`charging.limit()`): a command action, proposed; the person validates it. */
export async function limitCharging(db: Db, deviceId: string, schedule: Record<string, unknown>): Promise<{ id: string }> {
  await requireModule(db, 'charging');
  return first(db, `select charging.limit($1, $2::jsonb, 'agent') id`, [deviceId, JSON.stringify(schedule)]);
}

/** An action moved along its lifecycle (`actions.move()`): validated by the person, launched, done. */
export async function moveAction(db: Db, actionId: string, toStatus: string, on?: string): Promise<{ id: string; status: string }> {
  await requireModule(db, 'actions');
  await db.query('select actions.move($1, $2, $3)', [actionId, toStatus, on ?? null]);
  return { id: actionId, status: toStatus };
}

// ---------------------------------------------------------------------------
// Keys — an owner's gestures (decision 0046)
// ---------------------------------------------------------------------------

/** Issues a key on an organisation; the secret is in the answer once, and nowhere else. */
export async function createApiKey(db: Db, k: { organisation_id: string; name: string; capabilities?: string[]; expires_at?: string }) {
  return first<{ api_key_id: string; secret: string; prefix: string; capabilities: string[]; expires_at: string | null }>(db,
    'select * from nexgen.create_api_key($1, $2, $3::text[], $4)',
    [k.organisation_id, k.name, `{${(k.capabilities ?? ['data.read']).join(',')}}`, k.expires_at ?? null]);
}

/** The keys of an organisation, never their secret. */
export async function listApiKeys(db: Db, organisationId: string) {
  return rows(db, 'select * from nexgen.list_api_keys($1)', [organisationId]);
}

/** Withdraws a key, at once. */
export async function revokeApiKey(db: Db, apiKeyId: string): Promise<{ id: string; revoked: true }> {
  await db.query('select nexgen.revoke_api_key($1)', [apiKeyId]);
  return { id: apiKeyId, revoked: true };
}

// ---------------------------------------------------------------------------
// Computing — the code of a module, handed in
// ---------------------------------------------------------------------------

/**
 * The computations of the modules that are code rather than functions of
 * the schema. Each takes the request of its module and writes its own
 * estimate or settlement, with its provenance. A surface started without
 * one answers `computation_not_loaded`.
 */
export interface Computations {
  'solar.size'?: (db: Db, request: never) => Promise<unknown>;
  'battery.size'?: (db: Db, request: never) => Promise<unknown>;
  'solar.yield'?: (db: Db, request: never) => Promise<unknown>;
  'community.settle'?: (db: Db, request: never) => Promise<unknown>;
  'charging.size'?: (db: Db, request: never) => Promise<unknown>;
}
export type ComputationName = keyof Computations;
export const COMPUTATIONS: ComputationName[] = ['solar.size', 'battery.size', 'solar.yield', 'community.settle', 'charging.size'];

/** Runs a module's computation with the request it takes, after checking the module is installed. */
export async function compute(db: Db, computations: Computations, name: ComputationName, request: Record<string, unknown>): Promise<unknown> {
  await requireModule(db, name.split('.')[0]!);
  const fn = computations[name];
  if (fn === undefined) throw new GestureError(`computation_not_loaded: ${name} is the code of its module, and this surface was started without it`);
  return fn(db, request as never);
}

export interface PvYieldAtInput {
  project_id: string;
  /** The participant's name: the place, the roof, the client. */
  name: string;
  /** ISO 3166-1 alpha-2: the country is data of the place, never assumed. */
  country: string;
  lon: number;
  lat: number;
  time_zone?: string;
  kwp: number;
  /** Degrees clockwise from true north: 180 faces south. */
  azimuth_deg: number;
  tilt_deg: number;
  /** A whole calendar year PVGIS covers; without it, the mean of every year it covers. */
  year?: number;
  /**
   * The system loss the person says for this place, a fraction (0.025 for
   * 2.5 %): set on the participant as `system_loss`, where any other
   * surface reads it too; without it, the cascade answers (decision 0055).
   */
  system_loss?: number;
  profileCode?: string;
}

/**
 * The yield of a PV system at a point, in one gesture: the participant
 * joins the project at that point, its PV system is described with one
 * array (`describePvSystem()`), the `solar` module estimates its yield for
 * the year asked, or as the mean of every year PVGIS covers (`solar.yield`),
 * and it is read back by calendar month through `resample()`, in UTC, the
 * mean of the years. The system loss is the place's: the one given is set
 * on the participant, and the estimate says the level it was read at.
 */
export async function estimatePvYieldAt(db: Db, computations: Computations, p: PvYieldAtInput) {
  const place = { country: p.country, geometry: { type: 'Point', coordinates: [p.lon, p.lat, 0] }, location_precision: 'rooftop' };
  const participant = await addParticipant(db, { project_id: p.project_id, name: p.name, place, role: 'prosumer', ...(p.time_zone ? { time_zone: p.time_zone } : {}) });
  if (p.system_loss !== undefined) {
    await db.query(`select set_attribute('participant', $1, 'system_loss', $2::jsonb, null, null, 'said by the person', 'estimated')`, [participant.id, JSON.stringify(p.system_loss)]);
  }
  const system = await describePvSystem(db, {
    participant_id: participant.id, name: 'PV system', kwp: p.kwp,
    arrays: [{ name: 'Array 1', azimuth_deg: p.azimuth_deg, tilt_deg: p.tilt_deg }],
  });
  const estimate = await compute(db, computations, 'solar.yield', {
    deviceId: system.device_id, ...(p.year !== undefined ? { years: { from: p.year, to: p.year } } : {}), ...(p.profileCode ? { profileCode: p.profileCode } : {}),
  }) as { estimateId: string; seriesId: string; annualKwh: number; kwhPerKwp: number; kwp: number };
  const { provenance, years, system_loss } = await first<{ provenance: string; years: { from: number; to: number }; system_loss: Record<string, unknown> | null }>(db,
    `select provenance, inputs -> 'weather' -> 'years' years, inputs -> 'system_loss' system_loss from solar.estimates where id = $1`, [estimate.estimateId]);
  const n = years.to - years.from + 1;
  const byMonth = new Map<number, number>();
  for (const b of await resample(db, estimate.seriesId, `${years.from}-01-01T00:00:00Z`, `${years.to + 1}-01-01T00:00:00Z`, '1 month', { timeZone: 'UTC' })) {
    if (b.value === null) continue;
    const month = Number(b.bucket.slice(5, 7));
    byMonth.set(month, (byMonth.get(month) ?? 0) + Number(b.value));
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a - b).map(([month, kwh]) => ({ month, kwh: Math.round((kwh / n) * 10) / 10 }));
  return {
    participant_id: participant.id, device_id: system.device_id, estimate_id: estimate.estimateId,
    annual_kwh: estimate.annualKwh, kwh_per_kwp: estimate.kwhPerKwp, years, system_loss, provenance, months,
  };
}

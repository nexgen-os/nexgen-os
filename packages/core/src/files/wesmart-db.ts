/**
 * The history of a WeSmart Database, imported table to table into the core.
 *
 * The WeSmart Database keeps, for each project, the participants with the
 * meter they carry in a column (`participants.smart_meter_id`) and their
 * address beside it (`participants.address`, `latitude`, `longitude`), and
 * the devices behind each participant (`devices.participant_id`). The core
 * has the same hierarchy with the meter as an object of its own
 * (decision 0043):
 *
 * | WeSmart Database | Core |
 * |---|---|
 * | `organisations` | `organisations` (`create_organisation()`) |
 * | `projects` | `projects` (`create_project()`), its country and status |
 * | `participants` | `participants` (`join_project()`), with its place |
 * | `participants.address`, `postal_code`, `city`, `latitude`, `longitude`, `country` | the participant's place, in the one standard shape |
 * | `participants.smart_meter_id` | `meters` (`declare_meter()`), carried by the participant |
 * | `devices.participant_id` | `devices.participant_id` (`install_device()`), unchanged |
 *
 * Two steps. `planWesmartImport()` is pure: it reads the rows and names, for
 * each, the gesture that writes it, or why it cannot be written (a refusal
 * by name, with its table and its id); a value it does not carry is counted
 * by its column, never dropped without a word. `importWesmartHistory()`
 * writes a plan through the schema's own gestures, acting as the person, and
 * records on every object the row it came from (`identifiers`, scheme
 * `imported_row`, `wesmart_db:<table>:<id>`): a second import finds the
 * object and writes nothing again.
 *
 * Nothing is guessed. A meter's scheme is the one the grid operators of the
 * participant's country issue and whose pattern its number matches
 * (`meterSchemesOf()`); a placeholder number (`VIRTUAL-…`) names no
 * connection point and declares no meter. The series of the WeSmart Database
 * (its `flows`, profiles and imported readings) are the next step, not this
 * one: they are counted as not carried.
 */
import type { Db } from '../db.js';
import { GestureError } from '../refusal.js';

/** The database the rows come from, as the prefix of the identifier of every object imported. */
export const WESMART_DB = 'wesmart_db';

/** The identifier scheme that records the row an object was imported from. */
export const IMPORTED_ROW_SCHEME = 'imported_row';

// ---------------------------------------------------------------------------
// The rows, as the WeSmart Database keeps them
// ---------------------------------------------------------------------------

/** A row as read from the database: its columns, any of them null. Numbers may come as text (`numeric`). */
type Row = Record<string, unknown> & { id: string };

export interface WesmartOrganisation extends Row {
  name?: string | null;
}

export interface WesmartProject extends Row {
  name?: string | null;
  organisation_id?: string | null;
  owner_id?: string | null;
  country?: string | null;
  status?: string | null;
  start_date?: string | null;
  created_at?: string | null;
}

export interface WesmartParticipant extends Row {
  project_id?: string | null;
  name?: string | null;
  status?: string | null;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  smart_meter_id?: string | null;
  power?: number | string | null;
  consumption?: number | string | null;
  join_date?: string | null;
  leave_date?: string | null;
  archived_at?: string | null;
  created_at?: string | null;
}

export interface WesmartDevice extends Row {
  participant_id?: string | null;
  name?: string | null;
  device_type?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  power?: number | string | null;
  installation_date?: string | null;
  status?: string | null;
  created_at?: string | null;
}

/** The tables read, as rows (`select * from <table>`). */
export interface WesmartSnapshot {
  organisations?: WesmartOrganisation[];
  projects: WesmartProject[];
  participants: WesmartParticipant[];
  devices?: WesmartDevice[];
}

// ---------------------------------------------------------------------------
// The plan: what each row becomes, or why it does not
// ---------------------------------------------------------------------------

export type WesmartTable = 'organisations' | 'projects' | 'participants' | 'devices';

/** A row that is not written, by the name of the reason. */
export interface ImportRefusal {
  code: string;
  table: WesmartTable;
  id: string;
  detail: string;
}

/** A column of a table whose values this import does not carry, with the rows that hold one. */
export interface NotCarried {
  table: WesmartTable;
  column: string;
  rows: number;
}

export interface PlannedOrganisation { key: string; name: string }

export interface PlannedProject {
  key: string;
  /** The planned organisation it is in, or the id of an organisation of the core. */
  organisation: { key: string } | { id: string };
  name: string;
  country: string;
  status: string | null;
  start_date: string | null;
}

export interface PlannedPlace {
  country: string;
  address_line1?: string;
  postal_code?: string;
  city?: string;
  geometry?: { type: 'Point'; coordinates: [number, number, number] };
}

export interface PlannedParticipant {
  key: string;
  project_key: string;
  name: string;
  category: 'consumer' | 'producer' | 'prosumer';
  status: string;
  join_date: string | null;
  leave_date: string | null;
  place: PlannedPlace;
}

export interface PlannedMeter {
  key: string;
  participant_key: string;
  identifier: string;
  scheme: string;
}

export interface PlannedDevice {
  key: string;
  participant_key: string;
  device_type: string;
  name: string;
  rated_power_kw: number | null;
  installed_on: string | null;
  status: string | null;
  nameplate: { manufacturer?: string; model?: string };
}

export interface WesmartImportPlan {
  organisations: PlannedOrganisation[];
  projects: PlannedProject[];
  participants: PlannedParticipant[];
  meters: PlannedMeter[];
  devices: PlannedDevice[];
  refusals: ImportRefusal[];
  notCarried: NotCarried[];
}

/** A scheme a meter number may be in: the grid operators of a country issue it, its pattern says which numbers. */
export interface MeterScheme {
  country: string;
  scheme: string;
  pattern: string | null;
}

export interface WesmartPlanOptions {
  /** The schemes of the connection points, by country (`meterSchemesOf()`). */
  meterSchemes: MeterScheme[];
  /**
   * The organisation of the core a project without an organisation goes
   * into (a project its owner kept alone). Without it such a project is
   * refused, `project_organisation_required`.
   */
  organisationForOwnProjects?: string;
}

/**
 * The device types of the WeSmart Database, by the core's `device_types`
 * code. A type absent here is refused, `device_type_unmapped`.
 */
export const WESMART_DEVICE_TYPES: Readonly<Record<string, string>> = {
  solar: 'solar',
  parking_canopy: 'parking_canopy',
  wind: 'wind',
  hydro: 'hydro',
  chp: 'cogeneration',
  biomass: 'biomass',
  geothermal: 'geothermal',
  hydrogen: 'hydrogen',
  battery: 'battery',
  inverter: 'inverter',
  heatpump: 'heat_pump',
  heat_pump: 'heat_pump',
  ev: 'charger',
  ev_charger: 'charger',
};

/** The device types that produce, as the WeSmart Database lists them (`PRODUCTION_DEVICE_TYPES`). */
const PRODUCING = new Set(['solar', 'parking_canopy', 'wind', 'chp', 'hydro', 'geothermal', 'biomass']);

/** A device's status, by the core's (`devices_status`). Null keeps the core's rule: planned until installed. */
const DEVICE_STATUSES: Readonly<Record<string, string>> = {
  active: 'in_service',
  inactive: 'out_of_service',
  planned: 'planned',
};

/** The statuses both databases share, word for word. */
const PROJECT_STATUSES = new Set(['simulation', 'creation', 'active', 'inactive', 'archived']);
const PARTICIPANT_STATUSES = new Set(['simulation', 'creation', 'active', 'inactive']);

/** The columns each table's mapping reads; any other column holding a value is counted as not carried. */
const CARRIED: Record<WesmartTable, Set<string>> = {
  organisations: new Set(['id', 'name']),
  projects: new Set(['id', 'name', 'organisation_id', 'owner_id', 'country', 'status', 'start_date']),
  participants: new Set(['id', 'project_id', 'name', 'status', 'address', 'postal_code', 'city', 'country', 'latitude',
    'longitude', 'smart_meter_id', 'power', 'consumption', 'join_date', 'leave_date', 'archived_at']),
  devices: new Set(['id', 'participant_id', 'name', 'device_type', 'manufacturer', 'model', 'power', 'installation_date', 'status']),
};

/** Bookkeeping columns: the database's, not a description. */
const BOOKKEEPING = new Set(['created_at', 'updated_at']);

/** The identifier an object imported from a row is recorded under. */
export function importedRowKey(table: WesmartTable, id: string): string {
  return `${WESMART_DB}:${table}:${id}`;
}

/** The key of the meter a participant's `smart_meter_id` becomes. */
function meterKey(participantId: string): string {
  return `${importedRowKey('participants', participantId)}:smart_meter_id`;
}

/** The meter number as the WeSmart Database compares it: spaces removed (`normalizeMeterId`). */
export function normaliseMeterNumber(value: string): string {
  return value.replace(/\s/g, '');
}

/** A placeholder for a number not known yet: `VIRTUAL-` and letters, digits, dashes. */
const VIRTUAL_METER = /^VIRTUAL-[A-Z0-9][A-Z0-9-]*$/i;

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** A number as `numeric` comes: a number or its text. Null when neither. */
function number(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** A date as `YYYY-MM-DD`, from a date or the date part of a timestamp. */
function day(v: unknown): string | null {
  const t = text(v);
  const m = t === null ? null : /^(\d{4}-\d{2}-\d{2})/.exec(t);
  return m ? m[1] : null;
}

function byCreation<T extends Row>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id));
}

function held(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/**
 * What every row of a WeSmart Database becomes in the core, or why it does
 * not. Pure: reads the rows and the options, touches nothing.
 *
 * A refused row refuses what hangs from it (`parent_refused`): the
 * participants of a refused project, the meter and the devices of a refused
 * participant. Two participants of one project carrying one meter
 * number are one connection point: the first entered carries the meter, the
 * others are refused theirs (`meter_shared`) and keep their own row.
 */
export function planWesmartImport(snapshot: WesmartSnapshot, options: WesmartPlanOptions): WesmartImportPlan {
  const plan: WesmartImportPlan = { organisations: [], projects: [], participants: [], meters: [], devices: [], refusals: [], notCarried: [] };
  const refuse = (code: string, table: WesmartTable, id: string, detail: string) => plan.refusals.push({ code, table, id, detail });
  const notCarried = new Map<string, NotCarried>();
  const count = (table: WesmartTable, column: string) => {
    const k = `${table}.${column}`;
    const entry = notCarried.get(k) ?? { table, column, rows: 0 };
    entry.rows += 1;
    notCarried.set(k, entry);
  };
  const audit = (table: WesmartTable, row: Row) => {
    for (const [column, value] of Object.entries(row)) {
      if (!CARRIED[table].has(column) && !BOOKKEEPING.has(column) && held(value)) count(table, column);
    }
  };
  const seen = new Map<WesmartTable, Set<string>>();
  const firstTime = (table: WesmartTable, row: Row): boolean => {
    const ids = seen.get(table) ?? new Set<string>();
    seen.set(table, ids);
    if (typeof row.id !== 'string' || row.id === '') {
      refuse('row_id_required', table, String(row.id ?? ''), 'a row without its id cannot be found again');
      return false;
    }
    if (ids.has(row.id)) {
      refuse('row_duplicated', table, row.id, 'the snapshot holds this row twice');
      return false;
    }
    ids.add(row.id);
    return true;
  };

  // Organisations.
  const organisations = new Set<string>();
  for (const o of byCreation(snapshot.organisations ?? [])) {
    if (!firstTime('organisations', o)) continue;
    audit('organisations', o);
    const name = text(o.name);
    if (name === null) { refuse('organisation_name_required', 'organisations', o.id, 'an organisation has a name'); continue; }
    plan.organisations.push({ key: importedRowKey('organisations', o.id), name });
    organisations.add(o.id);
  }

  // Projects.
  const projects = new Map<string, PlannedProject>();
  for (const p of byCreation(snapshot.projects)) {
    if (!firstTime('projects', p)) continue;
    audit('projects', p);
    const name = text(p.name);
    const country = text(p.country)?.toUpperCase() ?? null;
    const status = text(p.status);
    const organisationId = text(p.organisation_id);
    let organisation: PlannedProject['organisation'];
    if (organisationId !== null) {
      if (!organisations.has(organisationId)) {
        const known = (snapshot.organisations ?? []).some((o) => o.id === organisationId);
        refuse(known ? 'parent_refused' : 'organisation_not_found', 'projects', p.id,
          `its organisation ${organisationId} is ${known ? 'refused' : 'not in the snapshot'}`);
        continue;
      }
      organisation = { key: importedRowKey('organisations', organisationId) };
    } else if (options.organisationForOwnProjects !== undefined) {
      organisation = { id: options.organisationForOwnProjects };
    } else {
      refuse('project_organisation_required', 'projects', p.id, 'the project is in no organisation, and none was given for such projects');
      continue;
    }
    if (name === null) { refuse('project_name_required', 'projects', p.id, 'a project has a name'); continue; }
    if (country === null || !/^[A-Z]{2}$/.test(country)) {
      refuse('country_required', 'projects', p.id, `a project names the ISO 3166-1 alpha-2 country whose rules apply; it has ${JSON.stringify(p.country ?? null)}`);
      continue;
    }
    if (status !== null && !PROJECT_STATUSES.has(status)) {
      refuse('project_status_unknown', 'projects', p.id, `${status} is not a status of a project`);
      continue;
    }
    const planned: PlannedProject = { key: importedRowKey('projects', p.id), organisation, name, country, status, start_date: day(p.start_date) };
    plan.projects.push(planned);
    projects.set(p.id, planned);
  }

  // Devices, by participant, so that a participant knows whether it produces.
  const devicesOf = new Map<string, WesmartDevice[]>();
  for (const d of snapshot.devices ?? []) {
    const pid = text(d.participant_id);
    if (pid === null) continue;
    devicesOf.set(pid, [...(devicesOf.get(pid) ?? []), d]);
  }

  // Participants, their place and their meter.
  const participants = new Map<string, PlannedParticipant>();
  const meterCarriers = new Map<string, string>();
  for (const p of byCreation(snapshot.participants)) {
    if (!firstTime('participants', p)) continue;
    audit('participants', p);
    const projectId = text(p.project_id);
    const project = projectId === null ? undefined : projects.get(projectId);
    if (project === undefined) {
      const known = snapshot.projects.some((r) => r.id === projectId);
      refuse(known ? 'parent_refused' : 'project_not_found', 'participants', p.id,
        `its project ${projectId ?? 'is not given'}${projectId === null ? '' : known ? ' is refused' : ' is not in the snapshot'}`);
      continue;
    }
    const name = text(p.name);
    if (name === null) { refuse('participant_name_required', 'participants', p.id, 'a participant has a name'); continue; }
    const status = p.archived_at ? 'inactive' : (text(p.status) ?? 'simulation');
    if (!PARTICIPANT_STATUSES.has(status)) {
      refuse('participant_status_unknown', 'participants', p.id, `${status} is not a status of a participant`);
      continue;
    }

    // The place: what the row says, in the country of the participant, or
    // of its project when the row names none.
    const country = text(p.country)?.toUpperCase() ?? project.country;
    if (!/^[A-Z]{2}$/.test(country)) {
      refuse('country_invalid', 'participants', p.id, `${JSON.stringify(p.country)} is not an ISO 3166-1 alpha-2 code`);
      continue;
    }
    const place: PlannedPlace = { country };
    const line = text(p.address);
    const postal = text(p.postal_code);
    const city = text(p.city);
    if (line !== null) place.address_line1 = line;
    if (postal !== null) place.postal_code = postal;
    if (city !== null) place.city = city;
    const lat = number(p.latitude);
    const lon = number(p.longitude);
    if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      place.geometry = { type: 'Point', coordinates: [lon, lat, 0] };
    } else if (held(p.latitude) || held(p.longitude)) {
      count('participants', 'latitude, longitude (not a point)');
    }

    // What it does: it produces when it carries a power or a producing
    // device, it consumes when it carries a consumption.
    const devices = devicesOf.get(p.id) ?? [];
    const produces = (number(p.power) ?? 0) > 0 || devices.some((d) => PRODUCING.has(text(d.device_type) ?? ''));
    const consumes = (number(p.consumption) ?? 0) > 0;
    const category = produces ? (consumes ? 'prosumer' : 'producer') : 'consumer';

    const planned: PlannedParticipant = {
      key: importedRowKey('participants', p.id), project_key: project.key, name, category, status,
      join_date: day(p.join_date), leave_date: day(p.leave_date), place,
    };
    plan.participants.push(planned);
    participants.set(p.id, planned);

    // Its meter.
    const raw = text(p.smart_meter_id);
    if (raw === null) continue;
    const number_ = normaliseMeterNumber(raw);
    if (VIRTUAL_METER.test(number_)) {
      refuse('meter_virtual', 'participants', p.id, `${number_} is a placeholder, not a connection point an operator knows`);
      continue;
    }
    const schemes = options.meterSchemes.filter((s) => s.country.toUpperCase() === country && (s.pattern === null || new RegExp(s.pattern).test(number_)));
    const distinct = [...new Set(schemes.map((s) => s.scheme))];
    if (distinct.length !== 1) {
      refuse(distinct.length === 0 ? 'meter_scheme_unknown' : 'meter_scheme_ambiguous', 'participants', p.id,
        distinct.length === 0
          ? `${number_} matches no scheme of the connection points of ${country}`
          : `${number_} matches ${distinct.join(', ')} in ${country}`);
      continue;
    }
    // One open participant per connection point within a project.
    const point = `${project.key}|${distinct[0]}|${number_}`;
    const carrier = meterCarriers.get(point);
    if (carrier !== undefined) {
      refuse('meter_shared', 'participants', p.id, `${number_} is carried by ${carrier} in the same project; one connection point is one meter`);
      continue;
    }
    meterCarriers.set(point, planned.key);
    plan.meters.push({ key: meterKey(p.id), participant_key: planned.key, identifier: number_, scheme: distinct[0] });
  }

  // Devices: each stays with its participant.
  for (const d of byCreation(snapshot.devices ?? [])) {
    if (!firstTime('devices', d)) continue;
    audit('devices', d);
    const pid = text(d.participant_id);
    const participant = pid === null ? undefined : participants.get(pid);
    if (participant === undefined) {
      const known = snapshot.participants.some((r) => r.id === pid);
      refuse(known ? 'parent_refused' : 'participant_not_found', 'devices', d.id,
        `its participant ${pid ?? 'is not given'}${pid === null ? '' : known ? ' is refused' : ' is not in the snapshot'}`);
      continue;
    }
    const source = text(d.device_type);
    const type = source === null ? undefined : WESMART_DEVICE_TYPES[source];
    if (type === undefined) {
      refuse('device_type_unmapped', 'devices', d.id, `${JSON.stringify(source)} has no device type of the core`);
      continue;
    }
    const manufacturer = text(d.manufacturer);
    const model = text(d.model);
    const name = text(d.name) ?? ([manufacturer, model].filter(Boolean).join(' ') || null);
    if (name === null) { refuse('device_name_required', 'devices', d.id, 'a device has a name, or a manufacturer and a model'); continue; }
    const status = text(d.status);
    if (status !== null && DEVICE_STATUSES[status] === undefined) {
      refuse('device_status_unknown', 'devices', d.id, `${status} is not a status of a device`);
      continue;
    }
    const power = number(d.power);
    if (power !== null && power < 0) { refuse('device_power_negative', 'devices', d.id, `${power} kW`); continue; }
    plan.devices.push({
      key: importedRowKey('devices', d.id), participant_key: participant.key, device_type: type, name,
      rated_power_kw: power, installed_on: day(d.installation_date), status: status === null ? null : DEVICE_STATUSES[status],
      nameplate: { ...(manufacturer ? { manufacturer } : {}), ...(model ? { model } : {}) },
    });
  }

  plan.notCarried = [...notCarried.values()].sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
  return plan;
}

// ---------------------------------------------------------------------------
// Writing a plan, through the gestures of the schema
// ---------------------------------------------------------------------------

export interface WesmartImportResult {
  /** The id in the core of every object of the plan, by its key. */
  ids: Record<string, string>;
  /** What was written now, and what a previous import had written already, by kind. */
  created: Record<'organisations' | 'projects' | 'participants' | 'meters' | 'devices', number>;
  alreadyImported: Record<'organisations' | 'projects' | 'participants' | 'meters' | 'devices', number>;
}

/**
 * The schemes of the connection points by country: those the grid operators
 * of the `grid` module issue, with their pattern. Refuses
 * `module_not_installed` when the module is not.
 */
export async function meterSchemesOf(db: Db): Promise<MeterScheme[]> {
  const { rows: [installed] } = await db.query<{ ok: boolean }>(`select to_regclass('grid.operators') is not null ok`);
  if (!installed?.ok) throw new GestureError('module_not_installed: grid — the schemes of the connection points are those its operators issue');
  const { rows } = await db.query<MeterScheme>(
    `select distinct o.country, o.identifier_scheme scheme, s.pattern
       from grid.operators o join identifier_schemes s on s.code = o.identifier_scheme
      order by 1, 2`);
  return rows;
}

/**
 * Writes a plan, as the person the connection acts as, each object through
 * the gesture of its kind; finds first, by the row it came from, what a
 * previous import wrote, and writes it no second time. Run it in one
 * transaction (`Session.run()`): a refusal of the database stops it whole,
 * with the name of the refusal and the row it was writing.
 */
export async function importWesmartHistory(db: Db, plan: WesmartImportPlan): Promise<WesmartImportResult> {
  const ids: Record<string, string> = {};
  const zero = () => ({ organisations: 0, projects: 0, participants: 0, meters: 0, devices: 0 });
  const result: WesmartImportResult = { ids, created: zero(), alreadyImported: zero() };

  const found = async (key: string): Promise<string | undefined> => {
    const { rows } = await db.query<{ object_id: string }>(
      'select object_id from identifiers where scheme = $1 and value = $2', [IMPORTED_ROW_SCHEME, key]);
    return rows[0]?.object_id;
  };
  const idOf = (key: string): string => {
    const id = ids[key];
    if (id === undefined) throw new GestureError(`parent_not_imported: ${key} is not in the plan`);
    return id;
  };
  const write = async (kind: keyof WesmartImportResult['created'], key: string, sql: string, params: unknown[], after?: (id: string) => Promise<void>) => {
    const existing = await found(key);
    if (existing !== undefined) {
      ids[key] = existing;
      result.alreadyImported[kind] += 1;
      return;
    }
    try {
      const { rows: [row] } = await db.query<{ id: string }>(sql, params);
      ids[key] = row!.id;
      if (after) await after(row!.id);
    } catch (error) {
      throw new GestureError(`${String((error as { message?: string })?.message ?? error)} (while importing ${key})`);
    }
    result.created[kind] += 1;
  };

  // `add_identifier()` records the row in the statement that creates the
  // object, so that an object is never written without it.
  for (const o of plan.organisations) {
    await write('organisations', o.key,
      `with c as (select create_organisation($1) id) select c.id, add_identifier('organisation', c.id, $2, $3) from c`,
      [o.name, IMPORTED_ROW_SCHEME, o.key]);
  }
  for (const p of plan.projects) {
    const organisation = 'id' in p.organisation ? p.organisation.id : idOf(p.organisation.key);
    await write('projects', p.key,
      `with c as (select create_project($1, $2, $3, null, $4) id) select c.id, add_identifier('project', c.id, $5, $6) from c`,
      [organisation, p.name, p.country, p.start_date, IMPORTED_ROW_SCHEME, p.key],
      async (id) => {
        if (p.status !== null) await db.query('update projects set status = $2 where id = $1', [id, p.status]);
      });
  }
  for (const p of plan.participants) {
    const place = { ...p.place, identifiers: [{ scheme: IMPORTED_ROW_SCHEME, value: p.key }] };
    await write('participants', p.key,
      `select join_project($1, $2, $3::jsonb, $4, null, $5, $6) id`,
      [idOf(p.project_key), p.name, JSON.stringify(place), p.category, p.join_date, p.status],
      async (id) => {
        if (p.leave_date !== null) await db.query('select leave_project($1, $2)', [id, p.leave_date]);
      });
  }
  for (const m of plan.meters) {
    await write('meters', m.key,
      `with c as (select declare_meter($1, $2, $3, 'electricity', 'both', null, null) id) select c.id, add_identifier('meter', c.id, $4, $5) from c`,
      [idOf(m.participant_key), m.identifier, m.scheme, IMPORTED_ROW_SCHEME, m.key]);
  }
  for (const d of plan.devices) {
    await write('devices', d.key,
      `with c as (select install_device($1, $2, $3, null, $4, $5, null, 1, $6::jsonb, $7) id) select c.id, add_identifier('device', c.id, $8, $9) from c`,
      [idOf(d.participant_key), d.device_type, d.name, d.rated_power_kw, d.installed_on, JSON.stringify(d.nameplate), d.status,
       IMPORTED_ROW_SCHEME, d.key]);
  }
  return result;
}

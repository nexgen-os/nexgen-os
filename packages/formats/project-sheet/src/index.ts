// A project sheet: a project, its participants, the meters they carry and the
// devices behind them, as one table a spreadsheet saves as CSV.
//
// One row names a project and, when it has one, a participant; the row may
// carry one meter of that participant, one device, both or neither. Rows of
// the same project are one project, rows of the same participant in it one
// participant: what a later row says of an object an earlier row described
// fills what was empty and, when it says something else, is reported as
// `values_disagree`. The columns are named in the first row, in any order; a
// column the sheet does not know is reported and left aside.
//
// The separator is the one the header uses — a comma, a semicolon or a tab —
// so that a sheet saved by a spreadsheet in any language reads the same. A
// number may carry a decimal comma when the separator is not a comma. Dates
// are ISO 8601 days (YYYY-MM-DD). Identifiers an object is known by elsewhere
// are `scheme=value`, several separated by `|`.
//
// The reader carries what the sheet says and reports by name, with its line,
// what it cannot read; it never corrects it. Codes (a country, a category, a
// device type, an identifier scheme) are passed on as written: the model
// that receives them knows its vocabulary.

/** The columns of a project sheet, in the order the writer gives them. */
export const PROJECT_SHEET_COLUMNS = [
  'project',
  'country',
  'project_kind',
  'project_start_date',
  'project_identifiers',
  'participant',
  'category',
  'time_zone',
  'participant_identifiers',
  'address_line1',
  'address_line2',
  'postal_code',
  'city',
  'region',
  'participant_country',
  'latitude',
  'longitude',
  'location_precision',
  'meter_scheme',
  'meter_identifier',
  'meter_name',
  'meter_resource',
  'meter_direction',
  'meter_valid_from',
  'device_type',
  'device_name',
  'device_rated_power_kw',
  'device_unit_count',
  'device_installed_on',
  'device_identifiers',
] as const;

export type ProjectSheetColumn = (typeof PROJECT_SHEET_COLUMNS)[number];

/** An identifier an object is known by elsewhere, in a scheme. */
export interface SheetIdentifier {
  scheme: string;
  value: string;
}

/** Where a participant is: its address, and its point when the sheet gives one (WGS 84 degrees). */
export interface SheetPlace {
  country?: string;
  address_line1?: string;
  address_line2?: string;
  postal_code?: string;
  city?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  location_precision?: string;
}

export interface SheetMeter {
  scheme: string;
  identifier: string;
  name?: string;
  resource?: string;
  direction?: string;
  valid_from?: string;
}

export interface SheetDevice {
  device_type: string;
  name: string;
  rated_power_kw?: number;
  unit_count?: number;
  installed_on?: string;
  identifiers: SheetIdentifier[];
}

export interface SheetParticipant {
  name: string;
  category?: string;
  time_zone?: string;
  place?: SheetPlace;
  identifiers: SheetIdentifier[];
  meters: SheetMeter[];
  devices: SheetDevice[];
}

export interface SheetProject {
  name: string;
  country?: string;
  kind?: string;
  start_date?: string;
  identifiers: SheetIdentifier[];
  participants: SheetParticipant[];
}

export type SheetProblemCode =
  | 'column_missing'
  | 'column_unknown'
  | 'column_repeated'
  | 'quote_unterminated'
  | 'row_too_long'
  | 'project_required'
  | 'participant_required'
  | 'invalid_number'
  | 'invalid_date'
  | 'invalid_identifier'
  | 'coordinates_incomplete'
  | 'meter_incomplete'
  | 'device_incomplete'
  | 'values_disagree';

/**
 * What the reader could not read, by name, at its line (1 is the header).
 * A warning leaves something aside and reads the rest whole; an error means
 * the sheet does not say what its author meant, and an importer refuses it.
 */
export interface SheetProblem {
  code: SheetProblemCode;
  level: 'error' | 'warning';
  line: number;
  column?: string;
  value?: string;
}

export interface ProjectSheet {
  /** The separator the header uses. */
  delimiter: ',' | ';' | '\t';
  projects: SheetProject[];
  problems: SheetProblem[];
}

const WARNINGS: ReadonlySet<SheetProblemCode> = new Set(['column_unknown']);

/** Splits a sheet into rows of cells (RFC 4180: quotes doubled, separators and line breaks inside quotes). */
function cells(text: string, delimiter: string): { rows: { line: number; cells: string[] }[]; unterminated: number | null } {
  const rows: { line: number; cells: string[] }[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === '\n') line++; cell += c; }
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push({ line: rowLine, cells: row });
      row = []; cell = '';
      line++; rowLine = line;
    } else cell += c;
  }
  if (quoted) return { rows, unterminated: rowLine };
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push({ line: rowLine, cells: row }); }
  return { rows, unterminated: null };
}

/** The separator of the header: the one of comma, semicolon and tab it holds most of, outside quotes. */
function delimiterOf(header: string): ProjectSheet['delimiter'] {
  const outside = header.replace(/"[^"]*"/g, '');
  const counts = ([',', ';', '\t'] as const).map((d) => [d, outside.split(d).length - 1] as const);
  return counts.reduce((best, c) => (c[1] > best[1] ? c : best))[0];
}

/**
 * Reads a project sheet: see the head of this file. A sheet without the
 * columns `project` and `participant` gives no project and says
 * `column_missing`.
 */
export function readProjectSheet(text: string): ProjectSheet {
  const body = text.replace(/^﻿/, '');
  const delimiter = delimiterOf(body.split(/\r?\n/, 1)[0] ?? '');
  const problems: SheetProblem[] = [];
  const report = (code: SheetProblemCode, line: number, column?: string, value?: string) =>
    problems.push({ code, level: WARNINGS.has(code) ? 'warning' : 'error', line,
      ...(column === undefined ? {} : { column }), ...(value === undefined ? {} : { value }) });

  const { rows, unterminated } = cells(body, delimiter);
  if (unterminated !== null) report('quote_unterminated', unterminated);
  const [head, ...data] = rows;
  const columns = (head?.cells ?? []).map((c) => c.trim().toLowerCase());
  const known = new Set<string>(PROJECT_SHEET_COLUMNS);
  const index = new Map<string, number>();
  columns.forEach((c, i) => {
    if (c === '') return;
    if (!known.has(c)) report('column_unknown', 1, c);
    else if (index.has(c)) report('column_repeated', 1, c);
    else index.set(c, i);
  });
  for (const required of ['project', 'participant'] as const) {
    if (!index.has(required)) report('column_missing', 1, required);
  }
  if (!index.has('project') || !index.has('participant')) return { delimiter, projects: [], problems };

  const projects: SheetProject[] = [];
  for (const { line, cells: row } of data) {
    if (row.every((c) => c.trim() === '')) continue;
    if (row.length > columns.length && row.slice(columns.length).some((c) => c.trim() !== '')) report('row_too_long', line);
    const get = (c: ProjectSheetColumn): string | undefined => {
      const i = index.get(c);
      const v = i === undefined ? undefined : row[i]?.trim();
      return v === undefined || v === '' ? undefined : v;
    };
    const number = (c: ProjectSheetColumn, integer = false): number | undefined => {
      const raw = get(c);
      if (raw === undefined) return undefined;
      const written = delimiter === ',' ? raw : raw.replace(',', '.');
      const n = /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(written) ? Number(written) : NaN;
      if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) { report('invalid_number', line, c, raw); return undefined; }
      return n;
    };
    const date = (c: ProjectSheetColumn): string | undefined => {
      const raw = get(c);
      if (raw === undefined) return undefined;
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(raw) && new Date(`${raw}T00:00:00Z`).toISOString().startsWith(raw);
      if (!valid) { report('invalid_date', line, c, raw); return undefined; }
      return raw;
    };
    const identifiers = (c: ProjectSheetColumn): SheetIdentifier[] => {
      const raw = get(c);
      if (raw === undefined) return [];
      const out: SheetIdentifier[] = [];
      for (const item of raw.split('|').map((s) => s.trim()).filter((s) => s !== '')) {
        const at = item.indexOf('=');
        const scheme = at < 0 ? '' : item.slice(0, at).trim();
        const value = at < 0 ? '' : item.slice(at + 1).trim();
        if (scheme === '' || value === '') report('invalid_identifier', line, c, item);
        else out.push({ scheme, value });
      }
      return out;
    };
    /** Sets what is empty; reports what is said otherwise. */
    const settle = <T extends object>(target: T, values: Partial<T>, columnOf: Partial<Record<keyof T, ProjectSheetColumn>>) => {
      for (const [k, v] of Object.entries(values) as [keyof T, T[keyof T] | undefined][]) {
        if (v === undefined) continue;
        if (target[k] === undefined) target[k] = v;
        else if (target[k] !== v) report('values_disagree', line, columnOf[k], String(v));
      }
    };
    const addIdentifiers = (target: SheetIdentifier[], more: SheetIdentifier[]) => {
      for (const i of more) if (!target.some((t) => t.scheme === i.scheme && t.value === i.value)) target.push(i);
    };

    const projectName = get('project');
    if (projectName === undefined) { report('project_required', line, 'project'); continue; }
    let project = projects.find((p) => p.name === projectName);
    if (project === undefined) { project = { name: projectName, identifiers: [], participants: [] }; projects.push(project); }
    settle(project, { country: get('country'), kind: get('project_kind'), start_date: date('project_start_date') },
      { country: 'country', kind: 'project_kind', start_date: 'project_start_date' });
    addIdentifiers(project.identifiers, identifiers('project_identifiers'));

    const participantName = get('participant');
    if (participantName === undefined) {
      for (const c of PROJECT_SHEET_COLUMNS.slice(PROJECT_SHEET_COLUMNS.indexOf('category'))) {
        if (get(c) !== undefined) { report('participant_required', line, c, get(c)); break; }
      }
      continue;
    }
    let participant = project.participants.find((p) => p.name === participantName);
    if (participant === undefined) {
      participant = { name: participantName, identifiers: [], meters: [], devices: [] };
      project.participants.push(participant);
    }
    settle(participant, { category: get('category'), time_zone: get('time_zone') }, { category: 'category', time_zone: 'time_zone' });
    addIdentifiers(participant.identifiers, identifiers('participant_identifiers'));

    const latitude = number('latitude');
    const longitude = number('longitude');
    if ((latitude === undefined) !== (longitude === undefined)) report('coordinates_incomplete', line, latitude === undefined ? 'latitude' : 'longitude');
    const place: SheetPlace = {
      country: get('participant_country'), address_line1: get('address_line1'), address_line2: get('address_line2'),
      postal_code: get('postal_code'), city: get('city'), region: get('region'),
      ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
      location_precision: get('location_precision'),
    };
    if (Object.values(place).some((v) => v !== undefined)) {
      participant.place ??= {};
      settle(participant.place, place, {
        country: 'participant_country', address_line1: 'address_line1', address_line2: 'address_line2', postal_code: 'postal_code',
        city: 'city', region: 'region', latitude: 'latitude', longitude: 'longitude', location_precision: 'location_precision',
      });
    }

    const scheme = get('meter_scheme');
    const identifier = get('meter_identifier');
    const meterGiven = ['meter_name', 'meter_resource', 'meter_direction', 'meter_valid_from'].some((c) => get(c as ProjectSheetColumn) !== undefined);
    const meterValues = { name: get('meter_name'), resource: get('meter_resource'), direction: get('meter_direction'), valid_from: date('meter_valid_from') };
    if (scheme !== undefined && identifier !== undefined) {
      let meter = participant.meters.find((m) => m.scheme === scheme && m.identifier === identifier);
      if (meter === undefined) { meter = { scheme, identifier }; participant.meters.push(meter); }
      settle(meter, meterValues,
        { name: 'meter_name', resource: 'meter_resource', direction: 'meter_direction', valid_from: 'meter_valid_from' });
    } else if (scheme !== undefined || identifier !== undefined || meterGiven) {
      report('meter_incomplete', line, scheme === undefined ? 'meter_scheme' : 'meter_identifier');
    }

    const deviceType = get('device_type');
    const deviceName = get('device_name');
    const deviceGiven = ['device_rated_power_kw', 'device_unit_count', 'device_installed_on', 'device_identifiers'].some((c) => get(c as ProjectSheetColumn) !== undefined);
    const deviceValues = { device_type: deviceType, rated_power_kw: number('device_rated_power_kw'), unit_count: number('device_unit_count', true), installed_on: date('device_installed_on') };
    const deviceIdentifiers = identifiers('device_identifiers');
    if (deviceType !== undefined && deviceName !== undefined) {
      let device = participant.devices.find((d) => d.name === deviceName);
      if (device === undefined) { device = { device_type: deviceType, name: deviceName, identifiers: [] }; participant.devices.push(device); }
      settle(device, deviceValues,
        { device_type: 'device_type', rated_power_kw: 'device_rated_power_kw', unit_count: 'device_unit_count', installed_on: 'device_installed_on' });
      addIdentifiers(device.identifiers, deviceIdentifiers);
    } else if (deviceType !== undefined || deviceName !== undefined || deviceGiven) {
      report('device_incomplete', line, deviceType === undefined ? 'device_type' : 'device_name');
    }
  }
  return { delimiter, projects, problems };
}

/** One cell, quoted when it holds the separator, a quote or a line break. */
function quote(value: string, delimiter: string): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Writes projects as a sheet `readProjectSheet()` reads back the same: one
 * row per meter or device of a participant (a meter and a device side by
 * side while both lists last), one row for a participant with neither, one
 * for a project without participants. Numbers are written with a point,
 * so the default separator is the comma.
 */
export function writeProjectSheet(projects: SheetProject[], options: { delimiter?: ProjectSheet['delimiter'] } = {}): string {
  const delimiter = options.delimiter ?? ',';
  const ids = (list: SheetIdentifier[]) => list.map((i) => `${i.scheme}=${i.value}`).join('|');
  const text = (v: string | number | undefined) => (v === undefined ? '' : String(v));
  const lines = [PROJECT_SHEET_COLUMNS.join(delimiter)];
  for (const project of projects) {
    const projectCells: Partial<Record<ProjectSheetColumn, string>> = {
      project: project.name, country: text(project.country), project_kind: text(project.kind),
      project_start_date: text(project.start_date), project_identifiers: ids(project.identifiers),
    };
    const rows: Partial<Record<ProjectSheetColumn, string>>[] = [];
    if (project.participants.length === 0) rows.push(projectCells);
    for (const p of project.participants) {
      const place = p.place ?? {};
      const participantCells: Partial<Record<ProjectSheetColumn, string>> = {
        ...projectCells, participant: p.name, category: text(p.category), time_zone: text(p.time_zone),
        participant_identifiers: ids(p.identifiers), address_line1: text(place.address_line1), address_line2: text(place.address_line2),
        postal_code: text(place.postal_code), city: text(place.city), region: text(place.region), participant_country: text(place.country),
        latitude: text(place.latitude), longitude: text(place.longitude), location_precision: text(place.location_precision),
      };
      const count = Math.max(1, p.meters.length, p.devices.length);
      for (let i = 0; i < count; i++) {
        const m = p.meters[i];
        const d = p.devices[i];
        rows.push({
          ...participantCells,
          ...(m === undefined ? {} : {
            meter_scheme: m.scheme, meter_identifier: m.identifier, meter_name: text(m.name), meter_resource: text(m.resource),
            meter_direction: text(m.direction), meter_valid_from: text(m.valid_from),
          }),
          ...(d === undefined ? {} : {
            device_type: d.device_type, device_name: d.name, device_rated_power_kw: text(d.rated_power_kw),
            device_unit_count: text(d.unit_count), device_installed_on: text(d.installed_on), device_identifiers: ids(d.identifiers),
          }),
        });
      }
    }
    for (const row of rows) lines.push(PROJECT_SHEET_COLUMNS.map((c) => quote(row[c] ?? '', delimiter)).join(delimiter));
  }
  return lines.join('\r\n') + '\r\n';
}

// Weather files ⇄ Nexgen OS: EPW (EnergyPlus Weather) in and out, TMY3 in.
//
// EPW is how a typical year travels between solar and building tools: PVGIS,
// Meteonorm, climate.onebuilding.org and EnergyPlus write it, PVsyst, PV*SOL,
// SAM and pvlib read it. TMY3 is the CSV of the US National Solar Radiation
// Database that many older studies still carry. Both give one row per hour.
//
// Three conventions are kept straight here so that nobody downstream has to
// know them (decision 0012):
//   - both formats stamp an hour at its END, in local STANDARD time (no
//     daylight saving), hours 1 to 24; the core dates an interval value
//     (irradiance) at its start and an instant value (temperature, wind) at
//     its instant, both in UTC;
//   - a typical year is made of months from different years; it lands on one
//     calendar year (`options.year`, by default the latest year it was made
//     from) as a `simulated` series named after the years it comes from;
//   - a missing value (EPW 9999, 99.9, 999; TMY3 -9900) is left out, never
//     filled.
//
// The header's time zone is trusted, then checked: the hour of the
// irradiance-weighted noon is compared with the solar noon of the file's
// longitude, and a file whose hours are off by one or more is reported by
// name (`time_offset_suspect`) with the offset its irradiance implies. PVGIS
// writes its EPW hours in UTC under a header that gives the local offset;
// `utcOffsetHours: 0` reads such a file right.

import { storeSeries, type CollectedSeries, type Db, type SeriesPoint } from '../../connectors/index.js';

export type { Db };

export type WeatherQuantity = 'ghi' | 'dni' | 'dhi' | 'temperature' | 'wind_speed';

export interface WeatherFileLocation {
  name: string | null;
  /** The state, province or region as the file writes it. */
  region: string | null;
  /** The country as the file writes it (a code or a name), never interpreted. */
  country: string | null;
  /** Where the data come from, as the file says (`ECMWF/ERA`, `TMY3`, a station network). */
  data_source: string | null;
  /** The station's identifier (WMO, USAF), when there is one. */
  station_id: string | null;
  lat: number;
  lon: number;
  /** Hours from UTC of the file's standard time, east positive: what its hours are read in. */
  utc_offset_hours: number;
  elevation_m: number | null;
}

export interface WeatherFileWarning {
  code: 'time_offset_suspect';
  message: string;
  /** The offset the irradiance implies, hours from UTC. */
  implied_utc_offset_hours: number;
}

export interface WeatherFile {
  format: 'epw' | 'tmy3';
  location: WeatherFileLocation;
  /** One calendar year made of months from more than one year: a typical year, laid on `year`. */
  typical: boolean;
  /** The years the rows come from, in order. */
  years: number[];
  /** The calendar year a typical year was laid on; null for real years. */
  year: number | null;
  /** `ghi`, `dni`, `dhi` (W/m², hour intervals), `temperature` (°C) and `wind_speed` (m/s) (instants), when the file has them. */
  series: CollectedSeries[];
  /** Fields of the file that hold data but have no place in the core yet. */
  skipped: string[];
  /** Values the file marks as missing, per quantity: left out. */
  missing: Partial<Record<WeatherQuantity, number>>;
  warnings: WeatherFileWarning[];
}

export interface ReadOptions {
  /** The calendar year a typical year lands on. Default: the latest year it was made from. */
  year?: number;
  /** Overrides the header's time zone, hours from UTC (0 for a PVGIS EPW). */
  utcOffsetHours?: number;
}

const HOUR_MS = 3_600_000;
const INTERVAL: WeatherQuantity[] = ['ghi', 'dni', 'dhi'];
const ORDER: WeatherQuantity[] = ['ghi', 'dni', 'dhi', 'temperature', 'wind_speed'];
/**
 * The unit each quantity is written in by both formats, by its code in the
 * core's `units` vocabulary: `store()` converts from it and refuses a unit
 * that does not measure the quantity. An hour's radiation in Wh/m² is the
 * hour's mean irradiance in W/m².
 */
const UNITS: Record<WeatherQuantity, string> = { ghi: 'W-PER-M2', dni: 'W-PER-M2', dhi: 'W-PER-M2', temperature: 'DEG_C', wind_speed: 'M-PER-SEC' };

/** One row of a file, in its own terms: local standard time, hour ending 1 to 24. */
interface Row {
  year: number;
  month: number;
  day: number;
  hour: number;
  values: Partial<Record<WeatherQuantity, number | null>>;
}

// ---------------------------------------------------------------------------
// EPW
// ---------------------------------------------------------------------------

/**
 * EPW data fields after the date, minute and flags (field 6 onward), in
 * order, with the value that marks them missing. The core carries five;
 * the others are written back as missing.
 */
const EPW_FIELDS: { name: string; quantity?: WeatherQuantity; missing: number }[] = [
  { name: 'dry_bulb_temperature', quantity: 'temperature', missing: 99.9 },
  { name: 'dew_point_temperature', missing: 99.9 },
  { name: 'relative_humidity', missing: 999 },
  { name: 'atmospheric_pressure', missing: 999999 },
  { name: 'extraterrestrial_horizontal_radiation', missing: 9999 },
  { name: 'extraterrestrial_direct_normal_radiation', missing: 9999 },
  { name: 'horizontal_infrared_radiation', missing: 9999 },
  { name: 'global_horizontal_radiation', quantity: 'ghi', missing: 9999 },
  { name: 'direct_normal_radiation', quantity: 'dni', missing: 9999 },
  { name: 'diffuse_horizontal_radiation', quantity: 'dhi', missing: 9999 },
  { name: 'global_horizontal_illuminance', missing: 999999 },
  { name: 'direct_normal_illuminance', missing: 999999 },
  { name: 'diffuse_horizontal_illuminance', missing: 999999 },
  { name: 'zenith_luminance', missing: 9999 },
  { name: 'wind_direction', missing: 999 },
  { name: 'wind_speed', quantity: 'wind_speed', missing: 999 },
  { name: 'total_sky_cover', missing: 99 },
  { name: 'opaque_sky_cover', missing: 99 },
  { name: 'visibility', missing: 9999 },
  { name: 'ceiling_height', missing: 99999 },
  { name: 'present_weather_observation', missing: 9 },
  { name: 'present_weather_codes', missing: 999999999 },
  { name: 'precipitable_water', missing: 999 },
  { name: 'aerosol_optical_depth', missing: 0.999 },
  { name: 'snow_depth', missing: 999 },
  { name: 'days_since_last_snowfall', missing: 99 },
  { name: 'albedo', missing: 999 },
  { name: 'liquid_precipitation_depth', missing: 999 },
  { name: 'liquid_precipitation_quantity', missing: 99 },
];
/** Fields that say nothing about the weather when they hold a value. */
const EPW_NOT_DATA = new Set(['present_weather_observation', 'present_weather_codes']);
const EPW_FLAGS = '?9?9?9?9E0?9?9?9?9?9?9?9?9?9?9?9?9?9?9?9*9*9?9?9?9';

/** An EPW file as series in the core's conventions. */
export function readEpw(text: string, options: ReadOptions = {}): WeatherFile {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = lines[0]?.split(',') ?? [];
  if (header[0]?.trim().toUpperCase() !== 'LOCATION' || header.length < 10) {
    throw new Error('epw_unreadable: the first line of an EPW file is LOCATION with nine fields');
  }
  const location: WeatherFileLocation = {
    name: text_(header[1]),
    region: text_(header[2]),
    country: text_(header[3]),
    data_source: text_(header[4]),
    station_id: text_(header[5]),
    lat: num(header[6], 'latitude'),
    lon: num(header[7], 'longitude'),
    utc_offset_hours: options.utcOffsetHours ?? num(header[8], 'time zone'),
    elevation_m: Number.isFinite(Number(header[9])) ? Number(header[9]) : null,
  };

  const periods = lines.slice(1, 8).find((l) => /^DATA PERIODS/i.test(l));
  const perHour = periods ? Number(periods.split(',')[2]) : 1;
  if (perHour !== 1) throw new Error(`epw_subhourly_unsupported: ${perHour} records per hour; the reader takes hourly files`);

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(8)) {
    if (!line.trim()) continue;
    const f = line.split(',');
    if (f.length < 6 + EPW_FIELDS.length - 2) throw new Error(`epw_unreadable: a data row has ${f.length} fields: ${line.slice(0, 40)}`);
    const values: Row['values'] = {};
    EPW_FIELDS.forEach((field, i) => {
      const raw = f[6 + i];
      const v = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
      const present = Number.isFinite(v) && v < field.missing;
      if (field.quantity) values[field.quantity] = present ? zero(v) : null;
      else if (present && !EPW_NOT_DATA.has(field.name)) seen.add(field.name);
    });
    rows.push({ year: int(f[0]), month: int(f[1]), day: int(f[2]), hour: int(f[3]), values });
  }
  return toWeatherFile('epw', location, rows, [...seen], options);
}

/**
 * Series written as an EPW file for one calendar year in the location's
 * standard time: what PVsyst, PV*SOL, SAM, EnergyPlus or pvlib reads to
 * rerun the same weather. Hours without a value are written missing; 29
 * February is written only when the series have values that day.
 */
export function writeEpw(input: { location: WeatherFileLocation; series: CollectedSeries[]; year: number; comment?: string }): string {
  const { location, year } = input;
  const offsetMs = location.utc_offset_hours * HOUR_MS;
  const byQuantity = new Map<string, Map<number, number>>();
  for (const s of input.series) {
    byQuantity.set(s.quantity_code, new Map(s.values.map((p) => [Date.parse(p.at), p.value])));
  }
  const valueAt = (q: WeatherQuantity, row: { y: number; m: number; d: number; h: number }) => {
    const end = Date.UTC(row.y, row.m - 1, row.d, row.h) - offsetMs;
    return byQuantity.get(q)?.get(INTERVAL.includes(q) ? end - HOUR_MS : end);
  };

  const leap = isLeap(year);
  const out: string[] = [];
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= daysIn(year, m); d++) {
      const hours = Array.from({ length: 24 }, (_, i) => ({ y: year, m, d, h: i + 1 }));
      if (m === 2 && d === 29 && !hours.some((r) => ORDER.some((q) => valueAt(q, r) !== undefined))) continue;
      for (const r of hours) {
        const fields = EPW_FIELDS.map((field) => {
          const v = field.quantity ? valueAt(field.quantity, r) : undefined;
          return v === undefined ? String(field.missing) : fmt(v);
        });
        out.push([year, m, d, r.h, 0, EPW_FLAGS, ...fields].join(','));
      }
    }
  }
  const febHas29 = out.some((l) => l.startsWith(`${year},2,29,`));
  const weekday = new Date(Date.UTC(year, 0, 1)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const field = (s: string | null) => (s ?? '-').replace(/,/g, ' ');
  return [
    ['LOCATION', field(location.name), field(location.region), field(location.country), field(location.data_source), field(location.station_id),
      fmt(location.lat), fmt(location.lon), fmt(location.utc_offset_hours), location.elevation_m === null ? '0' : fmt(location.elevation_m)].join(','),
    'DESIGN CONDITIONS,0',
    'TYPICAL/EXTREME PERIODS,0',
    'GROUND TEMPERATURES,0',
    `HOLIDAYS/DAYLIGHT SAVINGS,${leap && febHas29 ? 'Yes' : 'No'},0,0,0`,
    `COMMENTS 1,${(input.comment ?? 'Written by Nexgen OS').replace(/[\r\n]/g, ' ')}`,
    'COMMENTS 2,Hours in local standard time; missing values carry the EPW missing codes',
    `DATA PERIODS,1,1,Data,${weekday},1/1,12/31`,
    ...out,
  ].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// TMY3
// ---------------------------------------------------------------------------

const TMY3_COLUMNS: Record<WeatherQuantity, string> = {
  ghi: 'GHI (W/m^2)',
  dni: 'DNI (W/m^2)',
  dhi: 'DHI (W/m^2)',
  temperature: 'Dry-bulb (C)',
  wind_speed: 'Wspd (m/s)',
};
const TMY3_SKIPPED = ['Dew-point (C)', 'RHum (%)', 'Pressure (mbar)', 'Wdir (degrees)', 'Alb (unitless)', 'Pwat (cm)', 'AOD (unitless)', 'Lprecip depth (mm)'];

/** A TMY3 file of the National Solar Radiation Database as series in the core's conventions. */
export function readTmy3(text: string, options: ReadOptions = {}): WeatherFile {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const meta = csv(lines[0] ?? '');
  const columns = csv(lines[1] ?? '').map((c) => c.trim());
  const at = (name: string) => columns.indexOf(name);
  if (meta.length < 7 || at('Date (MM/DD/YYYY)') !== 0 || at('Time (HH:MM)') !== 1) {
    throw new Error('tmy3_unreadable: a TMY3 file starts with the station line, then the column names Date (MM/DD/YYYY), Time (HH:MM), …');
  }
  const location: WeatherFileLocation = {
    name: text_(meta[1]),
    region: text_(meta[2]),
    country: null,
    data_source: 'TMY3',
    station_id: text_(meta[0]),
    lat: num(meta[4], 'latitude'),
    lon: num(meta[5], 'longitude'),
    utc_offset_hours: options.utcOffsetHours ?? num(meta[3], 'time zone'),
    elevation_m: Number.isFinite(Number(meta[6])) ? Number(meta[6]) : null,
  };
  const index = Object.fromEntries(ORDER.map((q) => [q, at(TMY3_COLUMNS[q])])) as Record<WeatherQuantity, number>;
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const line of lines.slice(2)) {
    if (!line.trim()) continue;
    const f = line.split(',');
    const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(f[0] ?? '');
    const time = /^(\d{1,2}):00$/.exec(f[1] ?? '');
    if (!date || !time) throw new Error(`tmy3_unreadable: a row without a date and an hour: ${line.slice(0, 40)}`);
    const values: Row['values'] = {};
    for (const q of ORDER) {
      if (index[q] < 0) continue;
      const v = Number(f[index[q]]);
      values[q] = Number.isFinite(v) && v > -9900 ? zero(v) : null;
    }
    for (const name of TMY3_SKIPPED) {
      const i = at(name);
      const v = i < 0 ? NaN : Number(f[i]);
      if (Number.isFinite(v) && v > -9900) seen.add(name);
    }
    rows.push({ year: Number(date[3]), month: Number(date[1]), day: Number(date[2]), hour: Number(time[1]), values });
  }
  return toWeatherFile('tmy3', location, rows, [...seen], options);
}

// ---------------------------------------------------------------------------
// Rows to series, shared by both readers
// ---------------------------------------------------------------------------

function toWeatherFile(format: WeatherFile['format'], location: WeatherFileLocation, rows: Row[], skipped: string[], options: ReadOptions): WeatherFile {
  if (rows.length === 0) throw new Error(`${format}_unreadable: no data row`);
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const typical = years.length > 1 && new Set(rows.map((r) => `${r.month}-${r.day}-${r.hour}`)).size === rows.length;
  const year = typical ? options.year ?? years[years.length - 1] : null;
  const offsetMs = location.utc_offset_hours * HOUR_MS;

  const points = new Map<WeatherQuantity, SeriesPoint[]>(ORDER.map((q) => [q, []]));
  const missing: WeatherFile['missing'] = {};
  const instants = new Set<number>();
  for (const r of rows) {
    if (r.hour < 1 || r.hour > 24 || r.month < 1 || r.month > 12 || r.day < 1 || r.day > 31) {
      throw new Error(`${format}_unreadable: no such hour ${r.year}-${r.month}-${r.day} ${r.hour}`);
    }
    const y = year ?? r.year;
    if (r.month === 2 && r.day === 29 && !isLeap(y)) continue;
    const end = Date.UTC(y, r.month - 1, r.day, r.hour) - offsetMs;
    if (instants.has(end)) throw new Error(`${format}_duplicate_hour: ${y}-${r.month}-${r.day} hour ${r.hour} comes twice`);
    instants.add(end);
    for (const q of ORDER) {
      const v = r.values[q];
      if (v === undefined) continue;
      if (v === null) {
        missing[q] = (missing[q] ?? 0) + 1;
        continue;
      }
      points.get(q)!.push({ at: new Date(INTERVAL.includes(q) ? end - HOUR_MS : end).toISOString(), value: v });
    }
  }

  const series: CollectedSeries[] = ORDER.filter((q) => rows.some((r) => r.values[q] !== undefined)).map((q) => ({
    quantity_code: q,
    value_kind: INTERVAL.includes(q) ? 'interval' : 'instant',
    step: '1 hour',
    unit: UNITS[q],
    values: points.get(q)!.sort((a, b) => a.at.localeCompare(b.at)),
  }));
  const warnings: WeatherFileWarning[] = [];
  const implied = impliedOffset(rows, location);
  if (implied !== null && implied !== location.utc_offset_hours) {
    warnings.push({
      code: 'time_offset_suspect',
      message: `the irradiance peaks as if the hours were at UTC${implied >= 0 ? '+' : ''}${implied}, the file reads them at UTC${location.utc_offset_hours >= 0 ? '+' : ''}${location.utc_offset_hours}`,
      implied_utc_offset_hours: implied,
    });
  }
  return { format, location, typical, years, year, series, skipped, missing, warnings };
}

/**
 * The offset the irradiance implies: the irradiance-weighted middle of the
 * hours, against the solar noon of the longitude (12 h + offset − lon/15 in
 * standard time, the equation of time averaging out over the days). Null
 * without irradiance; the header's offset when they agree within half an hour.
 */
function impliedOffset(rows: Row[], location: WeatherFileLocation): number | null {
  let weight = 0;
  let sum = 0;
  for (const r of rows) {
    const g = r.values.ghi;
    if (g === null || g === undefined || g <= 0) continue;
    weight += g;
    sum += g * (r.hour - 0.5);
  }
  if (weight === 0) return null;
  const solarNoon = 12 + location.utc_offset_hours - location.lon / 15;
  const shift = sum / weight - solarNoon;
  return Math.abs(shift) <= 0.5 ? location.utc_offset_hours : location.utc_offset_hours + Math.round(shift);
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

export interface WeatherTarget {
  organisationId: string;
  /** The object the weather is about: a weather point, a site. */
  objectId: string;
}

/**
 * Stores what a file holds on an object, one series per quantity, with the
 * source the caller names (the `sources` row of the dataset: `pvgis`, a
 * station network, a licensed model). A typical year is `simulated` and
 * named after its years (`typical year 2005-2020`); real years are
 * `measured` and unnamed, unless told otherwise. Importing the same file
 * again replaces the values.
 */
export async function importWeatherFile(
  db: Db,
  target: WeatherTarget,
  file: WeatherFile,
  options: { sourceCode: string; kind?: 'measured' | 'simulated'; name?: string | null },
): Promise<{ series: { quantity_code: string; seriesId: string; inserted: number }[]; warnings: WeatherFileWarning[] }> {
  const kind = options.kind ?? (file.typical ? 'simulated' : 'measured');
  const name = options.name !== undefined ? options.name : file.typical ? `typical year ${file.years[0]}-${file.years[file.years.length - 1]}` : null;
  const series = [];
  for (const s of file.series) {
    const stored = await storeSeries(db, { organisationId: target.organisationId, objectId: target.objectId, sourceCode: options.sourceCode, kind, name }, s);
    series.push({ quantity_code: s.quantity_code, ...stored });
  }
  return { series, warnings: file.warnings };
}

/**
 * The weather series of an object, read through `resample()`, written as an
 * EPW file for one calendar year in the location's standard time. The
 * series are those of the source, kind and name given; a quantity the
 * object does not have is written missing.
 */
export async function exportEpw(
  db: Db,
  request: { objectId: string; sourceCode: string; kind: 'measured' | 'simulated'; name?: string | null; year: number; location: WeatherFileLocation; comment?: string },
): Promise<string> {
  const found = await db.query<{ id: string; quantity_code: string; value_kind: CollectedSeries['value_kind'] }>(
    `select id, quantity_code, value_kind from series
      where object_id = $1 and source_code = $2 and kind = $3 and name is not distinct from $4
        and quantity_code = any($5)`,
    [request.objectId, request.sourceCode, request.kind, request.name ?? null, ORDER],
  );
  const offsetMs = request.location.utc_offset_hours * HOUR_MS;
  const from = new Date(Date.UTC(request.year, 0, 1) - offsetMs).toISOString();
  const to = new Date(Date.UTC(request.year + 1, 0, 1) - offsetMs + HOUR_MS).toISOString();
  const series: CollectedSeries[] = [];
  for (const s of found.rows) {
    const values = await db.query<{ bucket: string | Date; value: number }>(`select bucket, value from resample($1, $2, $3, '1 hour')`, [s.id, from, to]);
    series.push({
      quantity_code: s.quantity_code,
      value_kind: s.value_kind,
      step: '1 hour',
      values: values.rows.map((v) => ({ at: new Date(v.bucket).toISOString(), value: v.value })),
    });
  }
  return writeEpw({ location: request.location, series, year: request.year, comment: request.comment });
}

// ---------------------------------------------------------------------------
// Small things
// ---------------------------------------------------------------------------

function text_(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  return t === '' || t === '-' || /^unknown$/i.test(t) ? null : t;
}

function num(s: string | undefined, what: string): number {
  const n = Number((s ?? '').trim());
  if ((s ?? '').trim() === '' || !Number.isFinite(n)) throw new Error(`weather_file_unreadable: no ${what} in the header`);
  return n;
}

function int(s: string | undefined): number {
  return Math.trunc(Number(s));
}

/** -0, which some writers print for a night value, is 0. */
function zero(v: number): number {
  return v === 0 ? 0 : v;
}

function fmt(v: number): string {
  return String(zero(Math.round(v * 1e4) / 1e4));
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** One CSV line, double quotes honoured. */
function csv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

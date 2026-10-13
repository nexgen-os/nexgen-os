// Open-Meteo — https://open-meteo.com, weather forecasts and archives,
// worldwide, CC BY 4.0, no key for non-commercial use. The open
// WeatherProvider that ships with the core.
//
// Subtleties of the API are kept straight here so that nobody downstream
// has to know them: times come back without an offset (UTC is asked for and
// marked); the radiation of an hour is the average of the hour *before* the
// stamp, so it is stored as an interval starting one hour earlier; wind
// speeds come in km/h unless metres per second are asked for; the azimuth of
// a plane is counted from south, west positive, where the core counts from
// true north, clockwise.

import type { Fetch } from '../../formats/geocoding/index.js';
import { azimuthFromSouth, type CollectedSeries, type Point, type WeatherProvider } from '../index.js';

export const SOURCE_CODE = 'open_meteo';

interface VariableSpec {
  variable: string;
  value_kind: CollectedSeries['value_kind'];
  /** The value at a stamp is the mean of the hour before it. */
  precedingHour: boolean;
}

/** Open-Meteo hourly forecast variables, to the core's quantities. Units already match (°C, W/m²). */
const VARIABLES: Record<string, VariableSpec> = {
  temperature: { variable: 'temperature_2m', value_kind: 'instant', precedingHour: false },
  irradiance: { variable: 'shortwave_radiation', value_kind: 'interval', precedingHour: true },
};

/**
 * Hourly archive variables (ERA5 reanalysis), to the core's quantities, in
 * the core's units once `wind_speed_unit=ms` is asked. `poa_irradiance` is
 * Open-Meteo's `global_tilted_irradiance`: the transposition to the plane is
 * done by Open-Meteo for the tilt and azimuth given.
 */
const HISTORY_VARIABLES: Record<string, VariableSpec> = {
  poa_irradiance: { variable: 'global_tilted_irradiance', value_kind: 'interval', precedingHour: true },
  irradiance: { variable: 'shortwave_radiation', value_kind: 'interval', precedingHour: true },
  temperature: { variable: 'temperature_2m', value_kind: 'instant', precedingHour: false },
  wind_speed: { variable: 'wind_speed_10m', value_kind: 'instant', precedingHour: false },
};

interface OpenMeteoHourly {
  hourly?: { time: (string | number)[] } & Record<string, (number | null)[] | (string | number)[]>;
  reason?: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function openMeteo(options: { baseUrl?: string; archiveUrl?: string; fetch?: Fetch; now?: () => Date } = {}): WeatherProvider {
  const base = (options.baseUrl ?? 'https://api.open-meteo.com').replace(/\/+$/, '');
  const archive = (options.archiveUrl ?? 'https://archive-api.open-meteo.com').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
  const now = options.now ?? (() => new Date());

  const getHourly = async (url: string): Promise<OpenMeteoHourly> => {
    const response = await doFetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`source_unavailable: ${response.status} from Open-Meteo`);
    return (await response.json()) as OpenMeteoHourly;
  };

  return {
    source_code: SOURCE_CODE,
    async forecast(where: Point, opts = {}) {
      const quantities = (opts.quantities ?? Object.keys(VARIABLES)).filter((q) => q in VARIABLES);
      if (quantities.length === 0) throw new Error('quantity_unknown: Open-Meteo gives temperature and irradiance');
      const params = new URLSearchParams({
        latitude: String(where.lat),
        longitude: String(where.lon),
        hourly: quantities.map((q) => VARIABLES[q].variable).join(','),
        forecast_days: String(Math.max(1, Math.ceil((opts.hours ?? 48) / 24))),
        timezone: 'UTC',
      });
      const body = await getHourly(`${base}/v1/forecast?${params}`);
      const issued_at = now().toISOString();
      const times = (body.hourly?.time ?? []) as string[];
      const limit = opts.hours ?? times.length;
      const series = quantities.map((quantity_code) => {
        const spec = VARIABLES[quantity_code];
        const column = (body.hourly?.[spec.variable] ?? []) as (number | null)[];
        const values = times.slice(0, limit).flatMap((t, i) => {
          const value = column[i];
          if (value === null || value === undefined) return [];
          const stamp = new Date(`${t}Z`);
          if (spec.precedingHour) stamp.setUTCHours(stamp.getUTCHours() - 1);
          return [{ at: stamp.toISOString(), value }];
        });
        return { quantity_code, value_kind: spec.value_kind, step: '1 hour', values };
      });
      return { issued_at, series };
    },

    /**
     * The ERA5 archive, hourly, for the days `from` to `to` included. Every
     * hour of those days is covered: the mean of the last hour of `to` is
     * stamped at midnight the day after, so one more day is asked and the
     * values outside the period are left out. A null (an hour the archive
     * does not have yet) is left out, never stored as zero. Without `model`,
     * Open-Meteo blends its reanalyses (`best_match`: ERA5 with ERA5-Land
     * and others where they exist); `model: 'era5'` asks ERA5 alone, on its
     * 0.25° grid.
     */
    async history(where: Point, from: string, to: string, opts = {}) {
      const start = dayStart(from);
      const end = dayStart(to) + DAY_MS;
      if (end <= start) throw new Error(`period_empty: ${from} to ${to}`);
      const oriented = opts.tilt_deg !== undefined && opts.azimuth_deg !== undefined;
      const quantities = opts.quantities ?? [oriented ? 'poa_irradiance' : 'irradiance', 'temperature', 'wind_speed'];
      const unknown = quantities.filter((q) => !(q in HISTORY_VARIABLES));
      if (unknown.length > 0) throw new Error(`quantity_unknown: ${unknown.join(', ')}; the Open-Meteo archive gives ${Object.keys(HISTORY_VARIABLES).join(', ')}`);
      if (quantities.includes('poa_irradiance') && !oriented) throw new Error('orientation_required: poa_irradiance needs tilt_deg and azimuth_deg');

      const params = new URLSearchParams({
        latitude: String(where.lat),
        longitude: String(where.lon),
        start_date: from,
        end_date: new Date(end).toISOString().slice(0, 10),
        hourly: quantities.map((q) => HISTORY_VARIABLES[q].variable).join(','),
        wind_speed_unit: 'ms',
        timezone: 'GMT',
        timeformat: 'unixtime',
      });
      if (opts.model) params.set('models', opts.model);
      if (oriented) {
        params.set('tilt', String(opts.tilt_deg));
        params.set('azimuth', String(azimuthFromSouth(opts.azimuth_deg!)));
      }
      const body = await getHourly(`${archive}/v1/archive?${params}`);
      if (!body.hourly) throw new Error(`source_unavailable: Open-Meteo archive answered without hourly values${body.reason ? ` (${body.reason})` : ''}`);
      const stamps = body.hourly.time as number[];
      return quantities.map((quantity_code) => {
        const spec = HISTORY_VARIABLES[quantity_code];
        const column = (body.hourly?.[spec.variable] ?? []) as (number | null)[];
        const values = stamps.flatMap((unix, i) => {
          const value = column[i];
          const at = unix * 1000 - (spec.precedingHour ? HOUR_MS : 0);
          if (value === null || value === undefined || at < start || at >= end) return [];
          return [{ at: new Date(at).toISOString(), value }];
        });
        return { quantity_code, value_kind: spec.value_kind, step: '1 hour', values };
      });
    },
  };
}

/** `YYYY-MM-DD` → milliseconds at 00:00 UTC that day. */
function dayStart(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`date_unreadable: ${day} (YYYY-MM-DD expected)`);
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`date_unreadable: ${day}`);
  return t;
}

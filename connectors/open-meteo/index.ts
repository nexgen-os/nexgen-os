// Open-Meteo — https://open-meteo.com, weather forecasts and archives,
// worldwide, CC BY 4.0, no key for non-commercial use. The open
// WeatherProvider that ships with the core.
//
// Two subtleties of the API are kept straight here so that nobody downstream
// has to know them: times come back without an offset (UTC is asked for and
// marked), and the radiation of an hour is the average of the hour *before*
// the stamp, so it is stored as an interval starting one hour earlier.

import type { Fetch } from '../../formats/geocoding/index.js';
import type { CollectedSeries, Point, WeatherProvider } from '../index.js';

export const SOURCE_CODE = 'open_meteo';

/** Open-Meteo hourly variables, to the core's quantities. Units already match (°C, W/m²). */
const VARIABLES: Record<string, { variable: string; value_kind: CollectedSeries['value_kind']; precedingHour: boolean }> = {
  temperature: { variable: 'temperature_2m', value_kind: 'instant', precedingHour: false },
  irradiance: { variable: 'shortwave_radiation', value_kind: 'interval', precedingHour: true },
};

interface OpenMeteoHourly {
  hourly?: { time: string[] } & Record<string, (number | null)[] | string[]>;
}

export function openMeteo(options: { baseUrl?: string; fetch?: Fetch; now?: () => Date } = {}): WeatherProvider {
  const base = (options.baseUrl ?? 'https://api.open-meteo.com').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
  const now = options.now ?? (() => new Date());

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
      const response = await doFetch(`${base}/v1/forecast?${params}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`source_unavailable: ${response.status} from Open-Meteo`);
      const body = (await response.json()) as OpenMeteoHourly;
      const issued_at = now().toISOString();
      const times = body.hourly?.time ?? [];
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
  };
}

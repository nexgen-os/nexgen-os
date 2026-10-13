// PVGIS — https://re.jrc.ec.europa.eu/pvg_tools/, the European Commission's
// photovoltaic geographical information system: satellite irradiance (SARAH3)
// where it covers, ERA5 elsewhere, a digital-elevation horizon, and a PV
// calculation. Free, no key, no restriction on use (API 5.3, read 13/10/2026).
//
// Three conventions are kept straight here so that nobody downstream has to
// know them: PVGIS counts the azimuth from south (west positive) while the
// core counts from true north clockwise; PVGIS stamps each hourly value
// `YYYYMMDD:HHMM` in UTC at the minute of the satellite image, and the core
// dates an hour at its start; PVGIS gives power in watts, the core keeps
// kilowatts and kilowatt-hours.

import type { Fetch } from '../../formats/geocoding/index.js';
import { azimuthFromSouth, type CollectedSeries, type Point } from '../index.js';

export const SOURCE_CODE = 'pvgis';

export interface PvgisSystem {
  /** Peak power, kWp. 1 gives yields per kWp. */
  kwp: number;
  /** Degrees clockwise from true north, as the core stores it. */
  azimuth_deg: number;
  /** Degrees from horizontal. */
  tilt_deg: number;
  /** `building` for roof-mounted, `free` for open rack. */
  mounting: 'building' | 'free';
  /** PVGIS's one aggregate loss, percent. */
  system_loss_pct: number;
  technology?: 'crystSi' | 'CIS' | 'CdTe' | 'Unknown';
  /** Use the digital-elevation horizon. Default true. */
  horizon?: boolean;
}

export interface PvgisHourly {
  /** What PVGIS used: the radiation database (SARAH3, ERA5), the years. */
  meta: { radiation_db: string; meteo_db: string; year_min: number; year_max: number; horizon: string | null };
  /** Energy per hour (kWh, interval), plane-of-array irradiance (W/m², interval mean), air temperature (°C, instant). */
  series: CollectedSeries[];
}

export interface PvgisYearly {
  meta: { radiation_db: string; meteo_db: string };
  /** kWh per year for the system given (per kWp when kwp = 1). */
  annual_kwh: number;
  /** kWh per month, January first. */
  monthly_kwh: number[];
  /** Yearly in-plane irradiation, kWh/m². */
  annual_poa_kwh_m2: number;
}

interface SeriescalcAnswer {
  inputs: { meteo_data: { radiation_db: string; meteo_db: string; year_min: number; year_max: number; horizon_data?: string | null } };
  outputs: { hourly: { time: string; P?: number; 'G(i)': number; T2m: number }[] };
}

interface PvcalcAnswer {
  inputs: { meteo_data: { radiation_db: string; meteo_db: string } };
  outputs: { monthly: { fixed: { month: number; E_m: number }[] }; totals: { fixed: { E_y: number; 'H(i)_y': number } } };
}

export function pvgis(options: { baseUrl?: string; fetch?: Fetch } = {}) {
  const base = (options.baseUrl ?? 'https://re.jrc.ec.europa.eu/api/v5_3').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);

  const systemParams = (system: PvgisSystem) => ({
    peakpower: String(system.kwp),
    loss: String(system.system_loss_pct),
    angle: String(system.tilt_deg),
    aspect: String(aspectOf(system.azimuth_deg)),
    mountingplace: system.mounting,
    pvtechchoice: system.technology ?? 'crystSi',
    usehorizon: system.horizon === false ? '0' : '1',
  });

  return {
    source_code: SOURCE_CODE,

    /** Hourly series of a system over whole years: what a yield run of the `pvgis_like` profile stores. */
    async hourly(where: Point, system: PvgisSystem, years: { from: number; to: number }, extra: { raddatabase?: string } = {}): Promise<PvgisHourly> {
      const params = new URLSearchParams({
        lat: String(where.lat), lon: String(where.lon),
        startyear: String(years.from), endyear: String(years.to),
        pvcalculation: '1', ...systemParams(system), outputformat: 'json',
      });
      if (extra.raddatabase) params.set('raddatabase', extra.raddatabase);
      const body = (await getJson(doFetch, `${base}/seriescalc?${params}`)) as SeriescalcAnswer;
      const m = body.inputs.meteo_data;
      const rows = body.outputs.hourly;
      return {
        meta: { radiation_db: m.radiation_db, meteo_db: m.meteo_db, year_min: m.year_min, year_max: m.year_max, horizon: m.horizon_data ?? null },
        series: [
          { quantity_code: 'production_energy', value_kind: 'interval', step: '1 hour', values: rows.map((r) => ({ at: hourStart(r.time), value: round((r.P ?? 0) / 1000) })) },
          { quantity_code: 'poa_irradiance', value_kind: 'interval', step: '1 hour', values: rows.map((r) => ({ at: hourStart(r.time), value: r['G(i)'] })) },
          { quantity_code: 'temperature', value_kind: 'instant', step: '1 hour', values: rows.map((r) => ({ at: hourStart(r.time), value: r.T2m })) },
        ],
      };
    },

    /** The multi-year average yield of a system: the quick figure of PVGIS's PV calculator. */
    async yearly(where: Point, system: PvgisSystem, extra: { raddatabase?: string } = {}): Promise<PvgisYearly> {
      const params = new URLSearchParams({ lat: String(where.lat), lon: String(where.lon), ...systemParams(system), outputformat: 'json' });
      if (extra.raddatabase) params.set('raddatabase', extra.raddatabase);
      const body = (await getJson(doFetch, `${base}/PVcalc?${params}`)) as PvcalcAnswer;
      return {
        meta: { radiation_db: body.inputs.meteo_data.radiation_db, meteo_db: body.inputs.meteo_data.meteo_db },
        annual_kwh: body.outputs.totals.fixed.E_y,
        monthly_kwh: [...body.outputs.monthly.fixed].sort((a, b) => a.month - b.month).map((x) => x.E_m),
        annual_poa_kwh_m2: body.outputs.totals.fixed['H(i)_y'],
      };
    },
  };
}

/** The core's azimuth (from true north, clockwise) as PVGIS's aspect (from south, west positive), in (-180, 180]. */
export const aspectOf = azimuthFromSouth;

/** `20230101:1210` → the start of that hour in UTC, ISO 8601. */
export function hourStart(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2}):(\d{2})(\d{2})$/.exec(stamp);
  if (!m) throw new Error(`pvgis_time_unreadable: ${stamp}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), 0)).toISOString();
}

async function getJson(doFetch: Fetch, url: string): Promise<unknown> {
  const response = await doFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`source_unavailable: ${response.status} from PVGIS`);
  return response.json();
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

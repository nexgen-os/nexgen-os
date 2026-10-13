// The `pv_yield` request kind, as a caller in TypeScript builds it and reads
// its answer (engines/pvlib/README.md). Any engine that accepts `pv_yield`
// answers in this shape; pvlib is the first.

import type { CollectedSeries } from '../../connectors/index.js';
import type { EngineSpec } from '../runner.js';

/** What `runEngine` needs to start the pvlib engine; the command comes from the caller or `NEXGEN_ENGINE_PVLIB`. */
export const PVLIB_ENGINE: Pick<EngineSpec, 'name' | 'install'> = {
  name: 'pvlib',
  install: 'python3 -m venv .venv-pvlib && .venv-pvlib/bin/pip install -e engines/pvlib, NEXGEN_ENGINE_PVLIB=".venv-pvlib/bin/python -m nexgen_pvlib"',
};

/** A series sent to or returned by an engine: a `CollectedSeries`, with its unit and, when it belongs to one array, the array's name. */
export type EngineSeries = CollectedSeries & { unit?: string; array?: string };

export interface PvYieldArray {
  name: string;
  /** Degrees clockwise from true north. */
  azimuth_deg: number;
  /** Degrees from horizontal. */
  tilt_deg: number;
  mounting: 'open_rack' | 'roof_parallel' | 'semi_integrated' | 'insulated' | 'floating';
  /** The model and its parameters in pvlib's key names (`pvwatts`: `pdc0` in W per module, `gamma_pdc` in 1/°C). */
  module: { model: 'pvwatts' | 'cec' | 'pvsyst' | 'sapm'; parameters: Record<string, unknown> };
  modules_per_string?: number;
  strings?: number;
  /** Ground reflectance, 0 to 1; the request's `albedo` otherwise, pvlib's default last. */
  albedo?: number | null;
}

export interface PvYieldRequest {
  kind: 'pv_yield';
  site: { lat: number; lon: number; altitude_m?: number | null; time_zone?: string | null };
  arrays: PvYieldArray[];
  /** `no_loss`: AC equals DC, no inverter modelled. */
  inverter: { model: 'pvwatts' | 'sandia' | 'adr' | 'no_loss'; parameters?: Record<string, unknown> };
  /** In order; each a fraction of what the previous ones left, a negative one a gain. */
  losses: { code: string; fraction: number | null }[];
  models: {
    /** `erbs` when only `ghi` is given. */
    decomposition?: string | null;
    /** Needed when the weather is horizontal (`ghi`, `dni`, `dhi`); ignored with `poa_irradiance`. */
    transposition?: string | null;
    temperature: string;
    /** The profile's; without them, pvlib's published set for each array's mounting (`sapm`, `pvsyst`). */
    temperature_parameters?: Record<string, number>;
    aoi?: string;
    spectral?: string;
  };
  /** `ghi` (with or without `dni`, `dhi`) for the site, or `poa_irradiance` for the site or per array; `temperature` and `wind_speed`. */
  weather: EngineSeries[];
  albedo?: number | null;
}

export interface PvYieldResult {
  /** `production_energy` (kWh per interval, AC) for the system; `poa_irradiance` and `module_temperature` per array. */
  series: EngineSeries[];
  /** The models used, as the engine resolved them. */
  meta: Record<string, unknown>;
}

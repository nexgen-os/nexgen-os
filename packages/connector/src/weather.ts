// What a weather or PV connector is asked and what it answers: a point, the
// series it brings back for one quantity, the interface of a weather source,
// and the azimuth convention of the services it calls.

import type { SeriesPoint } from '@nexgen-os/solar';

export type { SeriesPoint };

export interface Point {
  lon: number;
  lat: number;
}

/** What a connector brings back for one quantity: ready for `storeSeries()`. */
export interface CollectedSeries {
  quantity_code: string;
  /** What one value means: `interval` from `at` for one `step`, `instant` at `at`, `cumulative` register. */
  value_kind: 'interval' | 'instant' | 'cumulative';
  /** A Postgres interval (`1 hour`, `15 minutes`), null when irregular. */
  step: string | null;
  /** The unit the values are in, by QUDT code or symbol (`Wh`, `°C`); the quantity's own when absent. `store()` converts. */
  unit?: string;
  /** Tells apart two series of one object and quantity the connector brings at once (the dials of an index); the target's name otherwise. */
  name?: string | null;
  values: SeriesPoint[];
}

/** Weather observed or forecast at a point: a model, a station, an API. */
export interface WeatherProvider {
  readonly source_code: string;
  /** The forecast from now on, at the hourly step the model gives, with the time it was issued. */
  forecast(where: Point, options?: { hours?: number; quantities?: string[] }): Promise<{ issued_at: string; series: CollectedSeries[] }>;
  /**
   * Past weather, when the source has it (an archive, a reanalysis), for the
   * days `from` to `to` included (`YYYY-MM-DD`, UTC). Irradiance on a plane
   * (`poa_irradiance`) needs the plane: `tilt_deg` from horizontal and
   * `azimuth_deg` clockwise from true north. `model` names one of the
   * source's datasets (a reanalysis, a station network) when it has several.
   */
  history?(where: Point, from: string, to: string, options?: { quantities?: string[]; tilt_deg?: number; azimuth_deg?: number; model?: string }): Promise<CollectedSeries[]>;
}

/**
 * The core's azimuth (degrees clockwise from true north) counted from south,
 * west positive, in (-180, 180]: the convention of PVGIS (`aspect`),
 * Open-Meteo (`azimuth`) and PVsyst.
 */
export function azimuthFromSouth(azimuthDeg: number): number {
  let a = ((azimuthDeg - 180) % 360 + 360) % 360;
  if (a > 180) a -= 360;
  return a === -0 ? 0 : a;
}

// Connectors: how an installation reads the outside world.
//
// A source (a vocabulary row) says what exists: a weather model, a grid
// operator's hub, a company register, a map provider. A connection (a core
// row) says that an organisation reads it. A connector is the code in
// between: a library that implements one of the interfaces below and
// answers in the core's terms — quantities, value kinds, steps, external
// identifiers — so that what it brings back lands on ordinary objects,
// attributes, documents and series with its source on it (decision 0011).
//
// The interfaces are open and live here; implementations are open when
// their data is (Open-Meteo, OpenStreetMap, a public register) and private
// when it is not (a commercial map provider, a licensed register, a company's
// own data service). A private package implements the same interface and
// registers its `sources` rows; the core and the pages never import it.

import type { Db } from '../formats/db.js';
import type { Address } from '../formats/geocoding/index.js';

export type { Db };

export interface Point {
  lon: number;
  lat: number;
}

/** One value at one instant, ISO 8601 with its offset, in the quantity's unit. */
export interface SeriesPoint {
  at: string;
  value: number;
}

/** What a connector brings back for one quantity: ready for `storeSeries()`. */
export interface CollectedSeries {
  quantity_code: string;
  /** What one value means: `interval` from `at` for one `step`, `instant` at `at`, `cumulative` register. */
  value_kind: 'interval' | 'instant' | 'cumulative';
  /** A Postgres interval (`1 hour`, `15 minutes`), null when irregular. */
  step: string | null;
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

/** Readings of a meter from the grid operator's hub or a data hub. */
export interface MeterDataProvider {
  readonly source_code: string;
  readings(meter: { identifier: string; scheme: string }, from: string, to: string, options?: { step?: string }): Promise<CollectedSeries[]>;
}

/** A place a register or a map knows: becomes a site or a building, with its identifiers and attributes. */
export interface PlaceRecord {
  name: string;
  lon: number;
  lat: number;
  /** ISO 3166-1 alpha-2. */
  country: string;
  external_id: { scheme: string; value: string };
  address?: Partial<Address>;
  /** Typed values the register holds (an activity code, an annual consumption), keyed by `property_defs` code. */
  attributes?: Record<string, string | number | boolean>;
}

/** Places around a point: a company register, a building dataset, a map. */
export interface PlacesProvider {
  readonly source_code: string;
  nearby(where: Point, radiusM: number, options?: { country?: string; limit?: number }): Promise<PlaceRecord[]>;
  get?(externalId: string): Promise<PlaceRecord | null>;
}

export interface SeriesTarget {
  organisationId: string;
  /** The object the series is about: a site, a meter, a building, a zone. */
  objectId: string;
  sourceCode: string;
  kind: 'measured' | 'simulated' | 'forecast' | 'setpoint';
  scenarioId?: string | null;
  /**
   * Tells apart two series of the same object, quantity, kind and source:
   * a typical year next to the real years it was made from. Unnamed by
   * default.
   */
  name?: string | null;
}

/**
 * Writes what a connector brought back: finds or creates the series of that
 * object, quantity, kind, source, scenario and name, then inserts the values — into
 * `forecast_values` with their issue time for a forecast, into
 * `series_values` otherwise, where a value already present is replaced.
 */
export async function storeSeries(
  db: Db,
  target: SeriesTarget,
  series: CollectedSeries,
  options: { issuedAt?: string } = {},
): Promise<{ seriesId: string; inserted: number }> {
  if (target.kind === 'forecast' && !options.issuedAt) {
    throw new Error('issued_at_required: a forecast is stored with the time it was issued');
  }
  const found = await db.query<{ id: string }>(
    `select id from series
      where object_id = $1 and quantity_code = $2 and kind = $3 and source_code = $4
        and scenario_id is not distinct from $5 and name is not distinct from $6
      limit 1`,
    [target.objectId, series.quantity_code, target.kind, target.sourceCode, target.scenarioId ?? null, target.name ?? null],
  );
  let seriesId = found.rows[0]?.id;
  if (!seriesId) {
    const created = await db.query<{ id: string }>(
      `insert into series (organisation_id, object_id, quantity_code, kind, value_kind, step, source_code, scenario_id, name)
       values ($1, $2, $3, $4, $5, $6::interval, $7, $8, $9) returning id`,
      [target.organisationId, target.objectId, series.quantity_code, target.kind, series.value_kind, series.step, target.sourceCode, target.scenarioId ?? null, target.name ?? null],
    );
    seriesId = created.rows[0].id;
  }
  if (series.values.length === 0) return { seriesId, inserted: 0 };

  const ats = series.values.map((v) => v.at);
  const values = series.values.map((v) => v.value);
  if (target.kind === 'forecast') {
    const r = await db.query(
      `insert into forecast_values (series_id, at, issued_at, value)
       select $1, unnest($2::timestamptz[]), $3, unnest($4::float8[])
       on conflict do nothing`,
      [seriesId, ats, options.issuedAt, values],
    );
    return { seriesId, inserted: (r as { affectedRows?: number }).affectedRows ?? series.values.length };
  }
  await db.query(
    `insert into series_values (series_id, at, value)
     select $1, unnest($2::timestamptz[]), unnest($3::float8[])
     on conflict (series_id, at) do update set value = excluded.value, quality = 0`,
    [seriesId, ats, values],
  );
  return { seriesId, inserted: series.values.length };
}

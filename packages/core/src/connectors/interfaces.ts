// Connectors: how an installation reads the outside world.
//
// A source (a vocabulary row) says what exists: a weather model, a grid
// operator's hub, a company register, a map provider. A connector is the
// code that reads it, and a `connectors` row of the core is that code
// configured for one organisation. A client of an external API is a
// library that implements one of the interfaces below and
// answers in the core's terms — quantities, value kinds, steps, external
// identifiers — so that what it brings back lands on ordinary objects,
// attributes, documents and series with its source on it (decision 0011).
//
// The interfaces are open and live here; implementations are open when
// their data is (Open-Meteo, OpenStreetMap, a public register) and private
// when it is not (a commercial map provider, a licensed register, a company's
// own data service). A private package implements the same interface and
// registers its `sources` rows; the core and the pages never import it.

import type { Db } from '../db.js';
import type { Address } from '../address.js';
import { store, type SeriesPoint } from '../series.js';


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

/** A place a register or a map knows: becomes a participant or a building, with its identifiers and attributes. */
export interface PlaceRecord {
  name: string;
  lon: number;
  lat: number;
  /** ISO 3166-1 alpha-2. */
  country: string;
  external_id: { scheme: string; value: string };
  address?: Partial<Address>;
  /** Typed values the register holds (an activity code, an annual consumption), keyed by `attribute_types` code. */
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
  /** The object the series is about, by its kind and its id: a participant, a meter, a device, a project, an organisation. */
  objectKind: string;
  objectId: string;
  sourceCode: string;
  kind: 'measured' | 'simulated' | 'forecast' | 'setpoint';
  /**
   * Tells apart two series of the same object, quantity, kind and source:
   * a typical year next to the real years it was made from. Unnamed by
   * default.
   */
  name?: string | null;
}

/**
 * Writes what a connector brought back through `store()`, the one write
 * path: the series of that object, quantity, kind, source and name, found or created once (a different value kind or step is refused
 * by name), the values converted from `series.unit`, with their quality,
 * a forecast with its issue time. A value already present is replaced; an
 * equal one is left as it is, and `inserted` counts the rows that changed.
 */
export async function storeSeries(
  db: Db,
  target: SeriesTarget,
  series: CollectedSeries,
  options: { issuedAt?: string } = {},
): Promise<{ seriesId: string; inserted: number }> {
  const stored = await store(db, {
    object_kind: target.objectKind, object_id: target.objectId, quantity_code: series.quantity_code, kind: target.kind, value_kind: series.value_kind,
    step: series.step, source_code: target.sourceCode, name: target.name ?? null,
  }, series.values, { unit: series.unit ?? null, issuedAt: options.issuedAt ?? null });
  return { seriesId: stored.seriesId, inserted: stored.changed };
}

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
import { store } from '../series.js';


// What a connector speaks lives in `@nexgen-os/connector`, MIT, so
// that a connector runs without the core (decision 0064); the core
// re-exports it, one definition for both.
export {
  azimuthFromSouth,
  type CollectedSeries, type MeterDataProvider, type MeterOfHub, type MeterReadingOptions, type Point, type SourceRow, type WeatherProvider,
} from '@nexgen-os/connector';
import type { Address, CollectedSeries, Point, SourceRow } from '@nexgen-os/connector';

/** A place a register or a map knows: becomes a participant or a building, with its identifiers and attributes. */
export interface PlaceRecord {
  name: string;
  lon: number;
  lat: number;
  /** ISO 3166-1 alpha-2. */
  country: string;
  identifier: { scheme: string; value: string };
  address?: Partial<Address>;
  /** Typed values the register holds (an activity code, an annual consumption), keyed by `attribute_types` code. */
  attributes?: Record<string, string | number | boolean>;
}

/** Places around a point: a company register, a building dataset, a map. */
export interface PlacesProvider {
  readonly source_code: string;
  nearby(where: Point, radiusM: number, options?: { country?: string; limit?: number }): Promise<PlaceRecord[]>;
  get?(identifier: string): Promise<PlaceRecord | null>;
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
    step: series.step, source_code: target.sourceCode, name: series.name ?? target.name ?? null,
  }, series.values, { unit: series.unit ?? null, issuedAt: options.issuedAt ?? null });
  return { seriesId: stored.seriesId, inserted: stored.changed };
}

/**
 * Writes the `sources` row a connector package ships, once: inserted, or
 * updated where that package published it; a row another publisher owns is
 * left as it is.
 */
export async function registerSource(db: Db, row: SourceRow): Promise<void> {
  await db.query(
    `insert into sources (code, name, description, kind, base_url, docs_url, auth, countries, regions, license, attribution,
                          retention_days, redistributable, published_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (code) do update set
       name = excluded.name, description = excluded.description, kind = excluded.kind, base_url = excluded.base_url,
       docs_url = excluded.docs_url, auth = excluded.auth, countries = excluded.countries, regions = excluded.regions,
       license = excluded.license, attribution = excluded.attribution, retention_days = excluded.retention_days,
       redistributable = excluded.redistributable
     where sources.published_by = excluded.published_by`,
    [row.code, row.name, row.description ?? null, row.kind ?? 'api', row.base_url ?? null, row.docs_url ?? null, row.auth ?? 'none',
      row.countries ?? [], row.regions ?? [], row.license ?? null, row.attribution ?? null, row.retention_days ?? null,
      row.redistributable ?? true, row.published_by],
  );
}

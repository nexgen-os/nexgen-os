// Series: the SQL functions of the core, typed for TypeScript.
//
// One way to write (`store()`), one family of reads (`resample()`,
// `aggregate()`, `window()`, `latest()`, `fill()`, `coverage()`, `forecastAt()`,
// `exportRows()`), each a thin call of the function of the same name in
// schema `nexgen` (decision 0031). Nothing here computes a bucket, converts
// a unit or fills a gap: the database does, so that a page, a module, the
// Python client and an agent read the same figures. Instants come back as
// ISO 8601 strings in UTC; a page localises them, with the `Temporal` API
// or its polyfill, never by resampling again.

import type { Db } from './db.js';

/** One value at one instant, ISO 8601 with its offset, with its quality code (0 measured when absent; 3 missing). */
export interface SeriesPoint {
  at: string;
  value: number;
  quality?: number;
}

/** What names a series when it may not exist yet: the keys of `series_ensure()`. */
export interface SeriesIdentity {
  /** The kind of the object observed: `organisation`, `project`, `participant`, `meter`, `device` or `series`. */
  object_kind: string;
  object_id: string;
  quantity_code: string;
  kind?: 'measured' | 'simulated' | 'forecast' | 'setpoint' | 'command';
  value_kind?: 'interval' | 'instant' | 'cumulative';
  /** A Postgres interval (`15 minutes`, `1 hour`), null when irregular. */
  step?: string | null;
  source_code?: string | null;
  name?: string | null;
  /** A free note of where the values come from; a calculation of a module names itself here, `<module>.<table>:<id>`. */
  source?: string | null;
  device_id?: string | null;
  external_ref?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Bucket {
  bucket: string;
  value: number | null;
  samples: number;
  /** The count of values a regular series should have in the bucket; null for an irregular one. */
  expected: number | null;
  quality: number | null;
}

/** One bucket of several series added up (`aggregate()`): `series` is how many of them held a value in it. */
export interface AggregateBucket extends Bucket {
  series: number;
}

export interface Reading {
  at: string;
  value: number;
  quality: number;
}

export interface Gap {
  gap_from: string;
  gap_to: string;
  missing: number;
}

export interface ForecastValue {
  at: string;
  value: number;
  issued_at: string;
}

export interface ExportRow extends Reading {
  series_id: string;
}

const iso = (t: string | Date) => new Date(t).toISOString();

/** The series of an identity, created once. Refuses by name a different value kind or step. */
export async function seriesEnsure(db: Db, identity: SeriesIdentity): Promise<string> {
  const r = await db.query<{ id: string }>(
    `select series_ensure($1, $2, $3, $4, $5, $6::interval, $7, $8, $9, $10, $11::jsonb, $12) id`,
    [identity.object_kind, identity.object_id, identity.quantity_code, identity.kind ?? 'measured', identity.value_kind ?? 'interval', identity.step ?? null,
     identity.device_id ?? null, identity.external_ref ?? null, identity.source_code ?? null, identity.name ?? null,
     JSON.stringify(identity.metadata ?? {}), identity.source ?? null],
  );
  return r.rows[0].id;
}

/**
 * Writes values through `store()`: the series by id or by identity, the
 * values in `unit` (the quantity's when absent), a forecast with the time
 * it was issued. Returns the series and the rows that changed.
 */
export async function store(
  db: Db,
  series: string | SeriesIdentity,
  values: SeriesPoint[],
  options: { unit?: string | null; issuedAt?: string | null } = {},
): Promise<{ seriesId: string; changed: number }> {
  const withQuality = values.some((v) => v.quality !== undefined);
  const r = await db.query<{ series_id: string; changed: number }>(
    `select series_id, changed from store($1::uuid, $2::timestamptz[], $3::float8[], $4::smallint[], $5, $6::timestamptz, $7::jsonb)`,
    [typeof series === 'string' ? series : null, values.map((v) => v.at), values.map((v) => v.value),
     withQuality ? values.map((v) => v.quality ?? 0) : null, options.unit ?? null, options.issuedAt ?? null,
     typeof series === 'string' ? null : JSON.stringify(series)],
  );
  return { seriesId: r.rows[0].series_id, changed: r.rows[0].changed };
}

/** The amount of each bucket of a regular step (`resample()`): a cumulative register gives its consumption per bucket. */
export async function resample(
  db: Db,
  seriesId: string,
  from: string,
  to: string,
  step: string,
  options: { timeZone?: string | null; issuedBefore?: string | null } = {},
): Promise<Bucket[]> {
  const r = await db.query<Omit<Bucket, 'bucket'> & { bucket: string | Date }>(
    `select bucket, value, samples, expected, quality from resample($1, $2::timestamptz, $3::timestamptz, $4::interval, $5, $6::timestamptz)`,
    [seriesId, from, to, step, options.timeZone ?? null, options.issuedBefore ?? null],
  );
  return r.rows.map((b) => ({ ...b, bucket: iso(b.bucket) }));
}

/** Several series of one summable quantity added up on a regular step (`aggregate()`), each read as `resample()` reads it. */
export async function aggregate(
  db: Db,
  seriesIds: string[],
  from: string,
  to: string,
  step: string,
  options: { timeZone?: string | null } = {},
): Promise<AggregateBucket[]> {
  const r = await db.query<Omit<AggregateBucket, 'bucket'> & { bucket: string | Date }>(
    `select bucket, value, series, samples, expected, quality from aggregate($1::uuid[], $2::timestamptz, $3::timestamptz, $4::interval, $5)`,
    [seriesIds, from, to, step, options.timeZone ?? null],
  );
  return r.rows.map((b) => ({ ...b, bucket: iso(b.bucket) }));
}

/** The stored values themselves, in time order (`window()`): how a register's index is read. */
export async function window(db: Db, seriesId: string, from: string, to: string, limit = 100_000): Promise<Reading[]> {
  const r = await db.query<Omit<Reading, 'at'> & { at: string | Date }>(
    `select at, value, quality from nexgen.window($1, $2::timestamptz, $3::timestamptz, $4)`, [seriesId, from, to, limit]);
  return r.rows.map((v) => ({ ...v, at: iso(v.at) }));
}

/** The latest value that is not missing of each series (`latest()`). */
export async function latest(db: Db, seriesIds: string[]): Promise<ExportRow[]> {
  const r = await db.query<Omit<ExportRow, 'at'> & { at: string | Date }>(
    `select series_id, at, value, quality from latest($1::uuid[])`, [seriesIds]);
  return r.rows.map((v) => ({ ...v, at: iso(v.at) }));
}

/** Every bucket of the period, empty ones filled on the fly and flagged estimated (`fill()`); nothing is written. */
export async function fill(
  db: Db,
  seriesId: string,
  from: string,
  to: string,
  step: string,
  method: 'none' | 'zero' | 'previous' | 'linear' = 'linear',
  options: { timeZone?: string | null } = {},
): Promise<Bucket[]> {
  const r = await db.query<Omit<Bucket, 'bucket'> & { bucket: string | Date }>(
    `select bucket, value, samples, expected, quality from fill($1, $2::timestamptz, $3::timestamptz, $4::interval, $5, $6)`,
    [seriesId, from, to, step, method, options.timeZone ?? null],
  );
  return r.rows.map((b) => ({ ...b, bucket: iso(b.bucket) }));
}

/** The gaps of a regular series (`coverage()`). */
export async function coverage(db: Db, seriesId: string, from: string, to: string): Promise<Gap[]> {
  const r = await db.query<{ gap_from: string | Date; gap_to: string | Date; missing: number }>(
    `select gap_from, gap_to, missing from coverage($1, $2::timestamptz, $3::timestamptz)`, [seriesId, from, to]);
  return r.rows.map((g) => ({ gap_from: iso(g.gap_from), gap_to: iso(g.gap_to), missing: g.missing }));
}

/** A forecast as known at `asOf`, or issued `horizon` before each instant, or its latest issue (`forecast_at()`). */
export async function forecastAt(
  db: Db,
  seriesId: string,
  from: string,
  to: string,
  options: { asOf?: string | null; horizon?: string | null } = {},
): Promise<ForecastValue[]> {
  const r = await db.query<{ at: string | Date; value: number; issued_at: string | Date }>(
    `select at, value, issued_at from forecast_at($1, $2::timestamptz, $3::timestamptz, $4::timestamptz, $5::interval)`,
    [seriesId, from, to, options.asOf ?? null, options.horizon ?? null],
  );
  return r.rows.map((f) => ({ at: iso(f.at), value: f.value, issued_at: iso(f.issued_at) }));
}

/** The rows of the files door, sorted by series and time (`export_rows()`). */
export async function exportRows(db: Db, seriesIds: string[], from: string, to: string): Promise<ExportRow[]> {
  const r = await db.query<Omit<ExportRow, 'at'> & { at: string | Date }>(
    `select series_id, at, value, quality from export_rows($1::uuid[], $2::timestamptz, $3::timestamptz)`, [seriesIds, from, to]);
  return r.rows.map((v) => ({ ...v, at: iso(v.at) }));
}

/** A value converted between two units of the vocabulary, by code or symbol (`convert_unit()`). */
export async function convertUnit(db: Db, value: number, from: string, to: string): Promise<number> {
  const r = await db.query<{ value: number }>(`select convert_unit($1, $2, $3) as value`, [value, from, to]);
  return r.rows[0].value;
}

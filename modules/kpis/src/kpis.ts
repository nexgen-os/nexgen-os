// The gestures of the `kpis` module, typed for TypeScript: each is one call
// of the module's SQL function of the same name, under the caller's row
// level security. The computation is the database's (`kpis.measure()`), so
// that a figure computed from SQL, from the REST API or from here is the
// same figure.

import type { Db } from '@nexgen-os/core';

/** The kinds of object an indicator is computed for. */
export type ObjectKind = 'participant' | 'project' | 'meter' | 'device';

export interface Bucket {
  /** Start of the bucket, ISO 8601. */
  at: string;
  /** Null when a value is missing or a divisor is zero; never zero for nothing. */
  value: number | null;
  /** The value of each variable of the formula in the bucket. */
  variables: Record<string, number | null>;
}

/** What `kpis.measure()` answers, and what a figure keeps. */
export interface Measure {
  indicator: string;
  object_kind: ObjectKind;
  object_id: string;
  from: string;
  to: string;
  granularity: string | null;
  time_zone: string | null;
  quantity_code: string;
  buckets: Bucket[];
  total: { value: number | null; variables: Record<string, number | null> };
  /** The series read for each quantity variable. */
  series: Record<string, string[]>;
  /** How each quantity variable was had: from measured or simulated series, or computed by its `otherwise` formula. */
  read: Record<string, 'measured' | 'simulated' | 'forecast' | 'computed'>;
  /** The price series each weighted variable read (`times`). */
  prices: Record<string, { quantity: string; kind: string; series: string[] }>;
  /** Every answer of parameter_of() for each parameter variable. */
  parameters: Record<string, { value: unknown; level: string; source_code: string | null; reference: string | null }[]>;
}

export interface IndicatorOf {
  indicator_code: string;
  name: string;
  quantity_code: string;
  unit: string;
  display_unit: string | null;
  granularity: string | null;
  period_from: string;
  period_to: string;
  value: number | null;
  target: number | null;
  met: boolean | null;
  figure_id: string;
  series_id: string | null;
}

export interface PortfolioRow {
  /** The currency of an amount of money; null for any other quantity. */
  currency: string | null;
  projects: number;
  value: number | null;
  variables: Record<string, number | null>;
  /** The projects that could not be measured, with the refusal each met. */
  skipped: { project_id: string; refusal: string }[];
}

export interface ReportRow {
  sheet: string;
  section: string;
  position: number;
  indicator_code: string;
  name: string;
  unit: string;
  display_unit: string | null;
  value: number | null;
  target: number | null;
  met: boolean | null;
  status: 'computed' | 'not_computed';
  figure_id: string | null;
}

export interface Period {
  /** Start, included, ISO 8601. */
  from: string;
  /** End, excluded. */
  to: string;
  /** `1 month`, `1 day`, `1 hour`…; absent for one figure over the period. */
  granularity?: string | null;
}

/** An indicator of an object over a period, computed and written nowhere (`kpis.measure()`). */
export async function measure(db: Db, kind: ObjectKind, id: string, indicator: string, period: Period): Promise<Measure> {
  const r = await db.query<{ m: Measure }>(
    'select kpis.measure($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::interval) m',
    [kind, id, indicator, period.from, period.to, period.granularity ?? null],
  );
  return r.rows[0].m;
}

/**
 * Computes an indicator of an object over a period and keeps it as a figure
 * whose buckets are a simulated series of the object (`kpis.compute()`);
 * the same computation again replaces it. Returns the figure's id.
 */
export async function compute(db: Db, kind: ObjectKind, id: string, indicator: string, period: Period): Promise<string> {
  const r = await db.query<{ id: string }>(
    'select kpis.compute($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::interval) id',
    [kind, id, indicator, period.from, period.to, period.granularity ?? null],
  );
  return r.rows[0].id;
}

/** The latest figure of each indicator and granularity of an object within a period, against its target (`kpis.of()`). */
export async function indicatorsOf(db: Db, kind: ObjectKind, id: string, from: string, to: string): Promise<IndicatorOf[]> {
  const r = await db.query<IndicatorOf>(
    `select indicator_code, name, quantity_code, unit, display_unit, granularity::text, period_from::text, period_to::text,
            value, target, met, figure_id, series_id
       from kpis.of($1, $2, $3::timestamptz, $4::timestamptz) order by indicator_code, granularity`,
    [kind, id, from, to],
  );
  return r.rows;
}

/** An indicator over the projects the caller may read (`kpis.portfolio()`). */
export async function portfolio(db: Db, indicator: string, from: string, to: string): Promise<PortfolioRow[]> {
  const r = await db.query<PortfolioRow>(
    'select currency, projects, value, variables, skipped from kpis.portfolio($1, $2::timestamptz, $3::timestamptz)',
    [indicator, from, to],
  );
  return r.rows;
}

/** The rows of an export template from the figures already computed (`kpis.report()`). */
export async function report(db: Db, template: string, kind: ObjectKind, id: string, from: string, to: string): Promise<ReportRow[]> {
  const r = await db.query<ReportRow>(
    `select sheet, section, "position" as position, indicator_code, name, unit, display_unit, value, target, met, status, figure_id
       from kpis.report($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
    [template, kind, id, from, to],
  );
  return r.rows;
}

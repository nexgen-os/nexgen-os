// One PV system, several ways of computing its yield, and the gap between
// them month by month: the case a solar developer checks before trusting a
// figure. Each method is a yield estimate of the `solar` module, recorded
// with what it was computed from; the comparison only reads them back.
//
//   export NEXGEN_DB_URL=…   # the connection string, never written to a file
//   npx tsx docs/demo/compared.ts <pv system id> [year] [--engine pvlib] [--reference report.json]
//
// - `pvgis_like`: PVGIS computes (its satellite irradiance, its horizon, one
//   aggregate loss).
// - `pvwatts`: the module computes, on the ERA5 reanalysis, the real year
//   as it was (no typical year, no anchoring), so that both read the same
//   calendar year.
// - with `--engine pvlib`, the `pvwatts` profile computed by pvlib, the
//   same models in another program.
// - with `--reference`, the monthly energies of another tool's report
//   (PVsyst, PV*SOL…) read from a file, `{ "name", "source", "monthly_kwh": [12 numbers] }`;
//   the gaps are then taken against it. A report's figures are copied, never
//   estimated here.
//
// The year is the participant's local calendar year; every gap is
// (method − reference) / reference.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { connect, type Db } from '@nexgen-os/core';
import { estimateYield, type YieldClients, type YieldRequest } from '../../modules/solar/src/yield.js';

/** A way of computing the yield: a profile of `solar.yield_profiles`, and the engine that computes it when it is not the module. */
export interface YieldMethod {
  name: string;
  profileCode: string;
  engine?: YieldRequest['engine'];
}

/** The monthly energies of another tool's report, as the report prints them. */
export interface ReferenceReport {
  name: string;
  /** Where the figures come from: the report, its date, its version. */
  source: string;
  monthly_kwh: number[];
}

export interface ComparedYield {
  name: string;
  /** The estimate in `solar.estimates`; null for a reference report. */
  estimateId: string | null;
  annualKwh: number;
  kwhPerKwp: number;
  /** Twelve energies, January to December, kWh. */
  monthlyKwh: number[];
}

export interface Comparison {
  year: number;
  kwp: number;
  timeZone: string;
  /** The method the gaps are taken against: the report when one is given, else the first method. */
  reference: string;
  yields: ComparedYield[];
  /** Per method other than the reference: the gap of each month and of the year, as a fraction. */
  gaps: { name: string; monthly: (number | null)[]; annual: number }[];
}

export interface CompareOptions {
  /** Default: PVGIS, then the module's PVWatts. */
  methods?: YieldMethod[];
  reference?: ReferenceReport;
  /** `pvwatts`: temperature coefficient of power, 1/°C, for the arrays whose module product does not give one. */
  gammaPdc?: number;
  clients?: YieldClients;
}

export const DEFAULT_METHODS: YieldMethod[] = [
  { name: 'PVGIS', profileCode: 'pvgis_like' },
  { name: 'PVWatts', profileCode: 'pvwatts' },
];

/** Estimates the yield of `deviceId` for `year` by each method, and the gaps between them by month and by year. */
export async function compareYields(db: Db, deviceId: string, year: number, options: CompareOptions = {}): Promise<Comparison> {
  const methods = options.methods ?? DEFAULT_METHODS;
  if (methods.length === 0) throw new Error('methods_required: a comparison names at least one method');
  if (options.reference) checkedReport(options.reference);
  const { rows: [place] } = await db.query<{ time_zone: string | null }>(
    `select p.time_zone from devices d join participants p on p.id = d.participant_id where d.id = $1`, [deviceId]);
  if (!place) throw new Error(`device_not_found: ${deviceId}`);
  if (!place.time_zone) throw new Error('time_zone_required: the participant of the PV system has no time zone; its months cannot be cut');
  const timeZone = place.time_zone;

  const yields: ComparedYield[] = [];
  let kwp = 0;
  for (const method of methods) {
    const result = await estimateYield(db, {
      deviceId,
      years: { from: year, to: year },
      profileCode: method.profileCode,
      engine: method.engine,
      typicalYear: false,
      gammaPdc: options.gammaPdc,
    }, options.clients);
    kwp = result.kwp;
    const monthlyKwh = await monthsOf(db, result.seriesId, year, timeZone);
    const annualKwh = round(monthlyKwh.reduce((s, v) => s + v, 0), 1);
    yields.push({ name: method.name, estimateId: result.estimateId, annualKwh, kwhPerKwp: round(annualKwh / kwp, 1), monthlyKwh });
  }
  if (options.reference) {
    const monthlyKwh = options.reference.monthly_kwh;
    const annualKwh = round(monthlyKwh.reduce((s, v) => s + v, 0), 1);
    yields.unshift({ name: options.reference.name, estimateId: null, annualKwh, kwhPerKwp: round(annualKwh / kwp, 1), monthlyKwh });
  }

  const [reference, ...others] = yields;
  const gaps = others.map((y) => ({
    name: y.name,
    monthly: y.monthlyKwh.map((kwh, m) => (reference.monthlyKwh[m] > 0 ? round(kwh / reference.monthlyKwh[m] - 1, 4) : null)),
    annual: round(y.annualKwh / reference.annualKwh - 1, 4),
  }));
  return { year, kwp, timeZone, reference: reference.name, yields, gaps };
}

/** The twelve monthly energies of a series over the participant's local year, read through `resample()`. */
async function monthsOf(db: Db, seriesId: string, year: number, timeZone: string): Promise<number[]> {
  const { rows } = await db.query<{ month: number; kwh: number }>(
    `select extract(month from bucket at time zone $4)::int as month, value::float8 as kwh
       from resample($1, ($2::timestamp at time zone $4), ($3::timestamp at time zone $4), '1 month', $4)`,
    [seriesId, `${year}-01-01 00:00`, `${year + 1}-01-01 00:00`, timeZone],
  );
  const months = new Array<number>(12).fill(0);
  for (const r of rows) months[r.month - 1] = round(r.kwh, 1);
  return months;
}

function checkedReport(report: ReferenceReport): void {
  if (!report.name || !report.source) throw new Error('reference_unsourced: a reference report names itself and its source');
  if (!Array.isArray(report.monthly_kwh) || report.monthly_kwh.length !== 12 || !report.monthly_kwh.every((v) => Number.isFinite(v) && v >= 0)) {
    throw new Error('reference_months_required: a reference report gives twelve monthly energies, January to December, in kWh');
  }
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** The comparison as a Markdown table, kWh by month, and the gaps in percent. */
export function comparisonTable(c: Comparison): string {
  const pct = (g: number | null) => (g === null ? '' : `${g >= 0 ? '+' : ''}${(g * 100).toFixed(1)} %`);
  const head = ['Month', ...c.yields.map((y) => `${y.name} (kWh)`), ...c.gaps.map((g) => `${g.name} vs ${c.reference}`)];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---:').join('|')}|`];
  for (let m = 0; m < 12; m++) {
    lines.push(`| ${m + 1} | ${c.yields.map((y) => y.monthlyKwh[m].toFixed(1)).join(' | ')} | ${c.gaps.map((g) => pct(g.monthly[m])).join(' | ')} |`);
  }
  lines.push(`| Year | ${c.yields.map((y) => `**${y.annualKwh.toFixed(1)}**`).join(' | ')} | ${c.gaps.map((g) => `**${pct(g.annual)}**`).join(' | ')} |`);
  lines.push(`| kWh/kWp | ${c.yields.map((y) => y.kwhPerKwp.toFixed(1)).join(' | ')} | ${c.gaps.map(() => '').join(' | ')} |`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const engine = flag('--engine');
  const referenceFile = flag('--reference');
  const [deviceId, yearArg] = args;
  const url = process.env.NEXGEN_DB_URL;
  if (!deviceId || !url) {
    console.error('usage: NEXGEN_DB_URL=… npx tsx docs/demo/compared.ts <pv system id> [year] [--engine pvlib] [--reference report.json]');
    process.exit(2);
  }
  const year = yearArg ? Number(yearArg) : new Date().getUTCFullYear() - 3;
  const methods = engine ? [...DEFAULT_METHODS, { name: `PVWatts by ${engine}`, profileCode: 'pvwatts', engine: { name: engine } }] : DEFAULT_METHODS;
  const reference = referenceFile ? (JSON.parse(await readFile(referenceFile, 'utf8')) as ReferenceReport) : undefined;
  const client = await connect(url);
  try {
    await client.exec('set search_path = nexgen, extensions');
    const db: Db = { query: async <T>(sql: string, params?: unknown[]) => ({ rows: await client.query<T>(sql, params) }) };
    const comparison = await compareYields(db, deviceId, year, { methods, reference });
    console.log(`${comparison.kwp} kWp, ${year} in ${comparison.timeZone}, gaps against ${comparison.reference}\n`);
    console.log(comparisonTable(comparison));
  } finally {
    await client.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

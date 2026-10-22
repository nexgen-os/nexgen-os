// From a PV system to its yield, on your own database: a `pvgis_like` yield
// estimate for one calendar year, recorded as an estimate, then read back month by
// month through `resample()`, the one way to read a series.
//
//   export NEXGEN_DB_URL=…   # the connection string, never written to a file
//   npx tsx examples/yield.ts <pv system id> [year]
//
// The system is a row of `solar.pv_systems`, with its arrays, each with its
// own azimuth and tilt. PVGIS computes the
// energy (no key, an Internet connection); the year is a whole calendar
// year PVGIS covers, the last full one but two by default.

import { pathToFileURL } from 'node:url';
import type { Db } from '@nexgen-os/core';
import { estimateYield, type YieldClients, type YieldResult } from '../modules/solar/src/yield.js';
import { connect } from '../packages/cli/src/sql.js';

export interface MonthOfYield {
  /** `YYYY-MM`, a month in UTC, as PVGIS's year is. */
  month: string;
  kwh: number;
}

/** Estimates the yield of `pvSystemId` for `year` and reads its series back by month. */
export async function yieldOfSystem(
  db: Db,
  pvSystemId: string,
  year: number,
  clients?: YieldClients,
): Promise<{ result: YieldResult; months: MonthOfYield[] }> {
  const result = await estimateYield(db, { pvSystemId, years: { from: year, to: year } }, clients);
  const { rows } = await db.query<{ month: string; kwh: number }>(
    `select to_char(bucket at time zone 'UTC', 'YYYY-MM') as month, round(value::numeric, 1)::float8 as kwh
       from resample($1, $2::timestamptz, $3::timestamptz, '1 month', 'UTC')
      order by bucket`,
    [result.seriesId, `${year}-01-01T00:00:00Z`, `${year + 1}-01-01T00:00:00Z`],
  );
  return { result, months: rows };
}

async function main(): Promise<void> {
  const [pvSystemId, yearArg] = process.argv.slice(2);
  const url = process.env.NEXGEN_DB_URL;
  if (!pvSystemId || !url) {
    console.error('usage: NEXGEN_DB_URL=… npx tsx examples/yield.ts <pv system id> [year]');
    process.exit(2);
  }
  const year = yearArg ? Number(yearArg) : new Date().getUTCFullYear() - 3;
  const client = await connect(url);
  try {
    await client.exec('set search_path = nexgen, public, extensions');
    const db: Db = { query: async <T>(sql: string, params?: unknown[]) => ({ rows: await client.query<T>(sql, params) }) };
    const { result, months } = await yieldOfSystem(db, pvSystemId, year);
    console.log(`estimate ${result.estimateId}: ${Math.round(result.annualKwh)} kWh in ${year}, ${Math.round(result.kwhPerKwp)} kWh/kWp on ${result.kwp} kWp (${result.radiationDb})`);
    for (const { month, kwh } of months) console.log(`  ${month}  ${kwh} kWh`);
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

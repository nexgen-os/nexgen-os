/**
 * `nexgen-os try`: Nexgen OS without a database or an account. The core and
 * the `solar` module are installed in a Postgres in memory (PGlite, with
 * PostGIS), by the same engine as `init`; the house of example 01 is loaded
 * with its PV system described as the README's step 6 does; its yield for
 * one calendar year is computed by the `solar` module as an estimate, and
 * read back month by month through `resample()`, with what the estimate
 * says it was computed from. Nothing is kept: the database ends with the
 * command.
 *
 * PGlite is loaded only by this command, so that the commands handed a
 * connection string never load it.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { compute, resample, type Computations, type Db, type SqlClient } from '@nexgen-os/core';
import { install } from './apply.js';
import { defaultRoot } from './catalogue.js';
import { NexgenError } from './errors.js';

/** The package's folder: `packages/cli` in a checkout, the installed package once published. */
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The dataset `try` loads: example 01, a house in Seville, with the core only. */
export const DEMO_DATASET = 'docs/demo/01-house-pv-battery.sql';

/** The PV system of example 01 and its one array, as the README describes them (step 6). */
export const DEMO_PV_SYSTEM = [
  `insert into solar.devices (id, kwp_dc, grid_connection) values ('00000000-0000-4000-8000-000100000051', 3.825, 'self_consumption');`,
  `insert into solar.pv_arrays (organisation_id, device_id, name, azimuth_deg, tilt_deg, mounting, kwp_dc) values ('00000000-0000-4000-8000-000100000001', '00000000-0000-4000-8000-000100000051', 'South roof', 180, 30, 'roof_parallel', 3.825);`,
];
export const DEMO_DEVICE_ID = '00000000-0000-4000-8000-000100000051';

/** The roles a Supabase project grants its `extensions` schema to. */
const SUPABASE_ROLES = 'anon, authenticated, service_role';

/** A PGlite seen as the installer sees a database. Closing it is the caller's business. */
export function memorySqlClient(db: PGlite): SqlClient {
  return {
    async exec(sql) {
      await db.exec(sql);
    },
    async query<T>(sql: string, params: unknown[] = []) {
      return (await db.query<T>(sql, params)).rows;
    },
    async close() {},
  };
}

/**
 * An empty Postgres in memory as a Supabase project is before `nexgen-os
 * init`: the `auth` schema Supabase provides and, unless told otherwise,
 * PostGIS enabled in `extensions`.
 */
export async function emptyMemoryDatabase(options: { postgis?: boolean } = {}): Promise<PGlite> {
  let modules: [typeof import('@electric-sql/pglite'), typeof import('@electric-sql/pglite-postgis')];
  try {
    modules = await Promise.all([import('@electric-sql/pglite'), import('@electric-sql/pglite-postgis')]);
  } catch {
    throw new NexgenError('pglite_required', 'a database in memory needs PGlite; run npm install @electric-sql/pglite @electric-sql/pglite-postgis');
  }
  const [{ PGlite }, { postgis }] = modules;
  const db = await PGlite.create({ extensions: { postgis } });
  await db.exec(await readFile(join(pkg, 'sql', 'supabase-shim.sql'), 'utf8'));
  if (options.postgis ?? true) {
    await db.exec(`create schema if not exists extensions; grant usage on schema extensions to ${SUPABASE_ROLES};
      create extension if not exists postgis with schema extensions`);
  }
  return db;
}

export interface MonthOfYield {
  /** `YYYY-MM`, a month in UTC, as PVGIS's year is. */
  month: string;
  kwh: number;
}

export interface TryReport {
  participant: { name: string; city: string; country: string };
  system: { deviceId: string; kwp: number; arrays: { name: string; azimuthDeg: number; tiltDeg: number }[] };
  year: number;
  estimateId: string;
  annualKwh: number;
  kwhPerKwp: number;
  months: MonthOfYield[];
  /** What the estimate says it was computed from: the program and its version, the weather it read. */
  provenance: string;
  weather: unknown;
}

export interface TryOptions {
  /** The computations of the modules: the yield is the `solar` module's code (`modules/computations.ts`). */
  computations: Computations | undefined;
  /** A whole calendar year PVGIS covers; default the last full one but two. */
  year?: number;
  /** Where the migrations and the dataset are; default the package's assets, or the checkout. */
  root?: string;
}

/** The last full calendar year but two: one PVGIS's radiation databases cover. */
export const defaultYear = (now = new Date()): number => now.getUTCFullYear() - 3;

/** Installs Nexgen OS in memory, loads the house of example 01 and estimates its yield for a year. */
export async function tryInMemory(options: TryOptions): Promise<TryReport> {
  const year = options.year ?? defaultYear();
  if (!Number.isInteger(year) || year < 2005) throw new NexgenError('usage', '--year takes a calendar year PVGIS covers, such as 2023');
  const root = options.root ?? defaultRoot();
  const pg = await emptyMemoryDatabase();
  try {
    await install(memorySqlClient(pg), { root, modules: ['solar'], packs: [] });
    await pg.exec('set search_path = nexgen, extensions');
    await pg.exec(await readFile(join(root, DEMO_DATASET), 'utf8'));
    await pg.exec(DEMO_PV_SYSTEM.join('\n'));
    const db: Db = { query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<T>(sql, params)).rows }) };

    const result = (await compute(db, options.computations ?? {}, 'solar.yield', {
      deviceId: DEMO_DEVICE_ID,
      years: { from: year, to: year },
    })) as { estimateId: string; seriesId: string; annualKwh: number; kwhPerKwp: number; kwp: number };

    const buckets = await resample(db, result.seriesId, `${year}-01-01T00:00:00Z`, `${year + 1}-01-01T00:00:00Z`, '1 month', { timeZone: 'UTC' });
    const months = buckets
      .filter((b) => b.value !== null)
      .map((b) => ({ month: b.bucket.slice(0, 7), kwh: Math.round(Number(b.value) * 10) / 10 }));
    const [participant] = (await db.query<TryReport['participant']>(
      `select p.name, p.city, p.country from devices d join participants p on p.id = d.participant_id where d.id = $1`, [DEMO_DEVICE_ID])).rows;
    const arrays = (await db.query<{ name: string; azimuthDeg: number; tiltDeg: number }>(
      `select name, azimuth_deg::float8 as "azimuthDeg", tilt_deg::float8 as "tiltDeg" from solar.pv_arrays where device_id = $1 order by name`,
      [DEMO_DEVICE_ID])).rows;
    const [estimate] = (await db.query<{ provenance: string; weather: unknown }>(
      `select provenance, inputs->'weather' as weather from solar.estimates where id = $1`, [result.estimateId])).rows;
    return {
      participant: participant!,
      system: { deviceId: DEMO_DEVICE_ID, kwp: result.kwp, arrays },
      year,
      estimateId: result.estimateId,
      annualKwh: result.annualKwh,
      kwhPerKwp: result.kwhPerKwp,
      months,
      provenance: estimate!.provenance,
      weather: estimate!.weather,
    };
  } finally {
    await pg.close();
  }
}

/** What `try` prints: the house, its system, its year by month, and where the figure comes from. */
export function printTry(out: (line: string) => void, r: TryReport): void {
  out(`Nexgen OS in memory: the core and the solar module, example 01 loaded — nothing is kept`);
  out(`${r.participant.name}, ${r.participant.city} (${r.participant.country}): a PV system of ${r.system.kwp} kWp`);
  for (const a of r.system.arrays) out(`  array ${a.name}: azimuth ${a.azimuthDeg}° from north, tilt ${a.tiltDeg}°`);
  out(`yield ${r.year}, by month (UTC):`);
  const top = Math.max(...r.months.map((m) => m.kwh), 1);
  for (const m of r.months) out(`  ${m.month}  ${m.kwh.toFixed(1).padStart(7)} kWh  ${'█'.repeat(Math.round((m.kwh / top) * 30))}`);
  out(`total   ${Math.round(r.annualKwh)} kWh, ${Math.round(r.kwhPerKwp)} kWh/kWp`);
  out(`estimate ${r.estimateId}, computed by ${r.provenance}`);
  out(`weather  ${JSON.stringify(r.weather)}`);
  out('next: the same on your own database, nexgen-os init (packages/cli/README.md)');
}

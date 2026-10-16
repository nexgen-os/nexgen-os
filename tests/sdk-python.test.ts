// The Python client (sdk/python), when psycopg is installed: a fresh
// installation served over the Postgres protocol, a site with a series and
// another without a time zone, then the client's own tests run against it.
// Without the client and psycopg, the test is skipped and says how to
// install them.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { USER_A, freshDatabase, insert, one, organisation, repoRoot } from './helpers/db.js';

// The caller gives the interpreter: the environment's, else the local virtual environment, else the Python on the path.
const localVenv = join(repoRoot, '.venv-sdk', 'bin', 'python');
const python = process.env.NEXGEN_SDK_PYTHON ?? (existsSync(localVenv) ? localVenv : 'python3');
const INSTALL = 'pip install -e "sdk/python[binary]"';
const installed = spawnSync(python, ['-c', 'import nexgen_os, psycopg'], { encoding: 'utf8' }).status === 0;
const skipped = installed ? '' : ` (skipped: the Python client is not installed; ${INSTALL})`;

let db: PGlite;
let server: PGLiteSocketServer;
let url: string;
const fixture: Record<string, string> = {};

beforeAll(async () => {
  if (!installed) return;
  db = await freshDatabase();
  const org = await organisation(db, 'A utility', USER_A);
  const site = await insert(db, 'sites', { organisation_id: org, name: 'Depot', country: 'BE', time_zone: 'Europe/Brussels' });
  const elsewhere = await insert(db, 'sites', { organisation_id: org, name: 'Warehouse', country: 'BE' });
  const meter = await insert(db, 'meters', { organisation_id: org, site_id: site, identifier: '541400000000000001', scheme: 'gs1_gsrn' });
  const other = await insert(db, 'meters', { organisation_id: org, site_id: elsewhere, identifier: '541400000000000002', scheme: 'gs1_gsrn' });
  const series = (object: string) =>
    insert(db, 'series', { organisation_id: org, object_id: object, quantity_code: 'offtake_energy', kind: 'measured', value_kind: 'interval', step: '15 minutes' });
  const energy = await series(meter);
  const unplaced = await series(other);
  // Two local days in June, 1 kWh per quarter-hour, dated at the start of each interval.
  for (const id of [energy, unplaced]) {
    await db.query(
      `insert into series_values (series_id, at, value)
       select $1, ts, 1 from generate_series('2026-06-01 00:00+02'::timestamptz, '2026-06-02 23:45+02', '15 minutes') ts`,
      [id],
    );
  }
  const { version } = await one<{ version: string }>(db, 'select nexgen_schema_version() as version');
  Object.assign(fixture, {
    organisation: org, site, site_without_time_zone: elsewhere, meter, country: 'BE',
    series: energy, series_without_time_zone: unplaced, schema_version: version,
  });
  server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await server.start();
  url = `postgresql://postgres@${server.getServerConn()}/postgres?sslmode=disable`;
});

afterAll(async () => {
  await server?.stop();
  await db?.close();
});

function unittest(): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(python, ['-m', 'unittest', 'discover', '-v', '-s', 'tests'], {
      cwd: join(repoRoot, 'sdk', 'python'),
      env: { ...process.env, NEXGEN_DB_URL: url, NEXGEN_SDK_FIXTURE: JSON.stringify(fixture), PYTHONPATH: join(repoRoot, 'sdk', 'python') },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (status) => resolve({ status, output }));
  });
}

describe(`the Python client${skipped}`, () => {
  it.skipIf(!installed)('reads, resamples, places and attaches against a real installation, every refusal by its name', async () => {
    const { status, output } = await unittest();
    expect(output, output).not.toMatch(/skipped '/);
    expect(status, output).toBe(0);
    expect(output).toMatch(/Ran 9 tests/);
  }, 60_000);
});

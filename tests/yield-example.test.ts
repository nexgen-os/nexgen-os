// The twenty-minute path of the README, on PGlite: the house of example 01,
// its PV system described in the `solar` module in one line, a yield run
// through `examples/yield.ts` and its series read back by month.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { pvgis } from '../connectors/pvgis/index.js';
import type { Fetch } from '../formats/geocoding/index.js';
import { yieldOfSystem } from '../examples/yield.js';
import { freshDatabase, one, repoRoot } from './helpers/db.js';

const PV_SYSTEM = '00000000-0000-4000-8000-000100000051';
let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase(['architecture', 'weather', 'solar', 'tasks']);
  await db.exec(await readFile(`${repoRoot}/examples/01-house-pv-battery.sql`, 'utf8'));
  const readme = await readFile(`${repoRoot}/README.md`, 'utf8');
  const describeSystem = readme.match(/^\s*(insert into solar\.pv_systems .*;)$/m)?.[1];
  if (!describeSystem) throw new Error('the README no longer describes the PV system of example 01');
  await db.exec(`set search_path = nexgen, public, extensions; ${describeSystem}`);
});

afterAll(async () => {
  await db.close();
});

describe('the yield of example 01, as the README runs it', () => {
  it('runs on the roof face of the device, records the run and reads the year back by month', async () => {
    const recorded = JSON.parse(await readFile(`${repoRoot}/tests/fixtures/pvgis-seriescalc-brussels-2023-48h.json`, 'utf8')) as { outputs: { hourly: { P: number }[] } };
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      return { ok: true, status: 200, json: async () => recorded };
    };
    const { result, months } = await yieldOfSystem(db, PV_SYSTEM, 2023, { pvgis: pvgis({ fetch }) });

    // One array on the south face the device stands on, with the system's power.
    const params = Object.fromEntries(new URL(asked[0] as string).searchParams);
    expect(asked).toHaveLength(1);
    expect([params.peakpower, params.aspect, params.angle]).toEqual(['3.825', '0', '30']);
    const recordedKwh = recorded.outputs.hourly.reduce((s, h) => s + h.P, 0) / 1000;
    expect(result.kwp).toBe(3.825);
    expect(result.annualKwh).toBeCloseTo(recordedKwh, 3); // the recorded answer is served as it is

    // The recorded answer covers two days of January: one month, the whole of it.
    expect(months).toHaveLength(1);
    expect(months[0]?.month).toBe('2023-01');
    expect(months[0]?.kwh).toBeCloseTo(result.annualKwh, 1);

    const run = await one<{ status: string; subject_id: string }>(db, 'select status, subject_id from runs where id = $1', [result.runId]);
    expect(run).toEqual({ status: 'succeeded', subject_id: PV_SYSTEM });
  });
});

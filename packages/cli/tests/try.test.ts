// `nexgen-os try`: Nexgen OS in memory, without a database or an account —
// the house of example 01, its PV system as the README describes it, its
// yield computed by the `solar` module and read back by month, with the
// provenance the estimate records. PVGIS answers from a recorded response.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Computations, Fetch } from '@nexgen-os/core';
import { pvgis } from '@nexgen-os/pvgis';
import { estimateYield } from '../../../modules/solar/src/yield.js';
import { DEMO_PV_SYSTEM, defaultYear, main } from '../src/index.js';
import { repoRoot } from '../../../tests/helpers/db.js';

const recorded = JSON.parse(
  await readFile(join(repoRoot, 'tests', 'fixtures', 'pvgis-seriescalc-brussels-2023-48h.json'), 'utf8'),
) as { outputs: { hourly: { P: number }[] } };

/** The `solar` module's yield, with PVGIS answering from the recording; `asked` keeps the URLs. */
function computations(asked: string[]): Computations {
  const fetch: Fetch = async (url) => {
    asked.push(url);
    return { ok: true, status: 200, json: async () => recorded };
  };
  return { 'solar.yield': ((db, request) => estimateYield(db, request, { pvgis: pvgis({ fetch }) })) as Computations['solar.yield'] };
}

async function run(argv: string[], given?: Computations) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, ...(given ? { computations: given } : {}) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('nexgen-os try', () => {
  it('installs in memory, estimates the yield of the house of example 01 and reads it back by month', async () => {
    const asked: string[] = [];
    const r = await run(['try', '--year', '2023', '--json'], computations(asked));
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);

    // One array facing south at 30°, with the system's power, for the year asked.
    const params = Object.fromEntries(new URL(asked[0] as string).searchParams);
    expect(asked).toHaveLength(1);
    expect([params.peakpower, params.aspect, params.angle, params.startyear, params.endyear]).toEqual(['3.825', '0', '30', '2023', '2023']);

    expect(report.participant).toEqual({ name: 'Calle del Ejemplo 14', city: 'Sevilla', country: 'ES' });
    expect(report.system).toEqual({
      deviceId: '00000000-0000-4000-8000-000100000051', kwp: 3.825,
      arrays: [{ name: 'South roof', azimuthDeg: 180, tiltDeg: 30 }],
    });
    const recordedKwh = recorded.outputs.hourly.reduce((s, h) => s + h.P, 0) / 1000;
    expect(report.year).toBe(2023);
    expect(report.annualKwh).toBeCloseTo(recordedKwh, 3);
    // The recording covers two days of January: one month, the whole of it.
    expect(report.months).toEqual([{ month: '2023-01', kwh: Math.round(recordedKwh * 10) / 10 }]);
    expect(report.provenance).toBe('pvgis-5.3+solar-0.3.0');
    expect(report.weather).not.toBeNull();
  });

  it('prints the year by month and where the figure comes from', async () => {
    const r = await run(['try', '--year', '2023'], computations([]));
    expect(r.code).toBe(0);
    expect(r.out).toContain('Calle del Ejemplo 14, Sevilla (ES): a PV system of 3.825 kWp');
    expect(r.out).toContain('array South roof: azimuth 180° from north, tilt 30°');
    expect(r.out).toMatch(/2023-01 +\d+\.\d kWh +█+/);
    expect(r.out).toContain('computed by pvgis-5.3+solar-0.3.0');
  });

  it('describes the PV system as the README does', async () => {
    const readme = await readFile(join(repoRoot, 'README.md'), 'utf8');
    for (const line of DEMO_PV_SYSTEM) expect(readme).toContain(line);
  });

  it('refuses by name without the code of the solar module, and on a year that is not one', async () => {
    const without = await run(['try', '--year', '2023']);
    expect(without.code).toBe(1);
    expect(without.err).toMatch(/^computation_not_loaded: /);
    const year = await run(['try', '--year', 'last']);
    expect(year.code).toBe(2);
    expect(year.err).toMatch(/^usage: --year/);
  });

  it('defaults to the last full year but two', () => {
    expect(defaultYear(new Date('2026-10-22T23:00:00Z'))).toBe(2023);
  });
});

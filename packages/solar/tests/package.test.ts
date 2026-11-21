// `@nexgen-os/solar` is MIT so that an application embeds its computations
// without taking the AGPL of the core (decision 0063). The licence line alone
// would not do it: an MIT package that imports AGPL code at run time leaves
// its user under the AGPL. These tests hold the boundary — the package's
// code imports nothing but itself, and nothing it depends on, however far,
// is a workspace under the AGPL — and that the `solar` module of an
// installation computes with this package rather than with a copy of it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as solar from '@nexgen-os/solar';
import { exceedanceLevels, normalQuantile, offsetAt } from '@nexgen-os/solar';
import { offsetAt as coreOffsetAt } from '@nexgen-os/core';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
type Manifest = { name: string; license: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
const manifest = JSON.parse(read('packages/solar/package.json')) as Manifest;
const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, Manifest & { link?: boolean; resolved?: string }> };
const sources = readdirSync(new URL('packages/solar/src/', root)).filter((name) => name.endsWith('.ts'));

/** Every package the lockfile says `directory` brings, transitively, with its licence. */
function reached(directory: string): { name: string; at: string; license: string }[] {
  const out: { name: string; at: string; license: string }[] = [];
  const seen = new Set([directory]);
  const queue = [directory];
  while (queue.length) {
    const entry = lock.packages[queue.shift() as string] ?? ({} as Manifest);
    for (const name of Object.keys({ ...entry.dependencies, ...entry.peerDependencies, ...entry.optionalDependencies })) {
      let at = `node_modules/${name}`;
      if (lock.packages[at]?.link) at = lock.packages[at].resolved as string;
      if (seen.has(at)) continue;
      seen.add(at);
      out.push({ name, at, license: lock.packages[at]?.license ?? 'none' });
      queue.push(at);
    }
  }
  return out;
}

describe('the MIT boundary of @nexgen-os/solar', () => {
  it('is MIT, with its own licence file', () => {
    expect(manifest.license).toBe('MIT');
    expect(lock.packages['packages/solar'].license).toBe('MIT');
    expect(read('packages/solar/LICENSE')).toMatch(/^MIT License\n/);
  });

  it('reaches no workspace under the AGPL, however far', () => {
    const agpl = reached('packages/solar').filter((p) => !p.at.includes('node_modules/') && /GPL/.test(p.license));
    expect(agpl, 'an MIT package that depends on AGPL code leaves its user under the AGPL').toEqual([]);
  });

  it('imports nothing but its own files and the platform', () => {
    for (const name of sources) {
      for (const [, specifier] of read(`packages/solar/src/${name}`).matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
        expect(specifier, `${name} imports ${specifier}`).toMatch(/^(\.\/|node:)/);
      }
    }
  });

  it('is the one implementation the solar module and the core compute with', () => {
    expect(existsSync(new URL('modules/solar/src/pvwatts.ts', root))).toBe(false);
    expect(read('modules/solar/src/yield.ts')).toContain("from '@nexgen-os/solar'");
    expect(read('modules/solar/src/exceedance.ts')).toContain("from '@nexgen-os/solar'");
    expect(coreOffsetAt).toBe(offsetAt);
  });

  it('exports the models', () => {
    for (const name of ['pvwattsEnergyPerKwp', 'faimanCellTemperature', 'finkelsteinSchafer', 'selectTypicalMonths', 'typicalYear', 'annualTotals', 'exceedanceLevels', 'normalQuantile', 'offsetAt']) {
      expect(typeof (solar as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});

describe('exceedanceLevels()', () => {
  const totals = [
    { year: 2021, total: 950 },
    { year: 2022, total: 1000 },
    { year: 2023, total: 1050 },
  ];

  it('gives the P50, the interannual spread and the levels asked for', () => {
    const levels = exceedanceLevels(totals, { probabilities: [90] });
    expect(levels.p50_kwh).toBe(1000);
    expect(levels.sigma.interannual).toBe(0.05);
    expect(levels.exceedance_kwh['90']).toBeCloseTo(1000 * (1 - normalQuantile(0.9) * 0.05), 3);
    expect(levels.years).toEqual([{ year: 2021, kwh: 950 }, { year: 2022, kwh: 1000 }, { year: 2023, kwh: 1050 }]);
  });

  it('adds the named components in quadrature, the interannual part over the horizon', () => {
    const levels = exceedanceLevels(totals, { horizonYears: 4, uncertainties: [{ code: 'dataset', pct: 5 }] });
    expect(levels.sigma.interannual_over_horizon).toBe(0.025);
    expect(levels.sigma.total).toBeCloseTo(Math.hypot(0.025, 0.05), 6);
  });

  it('refuses by name', () => {
    expect(() => exceedanceLevels(totals.slice(0, 1))).toThrow(/^real_years_required/);
    expect(() => exceedanceLevels(totals, { horizonYears: 0 })).toThrow(/^horizon_invalid/);
    expect(() => exceedanceLevels(totals, { probabilities: [100] })).toThrow(/^probability_invalid/);
    expect(() => exceedanceLevels(totals, { uncertainties: [{ code: 'x', pct: -1 }] })).toThrow(/^uncertainty_invalid/);
  });
});

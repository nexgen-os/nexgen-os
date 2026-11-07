// `@nexgen-os/solar` as another program installs it: the module's pure
// functions — the PVWatts physics, the Finkelstein-Schafer typical year, P50
// and P90 of yearly totals, the EPW reader — imported by the package's name,
// and every subpath of its manifest pointing at a file of the module.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as solar from '@nexgen-os/solar';
import { exceedanceLevels, normalQuantile } from '@nexgen-os/solar';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  license: string;
  files: string[];
  exports: Record<string, string | { types: string; import: string }>;
  dependencies: Record<string, string>;
};

describe('the package', () => {
  it('gives the PV formula, the typical year, the exceedance levels and the EPW reader from its name', () => {
    for (const name of [
      'faimanCellTemperature',
      'pvwattsEnergyPerKwp',
      'arrayEnergy',
      'remainingAfterLosses',
      'finkelsteinSchafer',
      'selectTypicalMonths',
      'typicalYear',
      'toYearGrid',
      'annualTotals',
      'exceedanceLevels',
      'normalQuantile',
      'readEpw',
      'readTmy3',
      'writeEpw',
      'sandiaFromOnd',
      'estimateYield',
      'exceedance',
      'size',
    ]) {
      expect(typeof (solar as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('maps every subpath of its manifest to a source file of the module, built to dist/ with its types', () => {
    expect(manifest.name).toBe('@nexgen-os/solar');
    expect(manifest.license).toBe('AGPL-3.0-only');
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (typeof target === 'string') {
        expect(existsSync(new URL(`../${target}`, import.meta.url)), subpath).toBe(true);
        continue;
      }
      const source = target.import.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts');
      expect(existsSync(new URL(`../${source}`, import.meta.url)), `${subpath} -> ${source}`).toBe(true);
      expect(target.types).toBe(target.import.replace(/\.js$/, '.d.ts'));
    }
    expect(manifest.files).toEqual(expect.arrayContaining(['dist', 'module.json', 'supabase']));
  });

  it('depends on every package of the repository its source imports', () => {
    const imported = new Set<string>();
    for (const file of ['index', 'pvwatts', 'exceedance', 'inverter', 'estimates', 'yield', 'size', 'performance', 'products']) {
      const text = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8');
      for (const [, name] of text.matchAll(/from '(@nexgen-os\/[^']+)'/g)) imported.add(name as string);
    }
    expect([...imported].sort()).toEqual(Object.keys(manifest.dependencies).sort());
  });
});

describe('P50 and the exceedance levels of yearly totals, with no database', () => {
  // 876, 963.6 and 788.4 kWh: a mean of 876 and a sample standard deviation of 87.6, 10 %.
  const years = [
    { year: 2021, kwh: 876 },
    { year: 2022, kwh: 963.6 },
    { year: 2023, kwh: 788.4 },
  ];

  it('gives P50, P75, P90 and P99 of one year by default', () => {
    const got = exceedanceLevels(years);
    expect(got.p50_kwh).toBe(876);
    expect(got.sigma).toEqual({ interannual: 0.1, interannual_over_horizon: 0.1, total: 0.1 });
    expect(Object.keys(got.exceedance_kwh)).toEqual(['75', '90', '99']);
    expect(got.exceedance_kwh['90']).toBeCloseTo(876 * (1 - normalQuantile(0.9) * 0.1), 3);
    expect(got.years).toEqual(years);
  });

  it('divides the interannual variability by the square root of the horizon and adds the named components in quadrature', () => {
    const got = exceedanceLevels(years, { horizonYears: 10, uncertainties: [{ code: 'irradiance', pct: 5 }, { code: 'models', pct: 3 }], probabilities: [90] });
    const sigma = Math.sqrt(0.01 / 10 + 0.05 ** 2 + 0.03 ** 2);
    expect(got.sigma.total).toBeCloseTo(sigma, 6);
    expect(got.exceedance_kwh).toEqual({ '90': expect.closeTo(876 * (1 - 1.2815516 * sigma), 2) });
  });

  it('refuses one year, a horizon under a year, a negative component and a probability out of range, by name', () => {
    expect(() => exceedanceLevels(years.slice(0, 1))).toThrow(/^real_years_required/);
    expect(() => exceedanceLevels(years, { horizonYears: 0 })).toThrow(/^horizon_invalid/);
    expect(() => exceedanceLevels(years, { uncertainties: [{ code: 'soiling', pct: -1 }] })).toThrow(/^uncertainty_invalid/);
    expect(() => exceedanceLevels(years, { probabilities: [100] })).toThrow(/^probability_invalid/);
  });
});

// The solar module as a package, `@nexgen-os/solar`: what an application
// imports is every file of the module's code, through one entry, with the
// packages of this repository it reads declared as its dependencies, under the
// module's own licence; and the computations a surface started from a checkout
// runs are the ones the package exports.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as solar from '@nexgen-os/solar';
import { MODULE_COMPUTATIONS } from '../../computations.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../package.json')) as {
  name: string;
  license: string;
  repository: { directory: string };
  files: string[];
  dependencies: Record<string, string>;
};
const moduleManifest = JSON.parse(read('../module.json')) as { code: string; licence: string };
const sources = readdirSync(new URL('../src/', import.meta.url)).filter((name) => name.endsWith('.ts'));
const code = sources.filter((name) => name !== 'index.ts');

describe('the package of the solar module', () => {
  it('is named after the module and carries its licence', () => {
    expect(manifest.name).toBe(`@nexgen-os/${moduleManifest.code}`);
    expect(manifest.license).toBe(moduleManifest.licence);
    expect(manifest.repository.directory).toBe('modules/solar');
    expect(manifest.files).toEqual(expect.arrayContaining(['dist', 'module.json', 'LICENSE']));
  });

  it('exports every file of the module code from its entry', () => {
    const index = read('../src/index.ts');
    for (const name of code) expect(index, name).toContain(`export * from './${name.replace(/\.ts$/, '.js')}';`);
  });

  it('declares exactly the packages of the repository its code imports', () => {
    const imported = new Set<string>();
    for (const name of code) {
      for (const [, pkg] of read(`../src/${name}`).matchAll(/from '(@nexgen-os\/[a-z0-9-]+)'/g)) imported.add(pkg as string);
    }
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...imported].sort());
  });

  it('exports the computations and the models under them', () => {
    expect(typeof solar.estimateYield).toBe('function');
    expect(typeof solar.size).toBe('function');
    expect(typeof solar.exceedance).toBe('function');
    expect(typeof solar.performanceIndicators).toBe('function');
    expect(typeof solar.finkelsteinSchafer).toBe('function');
    expect(typeof solar.typicalYear).toBe('function');
    expect(typeof solar.pvwattsEnergyPerKwp).toBe('function');
    expect(typeof solar.faimanCellTemperature).toBe('function');
  });

  it('is what the computations of a checkout run', () => {
    expect(MODULE_COMPUTATIONS['solar.size']).toBe(solar.size);
  });
});

// What a package of this repository ships under its licence (decision 0005):
// an MIT library takes nothing a closed product could not take, an AGPL
// package nothing it could not be distributed with, and neither a licence
// that forbids commercial use or names nothing.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain script of the repository, with no types of its own
import { accepted, allows, licenceProblems } from '../scripts/check-licences.mjs';
// @ts-expect-error — a plain script of the repository, with no types of its own
import { workspaces } from '../scripts/publish.mjs';
// @ts-expect-error — a plain script of the repository, with no types of its own
import { ownDocument } from '../scripts/sbom.mjs';

const mit = accepted('MIT') as Set<string>;
const agpl = accepted('AGPL-3.0-only') as Set<string>;

function lock(dependency: { license?: string; dependencies?: Record<string, string> }, licence = 'MIT') {
  return {
    packages: {
      '': { name: 'repo' },
      'packages/formats/thing': { name: '@nexgen-os/thing', license: licence, dependencies: { lib: '^1.0.0' } },
      'node_modules/@nexgen-os/thing': { resolved: 'packages/formats/thing', link: true },
      'node_modules/lib': { version: '1.0.0', ...dependency },
      'node_modules/deep': { version: '2.0.0', license: 'GPL-3.0-only' },
      'node_modules/tool': { version: '3.0.0', license: 'GPL-3.0-only', dev: true },
    },
  };
}

const thing = (licence = 'MIT') => [
  { directory: 'packages/formats/thing', pkg: { name: '@nexgen-os/thing', license: licence, dependencies: { lib: '^1.0.0' } } },
];

describe('an SPDX expression', () => {
  it('is allowed when one side of an OR is, and when both sides of an AND are', () => {
    expect(allows('MIT', mit)).toBe(true);
    expect(allows('(MIT OR GPL-3.0-only)', mit)).toBe(true);
    expect(allows('(MIT AND Zlib)', mit)).toBe(true);
    expect(allows('(MIT AND GPL-3.0-only)', mit)).toBe(false);
    expect(allows('Apache-2.0 WITH LLVM-exception', mit)).toBe(true);
    expect(allows('(BSD-3-Clause OR (MIT AND CC-BY-NC-4.0))', mit)).toBe(true);
  });

  it('refuses copyleft in an MIT library, and takes it in an AGPL package', () => {
    for (const licence of ['GPL-3.0-only', 'AGPL-3.0-or-later', 'LGPL-3.0-only', 'GPL-3.0']) {
      expect(allows(licence, mit)).toBe(false);
      expect(allows(licence, agpl)).toBe(true);
    }
    expect(allows('MPL-2.0', mit)).toBe(true);
  });

  it('refuses everywhere a licence that forbids commercial use, a source-available one, or none', () => {
    for (const licence of ['CC-BY-NC-4.0', 'BUSL-1.1', 'SSPL-1.0', 'PolyForm-Noncommercial-1.0.0', 'UNLICENSED', '', undefined]) {
      expect(allows(licence, mit)).toBe(false);
      expect(allows(licence, agpl)).toBe(false);
    }
  });

  it('is asked of a package of this repository only under a licence decision 0005 names', () => {
    expect(() => accepted('Apache-2.0')).toThrow(/^licence_unknown/);
  });
});

describe('what a package ships', () => {
  it('is read through its dependencies, transitively, and its development tools are not', () => {
    expect(licenceProblems(lock({ license: 'ISC', dependencies: { deep: '^2.0.0' } }), thing())).toEqual([
      'licence_refused: @nexgen-os/thing (MIT): @nexgen-os/thing > lib > deep is under GPL-3.0-only',
    ]);
    expect(licenceProblems(lock({ license: 'ISC', dependencies: { deep: '^2.0.0' } }, 'AGPL-3.0-only'), thing('AGPL-3.0-only'))).toEqual([]);
  });

  it('names a package without a licence', () => {
    expect(licenceProblems(lock({}), thing())).toEqual([
      'licence_refused: @nexgen-os/thing (MIT): @nexgen-os/thing > lib is under no licence',
    ]);
  });

  it('crosses a package of this repository without judging it', () => {
    const repo = {
      packages: {
        'packages/connectors/c': { license: 'MIT', dependencies: { '@nexgen-os/core': '^0.4.0' } },
        'node_modules/@nexgen-os/core': { resolved: 'packages/core', link: true },
        'packages/core': { license: 'AGPL-3.0-only', dependencies: { bad: '1.0.0' } },
        'node_modules/bad': { license: 'CC-BY-NC-4.0' },
      },
    };
    const list = [{ directory: 'packages/connectors/c', pkg: { name: '@nexgen-os/c', license: 'MIT' } }];
    expect(licenceProblems(repo, list)).toEqual([
      'licence_refused: @nexgen-os/c (MIT): @nexgen-os/c > @nexgen-os/core > bad is under CC-BY-NC-4.0',
    ]);
  });

  it('holds for every package of this repository today', () => {
    const repoLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    expect(licenceProblems(repoLock, workspaces())).toEqual([]);
  });
});

describe('the bill of materials of a package', () => {
  it('describes the package itself, without the private monorepo', () => {
    const document = {
      bomFormat: 'CycloneDX',
      metadata: { component: { 'bom-ref': 'nexgen-os-monorepo@0.4.2', name: 'nexgen-os' } },
      components: [
        { 'bom-ref': 'web-ifc@0.0.78', name: 'web-ifc' },
        { 'bom-ref': '@nexgen-os/ifc@0.4.2', name: 'ifc' },
      ],
      dependencies: [
        { ref: 'nexgen-os-monorepo@0.4.2', dependsOn: [] },
        { ref: '@nexgen-os/ifc@0.4.2', dependsOn: ['web-ifc@0.0.78'] },
      ],
    };
    const own = ownDocument(document, '@nexgen-os/ifc', '0.4.2');
    expect(own.metadata.component['bom-ref']).toBe('@nexgen-os/ifc@0.4.2');
    expect(own.components.map((c: { name: string }) => c.name)).toEqual(['web-ifc']);
    expect(own.dependencies).toEqual([{ ref: '@nexgen-os/ifc@0.4.2', dependsOn: ['web-ifc@0.0.78'] }]);
    expect(() => ownDocument(document, '@nexgen-os/other', '0.4.2')).toThrow(/^sbom_incomplete/);
  });

  it('is written by every release, and kept with its run', () => {
    const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
    expect(workflow).toMatch(/node scripts\/sbom\.mjs/);
    expect(workflow).toMatch(/upload-artifact/);
  });
});

#!/usr/bin/env node
/**
 * Writes the software bill of materials of every package a release
 * publishes: one CycloneDX document per package, listing what it ships —
 * its dependencies, transitively, with their version and their licence.
 * Development dependencies are not shipped and are not listed.
 *
 *   node scripts/sbom.mjs [directory]      # default: sbom/
 *
 * The list of packages is the one `scripts/publish.mjs` publishes, read from
 * the workspaces; the documents are made by `npm sbom` from the installed
 * tree, so `npm ci` comes first. The Release workflow keeps them with the run
 * of each release. How a vulnerability in one of them is handled: SECURITY.md.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publishOrder } from './publish.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `npm sbom --workspace` describes the monorepo and lists the package among
 * its components: the document of a package names the package itself as
 * what it describes, and the private monorepo is left out.
 */
export function ownDocument(document, name, version) {
  const self = `${name}@${version}`;
  const component = document.components.find((entry) => entry['bom-ref'] === self);
  if (!component) throw new Error(`sbom_incomplete: ${self} is not in its own bill of materials`);
  const monorepo = document.metadata.component['bom-ref'];
  return {
    ...document,
    metadata: { ...document.metadata, component },
    components: document.components.filter((entry) => entry !== component),
    dependencies: (document.dependencies ?? []).filter((entry) => entry.ref !== monorepo),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = resolve(process.argv[2] ?? join(root, 'sbom'));
  mkdirSync(out, { recursive: true });
  const order = publishOrder(root);
  for (const { name, version } of order) {
    const document = execFileSync(
      'npm',
      ['sbom', '--sbom-format', 'cyclonedx', '--sbom-type', 'library', '--omit', 'dev', '--workspace', name],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const file = join(out, `${name.replace('@', '').replace('/', '-')}-${version}.cdx.json`);
    writeFileSync(file, JSON.stringify(ownDocument(JSON.parse(document), name, version), null, 2) + '\n');
  }
  console.log(`sbom: ${order.length} packages, written to ${out}`);
}

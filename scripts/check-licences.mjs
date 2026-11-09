#!/usr/bin/env node
/**
 * Refuses a third-party package whose licence a package of this repository
 * cannot ship.
 *
 * The format libraries and the connectors are MIT so that any product, open
 * or not, can take them (decision 0005): what they bring with them has to
 * allow the same. The core, the command line and the MCP server are
 * AGPL-3.0: what they bring with them has to be free software they can be
 * distributed with. Neither ever ships a licence that forbids commercial use,
 * a source-available licence, or a package that names no licence at all.
 *
 *   node scripts/check-licences.mjs
 *
 * What a package brings is read from `package-lock.json`: every package its
 * `dependencies`, `optionalDependencies` and `peerDependencies` reach,
 * transitively, the way Node resolves them. Development dependencies are not
 * shipped and are not read. A package of this repository is crossed, never
 * judged: its own licence is decision 0005's.
 *
 * A refusal is named `licence_refused`, with the package of this repository,
 * the path that brings the third-party package and its licence.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workspaces } from './publish.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Licences that let any product, open or closed, take the code. */
export const PERMISSIVE = [
  '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC-BY-4.0', 'CC0-1.0',
  'ISC', 'MIT', 'MIT-0', 'Python-2.0', 'Unlicense', 'Zlib',
];

/**
 * Copyleft bound to the files of the package that carries it: a product that
 * takes the package unchanged takes no obligation on its own code.
 */
export const FILE_COPYLEFT = ['MPL-2.0'];

/** Copyleft an AGPL-3.0 work may be distributed with, and an MIT one may not. */
export const COPYLEFT = [
  'AGPL-3.0-only', 'AGPL-3.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later',
];

/** What a package of this repository may ship, by its own licence. */
export function accepted(licence) {
  if (licence === 'MIT') return new Set([...PERMISSIVE, ...FILE_COPYLEFT]);
  if (/^AGPL-3\.0/.test(licence)) return new Set([...PERMISSIVE, ...FILE_COPYLEFT, ...COPYLEFT]);
  throw new Error(`licence_unknown: a package of this repository under ${licence}, which decision 0005 does not name`);
}

/** The old spellings npm still finds in manifests, under their SPDX name. */
const ALIASES = {
  'GPL-3.0': 'GPL-3.0-only', 'GPL-3.0+': 'GPL-3.0-or-later', 'AGPL-3.0': 'AGPL-3.0-only',
  'AGPL-3.0+': 'AGPL-3.0-or-later', 'LGPL-3.0': 'LGPL-3.0-only', 'LGPL-3.0+': 'LGPL-3.0-or-later',
  'LGPL-2.1+': 'LGPL-2.1-or-later', 'Apache 2.0': 'Apache-2.0', 'BSD': 'BSD-3-Clause',
};

/**
 * Whether an SPDX expression is allowed by a set of licences: one side of an
 * `OR` is enough, both sides of an `AND` are needed, and an exception
 * (`WITH`) only ever adds a permission.
 */
export function allows(expression, set) {
  if (typeof expression !== 'string' || expression.trim() === '') return false;
  const text = expression.trim();
  const unwrapped = text.startsWith('(') && closing(text) === text.length - 1 ? text.slice(1, -1) : text;
  for (const operator of [' OR ', ' AND ']) {
    const parts = split(unwrapped, operator);
    if (parts.length > 1) {
      return operator === ' OR ' ? parts.some((part) => allows(part, set)) : parts.every((part) => allows(part, set));
    }
  }
  const id = unwrapped.split(' WITH ')[0].trim();
  return set.has(ALIASES[id] ?? id);
}

function closing(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function split(text, operator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') depth--;
    if (depth === 0 && text.startsWith(operator, i)) {
      parts.push(text.slice(start, i));
      start = i + operator.length;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Where Node finds `name` from the lockfile entry at `from`: up the tree. */
function resolve(packages, from, name) {
  let base = from;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const parent = base.lastIndexOf('/node_modules/');
    base = parent === -1 ? '' : base.slice(0, parent);
  }
}

/**
 * Every refusal for the packages of this repository, from a lockfile
 * (`packages` of `package-lock.json`, version 2 or 3) and the workspaces.
 */
export function licenceProblems(lock, list) {
  const packages = lock.packages ?? {};
  const problems = [];
  for (const { directory, pkg } of list) {
    if (pkg.private === true) continue;
    const allowed = accepted(pkg.license);
    const seen = new Set([directory]);
    const queue = [[directory, [pkg.name]]];
    while (queue.length) {
      const [at, path] = queue.shift();
      const entry = packages[at] ?? {};
      const optional = new Set([
        ...Object.keys(entry.optionalDependencies ?? {}),
        ...Object.entries(entry.peerDependenciesMeta ?? {}).filter(([, meta]) => meta?.optional).map(([name]) => name),
      ]);
      const names = new Set([
        ...Object.keys(entry.dependencies ?? {}),
        ...Object.keys(entry.optionalDependencies ?? {}),
        ...Object.keys(entry.peerDependencies ?? {}),
      ]);
      for (const name of [...names].sort()) {
        let found = resolve(packages, at, name);
        if (!found) {
          if (!optional.has(name)) problems.push(`licence_refused: ${pkg.name}: ${[...path, name].join(' > ')} is not in package-lock.json`);
          continue;
        }
        if (packages[found].link) found = packages[found].resolved;
        if (seen.has(found)) continue;
        seen.add(found);
        const target = packages[found] ?? {};
        const ours = !found.includes('node_modules/');
        if (!ours && !allows(target.license, allowed)) {
          problems.push(
            `licence_refused: ${pkg.name} (${pkg.license}): ${[...path, name].join(' > ')} is under ${target.license ?? 'no licence'}`,
          );
        }
        queue.push([found, [...path, name]]);
      }
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const list = workspaces(root);
  const problems = licenceProblems(lock, list);
  if (problems.length) {
    console.error(`${problems.length} licence problem(s) (decision 0005):`);
    for (const problem of problems) console.error('  ' + problem);
    process.exit(1);
  }
  console.log(`licences: ${list.filter(({ pkg }) => pkg.private !== true).length} packages, every package they ship allowed`);
}

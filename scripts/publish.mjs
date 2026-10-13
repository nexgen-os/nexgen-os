#!/usr/bin/env node
/**
 * Publishes the packages of this repository to npm, in the order their
 * dependencies impose.
 *
 * The list is **read from the workspaces** and never written down. It used to
 * be a column of `npm publish` lines in `docs/releasing.md`, and the day a
 * brick was added to the repository and not to the column, a release run from
 * that page would have shipped all the packages but one. Whatever is a
 * workspace and is not `private` is published; a package goes after every
 * package of this repository it depends on.
 *
 * It does nothing by default but say what it would do:
 *
 *   npm run release:publish              # the plan, and a dry run of each pack
 *   npm run release:publish -- --for-real
 *
 * For real, it refuses a working tree that is not clean and a HEAD that no
 * tag names — a version on npm is a version someone can read the source of —
 * and it needs either `npm login` done by a person at a terminal, or the
 * GitHub Actions workflow `.github/workflows/release.yml`, where npm trades
 * the run's OIDC identity for a short-lived publish credential (trusted
 * publishing) and attaches a provenance statement to every package. There is
 * no token in this repository. A version the registry already holds is
 * skipped, so a run that stopped half way is run again.
 *
 * It never publishes from a pull request: `--for-real` is refused there.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every workspace of the root manifest: its directory and its own manifest. */
export function workspaces(from = root) {
  const manifest = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'));
  const found = new Map();
  for (const pattern of manifest.workspaces ?? []) {
    const directories = pattern.endsWith('/*')
      ? readdirSync(join(from, pattern.slice(0, -2)), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(pattern.slice(0, -2), entry.name))
      : [pattern];
    for (const directory of directories) {
      const file = join(from, directory, 'package.json');
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      if (!found.has(pkg.name)) found.set(pkg.name, { directory, pkg });
    }
  }
  return [...found.values()];
}

/**
 * What is published, in the order it has to be: dependencies first, and
 * alphabetical among packages that do not depend on one another, so the order
 * is the same on every machine. A cycle is refused rather than broken.
 */
export function publishOrder(from = root) {
  const all = workspaces(from).filter(({ pkg }) => pkg.private !== true);
  const byName = new Map(all.map((entry) => [entry.pkg.name, entry]));
  const needs = (entry) =>
    Object.keys({ ...entry.pkg.dependencies, ...entry.pkg.peerDependencies }).filter((name) =>
      byName.has(name),
    );

  const ordered = [];
  const placed = new Set();
  while (ordered.length < all.length) {
    const ready = all
      .filter((entry) => !placed.has(entry.pkg.name))
      .filter((entry) => needs(entry).every((name) => placed.has(name)))
      .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name));
    if (ready.length === 0) {
      throw new Error('the packages of this repository depend on one another in a circle');
    }
    for (const entry of ready) {
      placed.add(entry.pkg.name);
      ordered.push({
        name: entry.pkg.name,
        version: entry.pkg.version,
        directory: entry.directory,
        needs: needs(entry),
      });
    }
  }
  return ordered;
}

/**
 * A range on a package of this repository that its current version does not
 * satisfy is a release that installs from the registry something older than
 * what was tagged — or nothing at all. Only the caret and exact forms this
 * repository uses are read; anything else is reported as unread.
 */
export function staleRanges(from = root) {
  const all = workspaces(from);
  const versions = new Map(all.map(({ pkg }) => [pkg.name, pkg.version]));
  const problems = [];
  for (const { pkg } of all) {
    for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies })) {
      const version = versions.get(name);
      if (version === undefined) continue;
      const match = /^(\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(range);
      if (match === null) {
        problems.push(`${pkg.name} names ${name} as ${range}, which this script does not read`);
        continue;
      }
      const [, operator, major, minor, patch] = match;
      const [vMajor, vMinor, vPatch] = version.split('.').map(Number);
      const floor = [Number(major), Number(minor), Number(patch)];
      const atLeast =
        vMajor > floor[0] ||
        (vMajor === floor[0] && (vMinor > floor[1] || (vMinor === floor[1] && vPatch >= floor[2])));
      const sameLine =
        operator === undefined
          ? version === `${major}.${minor}.${patch}`
          : operator === '~' || floor[0] === 0
            ? vMajor === floor[0] && vMinor === floor[1]
            : vMajor === floor[0];
      if (!atLeast || !sameLine) {
        problems.push(`${pkg.name} asks for ${name}@${range} and this repository holds ${version}`);
      }
    }
  }
  return problems;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options }).trim();
}

function onRegistry(name, version) {
  try {
    return run('npm', ['view', `${name}@${version}`, 'version'], { stdio: ['ignore', 'pipe', 'ignore'] }) === version;
  } catch {
    return false;
  }
}

function main() {
  const forReal = process.argv.includes('--for-real');
  const inActions = process.env.GITHUB_ACTIONS === 'true';
  if (forReal && inActions && process.env.GITHUB_EVENT_NAME === 'pull_request') {
    console.error('A pull request never publishes. Nothing was sent.');
    process.exit(1);
  }
  const order = publishOrder();

  const stale = staleRanges();
  if (stale.length > 0) {
    console.error(stale.map((line) => `  ${line}`).join('\n'));
    console.error('Nothing was published: fix the ranges above first.');
    process.exit(1);
  }

  if (forReal) {
    if (run('git', ['status', '--porcelain']) !== '') {
      console.error('The working tree is not clean: what would be published is not what is committed.');
      process.exit(1);
    }
    let tag = '';
    try {
      tag = run('git', ['describe', '--tags', '--exact-match', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      console.error('HEAD is not a tag: a version on npm is a version someone can read the source of. Tag first.');
      process.exit(1);
    }
    if (inActions) {
      console.log(`Publishing ${tag} with provenance, through GitHub OIDC.`);
    } else {
      try {
        console.log(`Publishing ${tag} as ${run('npm', ['whoami'], { stdio: ['ignore', 'pipe', 'ignore'] })}.`);
      } catch {
        console.error('Nobody is logged in to npm. Run `npm login --auth-type=web` yourself, then come back.');
        process.exit(1);
      }
    }
  }

  for (const entry of order) {
    const label = `${entry.name}@${entry.version}`;
    // npm refuses to publish over a version, dry run included, so both skip it.
    if (onRegistry(entry.name, entry.version)) {
      console.log(`= ${label} is already on the registry`);
      continue;
    }
    const args = ['publish', '--workspace', entry.directory, '--access', 'public'];
    if (!forReal) args.push('--dry-run');
    else if (inActions) args.push('--provenance');
    console.log(`${forReal ? '+' : '?'} ${label}${entry.needs.length > 0 ? `  (after ${entry.needs.join(', ')})` : ''}`);
    execFileSync('npm', args, { cwd: root, stdio: forReal ? 'inherit' : ['ignore', 'ignore', 'inherit'] });
  }
  console.log(
    forReal
      ? `${order.length} packages are on the registry.`
      : `${order.length} packages would be published. Nothing was sent: add --for-real, on a tag, logged in.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

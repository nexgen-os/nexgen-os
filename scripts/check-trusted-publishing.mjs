#!/usr/bin/env node
/**
 * Refuses a release when one of its packages cannot be published by the
 * Release workflow.
 *
 * The workflow publishes through npm trusted publishing: npm trades the run's
 * GitHub OIDC identity for a publish credential, package by package, and only
 * for a package whose trusted publisher names this repository and
 * `release.yml`. A package without one stops the run half way, after the
 * packages before it are already on the registry.
 *
 * The list is the one `scripts/publish.mjs` publishes, read from the
 * workspaces. For each package, the latest version on npm has to carry a
 * provenance attestation (`npm view <name> dist.attestations`), which a
 * publish through trusted publishing always has. A package never published,
 * or published without one, is named, with what to do on npmjs.com.
 *
 *   npm run release:check
 *
 * Inside the Release workflow, where the run holds an OIDC identity, a package
 * whose latest version has no attestation gets a second chance: the check asks
 * npm for that package's publish credential, exactly as `npm publish` will. If
 * npm hands one over, the trusted publisher is in place and this release is
 * the one that brings the attestation. Nothing is published by the check.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { publishOrder } from './publish.mjs';

export const REPOSITORY = 'nexgen-os/nexgen-os';
export const WORKFLOW = 'release.yml';
const REGISTRY = 'https://registry.npmjs.org';

/** What to do on npmjs.com, for one package. */
export function trustedPublisherAdvice(name) {
  return (
    `add its trusted publisher on https://www.npmjs.com/package/${name}/access — ` +
    `GitHub Actions, repository ${REPOSITORY}, workflow ${WORKFLOW}, no environment`
  );
}

/**
 * The latest version of a package on npm and whether it carries an
 * attestation, or `null` when npm has never heard of it. `view` runs
 * `npm view` with the given arguments and returns its standard output; it
 * throws on a failure, with npm's error output in `stderr` or `message`.
 */
export function readPublished(name, view = npmView) {
  let output;
  try {
    output = view([name, 'version', 'dist.attestations', '--json']);
  } catch (error) {
    const said = `${error?.stderr ?? ''}${error?.stdout ?? ''}${error?.message ?? ''}`;
    if (/E404|404 Not Found/.test(said)) return null;
    throw new Error(`npm could not be asked about ${name}: ${said.trim() || 'no answer'}`);
  }
  const answer = JSON.parse(output);
  // With one field missing, npm answers the other one alone, as a bare value.
  if (typeof answer === 'string') return { version: answer, attested: false };
  return { version: answer.version, attested: Boolean(answer['dist.attestations']?.provenance) };
}

/**
 * One line per package, and the packages that stop the release. `exchange`,
 * when given, asks npm for a publish credential for a package and resolves to
 * whether npm handed one over.
 */
export async function checkTrustedPublishing(names, { view = npmView, exchange } = {}) {
  const lines = [];
  const refused = [];
  for (const name of names) {
    const published = readPublished(name, view);
    if (published === null) {
      refused.push(name);
      lines.push(
        `✗ ${name} has never been published: publish it once by hand (docs/releasing.md, ` +
          `One-time setup on npmjs.com), then ${trustedPublisherAdvice(name)}.`,
      );
      continue;
    }
    const label = `${name}@${published.version}`;
    if (published.attested) {
      lines.push(`✓ ${label} carries a provenance attestation`);
      continue;
    }
    if (exchange !== undefined && (await exchange(name))) {
      lines.push(
        `✓ ${label} carries no provenance attestation, but npm grants this workflow a publish ` +
          `credential for it: its trusted publisher is in place, and this release brings the attestation`,
      );
      continue;
    }
    refused.push(name);
    lines.push(
      `✗ ${label}, its latest version on npm, carries no provenance attestation: it was not ` +
        `published through trusted publishing${exchange !== undefined ? ', and npm refuses this workflow a publish credential for it' : ''}. ` +
        `The Release workflow would stop on it. ${capitalised(trustedPublisherAdvice(name))}.`,
    );
  }
  return { lines, refused };
}

function capitalised(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function npmView(args) {
  return execFileSync('npm', ['view', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * The credential exchange `npm publish` performs under trusted publishing
 * (npm's `lib/utils/oidc.js`), stopped before anything is published: the
 * run's OIDC token for the audience `npm:registry.npmjs.org`, traded for a
 * short-lived token scoped to one package. Available inside a GitHub Actions
 * job with `id-token: write`, and nowhere else.
 */
export function githubOidcExchange(env = process.env, request = fetch) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !token) return undefined;
  return async (name) => {
    const identity = new URL(url);
    identity.searchParams.append('audience', `npm:${new URL(REGISTRY).hostname}`);
    const issued = await request(identity.href, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!issued.ok) throw new Error(`GitHub refused an OIDC token (${issued.status})`);
    const { value } = await issued.json();
    const escaped = name.replace('/', '%2f');
    const traded = await request(`${REGISTRY}/-/npm/v1/oidc/token/exchange/package/${escaped}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${value}` },
    });
    if (!traded.ok) return false;
    return Boolean((await traded.json())?.token);
  };
}

async function main() {
  const names = publishOrder().map((entry) => entry.name);
  const { lines, refused } = await checkTrustedPublishing(names, { exchange: githubOidcExchange() });
  console.log(lines.join('\n'));
  if (refused.length > 0) {
    console.error(
      `\nThe release is refused: ${refused.length} of ${names.length} packages cannot be published ` +
        `by the Release workflow (${refused.join(', ')}).`,
    );
    process.exit(1);
  }
  console.log(`\nEvery one of the ${names.length} packages can be published by the Release workflow.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

// How a release reaches npm: what is published is read from the workspaces,
// the workflow holds no token, and the check that runs first reads npm's
// answers rather than the registry.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain script of the repository, with no types of its own
import { publishOrder, staleRanges, workspaces } from '../scripts/publish.mjs';
import {
  REPOSITORY,
  checkTrustedPublishing,
  githubOidcExchange,
  readPublished,
  // @ts-expect-error — a plain script of the repository, with no types of its own
} from '../scripts/check-trusted-publishing.mjs';

interface Entry {
  name: string;
  version: string;
  directory: string;
  needs: string[];
}

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

describe('what a release publishes', () => {
  const order = publishOrder() as Entry[];

  it('is every workspace that is not private, and nothing else', () => {
    const expected = (workspaces() as { pkg: { name: string; private?: boolean } }[])
      .filter(({ pkg }) => pkg.private !== true)
      .map(({ pkg }) => pkg.name)
      .sort();
    expect(order.map((entry) => entry.name).sort()).toEqual(expected);
    expect(new Set(order.map((entry) => entry.name)).size).toBe(order.length);
    expect(order.map((entry) => entry.name)).toContain('nexgen-os');
  });

  it('puts a package after every package of this repository it depends on', () => {
    const position = new Map(order.map((entry, index) => [entry.name, index]));
    for (const entry of order) {
      for (const needed of entry.needs) {
        expect(position.get(needed), `${entry.name} needs ${needed}`).toBeLessThan(position.get(entry.name) as number);
      }
    }
  });

  it('holds no range on one of its own packages that the repository no longer satisfies', () => {
    expect(staleRanges()).toEqual([]);
  });

  it('names the repository the trusted publishers point at', () => {
    const manifest = JSON.parse(readFileSync(new URL('../packages/cli/package.json', import.meta.url), 'utf8'));
    expect(manifest.repository.url).toBe(`git+https://github.com/${REPOSITORY}.git`);
    expect(manifest.publishConfig).toEqual({ access: 'public' });
  });
});

describe('the release workflow', () => {
  it('publishes through OIDC, with no stored token', () => {
    expect(workflow).toMatch(/id-token: write/);
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
  });

  it('starts on a version tag or by hand, never on a pull request', () => {
    expect(workflow).toMatch(/tags: \['v\*'\]/);
    expect(workflow).toMatch(/workflow_dispatch/);
    expect(workflow).not.toMatch(/pull_request/);
  });

  it('pins the npm version that supports trusted publishing', () => {
    expect(workflow).toMatch(/npm install -g npm@11\.\d+\.\d+/);
  });

  it('checks the trusted publishers before anything is tested, built or published', () => {
    const check = workflow.indexOf('npm run release:check');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(workflow.indexOf('npm test'));
    expect(check).toBeLessThan(workflow.indexOf('npm run build'));
    expect(check).toBeLessThan(workflow.indexOf('npm run release:publish'));
  });

  it('is a step of docs/releasing.md', () => {
    const doc = readFileSync(new URL('../docs/releasing.md', import.meta.url), 'utf8');
    expect(doc).toContain('npm run release:check');
    expect(doc).toContain('release.yml');
  });
});

describe('the changelog', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const sections = [...changelog.matchAll(/^## \[([^\]]+)\](.*)$/gm)].map(([, name, rest]) => ({ name, rest }));

  it('opens on an [Unreleased] section, above every release', () => {
    expect(sections[0]?.name).toBe('Unreleased');
    expect(sections.filter((section) => section.name === 'Unreleased')).toHaveLength(1);
  });

  it('has a dated section for the version every published package carries', () => {
    const released = new Map(sections.slice(1).map((section) => [section.name, section.rest]));
    for (const { pkg } of workspaces() as { pkg: { name: string; version: string; private?: boolean } }[]) {
      if (pkg.private === true) continue;
      expect(released.get(pkg.version), `${pkg.name}@${pkg.version}`).toMatch(/^ — \d{4}-\d{2}-\d{2}$/);
    }
  });
});

// A fake `npm view`: the answer for each package name, or a thrower.
const attested = (version: string) =>
  JSON.stringify({
    version,
    'dist.attestations': {
      url: `https://registry.npmjs.org/-/npm/v1/attestations/x@${version}`,
      provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
    },
  });

const notFound = () => {
  const error = new Error('Command failed: npm view') as Error & { stderr: string };
  error.stderr = 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@nexgen-os%2fnew';
  throw error;
};

function npm(answers: Record<string, string | (() => never)>) {
  return (args: string[]) => {
    const answer = answers[args[0] as string];
    if (answer === undefined) throw new Error(`unexpected npm view ${args.join(' ')}`);
    return typeof answer === 'function' ? answer() : answer;
  };
}

describe('what npm says of a package', () => {
  it('reads the latest version and its provenance attestation', () => {
    expect(readPublished('nexgen-os', npm({ 'nexgen-os': attested('0.1.0') }))).toEqual({ version: '0.1.0', attested: true });
  });

  it('reads a version published without an attestation, which npm answers as a bare value', () => {
    expect(readPublished('nexgen-os', npm({ 'nexgen-os': '"0.1.0"\n' }))).toEqual({ version: '0.1.0', attested: false });
  });

  it('says a package npm has never heard of was never published', () => {
    expect(readPublished('@nexgen-os/new', npm({ '@nexgen-os/new': notFound }))).toBeNull();
  });

  it('does not mistake npm being unreachable for a package never published', () => {
    const offline = () => {
      throw Object.assign(new Error('Command failed'), { stderr: 'npm error code ENOTFOUND' });
    };
    expect(() => readPublished('nexgen-os', npm({ 'nexgen-os': offline }))).toThrow(/npm could not be asked about nexgen-os: .*ENOTFOUND/);
  });
});

describe('the release check', () => {
  it('passes when the latest version of every package carries an attestation', async () => {
    const { refused, lines } = await checkTrustedPublishing(['@nexgen-os/core', 'nexgen-os'], {
      view: npm({ '@nexgen-os/core': attested('0.1.0'), 'nexgen-os': attested('0.1.0') }),
    });
    expect(refused).toEqual([]);
    expect(lines).toEqual([
      '✓ @nexgen-os/core@0.1.0 carries a provenance attestation',
      '✓ nexgen-os@0.1.0 carries a provenance attestation',
    ]);
  });

  it('names a package published without an attestation, and says where to add its trusted publisher', async () => {
    const { refused, lines } = await checkTrustedPublishing(['nexgen-os'], { view: npm({ 'nexgen-os': '"0.1.0"' }) });
    expect(refused).toEqual(['nexgen-os']);
    expect(lines[0]).toMatch(/^✗ nexgen-os@0\.1\.0, its latest version on npm, carries no provenance/);
    expect(lines[0]).toContain('https://www.npmjs.com/package/nexgen-os/access');
    expect(lines[0]).toContain('GitHub Actions, repository nexgen-os/nexgen-os, workflow release.yml, no environment');
  });

  it('names a package never published, and says to publish it once by hand first', async () => {
    const { refused, lines } = await checkTrustedPublishing(['@nexgen-os/new'], { view: npm({ '@nexgen-os/new': notFound }) });
    expect(refused).toEqual(['@nexgen-os/new']);
    expect(lines[0]).toMatch(/^✗ @nexgen-os\/new has never been published: publish it once by hand/);
  });

  it('inside the workflow, lets a package through when npm grants the run a publish credential for it', async () => {
    const asked: string[] = [];
    const { refused, lines } = await checkTrustedPublishing(['@nexgen-os/core', 'nexgen-os'], {
      view: npm({ '@nexgen-os/core': attested('0.1.0'), 'nexgen-os': '"0.1.0"' }),
      exchange: async (name: string) => (asked.push(name), true),
    });
    expect(refused).toEqual([]);
    expect(asked).toEqual(['nexgen-os']); // only the package without an attestation is asked about
    expect(lines[1]).toMatch(/grants this workflow a publish credential/);
  });

  it('inside the workflow, still refuses a package npm refuses the run a credential for', async () => {
    const { refused, lines } = await checkTrustedPublishing(['nexgen-os'], {
      view: npm({ 'nexgen-os': '"0.1.0"' }),
      exchange: async () => false,
    });
    expect(refused).toEqual(['nexgen-os']);
    expect(lines[0]).toMatch(/npm refuses this workflow a publish credential for it/);
  });

  it('never lets a package never published through, workflow or not', async () => {
    const { refused } = await checkTrustedPublishing(['@nexgen-os/new'], {
      view: npm({ '@nexgen-os/new': notFound }),
      exchange: async () => true,
    });
    expect(refused).toEqual(['@nexgen-os/new']);
  });
});

describe('the credential exchange', () => {
  it('is not available outside a GitHub Actions job holding an OIDC identity', () => {
    expect(githubOidcExchange({})).toBeUndefined();
  });

  it('trades the run identity for a token scoped to the package, as npm publish does', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const request = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith('https://token.actions.example/')) return new Response(JSON.stringify({ value: 'oidc-id-token' }));
      return new Response(JSON.stringify({ token: 'short-lived' }));
    };
    const exchange = githubOidcExchange(
      { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/id?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'run' },
      request,
    );
    expect(await exchange('@nexgen-os/core')).toBe(true);
    expect(calls[0]?.url).toBe('https://token.actions.example/id?x=1&audience=npm%3Aregistry.npmjs.org');
    expect(calls[1]?.url).toBe('https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@nexgen-os%2fcore');
    expect(calls[1]?.init?.method).toBe('POST');
    expect((calls[1]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer oidc-id-token');
  });

  it('answers no when npm refuses the exchange', async () => {
    const request = async (url: string) =>
      url.includes('oidc/token/exchange')
        ? new Response('{"message":"no trusted publisher"}', { status: 404 })
        : new Response(JSON.stringify({ value: 'oidc-id-token' }));
    const exchange = githubOidcExchange(
      { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/id', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'run' },
      request,
    );
    expect(await exchange('nexgen-os')).toBe(false);
  });
});

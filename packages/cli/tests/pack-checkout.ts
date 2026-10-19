// A checkout of the fixture pack `xa` in a temporary folder: the published
// schema of this repository, the pack, and its committed seed. The tests
// change the copy, never the fixture.
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from '../../../tests/helpers/db.js';

export const FIXTURE = join(repoRoot, 'tests/fixtures/pack-checkout');

export async function checkout(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nexgen-pack-'));
  await cp(FIXTURE, root, { recursive: true });
  await cp(join(repoRoot, 'packs/schema'), join(root, 'packs/schema'), { recursive: true });
  return root;
}

/** Reads `packs/<slug>/<file>` of a checkout, lets `change` edit it, writes it back. */
export async function edit(root: string, file: string, change: (json: any) => void, slug = 'xa'): Promise<void> {
  const path = join(root, 'packs', slug, file);
  const json = JSON.parse(await readFile(path, 'utf8'));
  change(json);
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
}

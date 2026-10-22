// Copies what the installer applies — the core's migrations and seed, the
// modules' manifests and migrations, the packs' seeds and manifests — and the
// dataset `nexgen-os try` loads into `assets/`, in the same layout as the
// repository, so that the published package carries the files it records by path.

import { copyFileSync, cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const repo = join(pkg, '..', '..');
const out = join(pkg, 'assets');

rmSync(out, { recursive: true, force: true });
const copy = (rel) => {
  if (existsSync(join(repo, rel))) cpSync(join(repo, rel), join(out, rel), { recursive: true });
};

copy('supabase/migrations');
copy('supabase/seed');
for (const m of readdirSync(join(repo, 'modules'))) {
  copy(`modules/${m}/module.json`);
  copy(`modules/${m}/supabase/migrations`);
}
for (const p of readdirSync(join(repo, 'packs'))) copy(`packs/${p}/pack.json`);
copy('docs/demo/01-house-pv-battery.sql');
// The package is AGPL-3.0 like the core: npm ships a LICENSE found at the package root.
copyFileSync(join(repo, 'LICENSE'), join(pkg, 'LICENSE'));
console.log(`assets copied to ${out}`);

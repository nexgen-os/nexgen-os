// Copies what the installer applies — the core's migrations and seed, the
// modules' migrations, the packs' seeds and manifests — into `assets/`, in the
// same layout as the repository, so that the published package carries the
// files it records by path.

import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const pkg = new URL('..', import.meta.url).pathname;
const repo = join(pkg, '..', '..');
const out = join(pkg, 'assets');

rmSync(out, { recursive: true, force: true });
const copy = (rel) => {
  if (existsSync(join(repo, rel))) cpSync(join(repo, rel), join(out, rel), { recursive: true });
};

copy('supabase/migrations');
copy('supabase/seed');
for (const m of readdirSync(join(repo, 'modules'))) copy(`modules/${m}/migrations`);
for (const p of readdirSync(join(repo, 'packs'))) {
  copy(`packs/${p}/seed`);
  copy(`packs/${p}/pack.json`);
}
console.log(`assets copied to ${out}`);

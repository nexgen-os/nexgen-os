// Copies the repository's LICENSE (AGPL-3.0) into the package being built:
// npm ships a LICENSE found at the package root, and one copy of the text is
// kept in the repository. Run from a package folder: `node ../../scripts/copy-license.mjs`.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
copyFileSync(join(repo, 'LICENSE'), join(process.cwd(), 'LICENSE'));

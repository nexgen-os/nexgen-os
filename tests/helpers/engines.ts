// The example engines of packages/connectors, run from their folder with the
// Python on the path: no installation needed. Without Python, `installed`
// is null and the tests that need an engine say they are skipped.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { PVLIB_ENGINE, SHARING_EXAMPLE_ENGINE, describeEngine, type EngineSpec } from '@nexgen-os/core';
import { repoRoot } from './db.js';

/** The `sharing_example` engine (packages/connectors/sharing-example). */
export const sharingExample: EngineSpec = {
  ...SHARING_EXAMPLE_ENGINE,
  command: ['python3', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(join(repoRoot, 'packages', 'connectors', 'sharing-example'))}); from nexgen_sharing_example.run import main; sys.exit(main())`],
};

/**
 * The pvlib engine (packages/connectors/pvlib), when it is installed. The
 * caller gives the command: the environment's, else the local virtual
 * environment, else the Python on the path.
 */
const localVenv = join(repoRoot, '.venv-pvlib', 'bin', 'python');
export const pvlibEngine: EngineSpec = {
  ...PVLIB_ENGINE,
  command: process.env.NEXGEN_ENGINE_PVLIB ? undefined : [existsSync(localVenv) ? localVenv : 'python3', '-m', 'nexgen_pvlib'],
};

/** What an engine says of itself, or null when it cannot be started here. */
export const installed = (spec: EngineSpec) => describeEngine(spec).catch(() => null);

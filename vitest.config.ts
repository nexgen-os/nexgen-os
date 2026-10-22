import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The packages of this repository import one another by name
// (`@nexgen-os/core`); in the tests the name is the source, through the same
// `paths` tsc and tsx read, so that nothing needs building to be tested.
const { compilerOptions } = JSON.parse(readFileSync(new URL('./tsconfig.json', import.meta.url), 'utf8')) as {
  compilerOptions: { paths: Record<string, string[]> };
};
const alias = Object.fromEntries(
  Object.entries(compilerOptions.paths).map(([name, [file]]) => [name, fileURLToPath(new URL(file, import.meta.url))]),
);

export default defineConfig({
  resolve: { alias },
  test: {
    include: [
      'tests/**/*.test.ts',
      'modules/*/tests/**/*.test.ts',
      'packs/*/tests/**/*.test.ts',
      'packages/*/tests/**/*.test.ts',
      'packages/*/*/tests/**/*.test.ts',
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each file starts a PGlite (Postgres in WebAssembly) whose heap is not
    // given back while the process lives: one child process per file.
    pool: 'forks',
    isolate: true,
    // A machine with little memory bounds the pool: VITEST_MAX_FORKS=2.
    ...(process.env.VITEST_MAX_FORKS ? { maxWorkers: Number(process.env.VITEST_MAX_FORKS) } : {}),
  },
});

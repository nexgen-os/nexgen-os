import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'modules/*/tests/**/*.test.ts', 'packs/*/tests/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each file starts a PGlite (Postgres in WebAssembly) whose heap is not
    // given back while the process lives: one child process per file.
    pool: 'forks',
    isolate: true,
  },
});

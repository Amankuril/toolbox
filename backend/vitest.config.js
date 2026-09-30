import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.js'],
    setupFiles: ['./tests/setup-env.js'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Each file gets its own database and Redis prefix, so files can run in parallel.
    pool: 'forks',
  },
});

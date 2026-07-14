import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    // Launcher integration tests intentionally spawn short-lived fake Tutti CLI
    // processes; allow enough headroom when the root web/server suites run in parallel.
    testTimeout: 10_000,
  },
});

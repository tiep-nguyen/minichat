import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/db/migrate.ts', 'src/db/seed.ts', 'src/server.ts'],
    },
    setupFiles: ['./src/test/setup.ts'],
  },
});

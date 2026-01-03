import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'web/api/lib/**/*.js',
        'runtime-plugins/mongodb.js',
        'runtime-plugins/questdb.js',
      ],
      exclude: [
        'node_modules',
        'web/frontend/**',
        '**/*.test.js',
        '**/test/**',
        'e2e/**',
        // Routes are covered by E2E tests
        'web/api/routes/**',
        // home-assistant.js requires real HA instance
        'runtime-plugins/home-assistant.js',
      ],
    },
    include: ['**/*.test.js'],
    exclude: ['**/node_modules/**', 'web/frontend/**', 'e2e/**'],
    testTimeout: 30000, // Integration tests may take longer
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'web/api/**/*.js',
        'runtime-plugins/mongodb.js',
        'runtime-plugins/questdb.js',
      ],
      exclude: [
        'node_modules',
        'web/frontend/**',
        '**/*.test.js',
        '**/test/**',
        'e2e/**',
        // home-assistant.js requires real HA instance
        'runtime-plugins/home-assistant.js',
      ],
    },
    include: ['**/*.test.js'],
    exclude: ['**/node_modules/**', 'web/frontend/**', 'e2e/**'],
    testTimeout: 30000, // Integration tests may take longer
  },
});

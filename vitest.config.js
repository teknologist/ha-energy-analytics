import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'web/frontend/**',
        '**/*.test.js',
        '**/test/**',
        'e2e/**',
      ],
    },
    include: ['**/*.test.js'],
    exclude: [
      '**/node_modules/**',
      'web/frontend/**',
      'e2e/**',
      '**/test/**', // Exclude test directories (like web/api/test/)
    ],
  },
});

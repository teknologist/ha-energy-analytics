import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: 'html',
  use: {
    // Use 127.0.0.1 instead of localhost for CI to avoid IPv6 resolution issues
    baseURL: process.env.CI ? 'http://127.0.0.1:3044' : 'http://localhost:3044',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Disable automatic webServer in CI - start manually with background flag
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3042',
        reuseExistingServer: true,
        timeout: 120000,
      },
});

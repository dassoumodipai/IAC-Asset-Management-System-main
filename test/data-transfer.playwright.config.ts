import { defineConfig, devices } from '@playwright/test';

// Reuse only the web server; every API request is intercepted with synthetic data.
export default defineConfig({
  testDir: '.',
  testMatch: 'data-transfer.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  outputDir: '../test-results/data-transfer',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    ...devices['Desktop Chrome'],
    channel: 'msedge',
    viewport: { width: 1440, height: 1100 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});

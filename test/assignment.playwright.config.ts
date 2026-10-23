import { defineConfig, devices } from '@playwright/test';

// Reuse only the web server. Every application API request is mocked with synthetic data.
export default defineConfig({
  testDir: '.',
  testMatch: 'assignment-discovery.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  outputDir: '../test-results/assignment-discovery',
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

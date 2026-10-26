import { defineConfig, devices } from '@playwright/test';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: process.env.CI ? 'chromium' : 'edge',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'msedge' as const }),
      },
    },
  ],
  webServer: {
    command: 'node scripts/dev-test.mjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60000,
  },
});

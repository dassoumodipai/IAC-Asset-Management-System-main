import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
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
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 60000,
  },
});

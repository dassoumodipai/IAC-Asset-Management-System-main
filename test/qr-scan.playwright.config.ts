import { defineConfig, devices } from '@playwright/test';

// Reuse only the web server. All API requests are synthetic and intercepted.
export default defineConfig({
  testDir: '.',
  testMatch: 'qr-scan.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  outputDir: '../test-results/qr-scan-output',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173',
    ...devices['Desktop Chrome'],
    channel: 'msedge',
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -w @iac/web -- --port 5174',
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 60000,
  },
});

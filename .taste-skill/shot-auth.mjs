import { chromium } from '@playwright/test';

const out = 'E:/Projects/IAC-Asset-Management-System-main/IAC-Asset-Management-System-main/.taste-skill/after';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.route('**/api/v1/**', async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname.replace('/api/v1', '');
  if (path === '/auth/csrf') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'mock' }) });
  }
  return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) });
});
const base = process.env.BASE || 'http://127.0.0.1:5173';
await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/login-1440.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/login-390.png`, fullPage: true });
await browser.close();
console.log('done');

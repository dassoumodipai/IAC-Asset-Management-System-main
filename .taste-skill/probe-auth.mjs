import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.route('**/api/v1/**', async (r) => {
  const u = new URL(r.request().url());
  const path = u.pathname.replace('/api/v1', '');
  if (path === '/auth/csrf') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'mock' }) });
  return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) });
});
await p.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle' });
const info = await p.evaluate(() => {
  const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height, margin: getComputedStyle(e).margin, position: getComputedStyle(e).position, background: getComputedStyle(e).backgroundColor }; };
  return { content: rect('.access-content'), brand: rect('.access-brand'), sheet: rect('.access-sheet'), card: rect('.auth-card'), html: document.querySelector('.access-content')?.outerHTML.slice(0, 400) };
});
console.log(JSON.stringify(info, null, 2));
await b.close();

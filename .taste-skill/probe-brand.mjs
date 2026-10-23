import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route('**/api/v1/**', async (r) => {
  const u = new URL(r.request().url());
  const path = u.pathname.replace('/api/v1', '');
  if (path === '/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'a@b.c', displayName: 'Test admin', roles: ['ADMIN'], state: 'ACTIVE', emailVerifiedAt: '2026-01-04T00:00:00.000Z', portalAcceptedAt: '2026-01-04T00:00:00.000Z', portalNoticeVersion: '1', currentNoticeVersion: '1', version: 1, mfaEnrolled: true }) });
  if (path === '/dashboard') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'ADMIN', assets: { total: 0, assigned: 0, pendingAcknowledgements: 0, warrantyExpiring: 0 }, tickets: { total: 0, open: 0, inProgress: 0, completed: 0, unassigned: 0 }, unknownCounts: { warrantyExpiry: 0, amcExpiry: 0, financePending: 0 }, imports: { quarantined: 0 } }) });
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ values: [], departments: [], locations: [], items: [], nextCursor: null }) });
});
await p.goto('http://127.0.0.1:5173/dashboard', { waitUntil: 'networkidle' });
const info = await p.evaluate(() => {
  const el = document.querySelector('.sidebar .brand');
  const mark = document.querySelector('.brand-mark');
  const cs = mark ? getComputedStyle(mark) : null;
  return { brand: el?.outerHTML, bgImage: cs?.backgroundImage, mask: cs?.maskImage, content: cs?.content };
});
console.log(info.brand);
console.log(JSON.stringify({ bgImage: info.bgImage, mask: info.mask, content: info.content }));
await b.close();

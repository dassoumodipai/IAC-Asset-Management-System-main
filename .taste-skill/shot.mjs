import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'E:/Projects/IAC-Asset-Management-System-main/IAC-Asset-Management-System-main/.taste-skill/after';
mkdirSync(out, { recursive: true });

const user = {
  id: 'u1',
  email: 'test.admin@indiaautismcenter.org',
  displayName: 'Test admin',
  roles: ['ADMIN'],
  state: 'ACTIVE',
  emailVerifiedAt: '2026-01-04T00:00:00.000Z',
  portalAcceptedAt: '2026-01-04T00:00:00.000Z',
  portalNoticeVersion: '1',
  currentNoticeVersion: '1',
  version: 1,
  mfaEnrolled: true,
};

const summary = {
  role: 'ADMIN',
  assets: { total: 15, assigned: 5, pendingAcknowledgements: 2, warrantyExpiring: 0 },
  tickets: { total: 9, open: 4, inProgress: 1, completed: 4, unassigned: 2 },
  unknownCounts: { warrantyExpiry: 15, amcExpiry: 3, financePending: 15 },
  imports: { quarantined: 0 },
};

const assets = [
  { id: 'a1', assetCode: 'IAC-0001', description: 'Dell Latitude 5440 laptop', category: 'IT', status: 'Assigned', version: 1, serialNumber: 'DL5440-88213', currentAssignment: { id: 'as1', acknowledgement: 'ACCEPTED', version: 1 } },
  { id: 'a2', assetCode: 'IAC-0002', description: 'Epson EB-X51 projector', category: 'AV', status: 'Assigned', version: 1, serialNumber: 'EPX51-33910', currentAssignment: { id: 'as2', acknowledgement: 'PENDING', version: 1 } },
  { id: 'a3', assetCode: 'IAC-0003', description: 'Herman Miller Aeron chair', category: 'Furniture', status: 'In store', version: 1, serialNumber: 'HMA-77120', currentAssignment: null },
  { id: 'a4', assetCode: 'IAC-0004', description: 'Canon imageRUNNER 2630', category: 'Office', status: 'Assigned', version: 1, serialNumber: 'CN2630-10442', currentAssignment: { id: 'as4', acknowledgement: 'ACCEPTED', version: 1 } },
];

const tickets = [
  { id: 't1', ticketNumber: 1042, subject: 'Projector in Room 3 will not power on', priority: 'HIGH', status: 'OPEN', version: 1, ownerId: null },
  { id: 't2', ticketNumber: 1041, subject: 'Laptop fan running loudly since update', priority: 'MEDIUM', status: 'OPEN', version: 1, ownerId: 'u2' },
  { id: 't3', ticketNumber: 1039, subject: 'Request second monitor for design desk', priority: 'LOW', status: 'OPEN', version: 1, ownerId: null },
  { id: 't4', ticketNumber: 1037, subject: 'Printer on second floor jams on A4', priority: 'MEDIUM', status: 'IN_PROGRESS', version: 1, ownerId: 'u2' },
];

const references = {
  values: [
    { kind: 'STATUS', code: 'Assigned', label: 'Assigned', active: true, version: 1 },
    { kind: 'STATUS', code: 'In store', label: 'In store', active: true, version: 1 },
    { kind: 'TICKET_PRIORITY', code: 'HIGH', label: 'High', active: true, version: 1 },
    { kind: 'TICKET_PRIORITY', code: 'MEDIUM', label: 'Medium', active: true, version: 1 },
    { kind: 'TICKET_PRIORITY', code: 'LOW', label: 'Low', active: true, version: 1 },
    { kind: 'TICKET_STATUS', code: 'OPEN', label: 'Open', active: true, version: 1 },
    { kind: 'TICKET_STATUS', code: 'IN_PROGRESS', label: 'In progress', active: true, version: 1 },
    { kind: 'TICKET_STATUS', code: 'COMPLETED', label: 'Completed', active: true, version: 1 },
  ],
  departments: [],
  locations: [],
};

function payload(path) {
  if (path === '/me') return user;
  if (path === '/dashboard') return summary;
  if (path === '/references') return references;
  if (path.startsWith('/tickets')) return { items: tickets, nextCursor: null };
  if (path.startsWith('/assets')) return { items: assets, nextCursor: null };
  if (path === '/auth/csrf') return { csrfToken: 'mock' };
  return { items: [], nextCursor: null };
}

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.route('**/api/v1/**', async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname.replace('/api/v1', '');
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(path)) });
});

const base = process.env.BASE || 'http://127.0.0.1:5173';
await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/dashboard-1440.png`, fullPage: true });
writeFileSync(`${out}/preview.html`, await page.content());

await page.setViewportSize({ width: 768, height: 900 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/dashboard-768.png`, fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/dashboard-390.png`, fullPage: true });

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${base}/assets`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/assets-1440.png`, fullPage: true });

await browser.close();
console.log('done');

import { test, expect, BrowserContext } from '@playwright/test';
import { Pool } from 'pg';
import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto';
import { config } from 'dotenv';
config({ quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Isolated _test database required');
const pool = new Pool({ connectionString: url }),
  origin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const tag = `browser-fin-${randomUUID().slice(0, 8)}`;
let assetId: string,
  assetCode: string,
  admin: any,
  finance: any,
  executive: any,
  employee: any,
  department: string;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
async function identity(roles: string[]) {
  const u = { id: randomUUID(), session: randomBytes(32).toString('hex'), csrf: '' };
  const raw = randomBytes(32).toString('hex');
  u.csrf =
    raw +
    '.' +
    createHmac('sha256', Buffer.from(process.env.CSRF_SECRET!, 'hex'))
      .update(raw)
      .digest('base64url');
  await pool.query(
    `INSERT INTO users(id,email,display_name,state,email_verified_at,portal_accepted_at,portal_notice_version,mfa_enrolled_at,department_id) VALUES($1,$2,$3,'ACTIVE',now(),now(),'1',now(),$4)`,
    [u.id, `${tag}-${u.id}@example.org`, `Demo ${roles.join(' ')}`, department],
  );
  for (const r of roles)
    await pool.query('INSERT INTO user_roles(user_id,role_code) VALUES($1,$2)', [u.id, r]);
  await pool.query(
    `INSERT INTO sessions(id_hash,user_id,csrf_hash,expires_at,mfa_verified_at) VALUES($1,$2,$3,now()+interval '2 hours',now())`,
    [hash(u.session), u.id, hash(u.csrf)],
  );
  return u;
}
async function signIn(context: BrowserContext, u: any) {
  await context.clearCookies();
  await context.addCookies([
    { name: 'iac_dev_session', value: u.session, url: origin, httpOnly: true, sameSite: 'Strict' },
    { name: 'iac_dev_csrf', value: u.csrf, url: origin, sameSite: 'Strict' },
  ]);
}
test.use({ reducedMotion: 'reduce' });
test.beforeAll(async () => {
  const [d] = (
    await pool.query('INSERT INTO departments(code,name) VALUES($1,$1) RETURNING id', [tag])
  ).rows;
  department = d.id;
  admin = await identity(['ADMIN']);
  finance = await identity(['FINANCE']);
  executive = await identity(['EXECUTIVE']);
  employee = await identity(['EMPLOYEE']);
  const [a] = (
    await pool.query(
      `INSERT INTO assets(asset_code,category,asset_type,description,ownership_type,status,condition,risk_level,department_id,created_by) VALUES('IAC-IT-'||lpad(nextval('asset_number_seq')::text,6,'0'),'IT Hardware','Laptop',$1,'Owned','In Store','Good','Low',$2,$3) RETURNING id,asset_code`,
      [`${tag} demo laptop`, department, admin.id],
    )
  ).rows;
  assetId = a.id;
  assetCode = a.asset_code;
});
test.afterAll(async () => {
  await pool.end();
});
test('registrar submits, Finance returns and approves amendment, executive reads without edit powers', async ({
  page,
  context,
}) => {
  await signIn(context, admin);
  await page.goto(`/finance/${assetId}`);
  await expect(page.getByRole('heading', { name: `Finance · ${assetCode}` })).toBeVisible();
  await page.getByLabel('Submission reason').fill('Synthetic invoice ready for independent review');
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/finance/assets/${assetId}/submit`) &&
        r.request().method() === 'POST' &&
        r.status() === 201,
    ),
    page.getByRole('button', { name: 'Submit to Finance', exact: true }).click(),
  ]);
  await expect(page.getByText('SUBMITTED', { exact: true }).first()).toBeVisible();
  await signIn(context, finance);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Finance review', exact: true })).toBeVisible();
  await page.getByLabel('Asset code or description').fill(tag);
  await page.getByRole('link', { name: `Review ${assetCode}` }).click();
  await page.getByLabel('Decision', { exact: true }).selectOption('RETURN');
  await page.getByLabel('Review reason').fill('Correct the invoice reference before approval');
  await page.getByRole('button', { name: 'Return to registrar', exact: true }).click();
  await expect(page.getByText('RETURNED', { exact: true }).first()).toBeVisible();
  await signIn(context, admin);
  await page.goto(`/finance/${assetId}`);
  await page
    .getByLabel('Submission reason')
    .fill('Corrected source invoice attached in demo records');
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/finance/assets/${assetId}/submit`) &&
        r.request().method() === 'POST' &&
        r.status() === 201,
    ),
    page.getByRole('button', { name: 'Submit to Finance', exact: true }).click(),
  ]);
  await expect(page.getByText('SUBMITTED', { exact: true }).first()).toBeVisible();
  await signIn(context, finance);
  await page.goto(`/finance/${assetId}`);
  await page.getByLabel('Purchase cost (INR)').fill('85000.50');
  await page.getByLabel('Purchase date', { exact: true }).fill('2026-01-15');
  await page.getByLabel('Invoice number').fill('DEMO-INV-2026-01');
  await page.getByLabel('Supplier', { exact: true }).fill('Synthetic Equipment Supplier');
  await page
    .getByLabel('Review reason')
    .fill('Invoice total and asset identity independently verified');
  await page.screenshot({ path: '/downloads/iac-finance-review-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Record Finance approval', exact: true }).click();
  await expect(page.getByText('APPROVED', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/downloads/iac-finance-approved-desktop.png', fullPage: true });
  const [row] = (
    await pool.query('SELECT state,approved_cost FROM asset_finance WHERE asset_id=$1', [assetId])
  ).rows;
  expect(row).toEqual({ state: 'APPROVED', approved_cost: '85000.50' });
  await signIn(context, executive);
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: 'Executive overview', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Your executive role has read-only summary access.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'People & access' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Finance review', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/downloads/iac-executive-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Executive overview', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '/downloads/iac-executive-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(`/finance/${assetId}`);
  await expect(page.getByRole('heading', { name: 'Finance access required' })).toBeVisible();
  await signIn(context, employee);
  await page.goto('/executive');
  await expect(page.getByRole('heading', { name: 'Executive access required' })).toBeVisible();
});
test('Finance history reaches older evidence through the real paginated API', async ({
  page,
  context,
}) => {
  await pool.query(
    `INSERT INTO asset_finance_events(asset_id,action,actor_id,reason,finance_version,occurred_at)
    SELECT $1,'SUBMITTED',$2,'Synthetic archived Finance event '||i,i,'2010-01-01 00:00:00.123456+00'::timestamptz
    FROM generate_series(1,57) i`,
    [assetId, admin.id],
  );
  await signIn(context, finance);
  await page.goto(`/finance/${assetId}`);
  const list = page.locator('.finance-history');
  await expect(list.locator('li')).toHaveCount(25);
  await page.getByRole('button', { name: 'Load earlier Finance events', exact: true }).click();
  await expect(list.locator('li')).toHaveCount(50);
  await page.getByRole('button', { name: 'Load earlier Finance events', exact: true }).click();
  const expected = Number(
    (await pool.query('SELECT count(*) FROM asset_finance_events WHERE asset_id=$1', [assetId]))
      .rows[0].count,
  );
  await expect(list.locator('li')).toHaveCount(expected);
  await expect(
    page.getByRole('button', { name: 'Load earlier Finance events', exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await list.locator('li').last().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/downloads/iac-finance-history-paging-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page
    .getByRole('heading', { name: 'Finance history', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/downloads/iac-finance-history-paging-desktop.png' });
});
test('Finance queue combines master-data filters and loads subsequent pages', async ({
  page,
  context,
}) => {
  await pool.query(
    `INSERT INTO assets(asset_code,category,asset_type,description,ownership_type,status,condition,risk_level,department_id,created_by)
    SELECT 'IAC-IT-'||lpad(nextval('asset_number_seq')::text,6,'0'),'IT Hardware',CASE WHEN i<=28 THEN 'Laptop' ELSE 'Monitor' END,$1,'Owned','In Store','Good','Low',$2,$3 FROM generate_series(1,30)i`,
    [`${tag} filter fixture`, department, admin.id],
  );
  await signIn(context, finance);
  await page.goto('/finance');
  await page.getByLabel('Asset code or description').fill(`${tag} filter fixture`);
  await page.getByLabel('Review state').selectOption('UNSUBMITTED');
  await expect(page.locator('#finance-department option').filter({ hasText: tag })).toHaveCount(1);
  await page.getByLabel('Department', { exact: true }).selectOption({ label: tag });
  await page.getByLabel('Asset type', { exact: true }).selectOption('Laptop');
  await expect(page.getByRole('link', { name: /^Review IAC/ })).toHaveCount(25);
  await page.getByRole('button', { name: 'Load more records', exact: true }).click();
  await expect(page.getByRole('link', { name: /^Review IAC/ })).toHaveCount(28);
  await expect(page.getByRole('button', { name: 'Load more records', exact: true })).toHaveCount(0);
  await page.getByLabel('Asset type', { exact: true }).selectOption('Monitor');
  await expect(page.getByRole('link', { name: /^Review IAC/ })).toHaveCount(2);
  await page.screenshot({ path: '/downloads/iac-finance-filters-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/downloads/iac-finance-filters-mobile.png' });
});
test('Finance mobile queue, errors and server unread history remain usable', async ({
  page,
  context,
}) => {
  await signIn(context, finance);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/finance');
  await page.getByLabel('Review state').selectOption('ALL');
  await page.getByLabel('Asset code or description').fill(tag);
  await expect(page.getByRole('link', { name: `Review ${assetCode}` })).toBeVisible();
  await page.screenshot({ path: '/downloads/iac-finance-queue-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Asset code or description').fill('no-such-synthetic-device');
  await expect(page.getByRole('heading', { name: 'No matching records' })).toBeVisible();
  const ids: string[] = [];
  for (let i = 0; i < 110; i++) {
    const [n] = (
      await pool.query(
        `INSERT INTO in_app_announcements(title,message,path,audience,department_id,created_at) VALUES($1,'Synthetic pagination check','/notifications','DEPARTMENT',$2,'2020-01-01'::timestamptz+$3*interval '1 minute') RETURNING id`,
        [`${tag} notice ${i}`, department, i],
      )
    ).rows;
    ids.push(n.id);
  }
  await pool.query(
    'INSERT INTO in_app_announcement_reads(announcement_id,user_id) SELECT unnest($1::uuid[]),$2',
    [ids.slice(1), finance.id],
  );
  await page.goto('/notifications');
  await page.getByRole('button', { name: /^Unread/ }).click();
  await expect(page.getByRole('heading', { name: `${tag} notice 0`, exact: true })).toBeVisible();
  await page.screenshot({ path: '/downloads/iac-old-unread-mobile.png', fullPage: true });
});
test('Admin delivery health shows retry evidence without message content and denies Finance', async ({
  page,
  context,
}) => {
  const o = (
    await pool.query(
      'INSERT INTO notification_outbox(event_key,template,payload) VALUES($1,$2,$3) RETURNING id',
      [randomUUID(), `${tag}-DELIVERY`, { ciphertext: 'DO-NOT-EXPOSE-PRIVATE-TOKEN' }],
    )
  ).rows[0];
  const d = (
    await pool.query(
      "INSERT INTO email_deliveries(outbox_id,recipient,state,attempts,last_error_code) VALUES($1,'synthetic-retry@example.org','DEAD',6,'EAUTH') RETURNING id",
      [o.id],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO email_attempts(delivery_id,attempt_number,result_code) VALUES($1,6,'EAUTH')",
    [d.id],
  );
  await signIn(context, admin);
  await page.goto('/admin/deliveries');
  await expect(
    page.getByRole('heading', { name: 'Email delivery health', exact: true }),
  ).toBeVisible();
  await Promise.all([
    page.waitForResponse(r=>r.url().includes('/api/v1/admin/deliveries?state=DEAD')&&r.status()===200),
    page.getByLabel('Delivery state').selectOption('DEAD'),
  ]);
  await expect(page.locator('article').first()).toBeVisible();
  const card = page.locator('article').filter({ hasText: `${tag}-DELIVERY` });
  // Delivery IDs are random UUIDs, not chronological. Accumulated fixtures can
  // put this record on any page; exercise the real pagination rather than
  // assuming the newest insertion sorts first.
  while (!(await card.count())) {
    const more = page.getByRole('button', { name: 'Load more deliveries', exact: true });
    if (!(await more.count())) break;
    const count = await page.locator('article').count();
    await more.click();
    await expect.poll(() => page.locator('article').count()).toBeGreaterThan(count);
  }
  await expect(card).toBeVisible();
  await expect(card).toContainText('6 / 6');
  await card.getByText('Attempt history', { exact: true }).click();
  await expect(card).toContainText('Attempt 6: EAUTH');
  await expect(page.getByText('DO-NOT-EXPOSE-PRIVATE-TOKEN')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/downloads/iac-delivery-health-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Email delivery health', exact: true }),
  ).toBeVisible();
  await Promise.all([
    page.waitForResponse(r=>r.url().includes('/api/v1/admin/deliveries?state=DEAD')&&r.status()===200),
    page.getByLabel('Delivery state').selectOption('DEAD'),
  ]);
  await expect(page.locator('article').first()).toBeVisible();
  // Delivery IDs are random UUIDs, not chronological. Accumulated fixtures can
  // put this record on any page; exercise the real pagination rather than
  // assuming the newest insertion sorts first.
  while (!(await card.count())) {
    const more = page.getByRole('button', { name: 'Load more deliveries', exact: true });
    if (!(await more.count())) break;
    const count = await page.locator('article').count();
    await more.click();
    await expect.poll(() => page.locator('article').count()).toBeGreaterThan(count);
  }
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/downloads/iac-delivery-health-mobile.png', fullPage: true });
  await signIn(context, finance);
  await page.goto('/admin/deliveries');
  await expect(
    page.getByRole('heading', { name: 'Email delivery health', exact: true }),
  ).toHaveCount(0);
  const response = await page.request.get('/api/v1/admin/deliveries');
  expect(response.status()).toBe(403);
});

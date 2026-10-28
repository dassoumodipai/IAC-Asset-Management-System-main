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
test('role and viewport visual audit',async({page,context})=>{
 const routes=[['admin',admin,['/dashboard','/equipment/people','/finance','/assets','/assets/new','/tickets','/tickets/new','/admin/users','/master-control','/admin/imports','/admin/audit','/admin/announcements','/admin/deliveries','/assets/labels','/profile','/notifications','/install']],['finance',finance,['/dashboard','/equipment/people',`/finance/${assetId}`,'/executive','/profile']],['executive',executive,['/dashboard','/profile']],['employee',employee,['/dashboard','/equipment/mine','/assets','/tickets/new','/profile']]] as const;
 const findings:any[]=[];
 for(const[role,u,paths]of routes){await signIn(context,u);for(const path of paths){for(const width of[1280,390]){await page.setViewportSize({width,height:844});await page.goto(path);await expect(page.locator('main')).toBeVisible();await page.waitForLoadState('networkidle');await page.evaluate(()=>scrollTo(0,0));const file=`/downloads/iac-ui-audit/${role}-${path.replaceAll('/','_')}-${width}.png`;await page.screenshot({path:file});const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,heading:document.querySelector('main h1,main h2,main h3')?.textContent,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),overflowElements:[...document.querySelectorAll('main *')].filter(e=>!e.closest('.table-scroll,.master-groups nav')&&e.getBoundingClientRect().right>innerWidth+2).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.slice(0,65)}))}));findings.push({role,path,width,file,...result});}}}
 console.log(JSON.stringify(findings));
 expect(findings.filter(f=>f.overflow)).toEqual([]);
});

// Synthetic disposable local HTTP probe. Not a capacity/SLA certification.
import { config } from 'dotenv';
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
config({ quiet: true });
const source = new URL(process.env.TEST_DATABASE_URL || 'invalid:');
if (
  !['postgres:', 'postgresql:'].includes(source.protocol) ||
  !source.pathname.endsWith('_test') ||
  source.search ||
  !['127.0.0.1', 'localhost'].includes(source.hostname)
)
  throw new Error('Loopback isolated _test source required');
const name = `iac_load_${randomBytes(5).toString('hex')}_test`,
  adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const admin = new Pool({ connectionString: adminUrl.toString() });
const target = new URL(source);
target.pathname = '/' + name;
let created = false,
  pool,
  app;
const hash = (s) => createHash('sha256').update(s).digest('hex');
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = target.toString();
  process.env.TEST_DATABASE_URL = target.toString();
  process.env.MIGRATION_DATABASE_URL = target.toString();
  const migration = spawnSync('npm', ['run', 'db:migrate'], {
    encoding: 'utf8',
    env: process.env,
    timeout: 60000,
  });
  if (migration.status !== 0) throw new Error('Disposable migration failed');
  pool = new Pool({ connectionString: target.toString() });
  const identities = [];
  for (const role of ['ADMIN', 'FINANCE', 'EXECUTIVE', 'EMPLOYEE', 'IT_ADMIN']) {
    const id = randomUUID(),
      session = randomBytes(32).toString('hex'),
      raw = randomBytes(24).toString('hex');
    const csrf =
      raw +
      '.' +
      createHmac('sha256', Buffer.from(process.env.CSRF_SECRET, 'hex'))
        .update(raw)
        .digest('base64url');
    await pool.query(
      "INSERT INTO users(id,email,display_name,state,email_verified_at,portal_accepted_at,portal_notice_version,mfa_enrolled_at) VALUES($1,$2,$3,'ACTIVE',now(),now(),'1',now())",
      [id, `synthetic-${id}@example.org`, `Synthetic ${role}`],
    );
    await pool.query('INSERT INTO user_roles(user_id,role_code) VALUES($1,$2)', [id, role]);
    await pool.query(
      "INSERT INTO sessions(id_hash,user_id,csrf_hash,expires_at,mfa_verified_at) VALUES($1,$2,$3,now()+interval '1 hour',now())",
      [hash(session), id, hash(csrf)],
    );
    identities.push({ id, session, csrf, role });
  }
  const [registrar, finance, executive, employee, it] = identities;
  await pool.query(
    `INSERT INTO assets(asset_code,category,asset_type,description,ownership_type,status,condition,risk_level,created_by)
  SELECT 'IAC-IT-'||lpad(n::text,6,'0'),'IT Hardware','Laptop','Synthetic mixed-load device '||n,'Owned','In Store','Good','Low',$1 FROM generate_series(1,50000)n`,
    [registrar.id],
  );
  const assets = (
    await pool.query('SELECT id,asset_code FROM assets ORDER BY asset_code LIMIT 1000')
  ).rows;
  await pool.query(
    "INSERT INTO asset_finance(asset_id,state,asset_version,submitted_by,submission_reason) SELECT id,'SUBMITTED',version,$1,'Synthetic load submission' FROM assets ORDER BY asset_code LIMIT 1000",
    [registrar.id],
  );
  await pool.query(
    "INSERT INTO asset_finance_events(asset_id,action,actor_id,reason,finance_version) SELECT id,'SUBMITTED',$1,'Synthetic load evidence',1 FROM assets ORDER BY asset_code LIMIT 1000",
    [registrar.id],
  );
  await pool.query('ANALYZE');
  const { createApp } = require('../apps/api/dist/main.js');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const cases = [
    [registrar, '/assets?limit=25', 200],
    [registrar, '/assets?q=25000&limit=25', 200],
    [finance, '/finance/queue?state=SUBMITTED&limit=25', 200],
    [executive, '/finance/executive-summary', 200],
    [finance, `/finance/assets/${assets[0].id}/history`, 200],
    [employee, '/equipment/people', 403],
    [it, '/finance/queue', 403],
    [employee, `/finance/assets/${assets[0].id}`, 403],
  ];
  const measurements = cases.map(([, path, status]) => ({
    path,
    expected: status,
    ms: [],
    errors: 0,
  }));
  const start = performance.now();
  let counter = 0;
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      while (performance.now() - start < 10000) {
        const i = counter++ % cases.length,
          [user, path, expected] = cases[i],
          t = performance.now();
        try {
          const r = await fetch(base + path, {
            headers: { Cookie: `iac_dev_session=${user.session}; iac_dev_csrf=${user.csrf}` },
            signal: AbortSignal.timeout(10000),
          });
          const body = await r.json();
          let valid = r.status === expected;
          if (valid && expected === 200) {
            if (path.includes('executive-summary'))
              valid = body.totalAssets === 50000 && body.pendingReviews === 1000;
            else if (path.endsWith('/history'))
              valid = Array.isArray(body.items) && body.items.length === 1;
            else
              valid = Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 25;
          }
          if (valid && expected === 403) valid = body.error?.code === 'FORBIDDEN';
          if (!valid) measurements[i].errors++;
        } catch {
          measurements[i].errors++;
        }
        measurements[i].ms.push(performance.now() - t);
      }
    }),
  );
  const elapsed = performance.now() - start;
  const results = measurements.map(({ ms, ...m }) => {
    ms.sort((a, b) => a - b);
    return {
      ...m,
      requests: ms.length,
      medianMs: ms[Math.floor(ms.length * 0.5)],
      p95Ms: ms[Math.min(ms.length - 1, Math.ceil(ms.length * 0.95) - 1)],
      maxMs: ms.at(-1),
    };
  });
  const errorCount = results.reduce((s, r) => s + r.errors, 0);
  const evidence = (await pool.query('SELECT count(*)::int AS n FROM asset_finance_events')).rows[0]
    .n;
  if (evidence !== 1000) throw new Error('Read-only workload changed Finance evidence');
  console.log(
    JSON.stringify(
      {
        scope:
          '20 concurrent local HTTP readers over50000synthetic assets and1000submitted Finance records; no mutation workload, files, production traffic or SMTP',
        durationMs: elapsed,
        totalRequests: counter,
        errorCount,
        results,
        financeEvidenceUnchanged: true,
        limits:
          'Local PostgreSQL14/Node24 warm run. Not sustained production capacity, WAN latency, write contention, attachment/import load, availability or an SLA.',
      },
      null,
      2,
    ),
  );
  if (errorCount) process.exitCode = 1;
} finally {
  await app?.close();
  await pool?.end();
  try {
    if (created) await admin.query(`DROP DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

// Disposable synthetic-data drill only. Never accepts a production database.
import { config } from 'dotenv';
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
config({ quiet: true });
const source = new URL(process.env.TEST_DATABASE_URL || 'invalid:');
if (
  !['postgres:', 'postgresql:'].includes(source.protocol) ||
  !source.pathname.endsWith('_test') ||
  source.search !== '' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname)
)
  throw new Error('Restore drill requires a loopback isolated _test database');
const name = `iac_restore_${randomBytes(6).toString('hex')}_test`;
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const target = new URL(source);
target.pathname = `/${name}`;
const admin = new Pool({ connectionString: adminUrl.toString() });
const original = new Pool({ connectionString: source.toString() });
let restored,
  created = false;
const folder = await mkdtemp(join(tmpdir(), 'iac-restore-'));
await chmod(folder, 0o700);
const archive = join(folder, 'synthetic.dump');
const tables = [
  'schema_migrations',
  'users',
  'assets',
  'assignments',
  'assignment_events',
  'asset_movements',
  'tickets',
  'ticket_updates',
  'asset_finance',
  'asset_finance_events',
  'audit_events',
  'notification_outbox',
  'email_deliveries',
  'email_attempts',
  'asset_photos',
  'ticket_photos',
];
function pg(command, url, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    },
  });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed; backup/restore drill not verified`);
}
async function counts(pool) {
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        (
          await pool.query(
            `SELECT count(*)::text AS count,md5(coalesce(string_agg(digest,',' ORDER BY digest),'')) AS digest FROM (SELECT md5(row_to_json(t)::text) AS digest FROM ${table} t) rows`,
          )
        ).rows[0],
      ]),
    ),
  );
}
try {
  const before = await counts(original);
  pg('pg_dump', source, ['--format=custom', '--no-owner', '--no-acl', '--file', archive]);
  await chmod(archive, 0o600);
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  created = true;
  pg('pg_restore', target, [
    '--dbname',
    name,
    '--exit-on-error',
    '--no-owner',
    '--no-acl',
    archive,
  ]);
  restored = new Pool({ connectionString: target.toString() });
  const after = await counts(restored);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error(
      'Source changed during drill or restored counts differ; rerun with test writers stopped',
    );
  const checks = [
    `SELECT count(*)::int AS n FROM (SELECT asset_id FROM assignments WHERE ended_at IS NULL GROUP BY asset_id HAVING count(*)>1) x`,
    `SELECT count(*)::int AS n FROM asset_finance f LEFT JOIN assets a ON a.id=f.asset_id WHERE a.id IS NULL`,
    `SELECT count(*)::int AS n FROM asset_finance_events e LEFT JOIN users u ON u.id=e.actor_id WHERE u.id IS NULL`,
  ];
  for (const sql of checks)
    if ((await restored.query(sql)).rows[0].n !== 0)
      throw new Error('Restored integrity invariant failed');
  const trigger = (
    await restored.query(
      "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='immutable_finance_events' AND NOT tgisinternal",
    )
  ).rows[0].n;
  if (trigger !== 1) throw new Error('Immutable Finance trigger missing from restore');
  const client = await restored.connect();
  try {
    await client.query('BEGIN');
    const event = (await client.query('SELECT id FROM asset_finance_events LIMIT 1')).rows[0];
    if (!event) throw new Error('Need synthetic Finance evidence to verify restored trigger');
    let rejected = false;
    try {
      await client.query(
        "UPDATE asset_finance_events SET reason='forbidden restore probe' WHERE id=$1",
        [event.id],
      );
    } catch (error) {
      rejected = /append only/.test(error.message);
    }
    if (!rejected) throw new Error('Restored Finance evidence accepted mutation');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        scope:
          'Synthetic loopback logical dump and disposable restore; no worker or SMTP dispatch started',
        tableCounts: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.count])),
        allSelectedRowDigestsMatch: true,
        integrityChecks: checks.length,
        financeTriggerPresent: true,
        financeMutationRejected: true,
        limits:
          'Not production PITR, encrypted-backup proof, key recovery, RPO/RTO guarantee or disaster recovery certification',
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await restored?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
  } finally {
    await Promise.allSettled([original.end(), admin.end()]);
    await rm(folder, { recursive: true, force: true });
  }
}

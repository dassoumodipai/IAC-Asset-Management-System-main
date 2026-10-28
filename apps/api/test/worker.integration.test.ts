import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/db';
import { dispatchOnce } from '../src/worker';
const connection = process.env.TEST_DATABASE_URL;
if (!connection || !new URL(connection).pathname.endsWith('_test'))
  throw new Error('Worker tests require isolated TEST_DATABASE_URL ending _test');
process.env.DATABASE_URL = connection;
const db = new Db();
after(async () => db.onModuleDestroy());

// The integration suite requires its fake SMTP dependency. Missing SMTP must fail, not pass silently.
async function checkSmtpAvailable(): Promise<boolean> {
  const smtpPort = process.env.SMTP_PORT || '1025';
  const smtpHost = process.env.SMTP_HOST || '127.0.0.1';
  try {
    const net = await import('node:net');
    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: smtpHost, port: parseInt(smtpPort) }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}
async function delivery() {
  const key = `worker-test-${randomUUID()}`;
  await db.tx((c) =>
    db.notify(c, key, 'TEST', [`${key}@example.org`], {
      subject: 'Synthetic worker test',
      text: 'Local Mailpit only.',
    }),
  );
  const [row] = await db.query(
    'SELECT d.* FROM email_deliveries d JOIN notification_outbox o ON o.id=d.outbox_id WHERE o.event_key=$1',
    [key],
  );
  await db.query("UPDATE email_deliveries SET next_attempt_at='2000-01-01' WHERE id=$1", [row.id]);
  return row;
}
test('SMTP worker accepts local mail and records the sent Message-ID', async () => {
  assert.ok(await checkSmtpAvailable(), 'SMTP integration requires local fake mail sink');
  const row = await delivery();
  await dispatchOnce(db);
  const [sent] = await db.query('SELECT * FROM email_deliveries WHERE id=$1', [row.id]);
  assert.equal(sent.state, 'ACCEPTED');
  assert.ok(sent.provider_message_id.includes(row.id));
  assert.equal(
    (await db.query('SELECT result_code FROM email_attempts WHERE delivery_id=$1', [row.id]))[0]
      .result_code,
    'SMTP_ACCEPTED',
  );
});
test('expired worker lease is reclaimed without creating another delivery', async () => {
  assert.ok(await checkSmtpAvailable(), 'SMTP integration requires local fake mail sink');
  const row = await delivery();
  await db.query(
    "UPDATE email_deliveries SET state='LEASED',attempts=1,leased_until=now()-interval '1 minute',lease_token=$2 WHERE id=$1",
    [row.id, randomUUID()],
  );
  await dispatchOnce(db);
  const [sent] = await db.query('SELECT * FROM email_deliveries WHERE id=$1', [row.id]);
  assert.equal(sent.state, 'ACCEPTED');
  assert.equal(sent.attempts, 2);
  assert.equal(sent.lease_token, null);
});
test('SMTP outage leaves durable pending retry and recovers', async () => {
  assert.ok(await checkSmtpAvailable(), 'SMTP integration requires local fake mail sink');
  const row = await delivery();
  const old = process.env.SMTP_PORT;
  process.env.SMTP_PORT = '1';
  try {
    await dispatchOnce(db);
  } finally {
    process.env.SMTP_PORT = old;
  }
  let [state] = await db.query('SELECT * FROM email_deliveries WHERE id=$1', [row.id]);
  assert.equal(state.state, 'PENDING');
  assert.equal(state.attempts, 1);
  assert.ok(new Date(state.next_attempt_at) > new Date());
  await db.query("UPDATE email_deliveries SET next_attempt_at='2000-01-01' WHERE id=$1", [row.id]);
  await dispatchOnce(db);
  [state] = await db.query('SELECT * FROM email_deliveries WHERE id=$1', [row.id]);
  assert.equal(state.state, 'ACCEPTED');
  assert.equal(state.attempts, 2);
});

test('expired authentication delivery is dead-lettered without sending and lease credentials are cleared', async () => {
  const row = await delivery();
  await db.query(
    "UPDATE notification_outbox SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [row.outbox_id],
  );
  await db.query(
    "UPDATE email_deliveries SET state='LEASED',leased_until=now()-interval '1 minute',lease_token=$2 WHERE id=$1",
    [row.id, randomUUID()],
  );
  await dispatchOnce(db);
  const [dead] = await db.query('SELECT * FROM email_deliveries WHERE id=$1', [row.id]);
  assert.equal(dead.state, 'DEAD');
  assert.equal(dead.last_error_code, 'EXPIRED');
  assert.equal(dead.attempts, 0);
  assert.equal(dead.lease_token, null);
  assert.equal(dead.leased_until, null);
  assert.equal(
    (await db.query('SELECT * FROM email_attempts WHERE delivery_id=$1', [row.id])).length,
    0,
  );
  assert.deepEqual(
    (await db.query('SELECT payload FROM notification_outbox WHERE id=$1', [row.outbox_id]))[0]
      .payload,
    {},
  );
});
test('concurrent worker claims do not send the same queued delivery twice', async () => {
  assert.ok(await checkSmtpAvailable(), 'Concurrent SMTP test requires local fake mail sink');
  const rows = await Promise.all([delivery(), delivery()]);
  await Promise.all([dispatchOnce(db), dispatchOnce(db)]);
  for (const row of rows) {
    const [sent] = await db.query('SELECT state,attempts FROM email_deliveries WHERE id=$1', [
      row.id,
    ]);
    assert.equal(sent.state, 'ACCEPTED');
    assert.equal(sent.attempts, 1);
    assert.equal(
      (await db.query('SELECT id FROM email_attempts WHERE delivery_id=$1', [row.id])).length,
      1,
    );
  }
});

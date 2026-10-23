import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'dotenv';
import { mergeSmtpEnvironment, validateGmailConfig } from '../src/gmail-setup';

const valid = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'synthetic@example.org',
  SMTP_PASSWORD: 'a'.repeat(16),
  SMTP_FROM: 'synthetic@example.org',
};

test('Gmail config accepts the fixed TLS endpoint and normalizes the sender', () => {
  const config = validateGmailConfig({
    ...valid,
    SMTP_USER: ' Synthetic@Example.org ',
    SMTP_FROM: ' SYNTHETIC@EXAMPLE.ORG ',
    UNRELATED: 'ignored',
  });
  assert.deepEqual(config, valid);
  assert.equal(Object.keys(config).length, 6);
});

test('Gmail config rejects host, port and TLS overrides', () => {
  for (const changes of [
    { SMTP_HOST: 'smtp-relay.gmail.com' },
    { SMTP_HOST: '127.0.0.1' },
    { SMTP_PORT: '587' },
    { SMTP_SECURE: 'false' },
    { SMTP_SECURE: '' },
  ])
    assert.throws(() => validateGmailConfig({ ...valid, ...changes }));
});

test('Gmail config rejects missing, malformed or mismatched senders without exposing addresses', () => {
  for (const changes of [
    { SMTP_USER: '' },
    { SMTP_USER: 'not-an-address' },
    { SMTP_USER: 'synthetic@example.org\nBcc:another@example.org' },
    { SMTP_FROM: 'different@example.org' },
    { SMTP_FROM: 'Display <synthetic@example.org>' },
  ]) {
    assert.throws(
      () => validateGmailConfig({ ...valid, ...changes }),
      (error: Error) => !error.message.includes('@'),
    );
  }
});

test('Gmail config requires exactly sixteen app-password characters', () => {
  for (const password of ['', 'a'.repeat(15), 'a'.repeat(17), 'a'.repeat(15) + '!', '123456'])
    assert.throws(() => validateGmailConfig({ ...valid, SMTP_PASSWORD: password }));
});

test('Gmail config accepts displayed groups while rejecting other password controls', () => {
  assert.equal(
    validateGmailConfig({ ...valid, SMTP_PASSWORD: 'aaaa aaaa aaaa aaaa' }).SMTP_PASSWORD,
    valid.SMTP_PASSWORD,
  );
  assert.throws(() => validateGmailConfig({ ...valid, SMTP_PASSWORD: 'aaaa\taaaa aaaa aaaa' }));
  assert.throws(() => validateGmailConfig({ ...valid, SMTP_PASSWORD: 'aaaa\naaaa aaaa aaaa' }));
});

test('A prepared draft may omit the password but activation may not', () => {
  const draft = { ...valid, SMTP_PASSWORD: '' };
  assert.equal(validateGmailConfig(draft, false).SMTP_PASSWORD, '');
  assert.throws(() => validateGmailConfig(draft));
  assert.throws(() => validateGmailConfig({ ...draft, SMTP_PASSWORD: 'bad' }, false));
});

test('SMTP merge preserves unrelated configuration, comments and CRLF lines', () => {
  const preserved =
    '# retain this comment\r\n' +
    'DATABASE_URL="synthetic-database"\r\n' +
    'AUTH_MAIL_ENCRYPTION_KEY=synthetic-key\r\n' +
    'SESSION_SECRET=synthetic-session # preserve comment\r\n' +
    '\r\n';
  const original = preserved + 'SMTP_HOST=127.0.0.1\r\nSMTP_PORT=11025\r\n';
  const merged = mergeSmtpEnvironment(original, valid);
  assert.ok(merged.startsWith(preserved));
  const before = parse(original);
  const after = parse(merged);
  for (const key of ['DATABASE_URL', 'AUTH_MAIL_ENCRYPTION_KEY', 'SESSION_SECRET'])
    assert.equal(after[key], before[key]);
  for (const [key, value] of Object.entries(valid)) assert.equal(after[key], value);
  assert.equal(merged.replace(/\r\n/g, '').includes('\n'), false);
});

test('SMTP merge preserves apparent SMTP assignments inside quoted multiline values', () => {
  const preserved =
    'PRIVATE_TEXT="first line\nSMTP_HOST=must-stay\nSMTP_PASSWORD=not-a-setting\nlast line"\n' +
    "OTHER_TEXT='single quoted\nSMTP_USER=must-also-stay\nlast line'\n" +
    'BACKTICK_TEXT=`backtick quoted\nSMTP_FROM=must-stay-too\nlast line`\n';
  const original = preserved + 'SMTP_PASSWORD="old\nmultiline-value"\nSMTP_HOST=localhost\n';
  const merged = mergeSmtpEnvironment(original, valid);
  assert.ok(merged.startsWith(preserved));
  const before = parse(original);
  const after = parse(merged);
  for (const key of ['PRIVATE_TEXT', 'OTHER_TEXT', 'BACKTICK_TEXT'])
    assert.equal(after[key], before[key]);
  assert.equal(after.SMTP_PASSWORD, valid.SMTP_PASSWORD);
  assert.equal(merged.includes('multiline-value'), false);
});

test('SMTP merge removes duplicate assignments and accepts files without a final newline', () => {
  const original = 'SMTP_PORT=1025\nexport SMTP_PORT=11025\nSMTP_HOST=localhost\nKEEP_ME=synthetic';
  const merged = mergeSmtpEnvironment(original, valid);
  const after = parse(merged);
  assert.equal(after.KEEP_ME, 'synthetic');
  assert.equal(after.SMTP_PORT, '465');
  assert.equal(merged.match(/^SMTP_PORT=/gm)?.length, 1);
  assert.equal(merged.includes('export SMTP_PORT='), false);
  assert.deepEqual(parse(mergeSmtpEnvironment(merged, valid)), after);
  assert.throws(() => mergeSmtpEnvironment(original, { ...valid, SMTP_SECURE: 'false' }));
});

import { chmod, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parse } from 'dotenv';
import nodemailer from 'nodemailer';
import { z } from 'zod';

const smtpKeys = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
] as const;
export type GmailSmtpConfig = Record<(typeof smtpKeys)[number], string>;
const root = resolve(__dirname, '../../../');
const candidatePath = resolve(root, '.env.smtp.gmail');
const activePath = resolve(root, '.env');

class SetupError extends Error {}

export function validateGmailConfig(
  values: Record<string, string>,
  requirePassword = true,
): GmailSmtpConfig {
  const sender = z.string().trim().toLowerCase().email().max(254).safeParse(values.SMTP_USER);
  if (!sender.success) throw new SetupError('A valid sender address is required in SMTP_USER.');
  const password = (values.SMTP_PASSWORD ?? '').replace(/ /g, '');
  if (
    values.SMTP_HOST !== 'smtp.gmail.com' ||
    values.SMTP_PORT !== '465' ||
    values.SMTP_SECURE !== 'true' ||
    values.SMTP_FROM?.trim().toLowerCase() !== sender.data
  )
    throw new SetupError(
      'Gmail setup requires smtp.gmail.com, port 465, TLS, and matching sender.',
    );
  if ((requirePassword || password !== '') && !/^[a-zA-Z0-9]{16}$/.test(password))
    throw new SetupError('Enter a 16-character Google app password, not your account password.');
  return {
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: sender.data,
    SMTP_PASSWORD: password,
    SMTP_FROM: sender.data,
  };
}

function serialize(config: GmailSmtpConfig, newline = '\n'): string {
  return smtpKeys.map((key) => `${key}=${JSON.stringify(config[key])}`).join(newline) + newline;
}

export function mergeSmtpEnvironment(original: string, config: GmailSmtpConfig): string {
  const checked = validateGmailConfig(config);
  // Consume complete assignments, including quoted multiline values, before matching the next key.
  const assignment =
    /^[ \t]*(?:export[ \t]+)?([\w.-]+)(?:[ \t]*=[ \t]*|:[ \t]+)([ \t]*'(?:\\'|[^'])*'|[ \t]*"(?:\\"|[^"])*"|[ \t]*`(?:\\`|[^`])*`|[^#\r\n]*)[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/gm;
  const preserved = original.replace(assignment, (line: string, key: string) =>
    smtpKeys.includes(key as (typeof smtpKeys)[number]) ? '' : line,
  );
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const merged =
    preserved +
    (preserved && !preserved.endsWith('\n') ? newline : '') +
    serialize(checked, newline);
  const before = parse(original);
  const after = parse(merged);
  for (const key of Object.keys(before)) {
    if (!smtpKeys.includes(key as (typeof smtpKeys)[number]) && before[key] !== after[key])
      throw new SetupError(
        'Unrelated environment settings could not be preserved; no change made.',
      );
  }
  return merged;
}

async function hiddenPrompt(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new SetupError(
      'Use an interactive terminal; private values are never accepted as arguments.',
    );
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    process.stdout.write(prompt);
    return await rl.question('');
  } finally {
    process.stdout.write('\n');
    rl.close();
  }
}

async function writePrivate(path: string, text: string, exclusive = false): Promise<void> {
  const target = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const file = await open(target, 'wx', 0o600);
  try {
    await file.writeFile(text, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    if (!exclusive) await rename(target, path);
    await chmod(path, 0o600);
  } finally {
    if (!exclusive) await unlink(target).catch(() => undefined);
  }
}

async function verify(config: GmailSmtpConfig): Promise<void> {
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    tls: { servername: 'smtp.gmail.com', rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    logger: false,
    debug: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  try {
    await transport.verify();
  } catch {
    throw new SetupError(
      'SMTP verification failed. Check app-password eligibility and connectivity.',
    );
  } finally {
    transport.close();
  }
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['prepare', 'verify', 'activate'].includes(mode ?? ''))
    throw new SetupError('Usage: npm run email:gmail -- prepare|verify|activate');
  if (mode === 'prepare') {
    const sender = await hiddenPrompt('Google Workspace sender address (hidden): ');
    const candidate = validateGmailConfig(
      {
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: sender,
        SMTP_PASSWORD: '',
        SMTP_FROM: sender,
      },
      false,
    );
    await writePrivate(candidatePath, serialize(candidate), true);
    process.stdout.write('Private Gmail draft prepared. Active SMTP settings are unchanged.\n');
    return;
  }
  let candidate = validateGmailConfig(parse(await readFile(candidatePath, 'utf8')), false);
  if (mode === 'verify') {
    if (!candidate.SMTP_PASSWORD)
      candidate = validateGmailConfig({
        ...candidate,
        SMTP_PASSWORD: await hiddenPrompt('Google app password (16 characters; hidden): '),
      });
    await verify(candidate);
    await writePrivate(candidatePath, serialize(candidate));
    process.stdout.write('SMTP authentication verified and saved privately. No email was sent.\n');
    return;
  }
  candidate = validateGmailConfig(candidate);
  await verify(candidate);
  const active = await readFile(activePath, 'utf8');
  await writePrivate(activePath, mergeSmtpEnvironment(active, candidate));
  process.stdout.write(
    'SMTP settings activated. No process was restarted and no email was sent. Keep the worker stopped until outbound delivery is approved.\n',
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException)?.code;
    process.stderr.write(
      error instanceof SetupError
        ? `${error.message}\n`
        : code === 'EEXIST'
          ? 'Private Gmail draft already exists; use verify or retain it privately before preparing again.\n'
          : code === 'ENOENT'
            ? 'A required private configuration file is missing. Run prepare first; active .env is required for activation.\n'
            : 'SMTP setup could not complete. Private configuration and raw errors were not displayed.\n',
    );
    process.exitCode = 1;
  });
}

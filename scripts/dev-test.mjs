import { config } from 'dotenv';
import { spawn } from 'node:child_process';
config({ quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('TEST_DATABASE_URL must name an isolated _test database');
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run browser tests with npm run test:e2e');
const child = spawn(process.execPath, [cli, 'run', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '11025',
    SMTP_SECURE: 'false',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    SMTP_FROM: 'synthetic-tests@example.org',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));

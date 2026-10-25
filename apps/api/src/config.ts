import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
export const requestContext = new AsyncLocalStorage<{ id: string }>();
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
dotenv({ path: resolve(__dirname, '../../../.env'), quiet: true });
export const configuration = () => {
  const production = process.env.NODE_ENV === 'production';
  const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173';
  const url = new URL(origin);
  if (url.origin !== origin || (production && url.protocol !== 'https:'))
    throw new Error('APP_ORIGIN must be an origin and use HTTPS in production');
  const origins = [...new Set([
    origin,
    ...(process.env.ADDITIONAL_APP_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ])];
  for (const allowedOrigin of origins) {
    const parsed = new URL(allowedOrigin);
    if (parsed.origin !== allowedOrigin || (production && parsed.protocol !== 'https:'))
      throw new Error('Every additional app origin must be an exact HTTPS origin in production');
  }
  return {
    production,
    origin,
    origins,
    port: Number(process.env.PORT || 3000),
    databaseUrl: process.env.DATABASE_URL || '',
    sessionCookie: production ? '__Host-iac_session' : 'iac_dev_session',
    csrfCookie: production ? '__Host-iac_csrf' : 'iac_dev_csrf',
    noticeVersion: process.env.PORTAL_NOTICE_VERSION || '1',
  };
};
export function encryptionKey(name: string): Buffer {
  const value = process.env[name] || '';
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error(`${name} must contain 32 random bytes encoded as 64 hexadecimal characters`);
  return Buffer.from(value, 'hex');
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function encrypt(value: string, keyName: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyName), iv);
  return Buffer.concat([
    iv,
    cipher.update(value, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}
export function decrypt(value: string, keyName: string): string {
  const data = Buffer.from(value, 'base64');
  if (data.length < 28) throw new Error('Invalid encrypted envelope');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(keyName), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString(
    'utf8',
  );
}
export function signedCsrf(value = token()): string {
  return `${value}.${createHmac('sha256', encryptionKey('CSRF_SECRET')).update(value).digest('base64url')}`;
}
export function validCsrf(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 200) return false;
  const raw = value.split('.')[0];
  return !!raw && equal(value, signedCsrf(raw));
}

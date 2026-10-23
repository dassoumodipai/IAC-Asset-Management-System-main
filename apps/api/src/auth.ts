import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import * as argon2 from 'argon2';
import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Db } from './db';
import {
  AuthRequest,
  assertVersion,
  publicUser,
  requireRole,
  resolveSession,
  SessionGuard,
  staff,
} from './security';
import {
  configuration,
  decrypt,
  encrypt,
  equal,
  hash,
  signedCsrf,
  token,
  validCsrf,
} from './config';
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(128);
const name = z.string().trim().min(1).max(120);
const tokenInput = z.object({ token: z.string().min(32).max(200) }).strict();
const generic = { message: 'If this request is eligible, an email will arrive shortly.' };
export const passwordHash = (value: string) =>
  argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const dummyHash = passwordHash(randomBytes(32).toString('hex'));
export function base32(bytes: Buffer): string {
  let bits = 0,
    value = 0,
    result = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      result += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value << (5 - bits)) & 31];
  return result;
}
function base32Decode(value: string): Buffer {
  let bits = 0,
    buffer = 0;
  const out: number[] = [];
  for (const c of value) {
    const index = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);
    if (index < 0) throw new Error('Invalid MFA secret');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secret: string, counter = Math.floor(Date.now() / 30000)): string {
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(input).digest();
  const offset = digest[19]! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
export function validTotp(secret: string, code: string, lastCounter: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const n of [now - 1, now, now + 1])
    if ((lastCounter === null || n > lastCounter) && equal(totp(secret, n), code)) return n;
  return null;
}
@Injectable()
export class AuthService {
  constructor(@Inject(Db) readonly db: Db) {}
  async throttle(req: Request, key: string, limit = 5): Promise<void> {
    const rows = await this.db.query(
      `INSERT INTO auth_rate_limits(key_hash,attempts) VALUES($1,1) ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END,window_start=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END RETURNING attempts`,
      [hash(key)],
    );
    if (rows[0].attempts > limit)
      throw new HttpException('Too many attempts. Try again later.', 429);
  }
  async ipLimit(req: Request): Promise<void> {
    await this.throttle(req, `ip:${req.ip}`, 60);
  }
  async issue(
    client: PoolClient,
    user: any,
    purpose: 'VERIFY_EMAIL' | 'INVITE' | 'RESET_PASSWORD',
  ): Promise<void> {
    const raw = token();
    const minutes = purpose === 'RESET_PASSWORD' ? 30 : purpose === 'INVITE' ? 4320 : 1440;
    await this.db.query(
      'UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL',
      [user.id, purpose],
      client,
    );
    const [record] = await this.db.query(
      `INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 minute') RETURNING id`,
      [user.id, purpose, hash(raw), minutes],
      client,
    );
    const route =
      purpose === 'VERIFY_EMAIL'
        ? 'verify-email'
        : purpose === 'INVITE'
          ? 'invite'
          : 'reset-password';
    await this.db.notify(client, `auth:${record.id}`, purpose, [user.email], {
      subject:
        purpose === 'RESET_PASSWORD'
          ? 'Reset your IAC portal password'
          : purpose === 'INVITE'
            ? 'Your IAC portal invitation'
            : 'Verify your IAC portal email',
      text: `Open the IAC portal to continue: ${configuration().origin}/${route}#token=${raw}\nThis link expires in ${minutes} minutes. If you did not request it, disregard this email.`,
    });
    await this.db.query(
      `UPDATE notification_outbox SET expires_at=now()+$2*interval '1 minute' WHERE event_key=$1`,
      [`auth:${record.id}`, minutes],
      client,
    );
  }
  async register(req: Request, body: unknown) {
    const data = z.object({ email, password, displayName: name }).strict().parse(body);
    await this.ipLimit(req);
    await this.throttle(req, `register:${data.email}`, 5);
    const hashed = await passwordHash(data.password);
    await this.db.tx(async (client) => {
      if (
        !(
          await this.db.query(
            'SELECT email FROM approved_emails WHERE email=$1',
            [data.email],
            client,
          )
        )[0]
      )
        return;
      const [user] = await this.db.query(
        `INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id,email`,
        [data.email, data.displayName, hashed],
        client,
      );
      if (!user) return;
      await this.db.query(
        `INSERT INTO user_roles(user_id,role_code) VALUES($1,'EMPLOYEE')`,
        [user.id],
        client,
      );
      await this.issue(client, user, 'VERIFY_EMAIL');
      await this.db.audit(client, null, 'USER', user.id, 'REGISTRATION_REQUESTED');
    });
    return generic;
  }
  async verify(req: Request, body: unknown) {
    const data = tokenInput.parse(body);
    await this.ipLimit(req);
    await this.db.tx(async (client) => {
      const [record] = await this.db.query(
        `SELECT * FROM auth_tokens WHERE token_hash=$1 AND purpose='VERIFY_EMAIL' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`,
        [hash(data.token)],
        client,
      );
      if (!record) throw new UnauthorizedException('This link is invalid or expired');
      const [user] = await this.db.query(
        `UPDATE users SET email_verified_at=coalesce(email_verified_at,now()),state='ACTIVE',updated_at=now(),version=version+1 WHERE id=$1 AND state<>'DISABLED' RETURNING id`,
        [record.user_id],
        client,
      );
      if (!user) throw new UnauthorizedException('This link is invalid or expired');
      await this.db.query(
        'UPDATE auth_tokens SET consumed_at=now() WHERE id=$1',
        [record.id],
        client,
      );
      await this.db.audit(client, null, 'USER', record.user_id, 'EMAIL_VERIFIED');
    });
    return { message: 'Email verified. You can now sign in.' };
  }
  async forgot(req: Request, body: unknown) {
    const data = z.object({ email }).strict().parse(body);
    await this.ipLimit(req);
    await this.throttle(req, `reset:${data.email}`, 5);
    await this.db.tx(async (client) => {
      const [user] = await this.db.query(
        `SELECT id,email FROM users WHERE email=$1 AND state='ACTIVE' AND email_verified_at IS NOT NULL`,
        [data.email],
        client,
      );
      if (user) {
        await this.issue(client, user, 'RESET_PASSWORD');
        await this.db.audit(client, null, 'USER', user.id, 'PASSWORD_RESET_REQUESTED');
      }
    });
    return generic;
  }
  async tokenPassword(req: Request, body: unknown, purpose: 'INVITE' | 'RESET_PASSWORD') {
    const data = z
      .object({
        token: z.string().min(32).max(200),
        password,
        displayName: purpose === 'INVITE' ? name.optional() : z.never().optional(),
      })
      .strict()
      .parse(body);
    await this.ipLimit(req);
    const hashed = await passwordHash(data.password);
    await this.db.tx(async (client) => {
      const [record] = await this.db.query(
        'SELECT * FROM auth_tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',
        [hash(data.token), purpose],
        client,
      );
      if (!record) throw new UnauthorizedException('This link is invalid or expired');
      const [user] = await this.db.query(
        `UPDATE users SET password_hash=$2,email_verified_at=coalesce(email_verified_at,now()),state='ACTIVE',display_name=coalesce($3,display_name),version=version+1,updated_at=now() WHERE id=$1 AND state<>'DISABLED' RETURNING id`,
        [record.user_id, hashed, data.displayName || null],
        client,
      );
      if (!user) throw new UnauthorizedException('This link is invalid or expired');
      await this.db.query(
        'UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',
        [user.id],
        client,
      );
      await this.db.query(
        'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [user.id],
        client,
      );
      await this.db.audit(
        client,
        null,
        'USER',
        user.id,
        purpose === 'INVITE' ? 'INVITE_ACCEPTED' : 'PASSWORD_RESET',
      );
    });
    return { message: 'Password saved. You can now sign in.' };
  }
  async newSession(
    client: PoolClient,
    userId: string,
    req: Request,
    res: Response,
    scope = 'APP',
    mfa = false,
  ): Promise<void> {
    const raw = token();
    const prior = req.cookies?.[configuration().sessionCookie];
    if (typeof prior === 'string')
      await this.db.query(
        'UPDATE sessions SET revoked_at=now() WHERE id_hash=$1',
        [hash(prior)],
        client,
      );
    await this.db.query(
      `INSERT INTO sessions(id_hash,user_id,csrf_hash,scope,expires_at,mfa_verified_at) VALUES($1,$2,$3,$4,now()+interval '8 hours',CASE WHEN $5 THEN now() ELSE NULL END)`,
      [hash(raw), userId, hash(String(req.get('X-CSRF-Token') || '')), scope, mfa],
      client,
    );
    res.cookie(configuration().sessionCookie, raw, {
      httpOnly: true,
      secure: configuration().production,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    });
    req.cookies[configuration().sessionCookie] = raw;
  }
  async login(req: Request, res: Response, body: unknown) {
    const data = z
      .object({ email, password: z.string().min(1).max(128) })
      .strict()
      .parse(body);
    await this.ipLimit(req);
    await this.throttle(req, `login:${data.email}`, 5);
    const [user] = await this.db.query(
      `SELECT u.*,coalesce(array_agg(ur.role_code) FILTER(WHERE ur.role_code IS NOT NULL),'{}') AS roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id WHERE u.email=$1 GROUP BY u.id`,
      [data.email],
    );
    const ok = await argon2.verify(user?.password_hash || (await dummyHash), data.password);
    if (!ok || !user || user.state !== 'ACTIVE' || !user.email_verified_at)
      throw new UnauthorizedException('Email or password is incorrect');
    return this.db.tx(async (client) => {
      const [locked] = await this.db.query(
        'SELECT * FROM users WHERE id=$1 FOR UPDATE',
        [user.id],
        client,
      );
      if (
        !locked ||
        locked.state !== 'ACTIVE' ||
        !locked.email_verified_at ||
        locked.password_hash !== user.password_hash ||
        locked.version !== user.version
      )
        throw new UnauthorizedException('Email or password is incorrect');
      Object.assign(user, locked);
      user.roles = (
        await this.db.query('SELECT role_code FROM user_roles WHERE user_id=$1', [user.id], client)
      ).map((r) => r.role_code);
      await this.db.query(
        'DELETE FROM auth_rate_limits WHERE key_hash=$1',
        [hash(`login:${data.email}`)],
        client,
      );
      if (staff(user) && user.mfa_enrolled_at) {
        const challengeToken = token();
        await this.db.query(
          `INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'MFA_CHALLENGE',$2,now()+interval '5 minutes')`,
          [user.id, hash(challengeToken)],
          client,
        );
        return { mfaRequired: true, challengeToken };
      }
      const enrollment = staff(user);
      await this.newSession(client, user.id, req, res, enrollment ? 'MFA_ENROLLMENT' : 'APP');
      await this.db.audit(client, null, 'USER', user.id, 'LOGIN');
      const actor = {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        roles: user.roles,
        state: user.state,
        version: user.version,
        portalAcceptedAt: user.portal_accepted_at,
        portalNoticeVersion: user.portal_notice_version,
        emailVerifiedAt: user.email_verified_at,
        mfaEnrolled: !!user.mfa_enrolled_at,
        mfaVerifiedAt: null,
        sessionHash: '',
        sessionScope: enrollment ? 'MFA_ENROLLMENT' : 'APP',
      };
      return { user: publicUser(actor), mfaEnrollmentRequired: enrollment };
    });
  }
  async logout(req: Request, res: Response) {
    const raw = req.cookies?.[configuration().sessionCookie];
    if (typeof raw === 'string')
      await this.db.query('UPDATE sessions SET revoked_at=now() WHERE id_hash=$1', [hash(raw)]);
    res.clearCookie(configuration().sessionCookie, {
      path: '/',
      httpOnly: true,
      secure: configuration().production,
      sameSite: 'lax',
    });
    return { message: 'Signed out' };
  }
  async current(req: Request) {
    return publicUser(await resolveSession(this.db, req));
  }
  async portal(req: Request, body: unknown) {
    const data = z
      .object({ noticeVersion: z.string().max(30) })
      .strict()
      .parse(body);
    if (data.noticeVersion !== configuration().noticeVersion)
      throw new HttpException('The portal notice has changed. Refresh and review it.', 409);
    const actor = await resolveSession(this.db, req);
    if (actor.sessionScope !== 'APP' || (staff(actor) && !actor.mfaVerifiedAt))
      throw new ForbiddenException('Complete MFA first');
    await this.db.tx(async (client) => {
      await this.db.query(
        'UPDATE users SET portal_accepted_at=now(),portal_notice_version=$2,updated_at=now(),version=version+1 WHERE id=$1',
        [actor.id, data.noticeVersion],
        client,
      );
      await this.db.audit(client, actor, 'USER', actor.id, 'PORTAL_ACCESS_ACCEPTED', {
        noticeVersion: data.noticeVersion,
      });
    });
    return this.current(req);
  }
  async enroll(req: Request) {
    const actor = await resolveSession(this.db, req);
    if (!staff(actor)) throw new ForbiddenException('MFA enrollment is for privileged roles');
    if (actor.mfaEnrolled) throw new HttpException('MFA is already enrolled', 409);
    const secret = base32(randomBytes(20));
    await this.db.tx(async (client) => {
      await this.db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id], client);
      await this.db.query(
        `INSERT INTO mfa_enrollments(user_id,secret_ciphertext,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,expires_at=excluded.expires_at`,
        [actor.id, Buffer.from(encrypt(secret, 'TOTP_ENCRYPTION_KEY'))],
        client,
      );
      await this.db.audit(client, actor, 'USER', actor.id, 'MFA_ENROLLMENT_STARTED');
    });
    return {
      secret,
      otpauthUri: `otpauth://totp/${encodeURIComponent(`IAC:${actor.email}`)}?secret=${secret}&issuer=IAC&algorithm=SHA1&digits=6&period=30`,
    };
  }
  async confirmMfa(req: Request, res: Response, body: unknown) {
    const data = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(body);
    const actor = await resolveSession(this.db, req);
    await this.throttle(req, `mfa:${actor.id}`, 5);
    const recoveryCodes = Array.from({ length: 10 }, () =>
      randomBytes(10).toString('hex').toUpperCase(),
    );
    await this.db.tx(async (client) => {
      const [user] = await this.db.query(
        'SELECT * FROM users WHERE id=$1 FOR UPDATE',
        [actor.id],
        client,
      );
      if (user.mfa_enrolled_at) throw new HttpException('MFA is already enrolled', 409);
      const [pending] = await this.db.query(
        'SELECT * FROM mfa_enrollments WHERE user_id=$1 AND expires_at>now()',
        [actor.id],
        client,
      );
      if (!pending) throw new UnauthorizedException('Restart MFA enrollment');
      const secret = decrypt(pending.secret_ciphertext.toString(), 'TOTP_ENCRYPTION_KEY');
      const counter = validTotp(secret, data.code, null);
      if (counter === null)
        throw new UnauthorizedException('Incorrect or expired authentication code');
      await this.db.query(
        'UPDATE users SET mfa_secret_ciphertext=$2,mfa_enrolled_at=now(),mfa_last_counter=$3,version=version+1,updated_at=now() WHERE id=$1',
        [actor.id, pending.secret_ciphertext, counter],
        client,
      );
      for (const recovery of recoveryCodes)
        await this.db.query(
          'INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)',
          [actor.id, hash(recovery)],
          client,
        );
      await this.db.query('DELETE FROM mfa_enrollments WHERE user_id=$1', [actor.id], client);
      await this.db.query(
        'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [actor.id],
        client,
      );
      await this.newSession(client, actor.id, req, res, 'APP', true);
      await this.db.audit(client, actor, 'USER', actor.id, 'MFA_ENROLLED');
    });
    return { user: await this.current(req), recoveryCodes };
  }
  async verifyMfa(req: Request, res: Response, body: unknown) {
    const data = z
      .object({
        challengeToken: z.string().min(32).max(200),
        code: z.string().min(6).max(64).optional(),
        recoveryCode: z.string().min(6).max(64).optional(),
      })
      .strict()
      .refine((v) => !!v.code !== !!v.recoveryCode, 'Supply one authentication code')
      .parse(body);
    await this.ipLimit(req);
    await this.throttle(req, `challenge:${hash(data.challengeToken)}`, 5);
    const rawCode = (data.code || data.recoveryCode || '')
      .trim()
      .replace(/[-\s]/g, '')
      .toUpperCase();
    await this.db.tx(async (client) => {
      const [challenge] = await this.db.query(
        `SELECT * FROM auth_tokens WHERE token_hash=$1 AND purpose='MFA_CHALLENGE' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`,
        [hash(data.challengeToken)],
        client,
      );
      if (!challenge) throw new UnauthorizedException('Authentication challenge expired');
      await this.throttle(req, `mfa:${challenge.user_id}`, 5);
      const [user] = await this.db.query(
        `SELECT * FROM users WHERE id=$1 AND state='ACTIVE' AND email_verified_at IS NOT NULL FOR UPDATE`,
        [challenge.user_id],
        client,
      );
      if (!user?.mfa_secret_ciphertext)
        throw new UnauthorizedException('Authentication challenge expired');
      const secret = decrypt(user.mfa_secret_ciphertext.toString(), 'TOTP_ENCRYPTION_KEY');
      const counter = validTotp(
        secret,
        rawCode,
        user.mfa_last_counter === null ? null : Number(user.mfa_last_counter),
      );
      if (counter === null) {
        const [recovery] = await this.db.query(
          'UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash',
          [user.id, hash(rawCode)],
          client,
        );
        if (!recovery) throw new UnauthorizedException('Incorrect or expired authentication code');
        await this.db.audit(client, null, 'USER', user.id, 'MFA_RECOVERY_USED');
      } else
        await this.db.query(
          'UPDATE users SET mfa_last_counter=$2 WHERE id=$1',
          [user.id, counter],
          client,
        );
      await this.db.query(
        'UPDATE auth_tokens SET consumed_at=now() WHERE id=$1',
        [challenge.id],
        client,
      );
      await this.newSession(client, user.id, req, res, 'APP', true);
      await this.db.audit(client, null, 'USER', user.id, 'LOGIN_MFA');
    });
    return { user: await this.current(req) };
  }
  async users(req: AuthRequest, query: unknown = {}) {
    requireRole(req, 'ADMIN');
    const input = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        cursor: z.string().max(1000).optional(),
        q: z.string().trim().max(120).optional(),
        state: z.enum(['ACTIVE', 'INVITED', 'DISABLED']).optional(),
        role: z.enum(['ADMIN', 'EMPLOYEE', 'IT_ADMIN']).optional(),
      })
      .strict()
      .parse(query);
    const values: any[] = [];
    const where = ['TRUE'];
    if (input.q) {
      values.push(`%${input.q.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(u.email ILIKE $${values.length} OR u.display_name ILIKE $${values.length})`);
    }
    if (input.state) {
      values.push(input.state);
      where.push(`u.state=$${values.length}`);
    }
    if (input.role) {
      values.push(input.role);
      where.push(
        `EXISTS(SELECT 1 FROM user_roles filter_role WHERE filter_role.user_id=u.id AND filter_role.role_code=$${values.length})`,
      );
    }
    if (input.cursor) {
      let after: { createdAt: string; id: string };
      try {
        after = z
          .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
          .strict()
          .parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString()));
      } catch {
        throw new HttpException('Invalid cursor', 400);
      }
      values.push(after.createdAt, after.id);
      where.push(
        `(u.created_at,u.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`,
      );
    }
    values.push(input.limit + 1);
    const rows = await this.db.query(
      `SELECT u.id,u.email,u.display_name AS "displayName",u.employee_reference AS "employeeReference",u.state,u.version,u.created_at AS "createdAt",u.email_verified_at AS "emailVerifiedAt",u.portal_accepted_at AS "portalAcceptedAt",(u.mfa_enrolled_at IS NOT NULL) AS "mfaEnrolled",coalesce(array_agg(ur.role_code) FILTER(WHERE ur.role_code IS NOT NULL),'{}') AS roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id WHERE ${where.join(' AND ')} GROUP BY u.id ORDER BY u.created_at DESC,u.id DESC LIMIT $${values.length}`,
      values,
    );
    const items = rows.slice(0, input.limit),
      last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > input.limit
          ? Buffer.from(
              JSON.stringify({ createdAt: new Date(last.createdAt).toISOString(), id: last.id }),
            ).toString('base64url')
          : null,
    };
  }
  async approve(req: AuthRequest, body: unknown) {
    requireRole(req, 'ADMIN');
    const data = z.object({ email }).strict().parse(body);
    return this.db.tx(async (client) => {
      await this.db.query(
        'INSERT INTO approved_emails(email,approved_by) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [data.email, req.user.id],
        client,
      );
      await this.db.audit(client, req.user, 'USER', null, 'EMAIL_APPROVED', { email: data.email });
      return { email: data.email };
    });
  }
  async invite(req: AuthRequest, body: unknown) {
    requireRole(req, 'ADMIN');
    const data = z.object({ email, displayName: name.optional() }).strict().parse(body);
    return this.db.tx(async (client) => {
      await this.db.query(
        'INSERT INTO approved_emails(email,approved_by) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [data.email, req.user.id],
        client,
      );
      const [user] = await this.db.query(
        `INSERT INTO users(email,display_name) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET updated_at=now() WHERE users.state='INVITED' RETURNING id,email`,
        [data.email, data.displayName || data.email.split('@')[0]],
        client,
      );
      if (!user) throw new HttpException('This account already exists', 409);
      await this.db.query(
        `INSERT INTO user_roles(user_id,role_code,granted_by) VALUES($1,'EMPLOYEE',$2) ON CONFLICT DO NOTHING`,
        [user.id, req.user.id],
        client,
      );
      await this.issue(client, user, 'INVITE');
      await this.db.audit(client, req.user, 'USER', user.id, 'INVITED');
      return { id: user.id, email: user.email };
    });
  }
  async editUser(req: AuthRequest, id: string, body: unknown) {
    requireRole(req, 'ADMIN');
    z.string().uuid().parse(id);
    const data = z
      .object({
        state: z.enum(['ACTIVE', 'DISABLED']).optional(),
        roles: z
          .array(z.enum(['ADMIN', 'EMPLOYEE', 'IT_ADMIN']))
          .min(1)
          .max(3)
          .optional(),
        reason: z.string().trim().min(1).max(5000).optional(),
      })
      .strict()
      .refine((d) => d.state !== undefined || d.roles !== undefined, 'No changes supplied')
      .parse(body);
    await this.db.tx(async (client) => {
      await this.db.query(`SELECT pg_advisory_xact_lock(715023)`, [], client);
      const [user] = await this.db.query(
        'SELECT * FROM users WHERE id=$1 FOR UPDATE',
        [id],
        client,
      );
      if (!user) throw new HttpException('User not found', 404);
      assertVersion(req, user.version);
      if (data.state === 'ACTIVE' && (!user.password_hash || !user.email_verified_at))
        throw new HttpException('User must complete email verification or invitation first', 409);
      const roles = (
        await this.db.query('SELECT role_code FROM user_roles WHERE user_id=$1', [id], client)
      ).map((r) => r.role_code);
      const newRoles = data.roles || roles;
      const newState = data.state || user.state;
      if (
        roles.includes('ADMIN') &&
        user.state === 'ACTIVE' &&
        (!newRoles.includes('ADMIN') || newState !== 'ACTIVE')
      ) {
        const [count] = await this.db.query(
          `SELECT count(*)::int AS count FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role_code='ADMIN' AND u.state='ACTIVE' AND u.id<>$1`,
          [id],
          client,
        );
        if (count.count === 0)
          throw new HttpException('The final active Admin cannot be removed or disabled', 409);
      }
      await this.db.query(
        'UPDATE users SET state=$2,version=version+1,updated_at=now() WHERE id=$1',
        [id, newState],
        client,
      );
      if (data.roles) {
        await this.db.query('DELETE FROM user_roles WHERE user_id=$1', [id], client);
        for (const role of new Set(data.roles))
          await this.db.query(
            'INSERT INTO user_roles(user_id,role_code,granted_by) VALUES($1,$2,$3)',
            [id, role, req.user.id],
            client,
          );
      }
      await this.db.query(
        'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [id],
        client,
      );
      await this.db.query(
        'UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',
        [id],
        client,
      );
      await this.db.audit(client, req.user, 'USER', id, 'ACCESS_CHANGED', {
        state: newState,
        roles: newRoles,
        reason: data.reason || null,
      });
    });
    return { message: 'Access updated; existing sessions revoked' };
  }
}
@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get('health') async health() {
    await this.auth.db.query('SELECT 1');
    return { status: 'ok' };
  }
  @Get('auth/csrf') csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const c = configuration();
    const raw = req.cookies?.[c.csrfCookie];
    const csrfToken = validCsrf(raw) ? raw : signedCsrf();
    res.cookie(c.csrfCookie, csrfToken, {
      httpOnly: true,
      secure: c.production,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    });
    res.set('Cache-Control', 'no-store');
    return { csrfToken };
  }
  @Post('auth/register') @HttpCode(202) register(@Req() req: Request, @Body() body: unknown) {
    return this.auth.register(req, body);
  }
  @Post('auth/verify-email') @HttpCode(200) verify(@Req() req: Request, @Body() body: unknown) {
    return this.auth.verify(req, body);
  }
  @Post('auth/forgot-password') @HttpCode(202) forgot(@Req() req: Request, @Body() body: unknown) {
    return this.auth.forgot(req, body);
  }
  @Post('auth/reset-password') @HttpCode(200) reset(@Req() req: Request, @Body() body: unknown) {
    return this.auth.tokenPassword(req, body, 'RESET_PASSWORD');
  }
  @Post(['auth/invite/accept', 'auth/accept-invite']) @HttpCode(200) inviteAccept(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.auth.tokenPassword(req, body, 'INVITE');
  }
  @Post('auth/login') @HttpCode(200) login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.auth.login(req, res, body);
  }
  @Post('auth/logout') @HttpCode(200) logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.logout(req, res);
  }
  @Post('auth/logout-all') @HttpCode(200) async logoutAll(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actor = await resolveSession(this.auth.db, req);
    await this.auth.db.tx(async (c) => {
      await this.auth.db.query(
        'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [actor.id],
        c,
      );
      await this.auth.db.audit(c, actor, 'USER', actor.id, 'LOGOUT_ALL');
    });
    return this.auth.logout(req, res);
  }
  @Put('users/:id/roles') @UseGuards(SessionGuard) roles(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.auth.editUser(req, id, body);
  }
  @Get('me') me(@Req() req: Request) {
    return this.auth.current(req);
  }
  @Get('auth/me') async authMe(@Req() req: Request) {
    const user = await this.auth.current(req);
    return { user, mfaEnrollmentRequired: user.mfaEnrollmentRequired };
  }
  @Post(['me/portal-acceptance', 'auth/portal-access']) @HttpCode(200) portal(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.auth.portal(req, body);
  }
  @Post('auth/mfa/enroll') @HttpCode(200) enroll(@Req() req: Request) {
    return this.auth.enroll(req);
  }
  @Get('auth/mfa/enroll') enrollGet(@Req() _req: Request) {
    throw new HttpException('Use POST to start MFA enrollment', 405);
  }
  @Post(['auth/mfa/confirm', 'auth/mfa/enroll/confirm']) @HttpCode(200) confirm(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.auth.confirmMfa(req, res, body);
  }
  @Post(['auth/mfa/verify', 'auth/mfa/recover']) @HttpCode(200) mfa(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.auth.verifyMfa(req, res, body);
  }
  @Get('users') @UseGuards(SessionGuard) users(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.auth.users(req, query);
  }
  @Post(['approved-emails', 'users/approve-email']) @UseGuards(SessionGuard) approve(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.auth.approve(req, body);
  }
  @Post(['invitations', 'users/invite']) @UseGuards(SessionGuard) invite(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.auth.invite(req, body);
  }
  @Patch(['users/:id', 'users/:id/roles']) @UseGuards(SessionGuard) edit(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.auth.editUser(req, id, body);
  }
}

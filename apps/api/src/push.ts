import {
  Controller,
  Get,
  Inject,
  Injectable,
  Post,
  Put,
  Delete,
  Body,
  Req,
  UseGuards,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import webpush from 'web-push';
import { Db } from './db';
import { encrypt, hash, decrypt } from './config';
import { AuthRequest, requireRole, SessionGuard } from './security';

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => new URL(value).protocol === 'https:'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(20).max(256), auth: z.string().min(12).max(128) }).strict(),
}).strict();

function vapid() {
  const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY || '';
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY || '';
  const configuredSubject = process.env.PUSH_VAPID_SUBJECT?.trim() || '';
  const subject = configuredSubject.includes(':') ? configuredSubject : `mailto:${configuredSubject}`;
  return publicKey && privateKey && /^mailto:[^\s@]+@[^\s@]+$/.test(subject)
    ? { publicKey, privateKey, subject }
    : undefined;
}

@Injectable()
export class PushService {
  constructor(@Inject(Db) private readonly db: Db) {
    const keys = vapid();
    if (keys) webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  }

  publicKey() {
    return { enabled: !!vapid(), publicKey: vapid()?.publicKey ?? null };
  }

  async subscribe(req: AuthRequest, input: unknown) {
    if (!vapid()) throw new ServiceUnavailableException('Push notifications are not configured');
    const subscription = subscriptionSchema.parse(input);
    const endpointHash = hash(subscription.endpoint);
    await this.db.query(
      `INSERT INTO web_push_subscriptions(endpoint_hash,user_id,subscription_ciphertext)
       VALUES($1,$2,$3) ON CONFLICT(endpoint_hash) DO UPDATE SET
       user_id=excluded.user_id,subscription_ciphertext=excluded.subscription_ciphertext,updated_at=now()`,
      [endpointHash, req.user.id, encrypt(JSON.stringify(subscription), 'AUTH_MAIL_ENCRYPTION_KEY')],
    );
    return { enabled: true };
  }

  async unsubscribe(req: AuthRequest, endpoint: unknown) {
    const value = z.string().url().max(2048).parse(endpoint);
    await this.db.query('DELETE FROM web_push_subscriptions WHERE endpoint_hash=$1 AND user_id=$2', [hash(value), req.user.id]);
    return { enabled: true };
  }

  async broadcast(req: AuthRequest, body: unknown) {
    requireRole(req, 'ADMIN', 'IT_ADMIN');
    const keys = vapid();
    if (!keys) throw new ServiceUnavailableException('Push notifications are not configured');
    const input = z.object({
      title: z.string().trim().min(1).max(100),
      message: z.string().trim().min(1).max(500),
      path: z.string().trim().max(300).refine((value) => value.startsWith('/') && !value.startsWith('//')),
    }).strict().parse(body);
    const rows = await this.db.query(
      `SELECT s.endpoint_hash,s.subscription_ciphertext FROM web_push_subscriptions s
       JOIN users u ON u.id=s.user_id
       WHERE u.state='ACTIVE' AND u.email_verified_at IS NOT NULL AND u.portal_accepted_at IS NOT NULL`,
    );
    let sent = 0;
    let failed = 0;
    const stale: string[] = [];
    const failureStatuses = new Map<number | null, number>();
    const payload = JSON.stringify({ title: input.title, body: input.message, path: input.path });
    for (let offset = 0; offset < rows.length; offset += 16) {
      const batch = rows.slice(offset, offset + 16);
      const outcomes = await Promise.allSettled(batch.map(async (row: { endpoint_hash: string; subscription_ciphertext: string }) => {
        const subscription = JSON.parse(decrypt(row.subscription_ciphertext, 'AUTH_MAIL_ENCRYPTION_KEY'));
        await webpush.sendNotification(subscription, payload, { TTL: 60 * 60, urgency: 'normal' });
        return row.endpoint_hash as string;
      }));
      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') sent += 1;
        else {
          failed += 1;
          const statusCode = (outcome.reason as { statusCode?: number })?.statusCode;
          const safeStatus = typeof statusCode === 'number' ? statusCode : null;
          failureStatuses.set(safeStatus, (failureStatuses.get(safeStatus) ?? 0) + 1);
          if (statusCode === 404 || statusCode === 410) stale.push(batch[index].endpoint_hash);
        }
      });
    }
    if (stale.length) await this.db.query('DELETE FROM web_push_subscriptions WHERE endpoint_hash=ANY($1::text[])', [stale]);
    await this.db.tx((client) => this.db.audit(client, req.user, 'PUSH_ANNOUNCEMENT', null, 'PUSH_ANNOUNCEMENT_SENT', {
      title: input.title,
      subscribedDevices: rows.length,
      sent,
      failed,
      failureStatuses: Object.fromEntries(failureStatuses),
    }));
    return {
      subscribedDevices: rows.length,
      sent,
      failed,
      failureStatuses: [...failureStatuses].map(([statusCode, count]) => ({ statusCode, count })),
    };
  }
}

@Controller('push')
@UseGuards(SessionGuard)
export class PushController {
  constructor(@Inject(PushService) private readonly service: PushService) {}

  @Get('public-key') publicKey() {
    return this.service.publicKey();
  }

  @Put('subscription') subscribe(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.subscribe(req, body);
  }

  @Delete('subscription') unsubscribe(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.unsubscribe(req, (body as { endpoint?: unknown })?.endpoint);
  }

  @Post('broadcast') broadcast(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.broadcast(req, body);
  }
}

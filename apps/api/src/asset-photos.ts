import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Put,
  Req,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { Db } from './db';
import { assetScope, found, id, parse, text } from './domain-helpers';
import { AuthRequest, assertVersion, requireRole, SessionGuard } from './security';

const inputLimit = 40 * 1024;
const outputLimit = 80 * 1024;
const photoInput = z
  .object({
    dataUrl: z.string().max(23 + 4 * Math.ceil(inputLimit / 3)),
    reason: text(1000),
  })
  .strict();

function invalidPhoto(): never {
  throw new UnprocessableEntityException(
    'Choose a valid, non-animated JPEG or PNG picture up to 40 KB and 4 million pixels',
  );
}

function animatedPng(bytes: Buffer): boolean {
  // Inspect PNG chunks rather than matching arbitrary pixel/compressed bytes.
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (offset + length + 12 > bytes.length) return true;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    offset += length + 12;
    if (type === 'IEND') break;
  }
  return false;
}

async function sanitizePhoto(dataUrl: string): Promise<Buffer> {
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) invalidPhoto();
  const encoded = match[2]!;
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > inputLimit || bytes.toString('base64') !== encoded)
    invalidPhoto();
  if (
    match[1] === 'jpeg'
      ? !bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    invalidPhoto();
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 4_000_000 });
    const metadata = await image.metadata();
    if (
      metadata.format !== match[1] ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 4_000_000 ||
      (metadata.pages ?? 1) !== 1 ||
      (metadata.format === 'png' && animatedPng(bytes))
    )
      invalidPhoto();
    // Re-encoding removes embedded metadata and never retains source bytes.
    const output = await image
      .rotate()
      .resize({ width: 640, height: 480, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 75 })
      .toBuffer();
    if (output.length > outputLimit) invalidPhoto();
    return output;
  } catch {
    invalidPhoto();
  }
}

@Injectable()
export class AssetPhotoService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async get(req: AuthRequest, assetId: string) {
    id(assetId);
    return this.db.tx(async (client) => {
      // Custody changes lock this same asset FOR UPDATE. Re-check scope in a
      // fresh statement after acquiring the lock, including after a lock wait.
      found(
        (await this.db.query('SELECT id FROM assets WHERE id=$1 FOR SHARE', [assetId], client))[0],
      );
      const values: any[] = [assetId];
      const scope = assetScope(req.user, values);
      found(
        (
          await this.db.query(
            `SELECT a.id FROM assets a WHERE a.id=$1 AND ${scope}`,
            values,
            client,
          )
        )[0],
      );
      const [photo] = await this.db.query(
        'SELECT content,updated_at FROM asset_photos WHERE asset_id=$1',
        [assetId],
        client,
      );
      return {
        dataUrl: photo ? `data:image/jpeg;base64,${photo.content.toString('base64')}` : null,
        updatedAt: photo?.updated_at ?? null,
      };
    });
  }

  async put(req: AuthRequest, assetId: string, body: unknown) {
    requireRole(req, 'ADMIN');
    id(assetId);
    const { dataUrl, reason } = parse(photoInput, body);
    const content = await sanitizePhoto(dataUrl);
    const sha256 = createHash('sha256').update(content).digest('hex');
    return this.db.tx(async (client) => {
      const asset = found(
        (
          await this.db.query(
            'SELECT version FROM assets WHERE id=$1 FOR UPDATE',
            [assetId],
            client,
          )
        )[0],
      );
      assertVersion(req, asset.version);
      const [photo] = await this.db.query(
        `INSERT INTO asset_photos(asset_id,content,sha256,updated_by)
         VALUES($1,$2,$3,$4) ON CONFLICT(asset_id) DO UPDATE SET
         content=excluded.content,sha256=excluded.sha256,updated_by=excluded.updated_by,updated_at=now()
         RETURNING updated_at`,
        [assetId, content, sha256, req.user.id],
        client,
      );
      const [updated] = await this.db.query(
        'UPDATE assets SET version=version+1,updated_at=now() WHERE id=$1 RETURNING version',
        [assetId],
        client,
      );
      await this.db.audit(client, req.user, 'asset', assetId, 'ASSET_PHOTO_UPDATED', {
        byteSize: content.length,
        sha256,
        reason,
      });
      return {
        dataUrl: `data:image/jpeg;base64,${content.toString('base64')}`,
        updatedAt: photo!.updated_at,
        assetVersion: updated!.version,
      };
    });
  }
}

@Controller('assets/:id/photo')
@UseGuards(SessionGuard)
export class AssetPhotoController {
  constructor(@Inject(AssetPhotoService) private readonly service: AssetPhotoService) {}

  @Get()
  get(@Req() req: AuthRequest, @Param('id') assetId: string) {
    return this.service.get(req, assetId);
  }

  @Put()
  async put(
    @Req() req: AuthRequest,
    @Param('id') assetId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.put(req, assetId, body);
    res.setHeader('ETag', `"${result.assetVersion}"`);
    return result;
  }
}

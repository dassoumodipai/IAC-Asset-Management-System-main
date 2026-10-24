import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { ASSET_PHOTO, sanitizeImage, TICKET_PHOTO } from '../src/image-sanitize';

const url = (type: 'jpeg' | 'png', bytes: Buffer) =>
  `data:image/${type};base64,${bytes.toString('base64')}`;
const canvas = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } });

function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

test('strips EXIF and GPS', async () => {
  const source = await canvas(64, 64)
    .jpeg()
    .withMetadata({
      exif: { IFD0: { Copyright: 'x' }, GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } },
    })
    .toBuffer();
  assert.ok((await sharp(source).metadata()).exif);
  const out = await sanitizeImage(url('jpeg', source), TICKET_PHOTO);
  assert.equal((await sharp(out.content).metadata()).exif, undefined);
});

test('rotated JPEG is stored upright', async () => {
  const source = await canvas(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const out = await sanitizeImage(url('jpeg', source), TICKET_PHOTO);
  assert.equal(out.width, 100);
  assert.equal(out.height, 200);
});

test('downscales to 1600 longest side', async () => {
  const source = await canvas(3200, 1200).png({ compressionLevel: 9 }).toBuffer();
  const out = await sanitizeImage(url('png', source), TICKET_PHOTO);
  assert.equal(out.width, 1600);
  assert.equal(out.height, 600);
});

test('rejects fake image', async () => {
  await assert.rejects(
    sanitizeImage(
      `data:image/jpeg;base64,${Buffer.from('hello').toString('base64')}`,
      TICKET_PHOTO,
    ),
    (error: Error) => error.message === TICKET_PHOTO.message,
  );
});

test('rejects animated PNG', async () => {
  const png = await canvas(16, 16).png().toBuffer();
  const actl = chunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]));
  const animated = Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)]);
  await assert.rejects(
    sanitizeImage(url('png', animated), TICKET_PHOTO),
    (error: Error) => error.message === TICKET_PHOTO.message,
  );
});

test('rejects over inputLimit', async () => {
  const source = await canvas(64, 64).jpeg().toBuffer();
  await assert.rejects(
    sanitizeImage(url('jpeg', source), { ...TICKET_PHOTO, inputLimit: source.length - 1 }),
    (error: Error) => error.message === TICKET_PHOTO.message,
  );
});

test('sha256 matches content', async () => {
  const out = await sanitizeImage(url('png', await canvas(32, 32).png().toBuffer()), ASSET_PHOTO);
  assert.equal(out.sha256, createHash('sha256').update(out.content).digest('hex'));
});

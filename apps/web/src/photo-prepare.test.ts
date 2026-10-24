import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_LIMITS, TICKET_LIMITS, preparePhoto } from './photo-prepare';
afterEach(() => vi.unstubAllGlobals());
const jpeg = (bytes: number) =>
  `data:image/jpeg;base64,${Buffer.alloc(bytes, 1).toString('base64')}`;
function stubCanvas(width: number, height: number, sizes: number[]) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' }),
    toDataURL: vi.fn(() => jpeg(sizes.shift() ?? 1)),
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close: vi.fn() })),
  );
  return canvas;
}
const file = (type = 'image/jpeg') => new File([new Uint8Array(1000)], 'p', { type });
describe('preparePhoto', () => {
  it('exposes limits', () => {
    expect(TICKET_LIMITS).toEqual({ maxBytes: 350 * 1024, maxEdge: 1600 });
    expect(ASSET_LIMITS.maxBytes).toBe(40 * 1024);
  });
  it('preparePhoto rejects unsupported type with message', async () => {
    await expect(preparePhoto(file('image/heic'), TICKET_LIMITS)).rejects.toThrow(
      'Choose a JPEG or PNG photo. On iPhone, set Camera > Formats to Most Compatible or take the photo here.',
    );
  });
  it('scales longest edge to maxEdge', async () => {
    const canvas = stubCanvas(4000, 3000, [1000]);
    await preparePhoto(file(), TICKET_LIMITS);
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
  });
  it('steps quality down until under maxBytes', async () => {
    const canvas = stubCanvas(800, 600, [500 * 1024, 300 * 1024]);
    const result = await preparePhoto(file(), TICKET_LIMITS);
    expect(canvas.toDataURL).toHaveBeenCalledTimes(2);
    expect(result).toBe(jpeg(300 * 1024));
  });
});

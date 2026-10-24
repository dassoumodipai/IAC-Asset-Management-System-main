import { describe, expect, it } from 'vitest';
import { LAYOUTS, layoutPages, scanUrl } from './layouts';
import type { Layout } from './layouts';

const extent = (n: number, size: number, gap: number, margin: number) =>
  margin + n * size + (n - 1) * gap;

describe('label layouts', () => {
  it.each(['A4_40', 'A4_24', 'A4_14'] as const)('%s fits the page', (id) => {
    const l: Layout = LAYOUTS[id];
    expect(extent(l.cols, l.labelWidthMm, l.gapXMm, l.marginLeftMm)).toBeLessThanOrEqual(210);
    expect(extent(l.rows, l.labelHeightMm, l.gapYMm, l.marginTopMm)).toBeLessThanOrEqual(297);
  });

  it('layoutPages clamps start position', () => {
    const l = LAYOUTS.A4_24;
    const pages = layoutPages(['a', 'b'], l, 25);
    expect(pages).toHaveLength(2);
    expect(pages[0].slice(0, 23).every((c) => c === null)).toBe(true);
    expect(pages[0][23]).toBe('a');
    expect(pages[1][0]).toBe('b');
    expect(layoutPages(['a'], l, 0)[0][0]).toBe('a');
  });

  it('A4_40 matches the 40-up sticker sheet', () => {
    const l = LAYOUTS.A4_40;
    expect([l.cols, l.rows, l.labelWidthMm, l.labelHeightMm]).toEqual([4, 10, 45.7, 25.4]);
    expect(
      layoutPages(
        Array.from({ length: 41 }, (_, i) => i),
        l,
        1,
      ),
    ).toHaveLength(2);
  });

  it('thermal one per page', () => {
    const pages = layoutPages([1, 2, 3], LAYOUTS.THERMAL_50x25, 1);
    expect(pages).toHaveLength(3);
    expect(pages.every((p) => p.length === 1)).toBe(true);
  });

  it('qr at least 18 mm', () => {
    for (const l of Object.values(LAYOUTS)) expect(l.qrMm).toBeGreaterThanOrEqual(18);
  });

  it('scanUrl encodes', () => {
    expect(scanUrl('https://x.org', 'IAC-IT 1')).toBe('https://x.org/a/IAC-IT%201');
  });
});

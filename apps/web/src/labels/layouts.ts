export type LayoutId = 'A4_40' | 'A4_24' | 'A4_14' | 'THERMAL_50x25';
export interface Layout {
  id: LayoutId;
  pageWidthMm: number;
  pageHeightMm: number;
  cols: number;
  rows: number;
  labelWidthMm: number;
  labelHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
  gapXMm: number;
  gapYMm: number;
  qrMm: number;
}
export const LAYOUTS: Record<LayoutId, Layout> = {
  // Avery L7654-compatible small stickers.
  A4_40: {
    id: 'A4_40',
    pageWidthMm: 210,
    pageHeightMm: 297,
    cols: 4,
    rows: 10,
    labelWidthMm: 45.7,
    labelHeightMm: 25.4,
    marginTopMm: 21.5,
    marginLeftMm: 9.7,
    gapXMm: 2.6,
    gapYMm: 0,
    qrMm: 18,
  },
  A4_24: {
    id: 'A4_24',
    pageWidthMm: 210,
    pageHeightMm: 297,
    cols: 3,
    rows: 8,
    labelWidthMm: 63.5,
    labelHeightMm: 33.9,
    marginTopMm: 12.9,
    marginLeftMm: 7.2,
    gapXMm: 2.5,
    gapYMm: 0,
    qrMm: 22,
  },
  A4_14: {
    id: 'A4_14',
    pageWidthMm: 210,
    pageHeightMm: 297,
    cols: 2,
    rows: 7,
    labelWidthMm: 99.1,
    labelHeightMm: 38.1,
    marginTopMm: 15.1,
    marginLeftMm: 4.7,
    gapXMm: 2.5,
    gapYMm: 0,
    qrMm: 26,
  },
  THERMAL_50x25: {
    id: 'THERMAL_50x25',
    pageWidthMm: 50,
    pageHeightMm: 25,
    cols: 1,
    rows: 1,
    labelWidthMm: 50,
    labelHeightMm: 25,
    marginTopMm: 0,
    marginLeftMm: 0,
    gapXMm: 0,
    gapYMm: 0,
    qrMm: 18,
  },
};
export function layoutPages<T>(items: T[], layout: Layout, startAt: number): (T | null)[][] {
  const perPage = layout.cols * layout.rows;
  const start = Math.min(Math.max(Math.trunc(startAt) || 1, 1), perPage);
  const cells: (T | null)[] = [...Array<null>(start - 1).fill(null), ...items];
  const pages: (T | null)[][] = [];
  for (let i = 0; i < cells.length; i += perPage) {
    const page = cells.slice(i, i + perPage);
    while (page.length < perPage) page.push(null);
    pages.push(page);
  }
  return pages;
}
export function scanUrl(origin: string, assetCode: string): string {
  return `${origin}/a/${encodeURIComponent(assetCode)}`;
}

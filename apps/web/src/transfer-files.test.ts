import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Excel from 'exceljs';
import {
  csvText,
  downloadTable,
  fetchAllPages,
  parseCsv,
  readTable,
  tableRecords,
} from './transfer-files';
import { resetCsrf } from './api';

const response = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => resetCsrf());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function workbookFile(build: (book: Excel.Workbook) => void) {
  const book = new Excel.Workbook();
  build(book);
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  return new File([bytes], 'synthetic.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
function captureDownload() {
  let saved: Blob | undefined;
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn() } });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    if (!(blob instanceof Blob)) throw new Error('Expected a Blob download.');
    saved = blob;
    return 'blob:synthetic-export';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { anchor, blob: () => saved! };
}

describe('bounded CSV and record parser', () => {
  it('preserves BOM, quoted commas, multiline values, escaped quotes and empty trailing cells', () => {
    const table = parseCsv(
      '\uFEFFcode,name,note,empty\r\nDEMO,"Research, Admin","First line\r\nHe said ""yes""",\r\n',
    );
    expect(tableRecords(table)).toEqual([
      { code: 'DEMO', name: 'Research, Admin', note: 'First line\r\nHe said "yes"', empty: '' },
    ]);
  });
  it.each([
    'a,a\n1,2',
    '__proto__,name\nvalue,test',
    'constructor,name\nvalue,test',
    'prototype,name\nvalue,test',
    ' ,name\nvalue,test',
  ])('rejects duplicate, empty or prototype-bearing headings: %s', (csv) => {
    expect(() => tableRecords(parseCsv(csv))).toThrow(/Duplicate|safe column/);
  });
  it.each(['a\n"never closed', 'a\nabc"def', 'a\n"closed"trailer', 'a\nNUL\0value'])(
    'rejects malformed quoting and NUL data: %s',
    (csv) => {
      expect(() => parseCsv(csv)).toThrow(/quote|closing|NUL/);
    },
  );
  it('enforces row, column and cell bounds rather than silently truncating source data', () => {
    expect(() => parseCsv(`a\n${Array.from({ length: 501 }, () => 'value').join('\n')}`)).toThrow(
      '500 rows',
    );
    expect(() => parseCsv(Array.from({ length: 101 }, (_, i) => `c${i}`).join(','))).toThrow(
      '100 columns',
    );
    expect(() => parseCsv(`a\n${'x'.repeat(10001)}`)).toThrow('10,000');
    expect(() => tableRecords([['a'], ['one', 'extra']])).toThrow('more cells');
    expect(() => tableRecords([['a']])).toThrow('at least one data row');
  });
  it('pads missing cells but preserves zero and formula-leading text as literal source values', async () => {
    const file = new File(['code,value,note\nDEMO,0\nTEXT,=1+1,\n'], 'source.csv');
    const parsed = await readTable(file);
    expect(parsed.rows).toEqual([
      { code: 'DEMO', value: '0', note: '' },
      { code: 'TEXT', value: '=1+1', note: '' },
    ]);
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.filename).toBe('source.csv');
  });
  it('protects spreadsheet formula prefixes while escaping CSV data without evaluating it', () => {
    const values = [
      '=1+1',
      '+SUM(A1)',
      '@SUM(A1)',
      '-2',
      ' \t=cmd()',
      'plain, "quoted"',
      'line\nbreak',
    ];
    const parsed = tableRecords(
      parseCsv(
        csvText(
          ['value'],
          values.map((value) => ({ value })),
        ),
      ),
    );
    expect(parsed.map((row) => row.value)).toEqual([
      "'=1+1",
      "'+SUM(A1)",
      "'@SUM(A1)",
      "'-2",
      "' \t=cmd()",
      'plain, "quoted"',
      'line\nbreak',
    ]);
    expect(tableRecords(parseCsv(csvText(['value'], [{ value: '=1+1' }], false)))[0].value).toBe(
      '=1+1',
    );
  });
  it('round trips formula-leading CSV drafts while preserving existing leading apostrophes', () => {
    const originals = ['=text', "'=text", "''=text", 'normal text'];
    const exported = tableRecords(
      parseCsv(
        csvText(
          ['value'],
          originals.map((value) => ({ value })),
        ),
      ),
    );
    expect(exported.map((row) => row.value)).toEqual([
      "'=text",
      "''=text",
      "'''=text",
      'normal text',
    ]);
    const imported = exported.map(({ value }) =>
      /^'+[\s\u0000-\u001f]*[=+@-]/.test(value) ? value.slice(1) : value,
    );
    expect(imported).toEqual(originals);
  });
  it('rejects empty, oversized and non-supported files before parsing', async () => {
    await expect(readTable(new File([], 'empty.csv'))).rejects.toThrow('up to 2 MiB');
    await expect(
      readTable(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.csv')),
    ).rejects.toThrow('up to 2 MiB');
    await expect(readTable(new File(['a\n1'], 'fake.xlsm'))).rejects.toThrow('.csv or .xlsx');
    await expect(
      readTable(new File([new Uint8Array([0xff, 0xfe, 0xff])], 'bad-utf8.csv')),
    ).rejects.toThrow();
  });
});

describe('plain-value XLSX files', () => {
  it('round trips the real Excel exporter with literal formula-looking text and safe allowlisted columns', async () => {
    const saved = captureDownload();
    await downloadTable(
      'synthetic-draft',
      ['__form', 'code', 'name', 'active'],
      [
        {
          __form: 'master:departments:new',
          code: 'DEMO',
          name: '=Literal text',
          active: false,
          password: 'must-not-export',
          version: 99,
        },
      ],
      'xlsx',
    );
    expect(saved.anchor.download).toBe('synthetic-draft.xlsx');
    expect(saved.anchor.click).toHaveBeenCalledOnce();
    const file = new File([await saved.blob().arrayBuffer()], saved.anchor.download);
    const result = await readTable(file);
    expect(result.rows).toEqual([
      { __form: 'master:departments:new', code: 'DEMO', name: '=Literal text', active: 'false' },
    ]);
    expect(Object.keys(result.rows[0])).not.toContain('password');
    expect(Object.keys(result.rows[0])).not.toContain('version');
  });
  it('accepts dates, booleans and zero as plain values with stable text', async () => {
    const file = await workbookFile((book) => {
      const sheet = book.addWorksheet('Data');
      sheet.addRow(['day', 'active', 'amount']);
      sheet.addRow([new Date('2026-01-02T00:00:00Z'), false, 0]);
    });
    expect((await readTable(file)).rows).toEqual([
      { day: '2026-01-02', active: 'false', amount: '0' },
    ]);
  });
  it.each(['formula', 'hyperlink', 'richText'] as const)(
    'rejects %s cells instead of trusting cached results or embedded content',
    async (kind) => {
      const file = await workbookFile((book) => {
        const sheet = book.addWorksheet('Data');
        sheet.addRow(['value']);
        sheet.getCell('A2').value =
          kind === 'formula'
            ? { formula: '1+1', result: 2 }
            : kind === 'hyperlink'
              ? { text: 'Click', hyperlink: 'https://example.test/' }
              : { richText: [{ text: 'styled' }] };
      });
      await expect(readTable(file)).rejects.toThrow('plain values only');
    },
  );
  it('requires exactly one worksheet', async () => {
    const file = await workbookFile((book) => {
      book.addWorksheet('One').addRows([['code'], ['DEMO']]);
      book.addWorksheet('Two').addRow(['hidden extra']);
    });
    await expect(readTable(file)).rejects.toThrow('exactly one worksheet');
  });
  it('rejects workbook row limits and invalid archives', async () => {
    const file = await workbookFile((book) => {
      const sheet = book.addWorksheet('Data');
      sheet.addRow(['code']);
      for (let i = 0; i < 501; i++) sheet.addRow([`D${i}`]);
    });
    await expect(readTable(file)).rejects.toThrow('at most 500 rows');
    await expect(readTable(new File(['not a zip'], 'fake.xlsx'))).rejects.toThrow('supported XLSX');
  });
  it('rejects ZIP entry inflation and invalid directory bounds before workbook parsing', async () => {
    const file = await workbookFile((book) => {
      book.addWorksheet('Data').addRows([['code'], ['DEMO']]);
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const central = bytes.findIndex(
      (_, i) =>
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x01 &&
        bytes[i + 3] === 0x02,
    );
    expect(central).toBeGreaterThan(0);
    const inflated = bytes.slice();
    new DataView(inflated.buffer).setUint32(central + 24, 9 * 1024 * 1024, true);
    await expect(readTable(new File([inflated], 'inflated.xlsx'))).rejects.toThrow(
      'oversized workbook',
    );
    const end = bytes.length - 22;
    const invalid = bytes.slice();
    new DataView(invalid.buffer).setUint32(end + 16, bytes.length, true);
    await expect(readTable(new File([invalid], 'directory.xlsx'))).rejects.toThrow(
      'archive is too large',
    );
    const entries = bytes.slice();
    new DataView(entries.buffer).setUint16(end + 10, 257, true);
    await expect(readTable(new File([entries], 'entries.xlsx'))).rejects.toThrow(
      'archive is too large',
    );
  });
});

describe('complete, bounded record exports', () => {
  it('follows cursors beyond the 25 displayed records and preserves filters on every page', async () => {
    const first = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const second = Array.from({ length: 12 }, (_, i) => ({ id: 25 + i }));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ items: first, nextCursor: 'second-page' }))
      .mockResolvedValueOnce(response({ items: second, nextCursor: null }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchAllPages('/assets', { q: 'a&b', status: 'Assigned' })).toEqual([
      ...first,
      ...second,
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url), 'https://example.test'));
    expect(urls.map((url) => url.searchParams.get('limit'))).toEqual(['100', '100']);
    expect(urls.map((url) => url.searchParams.get('q'))).toEqual(['a&b', 'a&b']);
    expect(urls[1].searchParams.get('cursor')).toBe('second-page');
  });
  it('aborts a repeated pagination cursor instead of looping or exporting duplicated pages', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        response({ items: [{ id: 'synthetic' }], nextCursor: 'repeated' }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(fetchAllPages('/assets')).rejects.toThrow('pagination did not advance');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed pages and oversized exports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(response({ items: null, nextCursor: null })),
    );
    await expect(fetchAllPages('/assets')).rejects.toThrow('response is invalid');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        response({
          items: Array.from({ length: 5001 }, (_, i) => ({ id: i })),
          nextCursor: null,
        }),
      ),
    );
    await expect(fetchAllPages('/assets')).rejects.toThrow('More than 5,000');
    await expect(
      downloadTable(
        'too-big',
        ['value'],
        Array.from({ length: 5001 }, () => ({ value: 'x' })),
        'csv',
      ),
    ).rejects.toThrow('Export is too large');
    await expect(
      downloadTable('long-cell', ['value'], [{ value: 'x'.repeat(32001) }], 'csv'),
    ).rejects.toThrow('export cell is too long');
  });
});

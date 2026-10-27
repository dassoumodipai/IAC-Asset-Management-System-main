import { api, queryString } from './api';
import type { Page } from './types';

export type TransferColumn = string | { key: string; label?: string };
export type TransferFormat = 'csv' | 'xlsx';
const MAX_FILE = 2 * 1024 * 1024;
const MAX_ROWS = 500;
const MAX_COLUMNS = 100;
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  const input = text.replace(/^\uFEFF/, '');
  if (input.includes('\0')) throw new Error('Files cannot contain NUL characters.');
  const pushCell = () => {
    if (cell.length > 10000) throw new Error('An import cell exceeds 10,000 characters.');
    row.push(cell);
    cell = '';
    closed = false;
    if (row.length > MAX_COLUMNS) throw new Error('Use at most 100 columns.');
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1) throw new Error('Import at most 500 rows at a time.');
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
    } else if (char === '"') {
      if (cell || closed) throw new Error('CSV has an unexpected quote.');
      quoted = true;
    } else if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') {
      pushRow();
      if (char === '\r' && input[i + 1] === '\n') i++;
    } else {
      if (closed) throw new Error('CSV has text after a closing quote.');
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV has an unclosed quoted cell.');
  if (cell || row.length || closed) pushRow();
  return rows;
}

export function tableRecords(table: string[][]): Record<string, string>[] {
  if (!table.length) throw new Error('The file has no header row.');
  const headers = table[0].map((value) => value.trim());
  if (
    !headers.length ||
    headers.length > MAX_COLUMNS ||
    headers.some((key) => !key || unsafeKeys.has(key))
  )
    throw new Error('Use nonempty, safe column headings.');
  if (new Set(headers).size !== headers.length)
    throw new Error('Duplicate column headings are not allowed.');
  if (table.length < 2) throw new Error('Add at least one data row.');
  if (table.length > MAX_ROWS + 1) throw new Error('Import at most 500 rows at a time.');
  return table.slice(1).map((row, index) => {
    if (row.length > headers.length)
      throw new Error(`Row ${index + 2} has more cells than headings.`);
    return Object.fromEntries(headers.map((key, i) => [key, row[i] ?? '']));
  });
}

// Bound and verify ZIP inflation before handing XLSX to the workbook parser.
async function checkWorkbookZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--)
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  if (end < 0) throw new Error('This is not a supported XLSX workbook.');
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true),
    total = 0;
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count > 256 ||
    offset + size > end
  )
    throw new Error('The workbook archive is too large or unsupported.');
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('Invalid workbook archive.');
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true),
      expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (
      offset + 46 + nameLength + extra + comment > end ||
      local + 30 > end ||
      expanded > 8 * 1024 * 1024 ||
      (total += expanded) > 20 * 1024 * 1024 ||
      flags & 1 ||
      ![0, 8].includes(method)
    )
      throw new Error('Encrypted or oversized workbook content is not supported.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (names.has(name) || /(?:vbaProject|externalLinks|embeddings|\.\.\/)/i.test(name))
      throw new Error('Unsupported workbook content.');
    names.add(name);
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Invalid workbook archive.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > end) throw new Error('Invalid workbook archive.');
    if (method === 0) {
      if (compressed !== expanded) throw new Error('Invalid workbook size.');
    } else {
      const input = bytes.slice(start, start + compressed);
      const reader = new Blob([input])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw'))
        .getReader();
      let actual = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          actual += part.value.byteLength;
          if (actual > expanded || actual > 8 * 1024 * 1024)
            throw new Error('Workbook expands beyond its declared limit.');
        }
        if (actual !== expanded) throw new Error('Invalid workbook size.');
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }
    offset += 46 + nameLength + extra + comment;
  }
  if (!names.has('xl/workbook.xml')) throw new Error('The file is not an XLSX workbook.');
}

export async function readTable(file: File) {
  if (!file.size || file.size > MAX_FILE) throw new Error('Choose a CSV or XLSX file up to 2 MiB.');
  const buffer = await file.arrayBuffer(),
    bytes = new Uint8Array(buffer);
  let table: string[][];
  if (/\.csv$/i.test(file.name))
    table = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  else if (/\.xlsx$/i.test(file.name)) {
    await checkWorkbookZip(bytes);
    let Excel: typeof import('exceljs');
    try {
      Excel = await import('exceljs');
    } catch (error) {
      if (
        error instanceof TypeError &&
        /dynamically imported module|module script failed|importing a module script failed/i.test(
          error.message,
        )
      )
        throw new Error(
          'The app was updated while this page was open. Reload the page, then choose the XLSX file again.',
        );
      throw error;
    }
    const workbook = new Excel.Workbook();
    await workbook.xlsx.load(buffer as never);
    if (workbook.worksheets.length !== 1)
      throw new Error('Use a workbook with exactly one worksheet.');
    const sheet = workbook.worksheets[0];
    if (sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > MAX_COLUMNS)
      throw new Error('Use at most 500 rows and 100 columns.');
    table = [];
    sheet.eachRow((row) => {
      const values: string[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const value = row.getCell(column).value;
        let text: string;
        if (value === null || value === undefined) text = '';
        else if (value instanceof Date) text = value.toISOString().slice(0, 10);
        else if (['string', 'number', 'boolean'].includes(typeof value)) text = String(value);
        else
          throw new Error(
            'Import plain values only. Formula, hyperlink and rich-text cells are not supported.',
          );
        if (text.length > 10000 || text.includes('\0'))
          throw new Error('An import cell is too long or invalid.');
        values.push(text);
      }
      if (values.some((value) => value !== '')) table.push(values);
    });
  } else throw new Error('Choose a .csv or .xlsx file.');
  const rows = tableRecords(table);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return {
    rows,
    filename: file.name,
    sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
      '',
    ),
  };
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(cellText).join(';');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function csvText(
  columns: TransferColumn[],
  rows: Record<string, unknown>[],
  protectFormulas = true,
) {
  const quote = (value: string) => {
    const safe = protectFormulas && /^'*[\s\u0000-\u001f]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      columns
        .map((column) => quote(typeof column === 'string' ? column : (column.label ?? column.key)))
        .join(','),
      ...rows.map((row) =>
        columns
          .map((column) => quote(cellText(row[typeof column === 'string' ? column : column.key])))
          .join(','),
      ),
    ].join('\r\n')
  );
}
export function downloadFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadTable(
  name: string,
  columns: TransferColumn[],
  rows: Record<string, unknown>[],
  format: TransferFormat,
) {
  if (rows.length > 5000 || columns.length > MAX_COLUMNS)
    throw new Error('Export is too large. Narrow the filters and try again.');
  if (
    rows.some((row) =>
      columns.some(
        (column) => cellText(row[typeof column === 'string' ? column : column.key]).length > 32000,
      ),
    )
  )
    throw new Error('An export cell is too long. Narrow the export fields.');
  if (format === 'csv')
    downloadFile(
      `${name}.csv`,
      new Blob([csvText(columns, rows)], { type: 'text/csv;charset=utf-8' }),
    );
  else {
    const Excel = await import('exceljs');
    const workbook = new Excel.Workbook(),
      sheet = workbook.addWorksheet('Data');
    sheet.addRow(
      columns.map((column) => (typeof column === 'string' ? column : (column.label ?? column.key))),
    );
    for (const row of rows)
      sheet.addRow(
        columns.map((column) => cellText(row[typeof column === 'string' ? column : column.key])),
      );
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    downloadFile(
      `${name}.xlsx`,
      new Blob([new Uint8Array(buffer as ArrayBuffer)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
  }
}
export async function fetchAllPages<T extends object = Record<string, unknown>>(
  path: string,
  filters: Record<string, string | undefined> = {},
): Promise<T[]> {
  const items: T[] = [],
    cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await api<Page<T>>(path + queryString({ ...filters, limit: '100', cursor }));
    if (!Array.isArray(result.items)) throw new Error('Export response is invalid.');
    items.push(...result.items);
    if (items.length > 5000)
      throw new Error('More than 5,000 rows match. Narrow the filters before exporting.');
    cursor = result.nextCursor ?? undefined;
    if (cursor && cursors.has(cursor))
      throw new Error('Export pagination did not advance. Please retry.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return items;
}

import { describe, expect, it } from 'vitest';
import { assetPathFromScan } from './scan-url';

const origin = 'https://a.org';
describe('assetPathFromScan', () => {
  it('accepts own label', () => {
    expect(assetPathFromScan('https://a.org/a/IAC-IT-000123', origin)).toBe('/a/IAC-IT-000123');
    expect(assetPathFromScan('https://a.org/a/IAC%20X', origin)).toBe('/a/IAC%20X');
  });
  it('rejects foreign origin', () => {
    expect(assetPathFromScan('https://evil.org/a/IAC-IT-000123', origin)).toBeNull();
  });
  it('rejects other paths', () => {
    expect(assetPathFromScan('https://a.org/admin/users', origin)).toBeNull();
    expect(assetPathFromScan('https://a.org/a/x/y', origin)).toBeNull();
    expect(assetPathFromScan('https://a.org/a/', origin)).toBeNull();
  });
  it('rejects non-URL text', () => {
    expect(assetPathFromScan('IAC-IT-000123', origin)).toBeNull();
    expect(assetPathFromScan('javascript:alert(1)', origin)).toBeNull();
  });
});

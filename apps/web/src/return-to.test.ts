import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberReturnTo, takeReturnTo } from './return-to';
function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
}
beforeEach(stubStorage);
afterEach(() => vi.unstubAllGlobals());
describe('return-to after login', () => {
  it('round trip', () => {
    rememberReturnTo('/a/IAC-IT-000123');
    expect(takeReturnTo()).toBe('/a/IAC-IT-000123');
    expect(takeReturnTo()).toBe('/dashboard');
  });
  it('takeReturnTo ignores protocol-relative and absolute URLs', () => {
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil']) {
      rememberReturnTo(bad);
      expect(takeReturnTo()).toBe('/dashboard');
    }
  });
  it('ignores auth routes', () => {
    rememberReturnTo('/login');
    expect(takeReturnTo()).toBe('/dashboard');
    rememberReturnTo('/security');
    expect(takeReturnTo()).toBe('/dashboard');
  });
  it('uses the caller fallback', () => {
    expect(takeReturnTo('/x')).toBe('/x');
  });
  it('expires after 15 minutes', () => {
    rememberReturnTo('/a/X', 1000);
    expect(takeReturnTo('/dashboard', 1000 + 15 * 60 * 1000 + 1)).toBe('/dashboard');
    rememberReturnTo('/a/X', 1000);
    expect(takeReturnTo('/dashboard', 1000 + 14 * 60 * 1000)).toBe('/a/X');
  });
  it('rejects malformed stored values', () => {
    sessionStorage.setItem('iac.returnTo', '/a/X');
    expect(takeReturnTo()).toBe('/dashboard');
  });
  it('storage throwing', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('sessionStorage', { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => rememberReturnTo('/a/X')).not.toThrow();
    expect(takeReturnTo()).toBe('/dashboard');
  });
});

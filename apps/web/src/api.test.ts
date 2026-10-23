import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, captureFragmentToken, queryString, resetCsrf } from './api';
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => resetCsrf());
afterEach(() => vi.unstubAllGlobals());
describe('browser API security boundary', () => {
  it('obtains CSRF before a write and attaches cookies, quoted version and caller retry key', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ csrfToken: 'safe-csrf' }))
      .mockResolvedValueOnce(response({ id: 'asset', version: 8 }));
    vi.stubGlobal('fetch', fetch);
    await api('/assets/id/assignments', {
      method: 'POST',
      body: { userId: 'employee' },
      version: 7,
      idempotencyKey: 'retry-key',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/auth/csrf',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/assets/id/assignments',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
        headers: expect.objectContaining({
          'X-CSRF-Token': 'safe-csrf',
          'If-Match': '"7"',
          'Idempotency-Key': 'retry-key',
        }),
      }),
    );
  });
  it('does not send any mutation when CSRF setup fails', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response({ error: { message: 'Security service unavailable' } }, 503));
    vi.stubGlobal('fetch', fetch);
    await expect(
      api('/auth/login', {
        method: 'POST',
        body: { email: 'synthetic@example.org', password: 'test-only' },
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('never silently retries a failed write', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ csrfToken: 'csrf' }))
      .mockRejectedValueOnce(new TypeError('network'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      api('/tickets', { method: 'POST', body: { subject: 'Synthetic test' } }),
    ).rejects.toThrow('Unable to reach the server');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('preserves conflict status and gives a useful reload instruction', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(
        response({ error: { code: 'VERSION_CONFLICT', requestId: 'reference' } }, 412),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(
      api('/tickets/id/status', { method: 'PATCH', body: { status: 'COMPLETED' }, version: 1 }),
    ).rejects.toMatchObject({
      status: 412,
      code: 'VERSION_CONFLICT',
      requestId: 'reference',
      message: expect.stringContaining('Reload'),
    });
  });
  it('gets private resources with cookies and no cache without requesting CSRF', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ items: [], nextCursor: null }));
    vi.stubGlobal('fetch', fetch);
    await api('/assets');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/assets',
      expect.objectContaining({ credentials: 'include', cache: 'no-store', method: 'GET' }),
    );
  });
  it('extracts and immediately clears a fragment token without exchanging it', () => {
    const replaceState = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', {
      location: { hash: '#token=synthetic-link', pathname: '/verify-email', search: '' },
      history: { replaceState },
    });
    expect(captureFragmentToken()).toBe('synthetic-link');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/verify-email');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('encodes search literals and omits empty cursor values', () => {
    expect(queryString({ q: 'a&b', cursor: undefined, status: '' })).toBe('?q=a%26b');
  });
});

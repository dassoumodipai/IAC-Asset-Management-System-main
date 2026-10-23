export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public requestId?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  version?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
}
let csrfPromise: Promise<string> | undefined;
export function resetCsrf() {
  csrfPromise = undefined;
}
async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = body?.error;
    const message =
      response.status === 412
        ? 'This record changed. Reload it and review the latest details before saving.'
        : (error?.message ??
          (typeof body?.message === 'string'
            ? body.message
            : 'The request could not be completed. Please retry.'));
    throw new ApiError(response.status, message, error?.code, error?.requestId, error?.fields);
  }
  return body;
}
async function csrf(): Promise<string> {
  if (!csrfPromise)
    csrfPromise = fetch('/api/v1/auth/csrf', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(readResponse)
      .then((value) => {
        const token = (value as { csrfToken?: string })?.csrfToken;
        if (!token) throw new Error('Security token unavailable. Reload the page and try again.');
        return token;
      })
      .catch((error) => {
        csrfPromise = undefined;
        throw error;
      });
  return csrfPromise;
}
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = await csrf();
  }
  if (options.version !== undefined) headers['If-Match'] = `"${options.version}"`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(
      'Unable to reach the server. Check your connection, then retry the same action.',
    );
  }
  try {
    return (await readResponse(response)) as T;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CSRF_INVALID') resetCsrf();
    throw error;
  }
}
export function queryString(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const value = query.toString();
  return value ? `?${value}` : '';
}
export function captureFragmentToken(): string {
  const fragment = window.location.hash.slice(1);
  const token = new URLSearchParams(fragment).get('token') ?? '';
  if (fragment)
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

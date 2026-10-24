const KEY = 'iac.returnTo';
const AUTH_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/invite',
  '/access',
  '/security',
];
function safe(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return false;
  if (path.length > 300) return false;
  const route = path.split(/[?#]/)[0];
  return !AUTH_ROUTES.includes(route);
}
const MAX_AGE_MS = 15 * 60 * 1000;
export function rememberReturnTo(path: string, now = Date.now()): void {
  if (!safe(path)) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: now }));
  } catch {
    // storage unavailable: fall back to the default landing page
  }
}
export function clearReturnTo(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}
export function takeReturnTo(fallback = '/dashboard', now = Date.now()): string {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(KEY);
  } catch {
    // storage unavailable
  }
  clearReturnTo();
  try {
    const { path, at } = JSON.parse(stored ?? '') as { path: unknown; at: unknown };
    if (typeof at === 'number' && now - at >= 0 && now - at <= MAX_AGE_MS && safe(path))
      return path;
  } catch {
    // missing or malformed entry
  }
  return fallback;
}

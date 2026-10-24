export function assetPathFromScan(scanned: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(scanned);
  } catch {
    return null;
  }
  if (url.origin !== origin || !/^\/a\/[^/]+$/.test(url.pathname)) return null;
  try {
    const code = decodeURIComponent(url.pathname.slice(3));
    return code ? `/a/${encodeURIComponent(code)}` : null;
  } catch {
    return null;
  }
}

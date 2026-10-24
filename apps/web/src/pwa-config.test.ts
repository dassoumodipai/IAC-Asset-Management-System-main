import { describe, expect, it } from 'vitest';
import { pwaOptions } from '../pwa.config';

describe('pwa config', () => {
  it('api is never cached', () => {
    const deny = pwaOptions.workbox?.navigateFallbackDenylist ?? [];
    expect(deny.some((re) => re.test('/api/v1/tickets'))).toBe(true);
    expect(deny.some((re) => re.test('/dashboard'))).toBe(false);
    expect(pwaOptions.workbox?.runtimeCaching).toEqual([]);
  });

  it('manifest values', () => {
    const m = pwaOptions.manifest as Record<string, unknown> & {
      icons: { src: string; purpose?: string }[];
    };
    expect(pwaOptions.registerType).toBe('prompt');
    expect(m.name).toBe('IAC Assets');
    expect(m.short_name).toBe('IAC Assets');
    expect(m.start_url).toBe('/dashboard');
    expect(m.scope).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#eef2f6');
    expect(m.background_color).toBe('#eef2f6');
    expect(m.icons).toHaveLength(3);
    expect(m.icons[2]).toMatchObject({ src: 'pwa-maskable-512.png', purpose: 'maskable' });
    expect(pwaOptions.workbox?.navigateFallback).toBe('/index.html');
    expect(pwaOptions.workbox?.globPatterns).toEqual(['**/*.{js,css,html,png,svg,woff2}']);
  });
});

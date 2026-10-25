import type { VitePWAOptions } from 'vite-plugin-pwa';

const themeColor = '#eef2f6';

export const pwaOptions: Partial<VitePWAOptions> = {
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
  },
  // The dev server is used through HTTPS tunnels for phone testing. Without
  // this, vite-plugin-pwa skips service worker registration in development.
  devOptions: {
    enabled: true,
    type: 'module',
    navigateFallback: 'index.html',
  },
  registerType: 'prompt',
  manifest: {
    name: 'IAC Assets',
    short_name: 'IAC Assets',
    id: '/',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    theme_color: themeColor,
    background_color: themeColor,
    icons: [
      { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [],
    globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
  },
};

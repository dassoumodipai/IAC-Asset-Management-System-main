import type { VitePWAOptions } from 'vite-plugin-pwa';

const themeColor = '#eef2f6';

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'prompt',
  manifest: {
    name: 'IAC Assets',
    short_name: 'IAC Assets',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    theme_color: themeColor,
    background_color: themeColor,
    icons: [
      { src: 'image.png', sizes: '1254x1254', type: 'image/png' },
      { src: 'image.png', sizes: '1254x1254', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [],
    globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
  },
};

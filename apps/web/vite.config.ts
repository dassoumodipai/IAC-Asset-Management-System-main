import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaOptions } from './pwa.config';
export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  server: {
    port: 5173,
    strictPort: true,
    // Dev only: lets a temporary HTTPS tunnel reach the dev server for phone testing.
    allowedHosts: ['.trycloudflare.com', '.devtunnels.ms'],
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: { sourcemap: false },
});

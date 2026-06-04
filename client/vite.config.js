import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server proxies /api to the Express backend on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Plan generation can take 10+ minutes. Give the dev proxy a generous
      // timeout so it doesn't sever a long-but-healthy /api/design request.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        timeout: 20 * 60_000,      // socket inactivity (ms)
        proxyTimeout: 20 * 60_000, // upstream response wait (ms)
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@sirpefoffice/shared': fileURLToPath(
        new URL('./src/shared/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ['devsirpef.mppef.gob.ve'],
    proxy: {
      '/api': {
        target: 'http://localhost:3101',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Los sourcemaps no se publican en producción salvo petición explícita.
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
  },
});

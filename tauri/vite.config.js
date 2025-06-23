import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../public',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/index.html'),
        settings: resolve(__dirname, 'src/settings.html'),
        welcome: resolve(__dirname, 'src/welcome.html'),
        'server-console': resolve(__dirname, 'src/server-console.html'),
        'session-detail': resolve(__dirname, 'src/session-detail.html'),
      },
    },
  },
  server: {
    port: 3000,
  },
});
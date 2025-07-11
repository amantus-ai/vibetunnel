import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/client'),
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'public/bundle'),
    emptyOutDir: false, // Don't delete existing bundles
    rollupOptions: {
      input: {
        'react-app': resolve(__dirname, 'src/client/react-app-entry.tsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name].[ext]'
      }
    }
  },
  server: {
    port: 4022, // Different port from the main server
    proxy: {
      '/api': {
        target: 'http://localhost:4020',
        changeOrigin: true
      },
      '/buffers': {
        target: 'ws://localhost:4020',
        ws: true,
        changeOrigin: true
      }
    }
  },
  css: {
    postcss: resolve(__dirname, 'postcss.config.js')
  }
})
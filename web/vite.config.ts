import { defineConfig } from 'vite';
import { resolve } from 'path';
import copy from 'rollup-plugin-copy';
import { nativeBuildPlugin } from './vite-plugin-native-build';
import { child_process } from 'vite-plugin-child-process';

export default defineConfig({
  
  // Enable experimental features for faster builds
  experimental: {
    renderBuiltUrl(filename) {
      return `/${filename}`;
    }
  },

  // Root directory for source files
  root: resolve(__dirname, 'src/client'),
  
  // Public directory for static assets
  publicDir: resolve(__dirname, 'src/client/assets'),
  
  // Build configuration
  build: {
    // Output directory relative to project root
    outDir: resolve(__dirname, 'public'),
    emptyOutDir: true,
    
    // Enable source maps for debugging
    sourcemap: true,
    
    // Target modern browsers for better performance
    target: 'es2020',
    
    // Use Rollup for bundling
    rollupOptions: {
      // Multiple entry points matching current structure
      input: {
        app: resolve(__dirname, 'src/client/index.html'),
        test: resolve(__dirname, 'src/client/test.html'),
        screencap: resolve(__dirname, 'src/client/screencap.html'),
      },
      
      // Maintain exact output structure for Mac app compatibility
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'app') return 'bundle/client-bundle.js';
          if (chunkInfo.name === 'test') return 'bundle/test.js';
          if (chunkInfo.name === 'screencap') return 'bundle/screencap.js';
          return 'bundle/[name].js';
        },
        chunkFileNames: 'bundle/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'index.css' || assetInfo.name === 'style.css') {
            return 'styles.css';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },

  // Development server configuration
  server: {
    port: 4020,
    host: '0.0.0.0',
    
    // Proxy API calls to Express server (now on port 4030)
    proxy: {
      '/api': {
        target: 'http://localhost:4030',
        changeOrigin: true
      },
      '/buffers': {
        target: 'ws://localhost:4030',
        ws: true
      }
    }
  },

  // TypeScript configuration for LitElement decorators
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true
      }
    }
  },
  
  // Resolve configuration
  resolve: {
    extensions: ['.ts', '.js', '.tsx', '.jsx']
  },

  plugins: [
    // Start Express server in development
    child_process({
      name: 'express-server',
      command: ['env', 'VIBETUNNEL_SEA=', 'PORT=4030', 'tsx', 'watch', 'src/cli.ts', '--no-auth'],
      watch: [/src\/server/, /src\/cli/],
      delay: 100
    }),

    // Copy assets to maintain compatibility
    copy({
      targets: [
        { 
          src: resolve(__dirname, 'src/client/assets/**/*'), 
          dest: resolve(__dirname, 'public/assets') 
        }
      ],
      hook: 'writeBundle'
    }),

    // Custom plugin to ensure exact compatibility with current build structure
    {
      name: 'vibetunnel-compatibility',
      generateBundle(options, bundle) {
        // Ensure the exact file structure expected by Mac app
        console.log('Generated bundle files:', Object.keys(bundle));
      }
    },

    // Build native executable after web bundle
    nativeBuildPlugin()
  ],

  // Optimize dependencies
  optimizeDeps: {
    include: [
      'lit',
      'monaco-editor',
      '@codemirror/commands',
      '@codemirror/lang-css',
      '@codemirror/lang-html',
      '@codemirror/lang-javascript',
      '@codemirror/lang-json',
      '@codemirror/lang-markdown',
      '@codemirror/lang-python',
      '@codemirror/state',
      '@codemirror/theme-one-dark',
      '@codemirror/view'
    ]
  }
});
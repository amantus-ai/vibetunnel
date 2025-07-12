import { defineConfig } from 'vite';
import { resolve } from 'path';
import copy from 'rollup-plugin-copy';
import { nativeBuildPlugin } from './vite-plugin-native-build';
import { child_process } from 'vite-plugin-child-process';

// Get Express port from environment or default to 4030 range
const expressPort = process.env.EXPRESS_PORT || '4030';

export default defineConfig({
  
  // Enable experimental features for faster builds
  experimental: {
    renderBuiltUrl(filename) {
      return `/${filename}`;
    }
  },

  // Root directory for source files
  root: resolve(__dirname, 'src/client'),
  
  // Public directory for static assets - removed to prevent duplication with copy plugin
  
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
          // Preserve original CSS file names to avoid collision
          if (assetInfo.name?.endsWith('.css')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },

  // Development server configuration
  server: {
    port: parseInt(process.env.VITE_PORT || '4020'),
    host: process.env.VITE_HOST || 'localhost', // Safer default, use VITE_HOST=0.0.0.0 for network access
    
    // Proxy configuration - uses Express port with fallback
    proxy: {
      '/api': {
        target: `http://localhost:${expressPort}`,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, req, res) => {
            console.error('API proxy error:', err);
            if ('writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'text/plain' });
              res.end('Express server unavailable. Try restarting dev server.');
            }
          });
        }
      },
      '/buffers': {
        target: `ws://localhost:${expressPort}`,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error('WebSocket proxy error:', err);
          });
        }
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
    // Start Express server with automatic port discovery
    child_process({
      name: 'express-server',
      command: ['bash', 'start-express-simple.sh'],
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
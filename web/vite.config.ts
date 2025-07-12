import { defineConfig } from 'vite';
import { resolve } from 'path';
import copy from 'rollup-plugin-copy';
import { nativeBuildPlugin } from './vite-plugin-native-build';
import { child_process } from 'vite-plugin-child-process';

// Get Express port from environment or default to 4030 range
const expressPort = process.env.EXPRESS_PORT || '4030';

// Read package.json for version
import packageJson from './package.json';

export default defineConfig({
  
  // Define global constants
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  
  // Enable experimental features for faster builds
  experimental: {
    renderBuiltUrl(filename) {
      return `/${filename}`;
    }
  },

  // Root directory for source files
  root: resolve(__dirname, 'src/client'),
  
  // Disable public directory since we're outputting to the same folder
  publicDir: false,
  
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
        sw: resolve(__dirname, 'src/client/sw.ts'),
      },
      
      // Maintain exact output structure for Mac app compatibility
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'app') return 'bundle/client-bundle.js';
          if (chunkInfo.name === 'test') return 'bundle/test.js';
          if (chunkInfo.name === 'screencap') return 'bundle/screencap.js';
          if (chunkInfo.name === 'sw') return 'sw.js';
          return 'bundle/[name].js';
        },
        chunkFileNames: 'bundle/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          // Preserve original CSS file names to avoid collision
          if (assetInfo.name?.endsWith('.css')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        format: 'es' // Use ES modules for all outputs
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
      },
      '/ws/input': {
        target: `ws://localhost:${expressPort}`,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error('WebSocket input proxy error:', err);
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
        },
        // Copy fonts to original /fonts/ path for backward compatibility
        { 
          src: resolve(__dirname, 'src/client/assets/fonts/*'), 
          dest: resolve(__dirname, 'public/fonts') 
        },
        // Copy icon files to root for direct access
        { 
          src: resolve(__dirname, 'src/client/assets/*.png'), 
          dest: resolve(__dirname, 'public') 
        },
        { 
          src: resolve(__dirname, 'src/client/assets/*.ico'), 
          dest: resolve(__dirname, 'public') 
        },
        // Copy manifest.json to root
        { 
          src: resolve(__dirname, 'src/client/assets/manifest.json'), 
          dest: resolve(__dirname, 'public') 
        }
      ],
      hook: 'writeBundle'
    }),

    // Custom plugin to ensure exact compatibility with current build structure
    {
      name: 'vibetunnel-compatibility',
      buildStart() {
        // Copy fonts to original paths during development
        const fs = require('fs');
        const path = require('path');
        
        const srcFontsDir = resolve(__dirname, 'src/client/assets/fonts');
        const destFontsDir = resolve(__dirname, 'public/fonts');
        
        // Ensure destination directory exists
        if (!fs.existsSync(destFontsDir)) {
          fs.mkdirSync(destFontsDir, { recursive: true });
        }
        
        // Copy font files
        if (fs.existsSync(srcFontsDir)) {
          const files = fs.readdirSync(srcFontsDir);
          files.forEach(file => {
            fs.copyFileSync(
              path.join(srcFontsDir, file),
              path.join(destFontsDir, file)
            );
          });
        }
      },
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
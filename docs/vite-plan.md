# Vite Migration Plan for VibeTunnel

## Overview

This document outlines a comprehensive plan to migrate VibeTunnel's build system from esbuild to Vite. The migration would provide hot module replacement (HMR), faster development cycles, and modern tooling while maintaining full compatibility with the Mac app's embedded server architecture.

## Why Consider Vite?

### Current State (esbuild)
- Fast builds but manual browser refresh required
- Watch mode rebuilds automatically but no HMR
- Custom build scripts and configuration
- Good performance but not optimal development experience

### Vite Benefits
- **Lightning Fast HMR**: Sub-50ms updates with instant feedback
- **Native ESM**: Modern ES modules, better tree shaking
- **Rich Plugin Ecosystem**: Monaco, PWA, TypeScript support built-in
- **Superior Developer Experience**: Better error messages, dev tools
- **Industry Standard**: Active development, future-proof
- **Framework Agnostic**: Works well with LitElement

## Architecture Understanding

### Development vs Production

**Key Insight: Vite has two completely separate modes**

#### Development Mode
```
Vite Dev Server (port 4021) ← Developer browsers
    ↓ (proxies API calls)
Express Server (port 4020) ← Mac app spawns this
```

#### Production Mode  
```
Vite Build → Static Files → Mac App Bundle → Express Server
```

**The Mac app never ships with Vite** - only the compiled static assets.

### Current vs Future Architecture

#### Current (esbuild):
```
Development:
  esbuild watch → public/bundle/client-bundle.js
  Express server (port 4020) serves public/ + API
  Browser: http://localhost:4020

Production:
  esbuild build → static files
  Mac app embeds static files → serves via Express
```

#### Future (Vite):
```
Development:
  Vite dev server (port 4021) → native ESM + HMR
  Express server (port 4020) → API only  
  Vite proxies /api calls to Express
  Browser: http://localhost:4021

Production:
  Vite build → same static files as esbuild
  Mac app embeds static files → serves via Express (UNCHANGED)
```

## Technical Implementation Plan

### 1. Dependencies

#### Remove
```bash
pnpm remove esbuild
```

#### Add
```bash
pnpm add -D vite @vitejs/plugin-legacy vite-plugin-monaco-editor
pnpm add -D @vitejs/plugin-typescript vite-plugin-pwa
pnpm add -D rollup-plugin-copy
```

### 2. New File Structure

```
web/
├── vite.config.ts              # New: Vite configuration
├── postcss.config.js           # New: PostCSS for Tailwind
├── src/
│   ├── client/
│   │   ├── index.html          # New: Main app entry point
│   │   ├── test.html           # New: Test page entry point  
│   │   ├── screencap.html      # New: Screencap entry point
│   │   ├── app-entry.ts        # Unchanged: App logic
│   │   ├── test-entry.ts       # Unchanged: Test logic
│   │   ├── screencap-entry.ts  # Unchanged: Screencap logic
│   │   ├── sw.ts               # Unchanged: Service worker
│   │   ├── styles.css          # Unchanged: Tailwind CSS
│   │   └── assets/             # Unchanged: Static assets
│   └── server/                 # Unchanged: Express server
```

### 3. Vite Configuration

**Key configuration challenges:**

#### Multiple Entry Points
Vite expects HTML files as entry points, unlike esbuild's JS entries:

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'src/client/index.html'),
        test: resolve(__dirname, 'src/client/test.html'),
        screencap: resolve(__dirname, 'src/client/screencap.html'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'app') return 'bundle/client-bundle.js';
          if (chunkInfo.name === 'test') return 'bundle/test.js';
          if (chunkInfo.name === 'screencap') return 'bundle/screencap.js';
          return 'bundle/[name].js';
        }
      }
    }
  }
});
```

#### Development Server Proxy
```typescript
server: {
  port: 4021,
  proxy: {
    '/api': {
      target: 'http://localhost:4020',
      changeOrigin: true
    },
    '/buffers': {
      target: 'ws://localhost:4020',
      ws: true  // WebSocket proxy for terminal connections
    }
  }
}
```

#### TypeScript Decorators (LitElement)
```typescript
plugins: [
  {
    name: 'typescript-decorators',
    config(config) {
      config.esbuild = {
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: true,
            useDefineForClassFields: false
          }
        }
      };
    }
  }
]
```

### 4. HTML Entry Points

**Current**: JavaScript files are entry points  
**Future**: HTML files import JavaScript modules

```html
<!-- src/client/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VibeTunnel</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <vibetunnel-app></vibetunnel-app>
  <script type="module" src="./app-entry.ts"></script>
</body>
</html>
```

### 5. Service Worker Migration

**Challenge**: Current service worker uses IIFE format
**Solution**: Use vite-plugin-pwa with injectManifest strategy

```typescript
VitePWA({
  strategies: 'injectManifest',
  srcDir: 'src/client',
  filename: 'sw.ts',
  outDir: '../../public',
  injectManifest: {
    swSrc: 'src/client/sw.ts',
    swDest: '../../public/sw.js'
  }
})
```

### 6. Monaco Editor Integration

**Current**: Custom esbuild plugin  
**Future**: vite-plugin-monaco-editor

```typescript
monacoEditorPlugin({
  languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
  customWorkers: []
})
```

### 7. Asset Handling

**Current**: Custom copy-assets.js script  
**Future**: Vite plugin or built-in asset handling

```typescript
// Custom plugin to replicate copy-assets.js behavior
{
  name: 'copy-assets',
  buildStart() {
    // Copy assets from src/client/assets to public
  }
}
```

## Migration Steps

### Phase 1: Setup (Week 1)
1. Install Vite dependencies alongside esbuild
2. Create basic `vite.config.ts`
3. Create HTML entry point templates
4. Test basic Vite build without removing esbuild

### Phase 2: Entry Points (Week 2)  
1. Configure multiple entry points in Vite
2. Ensure output file names match current structure exactly
3. Test each entry point (app, test, screencap) individually
4. Verify bundle output structure compatibility

### Phase 3: Service Worker (Week 3)
1. Configure vite-plugin-pwa for service worker
2. Test service worker registration and functionality
3. Verify push notifications and offline capabilities
4. Ensure IIFE format is maintained

### Phase 4: Monaco Editor (Week 3)
1. Replace custom Monaco plugin with vite-plugin-monaco-editor
2. Test Monaco functionality in both development and production
3. Verify language workers and syntax highlighting
4. Test file editing capabilities

### Phase 5: Development Server (Week 4)
1. Configure Vite proxy for Express server APIs
2. Test hot reloading and asset serving
3. Ensure WebSocket proxying works for terminal connections
4. Verify all API endpoints function correctly

### Phase 6: Production Build (Week 5)
1. Test full production build process
2. Verify all assets are copied correctly
3. Test Mac app integration with new build output
4. Performance testing and bundle analysis

### Phase 7: Final Migration (Week 6)
1. Update package.json scripts
2. Remove esbuild dependencies and configurations
3. Clean up old build scripts (build.js, dev.js, esbuild-config.js)
4. Update documentation and team workflows

## Critical Compatibility Requirements

### Output Structure Must Match Exactly

**Current Output:**
```
public/
├── bundle/
│   ├── client-bundle.js
│   ├── test.js
│   └── screencap.js
├── sw.js
├── styles.css
└── index.html
```

**Future Output Must Be Identical** - The Mac app's `BunServer.swift` expects this exact structure.

### Mac App Integration Points

1. **Static File Serving**: Mac app serves `public/` directory via Express
2. **Entry Points**: Mac app loads specific bundle files by name
3. **Service Worker**: Registration paths must remain the same
4. **Asset Paths**: All asset references must use same relative paths

## Risks and Mitigation

### High Risk
- **Mac App Compatibility**: Build output structure changes could break embedded server
- **Mitigation**: Extensive testing of Mac app integration, maintain exact file paths

### Medium Risk  
- **Service Worker Functionality**: PWA features are core to VibeTunnel
- **Mitigation**: Thorough testing of service worker registration and push notifications

- **WebSocket Proxying**: Terminal connections rely on WebSocket proxy
- **Mitigation**: Test all WebSocket connections during development

### Low Risk
- **Development Workflow Changes**: Team adaptation to new commands and ports
- **Mitigation**: Clear documentation and gradual migration with parallel systems

- **Monaco Editor**: Complex integration that needs careful migration
- **Mitigation**: Test editor functionality extensively in both modes

## Benefits vs Costs

### Benefits
- **Developer Experience**: Sub-second feedback loops, instant HMR
- **Modern Tooling**: Native ESM, better tree shaking, rich plugin ecosystem  
- **Performance**: Faster builds, better optimization
- **Future Proofing**: Industry standard with active development
- **Bundle Analysis**: Built-in analysis and optimization tools

### Costs
- **3-4 weeks dedicated migration work**
- **Risk of breaking production during migration**
- **Team workflow changes and learning curve**
- **Potential compatibility issues with current Mac app integration**

## Recommended Approach

### Option A: Full Migration
- Commit to 4-6 week migration timeline
- High reward but significant risk and effort
- Best long-term solution

### Option B: Proof of Concept
- Create parallel Vite setup alongside esbuild
- Test compatibility without disrupting current workflow
- Validate assumptions before full commitment

### Option C: Defer Migration
- Implement simple auto-refresh solution instead
- Revisit Vite migration as dedicated project later
- Lower risk, faster developer experience improvement

## Conclusion

Vite migration would significantly improve VibeTunnel's development experience with modern HMR and tooling. However, it requires substantial effort and carries migration risks due to the complex Mac app integration.

The migration is technically feasible but should be considered carefully against current project priorities and available development time.

**Key Decision Point**: Is 4-6 weeks of migration work worth the improved developer experience, or should we implement a simpler auto-refresh solution first?
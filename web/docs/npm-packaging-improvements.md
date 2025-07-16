# NPM Packaging Improvements

Based on npm best practices research, here are potential improvements to our current npm packaging approach:

## Current Approach Issues

1. **Direct package.json manipulation** - We currently modify package.json during the build process, which is not ideal
2. **Complex postinstall script** - Creates symlinks and manipulates the installation
3. **Mixed development and production configs** - Single package.json serves both purposes

## Recommended Improvements

### 1. Use publishConfig (Immediate improvement)

Instead of modifying package.json during build, use `publishConfig` to override fields during publishing:

```json
{
  "name": "vibetunnel",
  "main": "src/cli.ts",
  "dependencies": {
    "node-pty": "file:node-pty"
  },
  "publishConfig": {
    "main": "dist/vibetunnel-cli",
    "directory": "dist-npm"
  }
}
```

### 2. Create a Distribution Directory (Better approach)

Create a separate distribution directory with its own package.json:

```bash
# During build-npm.js:
1. Build everything to dist-npm/
2. Copy only necessary files
3. Create a clean package.json in dist-npm/ with only production fields
4. Run npm pack from dist-npm/
```

Example dist-npm/package.json:
```json
{
  "name": "vibetunnel",
  "version": "1.0.0-beta.10",
  "main": "vibetunnel-cli",
  "bin": {
    "vibetunnel": "./bin/vibetunnel",
    "vt": "./bin/vt"
  },
  "dependencies": {
    // Only runtime dependencies
  },
  "files": [
    "bin/",
    "dist/",
    "node-pty/",
    "prebuilds/",
    "scripts/postinstall-npm.js"
  ],
  "scripts": {
    "postinstall": "node scripts/postinstall-npm.js"
  }
}
```

### 3. Bundle node-pty Properly (Best approach)

Instead of using symlinks in postinstall:

1. **Option A**: Bundle node-pty into the main bundle using esbuild with proper externals configuration
2. **Option B**: Use a proper module resolution that doesn't require symlinks:
   ```javascript
   // In the CLI code, use dynamic require with proper path resolution
   const nodePty = require(path.join(__dirname, '../node-pty'));
   ```

### 4. Use .npmignore

Create .npmignore to exclude development files instead of using the files field:

```
# Development files
src/
scripts/build*.js
scripts/dev.js
scripts/clean.js
test/
*.test.ts
tsconfig.*.json
.github/
docs/

# Build artifacts
*.tgz
native/
```

### 5. Separate Build Outputs

Structure the project to have clear separation:

```
web/
├── src/           # Source files
├── dist/          # Development build
├── dist-npm/      # NPM package build
│   ├── package.json (clean, production-only)
│   ├── bin/
│   ├── lib/       # Compiled JS
│   ├── node-pty/  # Bundled module
│   └── prebuilds/
└── package.json   # Development package.json
```

## Implementation Plan

1. **Phase 1** (Current): Keep current approach but document it
2. **Phase 2**: Implement publishConfig to reduce package.json manipulation
3. **Phase 3**: Create separate dist-npm directory with clean package.json
4. **Phase 4**: Properly bundle or resolve node-pty without symlinks
5. **Phase 5**: Use tools like npm-pack-all or packito for automated packaging

## Benefits of Improvements

- Cleaner separation of development and production
- No runtime package.json manipulation
- Simpler postinstall scripts
- More maintainable build process
- Follows npm best practices
- Easier to understand and debug
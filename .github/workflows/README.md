# VibeTunnel CI/CD Workflows

This directory contains GitHub Actions workflows for continuous integration and testing.

## Workflows

### 1. Web CI (`web-ci.yml`)
Basic CI workflow that runs on every push and PR affecting the web directory.

**Jobs:**
- **Lint and Type Check**: Runs biome linting and TypeScript type checking
- **Build**: Builds the project and uploads artifacts
- **Test**: Runs the test suite

**Triggers:**
- Push to `main` or `ms-pty` branches
- Pull requests to `main`
- Only when files in `web/` directory change

### 2. SEA Build Test (`sea-build-test.yml`)
Advanced workflow for testing Single Executable Application (SEA) builds with custom Node.js.

**Features:**
- Builds custom Node.js from source with optimizations
- Caches custom Node.js builds for faster subsequent runs
- Tests SEA builds with both system and custom Node.js
- Supports manual triggers with custom Node.js versions

**Jobs:**
1. **build-custom-node**: 
   - Builds minimal Node.js without npm, intl, inspector, etc.
   - Uses GitHub Actions cache for persistence
   - Outputs the custom Node.js path for downstream jobs

2. **test-sea-build**:
   - Matrix build testing both system and custom Node.js
   - Builds SEA executable with node-pty patches
   - Performs smoke tests on the generated executable
   - Uploads artifacts for inspection

3. **build-with-blacksmith** (optional):
   - Uses Blacksmith runners for faster builds
   - Enhanced caching with Blacksmith cache action
   - Runs only on push events for efficiency

## Caching Strategy

### GitHub Actions Cache
- Custom Node.js builds are cached based on version and build script hash
- Cache key: `custom-node-linux-x64-v{version}-{hash}`
- Speeds up builds from ~15 minutes to ~1 minute

### Blacksmith Cache (Optional)
For even faster builds, the workflow includes Blacksmith runner support:
- 2x-4x faster build times
- Better cache persistence
- Recommended for main branch builds

## Manual Triggers

The SEA build workflow supports manual triggers via GitHub UI:
```yaml
workflow_dispatch:
  inputs:
    node_version:
      description: 'Node.js version to build'
      default: '24.2.0'
```

## Local Testing

To test the SEA build locally:
```bash
# Build custom Node.js
cd web
node build-custom-node.js

# Build SEA with custom Node.js
node build-native.js --custom-node=".node-builds/node-v24.2.0-minimal/out/Release/node"
```

## Optimization Details

The custom Node.js build removes:
- International support (`--without-intl`)
- npm and corepack (`--without-npm --without-corepack`)
- Inspector/debugging (`--without-inspector`)
- Code cache and snapshots
- Uses `-Os` optimization for size

This reduces the Node.js binary from ~120MB to ~50-60MB.

## Future Improvements

- [ ] Add Windows and macOS to the build matrix
- [ ] Implement release workflow for automated releases
- [ ] Add performance benchmarks
- [ ] Integrate with release signing process
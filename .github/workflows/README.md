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

### 2. NPM Package Test (`npm-test.yml`)
Dedicated workflow for testing the npm package build and installation.

**Jobs:**
- **Test NPM Package**: Builds the npm package and tests installation in a clean environment

**Features:**
- Builds npm package using the clean build approach
- Tests global installation without requiring build tools
- Verifies server startup and API functionality
- Validates package structure and dependencies

**Triggers:**
- Push to `main` or `npm-build` branches when web files change
- Pull requests to `main` when web files change

### 3. SEA Build Test (`sea-build-test.yml`)
Advanced workflow for testing Single Executable Application (SEA) builds with custom Node.js.

**Features:**
- Builds custom Node.js from source with optimizations
- Uses Blacksmith runners for significantly faster builds
- Caches custom Node.js builds for faster subsequent runs
- Tests SEA builds with both system and custom Node.js
- Supports manual triggers with custom Node.js versions

**Jobs:**
1. **build-custom-node**: 
   - Runs on `blacksmith-32vcpu-ubuntu-2404-arm` for fast compilation
   - Builds minimal Node.js without npm, intl, inspector, etc.
   - Uses Blacksmith cache for persistence
   - Outputs the custom Node.js path for downstream jobs

2. **test-sea-build**:
   - Runs on `blacksmith-8vcpu-ubuntu-2404-arm`
   - Matrix build testing both system and custom Node.js
   - Builds SEA executable with node-pty patches
   - Performs smoke tests on the generated executable
   - Uploads artifacts for inspection

3. **test-github-runners**:
   - Uses standard `ubuntu-latest` runners for comparison
   - Helps identify any Blacksmith-specific issues
   - Runs only on push events

### 4. Xcode SEA Test (`xcode-sea-test.yml`)
Tests the macOS Xcode build with custom Node.js to ensure the VibeTunnel.app works correctly with SEA executables.

**Features:**
- Builds custom Node.js on macOS using self-hosted runners
- Tests integration of SEA executable into macOS app bundle
- Verifies the app launches and contains the correct binaries
- Supports manual triggers with custom Node.js versions

**Jobs:**
1. **build-custom-node-mac**:
   - Runs on self-hosted macOS runner
   - Builds custom Node.js for macOS
   - Uses GitHub Actions cache (appropriate for self-hosted)
   - Outputs node path and size information

2. **test-xcode-build**:
   - Builds SEA executable with custom Node.js
   - Copies SEA and native modules to app resources
   - Builds VibeTunnel.app using Xcode
   - Verifies SEA executable is correctly bundled
   - Tests basic app functionality
   - Uploads built app as artifact

## Runner Strategy

### Blacksmith Runners (Linux)
- **Custom Node.js Build**: `blacksmith-32vcpu-ubuntu-2404-arm` (high CPU for compilation)
- **Other CI Jobs**: `blacksmith-8vcpu-ubuntu-2404-arm` (standard workloads)
- Benefits: Significantly faster builds, better caching, ARM64 architecture

### Self-Hosted Runners (macOS)
- Used for Xcode builds and macOS-specific testing
- Access to Xcode and macOS-specific tools
- Can test code signing and notarization

### GitHub Runners (Comparison)
- `ubuntu-latest` used in test job for baseline comparison
- Helps identify Blacksmith-specific issues

## Caching Strategy

### Blacksmith Cache
**IMPORTANT**: When using Blacksmith runners, you MUST use `useblacksmith/cache@v1`
- Used for all jobs running on Blacksmith runners
- Provides faster cache operations
- Better persistence than GitHub Actions cache
- Cache key: `custom-node-linux-x64-v{version}-{hash}`

### GitHub Actions Cache
**Only used for self-hosted runners and standard GitHub runners**
- Self-hosted macOS runners use `actions/cache@v4`
- Standard GitHub runners use `actions/cache@v4`
- Cache key format same as Blacksmith

### Cache Performance
- Initial custom Node.js build: ~10-15 minutes on 32vCPU
- Cached builds: ~1 minute
- Blacksmith cache restoration: 2-3x faster than GitHub Actions cache

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
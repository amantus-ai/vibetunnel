# Publishing VibeTunnel to npm

This guide helps the repository owner publish VibeTunnel to npm as a standalone package.

## Prerequisites

1. **npm account** with publish access to `vibetunnel`
2. **Node.js 22.12 through 24.x** installed
3. **Apple Silicon Mac** for the complete multi-platform package
4. **Docker** installed (for Linux builds)
5. **Rustup** installed; `native/vt-fwd/rust-toolchain.toml` pins the forwarder toolchain

## Publishing Checklist

### 1. Update Version

```bash
# Update version in both package files
cd web/
# Edit version in package.json and package.npm.json
vim package.json package.npm.json
```

### 2. Build for npm

```bash
# Clean and build for all platforms on macOS
pnpm run clean
pnpm run build:npm

# This creates dist-npm/ and vibetunnel-<version>.tgz with:
# - Compiled JavaScript (lib/)
# - Static files (public/)
# - Native-module prebuilds (prebuilds/)
# - Rust forwarders (forwarders/<platform>-<arch>/vibetunnel-fwd)
# - Package.json ready for publishing
```

### 3. Test Locally

```bash
# build:npm runs npm pack in dist-npm/ and moves the archive here, to web/
pnpm run test:npm-package ./vibetunnel-*.tgz
npm install -g ./vibetunnel-*.tgz

# Test basic functionality
vibetunnel --version
vibetunnel --help
vibetunnel --no-auth  # Test server starts

# Test with ngrok
vibetunnel --no-auth --ngrok

# Cleanup
npm uninstall -g vibetunnel
```

### 4. Publish to npm

```bash
# Login to npm (first time only)
npm login
# Username: [your-username]
# Password: [your-password]  
# Email: [your-email]
# OTP: [if 2FA enabled]

# Publish the exact archive tested above
npm publish ./vibetunnel-<version>.tgz
```

### 5. Verify Publication

```bash
# Check it's published
npm view vibetunnel

# Test installation
npx vibetunnel --version

# Test in a fresh directory
cd /tmp
npx vibetunnel --no-auth
```

## Package Configuration

The package is configured with:

- **Name**: `vibetunnel` (unscoped)
- **Main**: `lib/cli.js` (entry point)
- **Bin**: `vibetunnel` command
- **Platforms**: macOS (x64, arm64) and Linux (x64, arm64)
- **Node**: Requires Node.js 22+

## Rust Forwarder Outputs

`pnpm run build` builds the host forwarder and installs it at `native/vibetunnel-fwd` and `bin/vibetunnel-fwd` under `web/`.

`pnpm run build:npm` additionally stages the selected package targets at:

```text
web/forwarders/darwin-arm64/vibetunnel-fwd
web/forwarders/darwin-x64/vibetunnel-fwd
web/forwarders/linux-arm64/vibetunnel-fwd
web/forwarders/linux-x64/vibetunnel-fwd
```

The selected directories are copied unchanged to `web/dist-npm/forwarders/` and then into the package archive. At runtime the CLI selects `forwarders/<process.platform>-<process.arch>/vibetunnel-fwd`; the postinstall script makes that binary executable. A complete macOS build creates all four targets. Filtered and `--current-only` builds include only their selected targets.

## What Gets Published

The npm package includes:
- ✅ Compiled JavaScript (`lib/`)
- ✅ Web UI files (`public/`)
- ✅ CLI binary (`bin/vibetunnel`)
- ✅ Rust forwarders (`forwarders/<platform>-<arch>/vibetunnel-fwd`)
- ✅ Prebuilt native binaries (`prebuilds/`)
- ✅ README files (README.md, README.npm.md, README.standalone.md)
- ✅ Runtime-only Dockerfile for building directly from extracted package contents
- ✅ Postinstall scripts

Not included:
- ❌ Source TypeScript files
- ❌ Test files
- ❌ Development configs
- ❌ Mac/iOS app code

## Version Management

Follow semantic versioning:
- **Patch** (1.0.x): Bug fixes, small improvements
- **Minor** (1.x.0): New features, backward compatible
- **Major** (x.0.0): Breaking changes

Current version scheme:
- `1.0.0-beta.X` for beta releases
- `1.0.0` for first stable release

## Troubleshooting

### Build Fails

```bash
# Clean everything and retry
pnpm run clean
rm -rf dist-npm/
pnpm install
pnpm run build:npm
```

Complete multi-platform builds require macOS. On Linux, use
`pnpm run build:npm -- --current-only` or `pnpm run build:npm -- --platform linux`.

### Missing Prebuilds

```bash
# Build for specific platform
pnpm run build:npm -- --platform darwin --arch arm64
```

### Permission Denied

```bash
# Ensure you're logged in with correct account
npm whoami
npm access ls-packages

# If using npm org teams, ensure team access for the package
```

### Already Published Version

```bash
# Bump version first
npm version patch  # or minor/major
# Then rebuild and republish
```

## Post-Publishing

After successful publication:

1. **Test with npx**: `npx vibetunnel --version`
2. **Update documentation**: Add npm badge to main README
3. **Create GitHub release**: Tag the version
4. **Announce**: Twitter, Discord, etc.

## Automation (Future)

Consider setting up GitHub Actions:

```yaml
# .github/workflows/npm-publish.yml
name: Publish to npm
on:
  release:
    types: [created]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
      - run: cd web && pnpm install
      - run: cd web && pnpm run build:npm
      - run: cd web && npm publish ./vibetunnel-*.tgz
        env:
          NODE_AUTH_TOKEN: ${{secrets.NPM_TOKEN}}
```

## Support

For issues with publishing, check:
- [npm documentation](https://docs.npmjs.com/cli/v10/commands/npm-publish)
- [GitHub issues](https://github.com/amantus-ai/vibetunnel/issues)
- npm support: support@npmjs.com

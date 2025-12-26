# Publishing VibeTunnel to npm

This guide helps the repository owner publish VibeTunnel to npm as a standalone package.

## Prerequisites

1. **npm account** with publish access to `vibetunnel`
2. **Node.js 22+** installed
3. **Docker** installed (for Linux builds)

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
# Clean and build for all platforms
pnpm run clean
pnpm run build:npm

# This creates dist-npm/ with:
# - Compiled JavaScript (lib/)
# - Static files (public/)
# - Prebuilt binaries for all platforms
# - Package.json ready for publishing
```

### 3. Test Locally

```bash
# Test the package locally before publishing
cd dist-npm/
npm pack
npm install -g vibetunnel-*.tgz

# Test basic functionality
vibetunnel --version
vibetunnel --help
vibetunnel --no-auth  # Test server starts

# Test with ngrok
vibetunnel --no-auth --ngrok

# Cleanup
npm uninstall -g vibetunnel
rm vibetunnel-*.tgz
cd ..
```

### 4. Publish to npm

```bash
cd dist-npm/

# Login to npm (first time only)
npm login
# Username: [your-username]
# Password: [your-password]  
# Email: [your-email]
# OTP: [if 2FA enabled]

# Publish
npm publish
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

## What Gets Published

The npm package includes:
- ✅ Compiled JavaScript (`lib/`)
- ✅ Web UI files (`public/`)
- ✅ CLI binary (`bin/vibetunnel`)
- ✅ Prebuilt native binaries (`prebuilds/`)
- ✅ README files (README.md, README.npm.md, README.standalone.md)
- ✅ Dockerfile for containerization
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
      - run: cd web/dist-npm && npm publish
        env:
          NODE_AUTH_TOKEN: ${{secrets.NPM_TOKEN}}
```

## Support

For issues with publishing, check:
- [npm documentation](https://docs.npmjs.com/cli/v10/commands/npm-publish)
- [GitHub issues](https://github.com/amantus-ai/vibetunnel/issues)
- npm support: support@npmjs.com

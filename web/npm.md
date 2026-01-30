# NPM Publishing Guide for VibeTunnel

## Installation Guide

### Installing VibeTunnel from NPM

VibeTunnel is published as an npm package that works on macOS and Linux. The package includes prebuilt binaries for common platforms to avoid compilation.

#### Basic Installation

```bash
# Install globally (recommended)
npm install -g vibetunnel

# Or install locally in a project
npm install vibetunnel
```

#### Platform-Specific Notes

**macOS**: 
- Works out of the box
- PAM authentication supported natively

**Linux**:
- Works without additional dependencies
- PAM authentication is optional - installs only if PAM headers are available
- If you need PAM authentication, install development headers first:
  ```bash
  # Ubuntu/Debian
  sudo apt-get install libpam0g-dev
  
  # RHEL/CentOS/Fedora
  sudo yum install pam-devel
  ```

#### Verifying Installation

```bash
# Check version
vibetunnel --version

# Run the server
vibetunnel

# The server will start on http://localhost:4020
```

#### Docker Installation

For containerized environments:

```dockerfile
FROM node:20-slim

# Optional: Install PAM headers for authentication support
# RUN apt-get update && apt-get install -y libpam0g-dev

# Install VibeTunnel
RUN npm install -g vibetunnel

# Expose the default port
EXPOSE 4020

# Run VibeTunnel
CMD ["vibetunnel"]
```

#### Troubleshooting Installation

1. **"Cannot find module '../build/Release/pty.node'"**
   - The package includes prebuilds, this shouldn't happen
   - Try reinstalling: `npm uninstall -g vibetunnel && npm install -g vibetunnel`

2. **PAM authentication not working on Linux**
   - Install PAM headers: `sudo apt-get install libpam0g-dev`
   - Reinstall VibeTunnel to compile the PAM module

3. **Permission errors during installation**
   - Use a Node.js version manager (nvm, fnm) instead of system Node.js
   - Or fix npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors

## Quick Release Checklist

1. **Update versions** in all 3 files:
   - `package.json`
   - `package.npm.json` 
   - `../mac/VibeTunnel/version.xcconfig`

2. **Build**: `pnpm run build:npm`

3. **Verify**: 
   ```bash
   tar -xf vibetunnel-*.tgz package/package.json
   grep optionalDependencies package/package.json  # Must show authenticate-pam
   rm -rf package/
   ```

4. **Publish tarball**:
   ```bash
   npm publish vibetunnel-*.tgz --tag beta
   npm dist-tag add vibetunnel@VERSION latest
   ```

⚠️ **NEVER** use `npm publish` without the tarball filename!

## Critical Issue History: Wrong package.json Used in Releases

### The Problem

We've repeatedly published npm packages with the wrong configuration:
- **Version 11.2**: Used main `package.json` instead of `package.npm.json`
- **Version 11.3**: Also used main `package.json` despite having the correct `package.npm.json`
- **Both versions had to be unpublished** due to Linux installation failures

This causes installation failures on Linux systems because:
- Main `package.json` has `authenticate-pam` as a **regular dependency**
- `package.npm.json` has `authenticate-pam` as an **optional dependency**

When `authenticate-pam` is a regular dependency, npm fails the entire installation if PAM headers (libpam0g-dev) aren't available.

### Root Cause

The build script (`scripts/build-npm.js`) checks for `package.npm.json` and uses it if available, BUT:
- During `npm publish`, npm runs the `prepublishOnly` script which triggers `build:npm`
- This rebuilds the package, potentially overwriting the correct configuration
- The timing and execution context can cause the wrong package.json to be used

### The Solution

**NEVER use `npm publish` directly!** Instead:

1. Build the package explicitly:
   ```bash
   pnpm run build:npm
   ```

2. Verify the package has the correct configuration:
   ```bash
   # Extract and check package.json from the tarball
   tar -xf vibetunnel-*.tgz package/package.json
   cat package/package.json | grep -A5 -B5 authenticate-pam
   ```

3. Ensure `authenticate-pam` is under `optionalDependencies`:
   ```json
   "optionalDependencies": {
     "authenticate-pam": "^1.0.5"
   }
   ```

4. Publish the pre-built tarball:
   ```bash
   npm publish vibetunnel-*.tgz --tag beta
   npm dist-tag add vibetunnel@VERSION latest  # if needed
   ```

## Correct Release Process

### 1. Update Version Numbers
```bash
# Update all three version files - MUST keep in sync!
vim package.json          # Update version
vim package.npm.json      # Update version to match
vim ../mac/VibeTunnel/version.xcconfig  # Update MARKETING_VERSION
```

### 2. Build the Package
```bash
pnpm run build:npm
```

### 3. Verify the Build
```bash
# Check the tarball exists (look in parent directory!)
ls -la *.tgz

# Extract and verify authenticate-pam is optional
tar -xf vibetunnel-*.tgz package/package.json
cat package/package.json | grep -A5 -B5 authenticate-pam

# Should show:
#   "optionalDependencies": {
#     "authenticate-pam": "^1.0.5"
#   }

# Clean up
rm -rf package/
```

### 4. Test Installation Locally
```bash
# Test on a system without PAM headers
docker run --rm -it node:20 bash
npm install /path/to/vibetunnel-*.tgz
# Should succeed even without libpam0g-dev
```

### 5. Publish
```bash
# Publish the pre-built tarball with beta tag
npm publish vibetunnel-*.tgz --tag beta

# Also tag as latest if stable
npm dist-tag add vibetunnel@VERSION latest
```

## Package Configuration Files

### package.json (Main Development)
- Used for development environment
- Has ALL dependencies including devDependencies
- `authenticate-pam` is a regular dependency (for development)
- **DO NOT USE FOR NPM PUBLISHING**

### package.npm.json (NPM Distribution)
- Used for npm package distribution
- Has only runtime dependencies
- `authenticate-pam` is an **optional dependency**
- **ALWAYS USE THIS FOR NPM PUBLISHING**

## Common Mistakes

1. **Running `npm publish` without arguments**
   - This triggers rebuild and may use wrong package.json
   - Always publish pre-built tarball

2. **Not verifying the package before publishing**
   - Always check that authenticate-pam is optional
   - Test installation on Linux without PAM headers

3. **Version mismatch**
   - Keep package.json, package.npm.json, and version.xcconfig in sync

## Testing npm Package

### Quick Docker Test
```bash
# Test on Ubuntu without PAM headers
docker run --rm -it ubuntu:22.04 bash
apt update && apt install -y nodejs npm
npm install vibetunnel@VERSION
# Should succeed without libpam0g-dev

# Test with PAM headers
apt install -y libpam0g-dev
npm install vibetunnel@VERSION
# Should also succeed and include authenticate-pam
```

### Verify Installation
```bash
# Check if vibetunnel works
npx vibetunnel --version

# On Linux, check if PAM module loaded (optional)
node -e "try { require('authenticate-pam'); console.log('PAM available'); } catch { console.log('PAM not available'); }"
```

## Emergency Fixes

If you accidentally published with wrong configuration:

1. **Unpublish if within 72 hours** (not recommended):
   ```bash
   npm unpublish vibetunnel@VERSION
   ```

2. **Publish a fix version**:
   - Increment version (e.g., 11.3 → 11.4)
   - Follow correct process above
   - Deprecate the broken version:
   ```bash
   npm deprecate vibetunnel@BROKEN_VERSION "Has installation issues on Linux. Please use VERSION or later."
   ```

## Release History & Lessons Learned

### Version 11.1 (Good)
- Used `package.npm.json` correctly
- `authenticate-pam` was an optional dependency
- Linux installations worked without PAM headers

### Version 11.2 (Bad - Unpublished)
- Accidentally used main `package.json`
- `authenticate-pam` was a required dependency
- Failed on Linux without libpam0g-dev
- **Issue**: Wrong package.json configuration

### Version 11.3 (Bad - Unpublished)
- Also used main `package.json` despite fix attempts
- Same Linux installation failures
- **Issue**: npm publish process overwrote correct configuration

### Version 11.4 (Good)
- Built with explicit `pnpm run build:npm`
- Published pre-built tarball
- `authenticate-pam` correctly optional
- Linux installations work properly

### Version 11.5 (Good)
- Published December 2024
- Built with explicit `pnpm run build:npm`
- Published pre-built tarball: `vibetunnel-1.0.0-beta.11.5.tgz`
- Verified `authenticate-pam` as optional dependency before publishing
- Tagged as both `beta` and `latest`
- **Process followed correctly**: All three version files updated, tarball verified, published with explicit filename

### Version 12.1 (Good)
- Published July 2025
- Built with explicit `pnpm run build:npm`
- Published pre-built tarball
- `authenticate-pam` correctly optional
- Linux installations work properly

### Version 12.2 (Good - Latest)
- Published July 17, 2025
- Built with explicit `pnpm run build:npm`
- Published pre-built tarball: `vibetunnel-1.0.0-beta.12.2.tgz`
- Verified `authenticate-pam` as optional dependency before publishing
- Tagged with `beta` tag
- **Process followed correctly**: All three version files updated (from beta.13 to beta.12.2), tarball verified, published with explicit filename

## Summary

The critical lesson: **package.npm.json must be used for npm distribution**, not package.json. The build script supports this, but you must publish the pre-built tarball, not rely on npm's prepublish hooks.

**Golden Rule**: Always build first, verify the package configuration, then publish the tarball. Never use `npm publish` without arguments.
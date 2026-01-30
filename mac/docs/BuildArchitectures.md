# Building VibeTunnel for Different Architectures

## Overview

VibeTunnel now supports building separate binaries for arm64 (Apple Silicon) and x86_64 (Intel) architectures. This allows for optimized builds for each platform while maintaining smaller download sizes compared to universal binaries.

## Local Development

### Building for a Specific Architecture

```bash
# Build for arm64 (Apple Silicon)
./scripts/build.sh --configuration Release --arch arm64

# Build for Intel
./scripts/build.sh --configuration Release --arch x86_64

# Build for native architecture (default)
./scripts/build.sh --configuration Release
```

### Creating Distribution Packages

The packaging scripts automatically detect the architecture from the built app:

```bash
# Create DMG (architecture is auto-detected)
./scripts/create-dmg.sh build/Build/Products/Release/VibeTunnel.app

# Create ZIP (architecture is auto-detected)
./scripts/create-zip.sh build/Build/Products/Release/VibeTunnel.app
```

## Release Builds

The release workflow (`release.yml`) automatically:

1. Builds separate binaries for arm64 and x86_64
2. Creates DMG and ZIP files for each architecture
3. Names files according to the pattern: `VibeTunnel-<version>-<arch>.<ext>`

### Release Artifacts

Each release produces 4 distribution files:
- `VibeTunnel-<version>-arm64.dmg` - Apple Silicon DMG installer
- `VibeTunnel-<version>-arm64.zip` - Apple Silicon ZIP archive
- `VibeTunnel-<version>-intel.dmg` - Intel DMG installer
- `VibeTunnel-<version>-intel.zip` - Intel ZIP archive

## Architecture Detection

The packaging scripts use `lipo -info` to detect the architecture of the built binary and automatically append the appropriate suffix to the filename.

## Bun Executable

The Bun executable is also built architecture-specifically:

```bash
# Build for arm64
cd web
node build-native.js --arch arm64

# Build for x64 (Intel)
node build-native.js --arch x64
```

The build process automatically passes the correct Bun target:
- arm64 → `bun-darwin-aarch64`
- x64 → `bun-darwin-x64`
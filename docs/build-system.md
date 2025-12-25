<!-- Generated: 2025-06-21 16:24:00 UTC -->
# Build System

VibeTunnel uses platform-specific build systems for each component: Xcode for macOS and iOS applications, pnpm for the web frontend, and Bun for creating standalone executables. The build system supports both development and release builds with comprehensive automation scripts for code signing, notarization, and distribution.

The main build orchestration happens through shell scripts in `mac/scripts/` that coordinate building native applications, bundling the web frontend, and packaging everything together. Release builds include code signing, notarization, DMG creation, and automated GitHub releases with Sparkle update support.

## Build Workflows

### macOS Application Build

**Development Build with Poltergeist** (Recommended):
```bash
# Start Poltergeist for automatic rebuilds
poltergeist
# Make changes - app rebuilds automatically
```

**Development Build without Poltergeist**:
```bash
cd mac
xcodebuild -project VibeTunnel.xcodeproj -scheme VibeTunnel -configuration Debug build
```

**Release Build** - Full build with code signing:
```bash
cd mac
./scripts/build.sh --configuration Release --sign
```

**Key Script**: `mac/scripts/build.sh` (lines 39-222)
- Builds Bun executable from web frontend
- Compiles macOS app using xcodebuild
- Handles code signing if requested
- Verifies version consistency with `mac/VibeTunnel/version.xcconfig`

### Web Frontend Build

**Development Mode** - Watch mode with hot reload:
```bash
cd web
pnpm run dev
```

**Production Build** - Optimized bundles:
```bash
cd web
pnpm run build
```

**Bun Executable** - Standalone binary with native modules:
```bash
cd web
node build-native.js
```

**Key Files**:
- `web/package.json` - Build scripts and dependencies (lines 6-34)
- `web/build-native.js` - Bun compilation and native module bundling (lines 83-135)

### iOS Application Build

**Generate Xcode Project** - From project.yml:
```bash
cd ios
xcodegen generate
```

**Build via Xcode** - Open `ios/VibeTunnel.xcodeproj` and build

**Key File**: `ios/project.yml` - XcodeGen configuration (lines 1-92)

### Release Workflow

**Complete Release** - Build, sign, notarize, and publish:
```bash
cd mac
./scripts/release.sh stable           # Stable release
./scripts/release.sh beta 1          # Beta release
```

**Key Script**: `mac/scripts/release.sh` (lines 1-100+)
- Validates environment and dependencies
- Builds with appropriate flags
- Signs and notarizes app
- Creates DMG
- Publishes GitHub release
- Updates Sparkle appcast

## Platform Setup

### macOS Requirements

**Development Tools**:
- Xcode 16.0+ with command line tools
- Node.js 22.12+ and pnpm
- Bun runtime (installed via npm)
- xcbeautify (optional, for cleaner output)

**Release Requirements**:
- Valid Apple Developer certificate
- App Store Connect API keys for notarization
- Sparkle EdDSA keys in `mac/private/`

**Configuration Files**:
- `apple/Local.xcconfig` - Local development settings
- `mac/VibeTunnel/version.xcconfig` - Version numbers
- `mac/Shared.xcconfig` - Shared build settings

### Web Frontend Requirements

**Tools**:
- Node.js 22.12+ with npm
- Bun runtime for standalone builds

**Native Modules**:
- `@homebridge/node-pty-prebuilt-multiarch` - Terminal emulation
- Platform-specific binaries in `web/native/`:
  - `pty.node` - Native PTY module
  - `spawn-helper` - Process spawning helper
  - `vibetunnel` - Bun executable

### iOS Requirements

**Tools**:
- Xcode 16.0+
- XcodeGen (install via Homebrew)
- iOS 18.0+ deployment target

**Dependencies**:
- ghostty-web resources (JS + WASM) bundled in the iOS app

## Reference

### Build Targets

**macOS Xcode Workspace** (`mac/VibeTunnel.xcworkspace`):
- VibeTunnel scheme - Main application
- Debug configuration - Development builds
- Release configuration - Distribution builds

**Web Build Scripts** (`web/package.json`):
- `dev` - Development server with watchers
- `build` - Production TypeScript compilation
- `bundle` - Client-side asset bundling
- `typecheck` - TypeScript validation
- `lint` - ESLint code quality checks

### Build Scripts

**Core Build Scripts** (`mac/scripts/`):
- `build.sh` - Main build orchestrator
- `build-bun-executable.sh` - Bun compilation (lines 31-92)
- `copy-bun-executable.sh` - Bundle integration
- `codesign-app.sh` - Code signing
- `notarize-app.sh` - Apple notarization
- `create-dmg.sh` - DMG packaging
- `generate-appcast.sh` - Sparkle updates

**Helper Scripts**:
- `preflight-check.sh` - Pre-build validation
- `version.sh` - Version management
- `clean.sh` - Build cleanup
- `verify-app.sh` - Post-build verification

### Troubleshooting

**Common Issues**:

1. **Bun build fails** - Check `web/build-native.js` patches (lines 11-79)
2. **Code signing errors** - Verify `apple/Local.xcconfig` settings
3. **Notarization fails** - Check API keys in environment
4. **Version mismatch** - Update `mac/VibeTunnel/version.xcconfig`

**Build Artifacts**:
- macOS app: `mac/build/Build/Products/Release/VibeTunnel.app`
- Web bundles: `web/public/bundle/`
- Native executables: `web/native/`
- iOS app: `ios/build/`

**Clean Build**:
```bash
cd mac && ./scripts/clean.sh
cd ../web && npm run clean
```

# Custom Node.js Build

## Motivation

VibeTunnel uses Node.js Single Executable Applications (SEA) to create a standalone terminal server. However, the standard Node.js binary is quite large:

- **Standard Node.js binary**: ~110MB
- **Custom minimal Node.js**: ~43MB (61% reduction)
- **Final executable size**: ~45MB (down from ~105MB)
- **Final app size impact**: Reduces app from ~130MB to ~88MB

We don't need many Node.js features for VibeTunnel:
- No internationalization (ICU) support needed
- No npm package manager in the binary
- No inspector/debugging protocol
- No V8 snapshots or code cache

By building a custom Node.js without these features, we achieve a significantly smaller app bundle while maintaining full functionality.

## Build Behavior

### Debug Mode (Xcode)
- Uses system Node.js for faster iteration
- No custom Node.js compilation required
- Build output shows: `"Debug build - using system Node.js for faster builds"`
- If a custom Node.js was previously built, it will be reused for consistency

### Release Mode (Xcode)
- Automatically builds custom minimal Node.js on first run
- Compilation takes 10-20 minutes but is cached for future builds
- Uses the custom Node.js to create a smaller executable
- Build output shows version and size comparison

## Prerequisites

### Required Build Tools
For optimal build performance, the following tools are required:
- **Ninja**: Build system for faster compilation (significantly faster than Make)
- **ccache**: Compiler cache to speed up rebuilds

#### Installation
- **macOS**: `brew install ninja ccache`
- **Linux**: `apt-get install ninja-build ccache` (or equivalent for your distribution)

The build script will automatically use these tools if available, falling back to Make if Ninja is not found.

## Build Automation

### Release Builds
The release script (`mac/scripts/release.sh`) automatically checks for and builds custom Node.js if needed. You don't need to manually build it before releases.

### Manual Custom Node.js Build

To build the custom Node.js manually (outside of Xcode):

```bash
cd web
node build-custom-node.js --latest
```

This will:
1. Download the latest Node.js source
2. Configure it without unnecessary features
3. Build with optimizations (`-Os`, `-flto`, etc.)
4. Cache the result in `web/.node-builds/`

To use the custom Node.js for building the executable:

```bash
cd web
npm run build -- --custom-node
```

Or directly:

```bash
node build-native.js --custom-node
```

## Build Process Details

### Automatic Detection
The build system automatically searches for custom Node.js builds in `.node-builds/` when `--custom-node` is passed without a path. It finds the most recent build by checking directory modification times.

### Code Signing on macOS
When building the executable:
1. The Node.js binary is injected with our JavaScript code (SEA process)
2. The binary is stripped to remove debug symbols
3. The executable is re-signed with an ad-hoc signature

Note: You may see a warning about "invalidating the code signature" during the strip process - this is expected and harmless since we re-sign immediately after.

## Technical Details

### Features Disabled
- `--without-intl` - Removes internationalization support
- `--without-npm` - Excludes npm from the binary
- `--without-corepack` - Removes package manager wrapper
- `--without-inspector` - Disables debugging protocol
- `--without-node-snapshot` - Skips V8 snapshot (~2-3MB)
- `--without-node-code-cache` - Skips code cache (~1-2MB)

### Optimization Flags
- `-Os` - Optimize for size
- `-flto` - Link-time optimization
- `-ffunction-sections` / `-fdata-sections` - Enable dead code elimination
- `-Wl,-dead_strip` - Remove unused code at link time

### Build Cache
Custom Node.js builds are stored in `web/.node-builds/` and are excluded from git via `.gitignore`. The build system automatically detects and reuses existing builds.

## File Locations

- Build script: `web/build-custom-node.js`
- Native executable builder: `web/build-native.js`
- Xcode integration: `mac/scripts/build-web-frontend.sh`
- Build output: `web/.node-builds/node-v*-minimal/`
- Final executable: `web/native/vibetunnel`

## Troubleshooting

### Custom Node.js not detected
- Ensure the build completed successfully: check for `.node-builds/node-v*-minimal/out/Release/node`
- In Debug mode, the system will use custom Node.js if already built
- In Release mode, it will build custom Node.js automatically if not present

### Code signature warnings
The warning "changes being made to the file will invalidate the code signature" is expected and handled automatically. The build process re-signs the executable after all modifications.

## Known Limitations

- The custom Node.js build process takes 10-20 minutes on first run
- Cross-compilation is not supported - you must build on the target platform
- The custom build excludes some features that may be needed by certain npm packages
- Native module compatibility issues may occur when mixing Node.js versions

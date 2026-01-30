# Build Requirements

VibeTunnel for macOS now has a self-contained build system that automatically installs all required dependencies.

## Requirements

- **macOS**: 10.15 or later
- **Xcode**: 15.0 or later
- **Internet connection**: Required for first build to download dependencies

## Build Process

When you build VibeTunnel in Xcode for the first time:

1. **Install Build Dependencies** phase runs first
   - Downloads and installs Bun locally to `.build-tools/bun/`
   - No system-wide installation required
   - Works on both Intel and Apple Silicon Macs

2. **Build Web Frontend** phase uses Bun
   - Runs `bun install` to fetch dependencies
   - Runs `bun run bundle` to build the web interface
   - 10-100x faster than npm

3. **Build Bun Executable** phase compiles the server

## Benefits

- **Zero manual setup** - Just open in Xcode and build
- **No Node.js required** - Uses Bun for everything
- **Portable** - All tools installed locally
- **Fast** - Bun is significantly faster than npm
- **Cached** - Downloads only happen once

## Troubleshooting

If the build fails:

1. Check internet connection (required for first build)
2. Delete `.build-tools/` directory and rebuild
3. Check Console.app for detailed error messages

## Clean Build

To perform a completely clean build:

```bash
cd mac
rm -rf .build-tools/
rm -rf ../web/node_modules/
# Then build in Xcode
```
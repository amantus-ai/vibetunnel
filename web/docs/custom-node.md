# Custom Node.js Build

This document describes how to build a minimal custom Node.js binary for VibeTunnel.

## Overview

The custom Node.js build reduces binary size from ~110MB to ~50-60MB by excluding:
- International support (ICU) - saves ~28MB
- npm/npx - saves ~5MB
- corepack
- dtrace/etw instrumentation
- Inspector protocol
- Other unused features

## Usage

```bash
# Build for current Node.js version
node build-custom-node.js

# Build latest Node.js version
node build-custom-node.js --latest

# Build specific version
node build-custom-node.js --version=24.1.0
node build-custom-node.js --version=24.2.0
```

## Output Location

The custom Node.js will be built in:
```
.node-builds/node-vXX-minimal/out/Release/node
```

## Build Requirements

- Python 3 (for Node.js build system)
- C++ compiler (Xcode command line tools on macOS)
- make
- ~10-20 minutes build time

## Troubleshooting

### Incomplete Builds

If builds are incomplete (directories exist but no executable):

```bash
# Delete the incomplete build
rm -rf .node-builds/node-v24.1.0-minimal

# Rebuild
node build-custom-node.js --version=24.1.0
```

### Common Issues

- **Interrupted builds**: Delete the directory and rebuild
- **Missing executable**: Check `.node-builds/node-vXX-minimal/out/Release/node` exists
- **Build failures**: Ensure Xcode command line tools are installed (macOS)
- **Build time**: The build process takes 10-20 minutes - let it complete fully

### Verification

After building, verify the executable exists:
```bash
ls -la .node-builds/node-v24.1.0-minimal/out/Release/node
```

## Using with build-native.js

The custom Node.js is automatically detected by `build-native.js`:

```bash
# Auto-detect latest custom build
node build-native.js --custom-node

# Specify custom Node path
node build-native.js --custom-node=/path/to/custom/node
```

## Size Comparison

- Standard Node.js: ~110MB
- Custom Node.js: ~50-60MB
- Final executable with custom Node: ~105MB (vs ~155MB with standard Node)
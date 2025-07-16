# VibeTunnel NPM Package Distribution

This document explains the npm package build process, native module handling, and prebuild system for VibeTunnel.

## Overview

VibeTunnel is distributed as an npm package that includes:
- Full web server with terminal sharing capabilities
- Native modules for terminal (PTY) and authentication (PAM) support
- Cross-platform prebuilt binaries to avoid requiring build tools
- Command-line tools (`vibetunnel` and `vt`)

## Package Structure

```
vibetunnel/
├── dist/                    # Compiled server code
├── public/                  # Web interface assets
├── bin/                     # CLI entry points
│   ├── vibetunnel          # Main server executable
│   └── vt                  # Terminal wrapper command
├── node-pty/               # Vendored PTY implementation
│   ├── lib/                # TypeScript compiled code
│   └── package.json        # PTY package configuration
├── prebuilds/              # Native module prebuilt binaries
│   ├── node-pty-*          # PTY binaries for all platforms/Node versions
│   └── authenticate-pam-*  # PAM binaries for all platforms/Node versions
└── README.md               # Package documentation
```

## Native Modules

VibeTunnel requires two native modules:

### 1. node-pty (Terminal Support)
- **Purpose**: Provides pseudo-terminal (PTY) functionality
- **Components**:
  - `pty.node`: Main Node.js addon for terminal operations
  - `spawn-helper`: macOS-only C helper binary for process spawning
- **Platforms**: All (macOS, Linux)
- **Dependencies**: None (vendored implementation)

### 2. authenticate-pam (Authentication)
- **Purpose**: PAM (Pluggable Authentication Modules) integration for system authentication
- **Components**:
  - `authenticate_pam.node`: Node.js addon for system authentication
- **Platforms**: Both macOS and Linux
- **Dependencies**: System PAM libraries
- **Note**: While macOS uses different authentication mechanisms internally (OpenDirectory), VibeTunnel attempts PAM authentication on both platforms as a fallback after SSH key authentication

## Prebuild System

### Overview
We use `prebuild` and `prebuild-install` to provide precompiled native modules, eliminating the need for users to have build tools installed.

### Coverage
- **Node.js versions**: 20, 22, 23, 24
- **Platforms**: macOS (x64, arm64), Linux (x64, arm64)
- **Total prebuilds**: 24 binaries
  - node-pty: 16 binaries (macOS and Linux, all architectures)
  - authenticate-pam: 8 binaries (Linux only - macOS builds may fail due to PAM differences)

### Prebuild Files
```
prebuilds/
├── node-pty-v1.0.0-node-v115-darwin-arm64.tar.gz
├── node-pty-v1.0.0-node-v115-darwin-x64.tar.gz
├── node-pty-v1.0.0-node-v115-linux-arm64.tar.gz
├── node-pty-v1.0.0-node-v115-linux-x64.tar.gz
├── authenticate-pam-v1.0.5-node-v115-linux-arm64.tar.gz
├── authenticate-pam-v1.0.5-node-v115-linux-x64.tar.gz
└── ... (similar for node versions 22, 23, 24, Linux only)
```

Note: Node version numbers map to internal versions (v115=Node 20, v127=Node 22, v131=Node 23, v134=Node 24)

## Build Process

### Clean Build Approach
The npm build process uses a clean distribution directory approach that follows npm best practices:

1. **Creates dist-npm/ directory** - Separate from source files
2. **Generates clean package.json** - Only production fields, no dev dependencies
3. **Bundles dependencies** - node-pty is bundled directly, no symlinks needed
4. **Preserves source integrity** - Never modifies source package.json

### Unified Build (Multi-Platform by Default)
```bash
npm run build:npm
```
- Compiles TypeScript and bundles client code
- Builds native modules for all supported platforms (macOS x64/arm64, Linux x64/arm64)
- Creates comprehensive prebuilds for zero-dependency installation
- Generates npm README optimized for package distribution
- Creates clean dist-npm/ directory for packaging

### Build Options
The unified build script supports flexible targeting:

```bash
# Default: All platforms
npm run build:npm

# Current platform only (faster for development)
node scripts/build-npm.js --current-only

# Specific platform/architecture
node scripts/build-npm.js --platform darwin --arch arm64
node scripts/build-npm.js --platform linux

# Skip Docker (Linux builds will be skipped)
node scripts/build-npm.js --no-docker
```

### Docker Requirements
For Linux builds, Docker is required:
- **Recommended**: [OrbStack](https://orbstack.dev/)
- **Alternative**: [Docker Desktop](https://www.docker.com/products/docker-desktop/)

The build will fail with helpful error messages if Docker is not available.

## Installation Process

### For End Users
1. **Install package**: `npm install -g vibetunnel`
2. **Postinstall script runs**: Extracts appropriate prebuilt binaries
3. **No compilation needed**: Prebuilds included for all supported platforms
4. **Result**: Working VibeTunnel installation without build tools

### Key Improvements
- **No symlinks**: node-pty is bundled directly, avoiding postinstall symlink issues
- **Clean package structure**: Only production files in the npm package
- **Reliable installation**: Works in restricted environments (Docker, CI)

### Installation Scripts
The package uses a simplified postinstall approach:

```json
{
  "scripts": {
    "postinstall": "node scripts/postinstall.js"
  }
}
```

#### Postinstall Process
- **Prebuild extraction**: Extracts the appropriate prebuild for the current platform
- **No downloads**: All prebuilds are included in the package
- **No compilation**: Everything is pre-built, no build tools required
- **Platform detection**: Automatically selects correct binary based on OS and architecture

## Platform-Specific Details

### macOS
- **spawn-helper**: Additional C binary needed for proper PTY operations (now prebuilt as universal binary)
- **Authentication**: Attempts PAM authentication but may fall back to environment variables or SSH keys
- **Architecture**: Supports both Intel (x64) and Apple Silicon (arm64)
- **Build tools**: Not required with prebuilds; Xcode Command Line Tools only needed for source compilation fallback

### Linux
- **PAM authentication**: Full support via authenticate-pam module
- **PAM libraries**: Requires `libpam0g-dev` for authenticate-pam compilation from source
- **spawn-helper**: Not used on Linux (macOS-only)
- **Build tools**: Not required with prebuilds; `build-essential` only needed for source compilation fallback

### Docker Build Environment
Linux prebuilds are created using Docker with:
- **Base image**: `node:22-bookworm`
- **Dependencies**: `python3 make g++ git libpam0g-dev`
- **Package manager**: pnpm (more reliable than npm in Docker)
- **Environment**: `CI=true` to avoid interactive prompts

## spawn-helper Binary

### What is spawn-helper?
`spawn-helper` is a small C helper binary used by node-pty for proper terminal process spawning on macOS.

### Key Facts
- **Size**: ~70KB pure C binary
- **Platform**: macOS only (Linux doesn't use it)
- **Purpose**: Handles terminal device attachment for spawned processes
- **Dependencies**: None (pure C, no Node.js dependencies)
- **Architecture**: Platform-specific (x64 vs arm64)

### Source Code
```c
// Simplified version of spawn-helper functionality
int main (int argc, char** argv) {
  char *slave_path = ttyname(STDIN_FILENO);
  close(open(slave_path, O_RDWR));  // Attach to terminal
  
  char *cwd = argv[1];
  char *file = argv[2];
  argv = &argv[2];
  
  if (strlen(cwd) && chdir(cwd) == -1) {
    _exit(1);
  }
  
  execvp(file, argv);  // Execute the target command
  return 1;
}
```

### Installation Handling
- **Current approach**: Universal spawn-helper binary included in prebuilds (macOS only)
- **Benefits**: No compilation needed, faster installation, works without build tools
- **Fallback path**: If prebuild fails, compilation happens automatically via node-gyp
- **Error handling**: Non-fatal if missing (warns but continues)

### Universal Binary Implementation
spawn-helper is now shipped as a prebuilt universal binary in all macOS prebuilds:

**Implementation**: 
- Built for both x64 and arm64 architectures using clang++
- Combined into universal binary with `lipo`
- Included in every macOS node-pty prebuild automatically

**Benefits**:
- ✅ Faster installation (no compilation needed)
- ✅ Works without build tools (Xcode Command Line Tools)
- ✅ Universal compatibility across Intel and Apple Silicon Macs
- ✅ Smaller download than compiling during install

**Build process**:
```bash
# Build for both architectures
clang++ -arch x86_64 -o spawn-helper-x64 spawn-helper.cc
clang++ -arch arm64 -o spawn-helper-arm64 spawn-helper.cc

# Create universal binary  
lipo -create spawn-helper-x64 spawn-helper-arm64 -output spawn-helper-universal

# Include in all macOS prebuilds
```

## Package Optimization

### File Exclusions
Development artifacts are excluded from the final package:
- Test files (`public/bundle/test.js`, `public/test/` directory)
- Recording files (`*.cast` prevented by .gitignore)
- Build artifacts (`dist/` selectively included via package.json `files` field)

**Note**: `screencap.js` is kept as it provides screen capture functionality for the web interface.

### Size Optimization
- **Final size**: ~8.5 MB
- **File count**: ~275 files
- **Prebuilds**: Included for zero-build installation experience
- **Source code**: Minimal, compiled assets only

## Development Commands

### Local Development
```bash
# Multi-platform build with prebuilds (default)
npm run build:npm

# Single-platform build for local testing
node scripts/build-npm.js --current-only

# Test package locally
npm pack

# Verify package contents
tar -tzf vibetunnel-*.tgz | head -20
```

### Quality Checks
Always run before publishing:
```bash
pnpm run lint          # Check code style
pnpm run typecheck     # Verify TypeScript
```

## Publishing

### Prerequisites
1. Update version in `package.json`
2. Run multi-platform build
3. Test package locally
4. Verify all prebuilds are included

### Publish Command
```bash
npm publish
```

## Usage After Installation

### Installation
```bash
# Install globally
npm install -g vibetunnel
```

### Starting the Server
```bash
# Start with default settings (port 4020)
vibetunnel

# Start with custom port
vibetunnel --port 8080

# Start without authentication
vibetunnel --no-auth
```

Then open http://localhost:4020 in your browser to access the web interface.

### Using the vt Command
```bash
# Monitor AI agents with automatic activity tracking
vt claude
vt claude --dangerously-skip-permissions

# Run commands with output visible in VibeTunnel
vt npm test
vt python script.py
vt top

# Launch interactive shell
vt --shell
vt -i

# Update session title (inside a session)
vt title "My Project"
```

### Command Forwarding
```bash
# Basic usage
vibetunnel fwd <session-id> <command> [args...]

# Examples
vibetunnel fwd --session-id abc123 ls -la
vibetunnel fwd --session-id abc123 npm test
vibetunnel fwd --session-id abc123 python script.py
```

## Coexistence with Mac App

The npm package works seamlessly alongside the Mac app:

### Command Routing
- The `vt` command from npm automatically detects if the Mac app is installed
- If Mac app found at `/Applications/VibeTunnel.app`, npm `vt` defers to it
- Ensures you always get the best available implementation

### Installation Behavior
- Won't overwrite existing `/usr/local/bin/vt` from other tools
- Provides helpful warnings if conflicts exist
- Installation always succeeds, even if `vt` symlink can't be created
- Use `vibetunnel` or `npx vt` as alternatives

## Troubleshooting

### Common Issues

#### Missing Build Tools
**Error**: `gyp ERR! stack Error: not found: make`
**Solution**: Install build tools:
- **macOS**: `xcode-select --install`
- **Linux**: `apt-get install build-essential`

#### Missing PAM Development Libraries
**Error**: `fatal error: security/pam_appl.h: No such file or directory`
**Solution**: Install PAM development libraries:
- **Linux**: `apt-get install libpam0g-dev`
- **macOS**: Usually available by default

#### Docker Not Available
**Error**: `Docker is required for multi-platform builds`
**Solution**: Install Docker using OrbStack or Docker Desktop

#### Prebuild Download Failures
**Error**: `prebuild-install warn install No prebuilt binaries found`
**Cause**: Network issues or unsupported platform/Node version
**Result**: Automatic fallback to source compilation

### Debugging Installation
```bash
# Verbose npm install
npm install -g vibetunnel --verbose

# Check prebuild availability
npx prebuild-install --list

# Force source compilation
npm install -g vibetunnel --build-from-source
```

## Architecture Decisions

### Why Prebuilds?
- **User experience**: No build tools required for most users
- **Installation speed**: Pre-compiled binaries install much faster
- **Reliability**: Eliminates compilation errors in user environments
- **Cross-platform**: Supports all target platforms without user setup

### Why Docker for Linux Builds?
- **Cross-compilation**: Build Linux binaries from macOS development machine
- **Consistency**: Reproducible build environment
- **Dependencies**: Proper PAM library versions for Linux

### Why Vendored node-pty?
- **Control**: Custom modifications for VibeTunnel's needs
- **Reliability**: Avoid external dependency issues
- **Optimization**: Minimal implementation without unnecessary features

## Related Files

- `scripts/build-npm.js` - Unified npm build process with multi-platform support
- `scripts/postinstall-npm.js` - Fallback compilation logic
- `.prebuildrc` - Prebuild configuration for target platforms
- `package.json` - Package configuration and file inclusions

## Release Notes

### Version 1.0.0-beta.11 (2025-07-16)

**Published to npm**: Successfully published as `vibetunnel@beta`

**Key Features**:
- Cross-platform support for macOS (x64, arm64) and Linux (x64, arm64)
- Pre-built native binaries for Node.js versions 20, 22, 23, and 24
- Zero-dependency installation experience (no build tools required)
- Comprehensive prebuild system with 24 total binaries included

**Release Process Learnings**:

1. **Version Synchronization**:
   - Must update version in both `web/package.json` and `mac/VibeTunnel/version.xcconfig`
   - Build process validates version sync to prevent mismatches
   - Version mismatch will cause build failure with clear error message

2. **NPM Publishing Requirements**:
   - Beta versions require `--tag beta` flag when publishing
   - Previously published versions cannot be overwritten (must increment version)
   - Use `--access public` flag for public package publishing

3. **Package Build Process**:
   - `pnpm run build:npm` creates the complete package with all prebuilds
   - Build output filename may show older version in logs but creates correct package
   - Always verify package version in `dist-npm/package.json` before publishing

4. **Docker Testing Verification**:
   - Successfully tested on Ubuntu 22.04 (both ARM64 and x64 architectures)
   - Installation works without any build tools installed
   - Server starts correctly with all expected functionality
   - HTTP endpoints respond properly

5. **Package Structure**:
   - Final package size: 8.3 MB (24.9 MB unpacked)
   - Contains 198 files including all prebuilds and web assets
   - Proper postinstall script ensures seamless installation

**Installation**:
```bash
npm install -g vibetunnel@beta
```

**Testing Commands Used**:
```bash
# Build the package
cd web && pnpm run build:npm

# Verify package contents
tar -tzf vibetunnel-1.0.0-beta.11.tgz | head -50

# Test with Docker
docker build -t vibetunnel-test .
docker run --rm vibetunnel-test

# Test cross-platform
docker run --rm --platform linux/amd64 vibetunnel-test
```

### Version History

- **1.0.0-beta.11.1** (2025-07-16): Fixed npm installation issues, latest stable release
- **1.0.0-beta.11** (2025-07-16): Initial release with full prebuild system
- **1.0.0-beta.10** (2025-07-14): Previous version (unpublished)

## NPM Distribution Tags

VibeTunnel uses npm dist-tags to manage different release channels:

### Current Tags
- **latest**: Points to the most stable release (currently 1.0.0-beta.11.1)
- **beta**: Points to the latest beta release (currently 1.0.0-beta.11.1)

### Managing Tags

```bash
# View current tags
npm dist-tag ls vibetunnel

# Set a version as latest
npm dist-tag add vibetunnel@1.0.0-beta.11.1 latest

# Add a new tag
npm dist-tag add vibetunnel@1.0.0-beta.12 next

# Remove a tag
npm dist-tag rm vibetunnel next
```

### Installation by Tag

```bash
# Install latest stable (default)
npm install -g vibetunnel

# Install specific tag
npm install -g vibetunnel@beta
npm install -g vibetunnel@latest

# Install specific version
npm install -g vibetunnel@1.0.0-beta.11.1
```

### Best Practices
- Always tag beta releases with `beta` tag
- Only promote to `latest` after testing confirms stability
- Use semantic versioning for beta iterations (e.g., 1.0.0-beta.11.1, 1.0.0-beta.11.2)
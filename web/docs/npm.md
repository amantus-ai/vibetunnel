# NPM Package Release Process

This document describes how to build and release VibeTunnel as a full-featured npm package for Linux and macOS environments.

## Prerequisites

- **Node.js 20.0.0 or higher** 
- macOS or Linux development environment
- Access to npm registry with publish permissions for `@vibetunnel` scope
- Build tools for native modules (Xcode on macOS, build-essential on Linux)

## Package Overview

The npm package includes the **complete VibeTunnel server**:
- Full web UI with terminal interface (public/)
- TypeScript-compiled server code (dist/)
- CLI tools including `vt` command wrapper (bin/)
- Node.js native PTY module (node-pty)
- All server functionality without requiring standalone executable

Package size: **~8.1 MB** (much smaller than 81MB standalone version)

## Build Process

### 1. Install Dependencies

```bash
cd web
pnpm install
```

### 2. Build for NPM Distribution

```bash
npm run build:npm
```

This command:
- Runs the full build process (TypeScript, CSS, client bundles)
- Builds node-pty native module if needed
- Includes all web assets and UI
- Cleans up test files to reduce size
- Creates CLI entry points including `vt` command
- Generates npm-specific README

### 3. Verify Package Contents

```bash
npm pack --dry-run
```

This shows what files will be included in the published package.

## Platform Support

The npm package uses native Node.js modules that are built during installation:

### macOS
- Architectures: `arm64` (Apple Silicon), `x64` (Intel)
- Requires: Xcode Command Line Tools

### Linux
- Architectures: `x64`, `arm64`
- Requires: `build-essential` package

Note: Native modules are compiled during `npm install` for the target platform.

## Publishing Process

### 1. Update Version

Update version in `package.json`:
```json
{
  "version": "1.0.0-beta.11"
}
```

### 2. Build and Test Locally

```bash
# Build the package
npm run build:npm

# Create local package
npm pack

# Test installation locally
npm install -g vibetunnel-vibetunnel-cli-1.0.0-beta.11.tgz
```

### 3. Publish to NPM

```bash
# Login to npm (if not already)
npm login

# Publish the package
npm publish --access public
```

## Files and Configuration

### .npmignore
Controls which files are excluded from the npm package:
- Development files (src/, scripts/, docs/)
- Test files and configurations
- Build scripts and TypeScript configs

### package.json Configuration
Key fields for npm publishing:
- `name`: `@vibetunnel/vibetunnel-cli`
- `bin`: Points to CLI executable
- `files`: Explicit list of included files
- `engines`: Requires Node.js >= 20.0.0
- `os`: Supports `darwin` and `linux`
- `prepublishOnly`: Runs `build:npm` automatically

### Postinstall Script
`scripts/postinstall-npm.js` handles:
- Platform detection
- Binary selection and installation
- Setting executable permissions
- Fallback for development vs production

## Building for Multiple Platforms

To create a package with binaries for multiple platforms:

1. Build on each target platform:
   ```bash
   # On macOS ARM64
   npm run build:npm
   
   # On Linux x64 (using Docker or VM)
   npm run build:npm
   ```

2. Manually combine platform directories:
   ```bash
   native/
   ├── darwin-arm64/
   ├── darwin-x64/
   ├── linux-x64/
   └── linux-arm64/
   ```

3. Publish the combined package.

## Usage After Installation

```bash
# Install globally
npm install -g @vibetunnel/vibetunnel-cli
```

### Start the VibeTunnel server

```bash
# Start with default settings (port 4020)
vibetunnel

# Start with custom port
vibetunnel --port 8080

# Start without authentication
vibetunnel --no-auth
```

Then open http://localhost:4020 in your browser to access the full web interface.

### Use the vt command wrapper

The `vt` command allows you to run commands with TTY forwarding:

```bash
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

### Forward commands to a session

```bash
# Basic usage
vibetunnel fwd <session-id> <command> [args...]

# Examples
vibetunnel fwd abc123 ls -la
vibetunnel fwd abc123 npm test
vibetunnel fwd abc123 python script.py

# Using the direct command
vibetunnel-fwd abc123 ls -la
```

## Troubleshooting

### Missing Native Modules
If native modules fail to load:
1. Check Node.js version (must be >= 20.0.0)
2. Verify platform compatibility
3. Rebuild native modules: `cd node_modules/@vibetunnel/vibetunnel-cli && npm rebuild`

### Binary Not Found
If the `vibetunnel` command is not found:
1. Check npm global bin path: `npm bin -g`
2. Ensure it's in your PATH
3. Try running directly: `$(npm bin -g)/vibetunnel`

### Platform Not Supported
The package currently supports:
- macOS (Intel and Apple Silicon)
- Linux (x64 and ARM64)

Windows support is not currently available.

## Package Architecture

The npm package provides the complete VibeTunnel experience:

### What's Included:
- **Full web UI**: Complete terminal interface accessible via browser
- **Server functionality**: All features of the standalone server
- **CLI tools**: Including the `vt` command wrapper for enhanced terminal usage
- **No standalone executable**: Runs with Node.js (requires Node.js 20+)

### Package Size Comparison:
- npm package: **~8.1 MB** (full functionality)
- Standalone executable: **~81 MB** (includes Node.js runtime)
- Savings: **90% smaller** while maintaining all features

### Use Cases:
1. **Full terminal server**: Run VibeTunnel on any Linux or macOS system
2. **CI/CD integration**: Use `vt` and `vibetunnel fwd` for automation
3. **Headless servers**: Full functionality without GUI requirements
4. **Development environments**: Lightweight alternative to the macOS app

## Development Notes

### Custom Node.js Build
For smaller binary sizes, you can use a custom Node.js build:
```bash
node build-native.js --custom-node
```

### Testing Package Locally
Before publishing:
```bash
# Pack the package
npm pack

# Install globally from tarball
npm install -g vibetunnel-vibetunnel-cli-*.tgz

# Test the installation
vibetunnel version
```

### Version Synchronization
Ensure version is synchronized across:
- `package.json`
- `src/server/version.ts`
- `src/client/version.ts`

Run validation: `node scripts/validate-version-sync.js`
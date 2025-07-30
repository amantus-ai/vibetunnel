# Windows and Linux Compatibility Plan for VibeTunnel Web/Server

## Executive Summary

VibeTunnel's web/server component is already **highly compatible** with Linux and Windows thanks to the recent migration to a Rust-based PTY addon using the `portable-pty` crate. The main compatibility issue is **authentication on Windows**, as PAM (Pluggable Authentication Modules) is Unix-only.

## Current Compatibility Status

### ✅ Cross-Platform Ready Components

1. **Terminal (PTY) Implementation**
   - Uses `portable-pty` Rust crate - fully cross-platform
   - Native addon configured for all platforms in `native-pty/package.json`:
     - Windows: `x86_64-pc-windows-msvc`
     - Linux: `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`
     - macOS: `aarch64-apple-darwin`, `x86_64-apple-darwin`
   - Handles platform differences (cmd.exe vs /bin/bash) automatically

2. **Core Server Infrastructure**
   - Express.js server - platform agnostic
   - WebSocket (ws) - works everywhere
   - File operations use Node.js path module for cross-platform paths
   - Build system (ESBuild) is cross-platform

3. **Frontend**
   - Web-based UI works in any modern browser
   - No platform-specific code

### ⚠️ Platform-Specific Features

1. **Authentication** (MAIN ISSUE)
   - PAM authentication (`authenticate-pam`) is **Unix-only**
   - Windows has no authentication currently
   - Code gracefully fails with "PAM authentication not available"

2. **Screen Capture** (Minor)
   - macOS-only feature using native APIs
   - Returns appropriate error on other platforms
   - Not critical for core functionality

3. **Process Management** (Handled)
   - Signal handling differences between platforms
   - Already handled by `portable-pty` and native addon

## Windows Authentication Problem

### Current Behavior
```typescript
// src/server/services/authenticate-pam-loader.ts
if (process.platform === 'win32') {
  // Returns error: "PAM authentication not available"
  // No Windows users can log in!
}
```

### Windows Authentication Options

1. **Native Windows LogonUser API** (Recommended long-term)
   ```rust
   // Add to native-pty addon
   #[cfg(windows)]
   use windows::Win32::Security::LogonUserW;
   
   #[napi]
   pub fn authenticate_windows(username: String, password: String) -> Result<bool> {
     // Validate against Windows credentials
   }
   ```

2. **Third-party npm packages**
   - `node-sspi` - Windows SSPI authentication
   - `node-windows` - Windows service integration
   - Custom implementation using Windows APIs

3. **Cross-platform alternatives**
   - Token-based authentication
   - Configuration file with users/passwords
   - OAuth/SAML integration
   - Disable auth on Windows (dev only)

## Implementation Plan

### Phase 1: Immediate Compatibility (1-2 days)

1. **Build and Test on Target Platforms**
   ```bash
   # Linux/Windows
   cd web/native-pty
   npm install
   npm run build
   
   # Test basic functionality
   cd ..
   pnpm install
   pnpm run dev
   ```

2. **Add Platform Detection**
   ```typescript
   // src/server/utils/platform.ts
   export const PLATFORM_CONFIG = {
     isWindows: process.platform === 'win32',
     isLinux: process.platform === 'linux',
     isMac: process.platform === 'darwin',
     defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
     authAvailable: process.platform !== 'win32'
   };
   ```

3. **Temporary Windows Auth Workaround**
   ```typescript
   // Quick fix: Allow configurable auth bypass for Windows
   if (process.platform === 'win32') {
     const bypassAuth = process.env.VIBETUNNEL_WINDOWS_NO_AUTH === 'true';
     if (bypassAuth) {
       return { authenticated: true, username: 'windows-user' };
     }
   }
   ```

### Phase 2: Proper Windows Authentication (3-5 days)

1. **Extend Native Addon**
   ```rust
   // web/native-pty/src/lib.rs
   #[cfg(windows)]
   mod windows_auth;
   
   #[napi]
   pub fn authenticate_user(username: String, password: String) -> Result<bool> {
     #[cfg(windows)]
     return windows_auth::validate_credentials(username, password);
     
     #[cfg(unix)]
     return Err(Error::from_reason("Use PAM on Unix"));
   }
   ```

2. **Update Auth Service**
   ```typescript
   // Unified auth that works everywhere
   async authenticate(username: string, password: string): Promise<boolean> {
     if (process.platform === 'win32') {
       const { authenticateUser } = require('../native-pty');
       return authenticateUser(username, password);
     } else {
       return this.verifyPAMCredentials(username, password);
     }
   }
   ```

### Phase 3: CI/CD and Distribution (2-3 days)

1. **GitHub Actions Matrix Build**
   ```yaml
   strategy:
     matrix:
       os: [ubuntu-latest, windows-latest, macos-latest]
       node: [18, 20]
   ```

2. **Pre-built Binaries**
   - Build native addon for all platforms
   - Upload to GitHub releases or npm
   - Auto-download correct binary on install

3. **Platform-Specific Documentation**
   - Installation requirements per OS
   - Known limitations
   - Troubleshooting guide

## Testing Strategy

### Manual Testing Checklist
- [ ] Terminal creation and I/O
- [ ] Session management
- [ ] File browser
- [ ] Authentication (where available)
- [ ] Process termination
- [ ] Resize handling
- [ ] Special characters and Unicode

### Automated Testing
- Unit tests (already cross-platform)
- Integration tests via GitHub Actions
- E2E tests with Playwright (cross-platform)

## Known Limitations by Platform

### Windows
- No system authentication (until implemented)
- No screen capture support
- Different default shell (cmd.exe)
- Path separators (`\` vs `/`)

### Linux
- No screen capture (unless X11/Wayland integration added)
- Requires build tools for native addon compilation
- Different distributions may have varying requirements

### All Platforms
- Binary size increases with multi-platform support
- Native addon must be compiled or pre-built
- Platform-specific bugs may emerge

## Quick Start Commands

```bash
# Clone and setup
git clone <repo>
cd vibetunnel-rust/web

# Install dependencies
pnpm install

# Build native addon
cd native-pty
npm run build
cd ..

# Run development server
pnpm run dev

# For Windows without auth (temporary)
set VIBETUNNEL_WINDOWS_NO_AUTH=true
pnpm run dev
```

## Conclusion

VibeTunnel is **already 90% cross-platform compatible**. The main work needed is:

1. **Immediate**: Test and document current functionality on Windows/Linux
2. **Short-term**: Add basic Windows authentication support
3. **Long-term**: Polish platform-specific features and optimize distribution

The architecture is sound and the recent Rust PTY implementation has done most of the heavy lifting. Windows authentication is the primary blocker for production use on Windows.
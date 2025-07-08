# Homebrew Library Dependencies Issue

## Summary

VibeTunnel beta 7 shipped with Homebrew library dependencies, causing the app to fail on systems without Homebrew installed. This document explains the issue, how to identify it, and how to prevent it in future releases.

## The Problem

When users without Homebrew installed tried to run VibeTunnel beta 7, they received errors like:

```
dyld: Library not loaded: /opt/homebrew/opt/brotli/lib/libbrotlidec.1.dylib
  Referenced from: /Applications/VibeTunnel.app/Contents/Resources/vibetunnel
  Reason: image not found
```

## Binary Dependencies Comparison

### Beta 6 (Working) vs Beta 7 (Broken)

| Component | Beta 6 | Beta 7 |
|-----------|--------|--------|
| **Main App Binary** | System frameworks only | System frameworks + Thread Sanitizer |
| **vibetunnel Server** | System libraries only (106MB) | System + 10 Homebrew libraries (63MB) |
| **Frameworks Directory** | Clean | Contains `libclang_rt.tsan_osx_dynamic.dylib` |

### Beta 7 Homebrew Dependencies

The `vibetunnel` server binary in beta 7 linked to these Homebrew libraries:

```
/opt/homebrew/opt/libuv/lib/libuv.1.dylib
/opt/homebrew/opt/brotli/lib/libbrotlidec.1.dylib
/opt/homebrew/opt/brotli/lib/libbrotlienc.1.dylib
/opt/homebrew/opt/c-ares/lib/libcares.2.dylib
/opt/homebrew/opt/libnghttp2/lib/libnghttp2.14.dylib
/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib
/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib
/opt/homebrew/opt/icu4c@77/lib/libicui18n.77.dylib
/opt/homebrew/opt/icu4c@77/lib/libicuuc.77.dylib
```

## Root Cause

The issue was introduced by commit `826d8de4` which added `node-path-setup.sh` with:

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:..."
```

This prioritized Homebrew in PATH during the build process, causing:
1. Node.js to be built linking against Homebrew libraries
2. Native modules (node-pty, authenticate-pam) to link against Homebrew
3. The final vibetunnel binary to inherit these dependencies

## How to Test for Homebrew Dependencies

### Quick Check with otool

Check any binary for Homebrew dependencies:

```bash
# Check for Homebrew paths
otool -L /path/to/binary | grep -E "/opt/homebrew|/usr/local/Cellar"

# Show all dependencies
otool -L /path/to/binary
```

### Automated Verification Script

Use the provided verification script:

```bash
./verify-release-build.sh /Applications/VibeTunnel.app
```

This script checks for:
- Homebrew dependencies in all binaries
- Thread/Address/UB Sanitizer libraries
- Debug symbols and settings
- Code signing status

### Manual Testing Process

1. **Check the main app binary:**
   ```bash
   otool -L /Applications/VibeTunnel.app/Contents/MacOS/VibeTunnel
   ```

2. **Check the server binary:**
   ```bash
   otool -L /Applications/VibeTunnel.app/Contents/Resources/vibetunnel
   ```

3. **Check native modules:**
   ```bash
   otool -L /Applications/VibeTunnel.app/Contents/Resources/pty.node
   otool -L /Applications/VibeTunnel.app/Contents/Resources/authenticate_pam.node
   ```

4. **Check for sanitizer libraries:**
   ```bash
   ls -la /Applications/VibeTunnel.app/Contents/Frameworks/ | grep -i "clang\|san"
   ```

## What Dependencies Are Acceptable?

### ✅ Good (System Libraries Only)

```
/usr/lib/libz.1.dylib
/System/Library/Frameworks/CoreFoundation.framework/...
/System/Library/Frameworks/Security.framework/...
/usr/lib/libc++.1.dylib
/usr/lib/libSystem.B.dylib
```

### ❌ Bad (Homebrew/External)

Any path containing:
- `/opt/homebrew/`
- `/usr/local/Cellar/`
- `/usr/local/opt/`
- `libclang_rt.*san*` (sanitizer libraries)

## Prevention

### Build Environment

The fix involves using a clean PATH during builds:

```bash
# Set this before building
export VIBETUNNEL_BUILD_CLEAN_ENV=true
```

This modifies `node-path-setup.sh` to put Homebrew at the END of PATH instead of the beginning.

### Xcode Settings

Ensure these are disabled in the scheme:
- Thread Sanitizer (`enableThreadSanitizer`)
- Address Sanitizer (`enableAddressSanitizer`)
- ASan Stack Use After Return (`enableASanStackUseAfterReturn`)
- NSZombieEnabled

Check with:
```bash
./mac/scripts/check-xcode-settings.sh
```

### CI/CD Integration

Add to your release workflow:
```yaml
- name: Verify Release Build
  run: ./.github/scripts/verify-release.sh "${{ steps.build.outputs.app-path }}"
```

## Testing on a Clean System

To properly test a release:

1. **Find a Mac without Homebrew** (or temporarily rename `/opt/homebrew`)
2. **Install the app** from the DMG
3. **Run the app** and verify it starts without library errors
4. **Check Console.app** for any dlopen or library loading errors

## The Fix

The solution involved:

1. **Modifying PATH priority** - Homebrew paths moved to end during builds
2. **Clean environment** - Removing LDFLAGS, LIBRARY_PATH, etc. during compilation
3. **Configure flags** - Using `--shared-zlib` to prefer system libraries
4. **Verification tools** - Scripts to catch these issues before release

## Key Takeaways

- Always check library dependencies before releasing
- Homebrew should never be required for the release build
- Build environments can contaminate the final binary
- Automated verification prevents these issues
- The size difference (106MB → 63MB) wasn't from optimization alone - it included external libraries
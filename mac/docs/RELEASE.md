# VibeTunnel Release Process

This guide explains how to create and publish releases for VibeTunnel, a macOS menu bar application using Sparkle 2.x for automatic updates.

## 🎯 Release Process Overview

VibeTunnel uses an automated release process that handles all the complexity of:
- Building universal binaries containing both arm64 (Apple Silicon) and x86_64 (Intel)
- Code signing and notarization with Apple
- Creating DMG and ZIP files
- Publishing to GitHub
- Updating Sparkle appcast files

## ⚠️ Version Management Best Practices

### Critical Version Rules

1. **Version Configuration Source of Truth**
   - ALL version information is stored in `VibeTunnel/version.xcconfig`
   - The Xcode project must reference these values using `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)`
   - NEVER hardcode versions in the Xcode project

2. **Pre-release Version Suffixes**
   - For pre-releases, the suffix MUST be in version.xcconfig BEFORE running release.sh
   - Example: To release beta 2, set `MARKETING_VERSION = 1.0.0-beta.2` in version.xcconfig
   - The release script will NOT add suffixes - it uses the version exactly as configured

3. **Build Number Management**
   - Build numbers MUST be incremented for EVERY release (including pre-releases)
   - Build numbers MUST be monotonically increasing
   - Sparkle uses build numbers, not version strings, to determine if an update is available

### Common Version Management Mistakes

❌ **MISTAKE**: Running `./scripts/release.sh beta 2` when version.xcconfig already has `1.0.0-beta.2`
- **Result**: Creates version `1.0.0-beta.2-beta.2` (double suffix)
- **Fix**: The release type and number are only for tagging, not version modification

❌ **MISTAKE**: Forgetting to increment build number
- **Result**: Sparkle won't detect the update even with a new version
- **Fix**: Always increment CURRENT_PROJECT_VERSION in version.xcconfig

❌ **MISTAKE**: Hardcoding versions in Xcode project instead of using version.xcconfig
- **Result**: Version mismatches between built app and expected version
- **Fix**: Ensure Xcode project uses `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)`

### Version Workflow Example

For releasing 1.0.0-beta.2:

1. **Edit version.xcconfig**:
   ```
   MARKETING_VERSION = 1.0.0-beta.2  # Add suffix here
   CURRENT_PROJECT_VERSION = 105      # Increment from previous build
   ```

2. **Verify configuration**:
   ```bash
   ./scripts/preflight-check.sh
   # This will warn if version already has a suffix
   ```

3. **Run release**:
   ```bash
   ./scripts/release.sh beta 2
   # The "beta 2" parameters are ONLY for git tagging
   ```

## 🚀 Creating a Release

### 📋 Pre-Release Checklist (MUST DO FIRST!)

Before running ANY release commands, verify these items:

- [ ] **⚠️ CRITICAL: Version in version.xcconfig is EXACTLY what you want to release**
  ```bash
  grep MARKETING_VERSION VibeTunnel/version.xcconfig
  # For beta.2 should show: MARKETING_VERSION = 1.0.0-beta.2
  # NOT: MARKETING_VERSION = 1.0.0
  ```
  ⚠️ **WARNING**: The release script uses this version AS-IS. It will NOT add suffixes!
  
- [ ] **Build number is incremented**
  ```bash
  grep CURRENT_PROJECT_VERSION VibeTunnel/version.xcconfig
  # Must be higher than the last release
  ```
  
- [ ] **Web package.json version matches macOS version**
  ```bash
  # Check web version matches macOS version
  grep '"version"' ../web/package.json
  # Should match MARKETING_VERSION from version.xcconfig
  ```
  ⚠️ **IMPORTANT**: The web frontend version must be synchronized with the macOS app version!
  
- [ ] **CHANGELOG.md has entry for this version**
  ```bash
  grep "## \[1.0.0-beta.2\]" CHANGELOG.md
  # Must exist with release notes
  ```

- [ ] **Clean build and derived data if needed**
  ```bash
  rm -rf build DerivedData
  ```

### Step 1: Pre-flight Check
```bash
./scripts/preflight-check.sh
```
This validates your environment is ready for release.

### Step 2: CRITICAL Pre-Release Version Check
**IMPORTANT**: Before running the release script, ensure your version.xcconfig is set correctly:

1. For beta releases: The MARKETING_VERSION should already include the suffix (e.g., `1.0.0-beta.2`)
2. The release script will NOT add additional suffixes - it uses the version as-is
3. Always verify the version before proceeding:
   ```bash
   grep MARKETING_VERSION VibeTunnel/version.xcconfig
   # Should show: MARKETING_VERSION = 1.0.0-beta.2
   ```

**Common Mistake**: If the version is already `1.0.0-beta.2` and you run `./scripts/release.sh beta 2`, 
it will create `1.0.0-beta.2-beta.2` which is wrong!

### Step 3: Create/Update CHANGELOG.md
Before creating any release, ensure the CHANGELOG.md file exists and contains a proper section for the version being released. If this is your first release, create a CHANGELOG.md file in the project root:

```markdown
# Changelog

All notable changes to VibeTunnel will be documented in this file.

## [1.0.0-beta.2] - 2025-06-19

### 🎨 UI Improvements
- **Enhanced feature** - Description of the improvement
...
```

**CRITICAL**: The appcast generation relies on the local CHANGELOG.md file, NOT the GitHub release description. The changelog must be added to CHANGELOG.md BEFORE running the release script.

### Step 4: Create the Release

⚠️ **CRITICAL UNDERSTANDING**: The release script parameters are ONLY for:
1. Git tag creation
2. Determining if it's a pre-release on GitHub
3. Validation that your version.xcconfig matches your intent

The script will NEVER modify the version - it uses version.xcconfig exactly as configured!

```bash
# For stable releases:
./scripts/release.sh stable
# Expects version.xcconfig to have a stable version like "1.0.0"

# For pre-releases:
./scripts/release.sh beta 2
# Expects version.xcconfig to ALREADY have "1.0.0-beta.2"
# If version.xcconfig has "1.0.0", the script will add suffix and create "1.0.0-beta.2"
# If version.xcconfig already has "1.0.0-beta.2", it will use it as-is
```

**Script Validation**: The release script now includes:
- Double-suffix detection (prevents 1.0.0-beta.2-beta.2)
- Build number uniqueness check
- Version consistency verification
- Notarization credential validation

**IMPORTANT**: The release script does NOT automatically increment build numbers. You must manually update the build number in VibeTunnel.xcodeproj before running the script, or it will fail the pre-flight check.

The script will:
1. Validate build number is unique and incrementing
2. Build, sign, and notarize the app
3. Create a DMG
4. Publish to GitHub
5. Update the appcast files with EdDSA signatures
6. Commit and push all changes

### Step 5: Verify Success
- Check the GitHub releases page
- Verify the appcast was updated correctly with proper changelog content
- **Critical**: Verify the Sparkle signature is correct:
  ```bash
  # Download and verify the DMG signature
  curl -L -o test.dmg <github-dmg-url>
  sign_update test.dmg --account VibeTunnel
  # Compare with appcast sparkle:edSignature
  ```
- Test updating from a previous version
- **Important**: Verify that the Sparkle update dialog shows the formatted changelog, not HTML tags
- Check that update installs without "improperly signed" errors

## ⚠️ Critical Requirements

### 1. Build Numbers MUST Increment
Sparkle uses build numbers (CFBundleVersion) to determine updates, NOT version strings!

| Version | Build | Result |
|---------|-------|--------|
| 1.0.0-beta.1 | 100 | ✅ |
| 1.0.0-beta.2 | 101 | ✅ |
| 1.0.0-beta.3 | 99  | ❌ Build went backwards |
| 1.0.0 | 101 | ❌ Duplicate build number |

### 2. Required Environment Variables
```bash
export APP_STORE_CONNECT_KEY_ID="YOUR_KEY_ID"
export APP_STORE_CONNECT_ISSUER_ID="YOUR_ISSUER_ID"
export APP_STORE_CONNECT_API_KEY_P8="-----BEGIN PRIVATE KEY-----
YOUR_PRIVATE_KEY_CONTENT
-----END PRIVATE KEY-----"
```

### 3. Prerequisites
- Xcode 16.4+ installed
- Node.js 20+ and Bun (for web frontend build)
  ```bash
  # Install Bun
  curl -fsSL https://bun.sh/install | bash
  ```
- GitHub CLI authenticated: `gh auth status`
- Apple Developer ID certificate in Keychain
- Sparkle tools in `~/.local/bin/` (sign_update, generate_appcast)

## 🔐 Sparkle Configuration

### Sparkle Requirements for Non-Sandboxed Apps

VibeTunnel is not sandboxed, which simplifies Sparkle configuration:

#### 1. Entitlements (VibeTunnel.entitlements)
```xml
<!-- App is NOT sandboxed -->
<key>com.apple.security.app-sandbox</key>
<false/>

<!-- Required for code injection/library validation -->
<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
<true/>
<key>com.apple.security.cs.disable-library-validation</key>
<true/>
```

#### 2. Info.plist Configuration
```swift
"SUEnableInstallerLauncherService": false,  // Not needed for non-sandboxed apps
"SUEnableDownloaderService": false,         // Not needed for non-sandboxed apps
```

#### 3. Code Signing Requirements

The notarization script handles all signing correctly:
1. **Do NOT use --deep flag** when signing the app
2. Sign the app with hardened runtime and entitlements

The `notarize-app.sh` script should sign the app:
```bash
# Sign the app WITHOUT --deep flag
codesign --force --sign "Developer ID Application" --entitlements VibeTunnel.entitlements --options runtime VibeTunnel.app
```

### Common Version Sync Issues

#### Web Version Out of Sync
**Problem**: Web server shows different version than macOS app (e.g., "beta.3" when app is "beta.4").

**Cause**: web/package.json was not updated when BuildNumber.xcconfig was changed.

**Solution**: 
1. Update package.json to match BuildNumber.xcconfig:
   ```bash
   # Check current versions
   grep MARKETING_VERSION VibeTunnel/version.xcconfig
   grep "version" ../web/package.json
   
   # Update web version to match
   vim ../web/package.json
   ```

2. Validate sync before building:
   ```bash
   cd ../web && node scripts/validate-version-sync.js
   ```

**Note**: The web UI automatically displays the version from package.json (injected at build time).

### Common Sparkle Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "You're up to date!" when update exists | Build number not incrementing | Check build numbers in appcast are correct |
| "Update installation failed" | Signing or permission issues | Verify app signature and entitlements |
| "Cannot verify update signature" | EdDSA key mismatch | Ensure sparkle-public-ed-key.txt matches private key |

## 📋 Update Channels

VibeTunnel supports two update channels:

1. **Stable Channel** (`appcast.xml`)
   - Production releases only
   - Default for all users

2. **Pre-release Channel** (`appcast-prerelease.xml`)
   - Includes beta, alpha, and RC versions
   - Users opt-in via Settings

### Architecture Support

VibeTunnel uses universal binaries that include both architectures:
- **Apple Silicon (arm64)**: Optimized for M1+ Macs
- **Intel (x86_64)**: For Intel-based Macs

The build system creates a single universal binary that works on all Mac architectures. This approach:
- Simplifies distribution with one DMG/ZIP per release
- Works seamlessly with Sparkle auto-updates
- Provides optimal performance on each architecture
- Follows Apple's recommended best practices

## 🐛 Common Issues and Solutions

### Version and Build Number Issues

#### Double Version Suffix (e.g., 1.0.0-beta.2-beta.2)
**Problem**: Version has double suffix after running release script.

**Cause**: version.xcconfig already had the suffix, and you provided the same suffix to release.sh.

**Solution**: 
1. Clean up the botched release:
   ```bash
   # Delete the bad tag
   git tag -d v1.0.0-beta.2-beta.2
   git push origin :refs/tags/v1.0.0-beta.2-beta.2
   
   # Delete the GitHub release
   gh release delete v1.0.0-beta.2-beta.2 --yes
   
   # Fix version.xcconfig
   # Set to the correct version without double suffix
   ```
2. Re-run the release with correct parameters

#### Build Script Reports Version Mismatch
**Problem**: Build script warns that built version doesn't match version.xcconfig.

**Cause**: Xcode project is not properly configured to use version.xcconfig values.

**Solution**: 
1. Open VibeTunnel.xcodeproj in Xcode
2. Select the project, then the target
3. In Build Settings, ensure:
   - MARKETING_VERSION = `$(MARKETING_VERSION)`
   - CURRENT_PROJECT_VERSION = `$(CURRENT_PROJECT_VERSION)`

#### Preflight Check Warns About Existing Suffix
**Problem**: Preflight check shows "Version already contains pre-release suffix".

**Solution**: This is a helpful warning! It reminds you to use matching parameters:
```bash
# If version.xcconfig has "1.0.0-beta.2"
./scripts/release.sh beta 2  # Correct - matches the suffix
```

### Appcast Shows HTML Tags Instead of Formatted Text
**Problem**: Sparkle update dialog shows escaped HTML like `&lt;h2&gt;` instead of formatted text.

**Root Cause**: The generate-appcast.sh script is escaping HTML content from GitHub release descriptions.

**Solution**: 
1. Ensure CHANGELOG.md has the proper section for the release version BEFORE running release script
2. The appcast should use local CHANGELOG.md, not GitHub release body
3. If the appcast is wrong, manually fix the generate-appcast.sh script to use local changelog content

### Build Numbers Not Incrementing
**Problem**: Sparkle doesn't detect new version as an update.

**Solution**: Always increment the build number in the Xcode project before releasing.

## 🛠️ Manual Process (If Needed)

If the automated script fails, here's the manual process:

### 1. Update Version Numbers
Edit version configuration files:

**macOS App** (`VibeTunnel/version.xcconfig`):
- Update MARKETING_VERSION
- Update CURRENT_PROJECT_VERSION (build number)

**Web Frontend** (`../web/package.json`):
- Update "version" field to match MARKETING_VERSION

**Note**: The Xcode project file is named `VibeTunnel-Mac.xcodeproj`

### 2. Clean and Build Universal Binary
```bash
rm -rf build DerivedData
./scripts/build.sh --configuration Release
```

### 3. Sign and Notarize
```bash
./scripts/sign-and-notarize.sh build/Build/Products/Release/VibeTunnel.app
```

### 4. Create DMG and ZIP
```bash
./scripts/create-dmg.sh build/Build/Products/Release/VibeTunnel.app
./scripts/create-zip.sh build/Build/Products/Release/VibeTunnel.app
```

### 5. Sign DMG for Sparkle
```bash
export PATH="$HOME/.local/bin:$PATH"
sign_update build/VibeTunnel-X.X.X.dmg
```

### 6. Create GitHub Release
```bash
gh release create "v1.0.0-beta.1" \
  --title "VibeTunnel 1.0.0-beta.1" \
  --notes "Beta release 1" \
  --prerelease \
  build/VibeTunnel-*.dmg \
  build/VibeTunnel-*.zip
```

### 7. Update Appcast
```bash
./scripts/update-appcast.sh
git add appcast*.xml
git commit -m "Update appcast for v1.0.0-beta.1"
git push
```

## 🔍 Troubleshooting

### "Update is improperly signed" Error
**Problem**: Users see "The update is improperly signed and could not be validated."

**Cause**: The DMG was signed with the wrong Sparkle key (default instead of VibeTunnel account).

**Quick Fix**:
```bash
# 1. Download the DMG from GitHub
curl -L -o fix.dmg <github-dmg-url>

# 2. Generate correct signature
sign_update fix.dmg --account VibeTunnel

# 3. Update appcast-prerelease.xml with the new sparkle:edSignature
# 4. Commit and push
```

**Prevention**: The updated scripts now always use `--account VibeTunnel`.

### Debug Sparkle Updates
```bash
# Monitor VibeTunnel logs
log stream --predicate 'process == "VibeTunnel"' --level debug

# Check XPC errors
log stream --predicate 'process == "VibeTunnel"' | grep -i -E "(sparkle|xpc|installer)"

# Verify XPC services
codesign -dvv "VibeTunnel.app/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc"
```

### Verify Signing and Notarization
```bash
# Check app signature
./scripts/verify-app.sh build/VibeTunnel-1.0.0.dmg

# Verify XPC bundle IDs (should be org.sparkle-project.*)
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" \
  "VibeTunnel.app/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc/Contents/Info.plist"
```

### Appcast Issues
```bash
# Verify appcast has correct build numbers
./scripts/verify-appcast.sh

# Check if build number is "1" (common bug)
grep '<sparkle:version>' appcast-prerelease.xml
```

## 📚 Important Links

- [Sparkle Sandboxing Guide](https://sparkle-project.org/documentation/sandboxing/)
- [Sparkle Code Signing](https://sparkle-project.org/documentation/sandboxing/#code-signing)
- [Apple Notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)

---

**Remember**: Always use the automated release script, ensure build numbers increment, and test updates before announcing!
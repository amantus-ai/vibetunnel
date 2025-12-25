# VibeTunnel Release Documentation

This guide provides comprehensive documentation for creating and publishing releases for VibeTunnel, a macOS menu bar application using Sparkle 2.x for automatic updates.

## 🚀 Quick Release Commands

### Standard Release Flow
```bash
# 1. Update versions
vim VibeTunnel/version.xcconfig  # Set MARKETING_VERSION and increment CURRENT_PROJECT_VERSION
vim ../web/package.json          # Match version with MARKETING_VERSION

# 2. Update changelog
vim CHANGELOG.md                 # Add entry for new version

# 3. Run release
export SPARKLE_ACCOUNT="VibeTunnel"
./scripts/release.sh beta 5      # For beta.5
./scripts/release.sh stable      # For stable release

# If interrupted, resume with:
./scripts/release.sh --resume

# Check release status:
./scripts/release.sh --status
```

### If Release Script Fails

#### After Notarization Success
```bash
# 1. Create DMG (if missing)
./scripts/create-dmg.sh build/Build/Products/Release/VibeTunnel.app

# 2. Create GitHub release
gh release create "v1.0.0-beta.5" \
  --title "VibeTunnel 1.0.0-beta.5" \
  --prerelease \
  --notes-file RELEASE_NOTES.md \
  build/VibeTunnel-*.dmg \
  build/VibeTunnel-*.zip

# 3. Get Sparkle signature (ALWAYS use -f flag!)
sign_update -f private/sparkle_private_key build/VibeTunnel-*.dmg --account VibeTunnel

# 4. Update appcast manually (add to appcast-prerelease.xml)
# 5. Commit and push
git add ../appcast-prerelease.xml
git commit -m "Update appcast for v1.0.0-beta.5"
git push
```

## 🎯 Release Process Overview

VibeTunnel uses an automated release process that handles all the complexity of:
- Building universal binaries containing both arm64 (Apple Silicon) and x86_64 (Intel)
- Code signing and notarization with Apple
- Creating DMG and ZIP files
- Publishing to GitHub
- Updating Sparkle appcast files with EdDSA signatures

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

## 📋 Pre-Release Checklist

**Automated Checklist**: Run `./scripts/release-checklist.sh` for an interactive pre-release validation.

Before running ANY release commands, verify these items:

### ⚠️ CRITICAL: Sparkle Signature Verification
- [ ] **Verify private key exists at `private/sparkle_private_key`**
- [ ] **Confirm you will use the `-f` flag with ALL sign_update commands**
- [ ] **Test sign a dummy file to ensure correct key:**
  ```bash
  echo "test" > test.txt
  sign_update -f private/sparkle_private_key test.txt
  # Should produce a signature starting with a valid EdDSA signature
  rm test.txt
  ```
- [ ] **NEVER use sign_update without the `-f` flag!**
- [ ] **The public key in Info.plist is: `AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI=`**
- [ ] **Run signature validation script:**
  ```bash
  ./scripts/validate-sparkle-signature.sh
  # Should show all signatures are valid
  ```

### Environment Setup
- [ ] Ensure stable internet connection (notarization requires consistent connectivity)
- [ ] Check Apple Developer status page for any service issues
- [ ] Have at least 30 minutes available (full release takes 15-20 minutes)
- [ ] Close other resource-intensive applications
- [ ] Ensure you're on main branch
  ```bash
  git checkout main
  git pull --rebase origin main
  git status  # Check for uncommitted changes
  ```

### Version Verification
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

### Environment Variables
- [ ] Set required environment variables:
  ```bash
  export SPARKLE_ACCOUNT="VibeTunnel"
  export APP_STORE_CONNECT_KEY_ID="YOUR_KEY_ID"
  export APP_STORE_CONNECT_ISSUER_ID="YOUR_ISSUER_ID"
  export APP_STORE_CONNECT_API_KEY_P8="-----BEGIN PRIVATE KEY-----
  YOUR_PRIVATE_KEY_CONTENT
  -----END PRIVATE KEY-----"
  ```

### Clean Build
- [ ] Clean build and derived data if needed:
  ```bash
  ./scripts/clean.sh
  rm -rf build DerivedData
  rm -rf ~/Library/Developer/Xcode/DerivedData/VibeTunnel-*
  ```

### File Verification
- [ ] CHANGELOG.md exists and has entry for new version
- [ ] Sparkle private key exists at expected location
- [ ] No stuck DMG volumes in /Volumes/
  ```bash
  # Check for stuck volumes
  ls /Volumes/VibeTunnel*
  # Unmount if needed
  for volume in /Volumes/VibeTunnel*; do
      hdiutil detach "$volume" -force
  done
  ```
- [ ] **Check for unexpected files in the app bundle**
  ```bash
  # Check for node_modules or other development files
  find build/Build/Products/Release/VibeTunnel.app -name "node_modules" -type d
  find build/Build/Products/Release/VibeTunnel.app -name "*.jar" -type f
  # Should return empty - no development files in release build
  ```

## 🚀 Creating a Release

### Step 1: Pre-flight Check
```bash
# Run the comprehensive release checklist
./scripts/release-checklist.sh

# Then run the automated preflight check
./scripts/preflight-check.sh
```
These scripts validate your environment is ready for release.

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
Before creating any release, ensure the CHANGELOG.md file exists in the project root (`/vibetunnel/CHANGELOG.md`) and contains a proper section for the version being released:

```markdown
# Changelog

All notable changes to VibeTunnel will be documented in this file.

## [1.0.0-beta.2] - 2025-06-19

### 🎨 UI Improvements
- **Enhanced feature** - Description of the improvement
...
```

**CRITICAL**: The release process uses the CHANGELOG.md file in the project root as the single source of truth for release notes. The changelog must be updated with the new version section BEFORE running the release script.

**Key Points**:
- **Location**: CHANGELOG.md must be at `/vibetunnel/CHANGELOG.md` (project root, NOT in `mac/`)
- **No RELEASE_NOTES.md files**: The release process does NOT use RELEASE_NOTES.md files
- **Per-Version Extraction**: The release script automatically extracts ONLY the changelog section for the specific version being released
- **GitHub Release**: Uses the extracted markdown content directly (via `generate-release-notes.sh`)
- **Sparkle Appcast**: Converts the markdown to HTML for update dialogs

The release script uses these helper scripts:
- `generate-release-notes.sh` - Extracts markdown release notes for GitHub
- `changelog-to-html.sh` - Converts markdown to HTML for Sparkle appcast
- `find-changelog.sh` - Reliably locates CHANGELOG.md from any directory

### Step 4: Create the Release

⚠️ **CRITICAL UNDERSTANDING**: The release script parameters are ONLY for:
1. Git tag creation
2. Determining if it's a pre-release on GitHub
3. Validation that your version.xcconfig matches your intent

The script will NEVER modify the version - it uses version.xcconfig exactly as configured!

For long-running operations, consider using screen or tmux:
```bash
# Run in a screen/tmux session to prevent disconnection
screen -S release
./scripts/release.sh beta 5 --verbose --log
```

**IMPORTANT**: When using Claude Code or any automated tool, NEVER run the release script in the background. Always run it directly in the foreground to ensure proper completion and error handling.

```bash
# For stable releases:
./scripts/release.sh stable

# For pre-releases:
./scripts/release.sh beta 2
# The "beta 2" parameters are ONLY for git tagging
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

**Note**: Notarization can take 5-10 minutes depending on Apple's servers. This is normal.

### Step 5: Verify Success
- Check the GitHub releases page
- **IMPORTANT**: Verify the GitHub release shows ONLY the current version's changelog, not the entire history
  - If it shows the full changelog, the release notes were not generated correctly
  - The release should only show changes for that specific version (e.g., beta.10 shows only beta.10 changes)
- **Monitor app size**: Verify the DMG size is reasonable (expected: ~42-44 MB)
  ```bash
  # Check DMG size
  ls -lh build/VibeTunnel-*.dmg
  # Compare with previous releases
  gh release list --limit 5 | grep -E "beta|stable"
  # Download and check sizes
  for tag in $(gh release list --limit 5 | awk '{print $3}'); do
      echo "=== $tag ==="
      gh release view "$tag" --json assets --jq '.assets[] | "\(.name): \(.size) bytes (\(.size/1024/1024 | floor) MB)"'
  done
  ```
  - If size increased significantly (>5MB), investigate for bundled development files
- Verify the appcast was updated correctly with proper changelog content
- **Critical**: Verify the Sparkle signature is correct:
  ```bash
  # Download and verify the DMG signature
  curl -L -o test.dmg <github-dmg-url>
  sign_update -f private/sparkle_private_key test.dmg --account VibeTunnel
  # Compare with appcast sparkle:edSignature
  ```
- Test updating from a previous version
- **Important**: Verify that the Sparkle update dialog shows the formatted changelog, not HTML tags
- **CRITICAL**: Check that update installs without "improperly signed" errors
  - If you get "improperly signed" error, the appcast has wrong signature
  - Regenerate with: `sign_update -f private/sparkle_private_key [dmg-file]`
  - Update appcast XML with correct signature
  - Run `./scripts/validate-sparkle-signature.sh` to verify all signatures
- Verify Stats.store is serving the updated appcast (1-minute cache):
  ```bash
  curl -H "User-Agent: VibeTunnel/X.X.X Sparkle/2.7.1" \
       https://stats.store/api/v1/appcast/appcast-prerelease.xml | \
       grep sparkle:edSignature
  ```

### If Interrupted

If the release script is interrupted:
```bash
./scripts/check-release-status.sh 1.0.0-beta.5
./scripts/release.sh --resume
```

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
# CRITICAL: Always use -f flag with private key file!
sign_update -f private/sparkle_private_key build/VibeTunnel-X.X.X.dmg
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

## 🔍 Verification Commands

```bash
# Check release artifacts
ls -la build/VibeTunnel-*.dmg
ls -la build/VibeTunnel-*.zip

# Check GitHub release
gh release view v1.0.0-beta.5

# Verify Sparkle signature (ALWAYS use -f flag!)
curl -L -o test.dmg [github-dmg-url]
sign_update -f private/sparkle_private_key test.dmg --account VibeTunnel

# Check appcast
grep "1.0.0-beta.5" ../appcast-prerelease.xml

# Verify app in DMG
hdiutil attach test.dmg
spctl -a -vv /Volumes/VibeTunnel/VibeTunnel.app
hdiutil detach /Volumes/VibeTunnel
```

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
- Node.js 22.12+ and Bun (for web frontend build)
  ```bash
  # Install Bun
  curl -fsSL https://bun.sh/install | bash
  ```
- GitHub CLI authenticated: `gh auth status`
- Apple Developer ID certificate in Keychain
- Sparkle tools in `~/.local/bin/` (sign_update, generate_appcast)

## 🔐 Sparkle Configuration

### ⚠️ CRITICAL: Sparkle Private Key Management

**ALWAYS use the file-based private key for signing!**

VibeTunnel uses EdDSA signatures for Sparkle updates. The correct private key is stored at:
- `private/sparkle_ed_private_key` (clean key file - REQUIRED for sign_update)
- `private/sparkle_private_key` (commented version for documentation)

**CRITICAL**: The sign_update tool requires a clean key file with ONLY the base64 key. If you only have the commented version, the scripts will automatically extract and create the clean version.

**WARNING**: Your system may have multiple Sparkle private keys:
1. **File-based key** (CORRECT) - Matches the public key in Info.plist
2. **Keychain key** (WRONG) - May produce incompatible signatures

**ALWAYS use the `-f` flag when signing:**
```bash
# ✅ CORRECT - Uses file-based key
sign_update -f private/sparkle_ed_private_key build/VibeTunnel-*.dmg

# ❌ WRONG - May use keychain key
sign_update build/VibeTunnel-*.dmg
```

The public key in Info.plist is: `AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI=`

**Key File Format Requirements**:
- The clean key file (`sparkle_ed_private_key`) must contain ONLY the base64 key
- No comments, no extra lines, just the key: `SMYPxE98bJ5iLdHTLHTqGKZNFcZLgrT5Hyjh79h3TaU=`
- The scripts handle this automatically by extracting from the commented file

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

### Architecture Support

VibeTunnel uses universal binaries that include both architectures:
- **Apple Silicon (arm64)**: Optimized for M1+ Macs
- **Intel (x86_64)**: For Intel-based Macs

The build system creates a single universal binary that works on all Mac architectures. This approach:
- Simplifies distribution with one DMG/ZIP per release
- Works seamlessly with Sparkle auto-updates
- Provides optimal performance on each architecture
- Follows Apple's recommended best practices

## 📋 Update Channels

VibeTunnel supports two update channels:

1. **Stable Channel** (`appcast.xml`)
   - Production releases only
   - Default for all users

2. **Pre-release Channel** (`appcast-prerelease.xml`)
   - Includes beta, alpha, and RC versions
   - Users opt-in via Settings

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

### App Size Issues

#### Unexpected Size Increase
**Problem**: DMG size increased significantly (>5MB) between releases.

**Common Causes**:
1. **Development dependencies bundled**: node_modules, JAR files, or other dev files
2. **Build cache not cleaned**: Old artifacts included
3. **New frameworks added**: Legitimate size increase from new dependencies

**Solution**:
```bash
# 1. Check app bundle contents
find build/Build/Products/Release/VibeTunnel.app -name "node_modules" -type d
find build/Build/Products/Release/VibeTunnel.app -name "*.jar" -type f
find build/Build/Products/Release/VibeTunnel.app -type f -size +1M -ls

# 2. Compare with previous release
# Extract previous DMG
hdiutil attach VibeTunnel-previous.dmg
du -sh /Volumes/VibeTunnel/VibeTunnel.app/Contents/*
hdiutil detach /Volumes/VibeTunnel

# 3. Clean and rebuild
./scripts/clean.sh
rm -rf ~/Library/Developer/Xcode/DerivedData/VibeTunnel-*
./scripts/build.sh --configuration Release
```

**Prevention**:
- Add size checks to release script
- Ensure .gitignore includes all development paths
- Regular audits of app bundle contents

### Common Version Sync Issues

#### Web Version Out of Sync
**Problem**: Web server shows different version than macOS app (e.g., "beta.3" when app is "beta.4").

**Cause**: web/package.json was not updated when version.xcconfig was changed.

**Solution**: 
1. Update package.json to match version.xcconfig:
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

### "Uncommitted changes detected"
```bash
git status --porcelain  # Check what's changed
git stash              # Temporarily store changes
# Run release
git stash pop          # Restore changes
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

### Stuck DMG Volumes
**Problem**: "Resource temporarily unavailable" errors when creating DMG.

**Symptoms**:
- `hdiutil: create failed - Resource temporarily unavailable`
- Multiple VibeTunnel volumes visible in Finder
- DMG creation fails repeatedly

**Solution**:
```bash
# Manually unmount all VibeTunnel volumes
for volume in /Volumes/VibeTunnel*; do
    hdiutil detach "$volume" -force
done

# Kill any stuck DMG processes
pkill -f "VibeTunnel.*\.dmg"
```

**Prevention**: Scripts now clean up volumes automatically before DMG creation.

### Build Number Already Exists
**Problem**: Sparkle requires unique build numbers for each release.

**Solution**:
1. Check existing build numbers:
   ```bash
   grep -E '<sparkle:version>[0-9]+</sparkle:version>' ../appcast*.xml
   ```
2. Update `mac/VibeTunnel/version.xcconfig`:
   ```
   CURRENT_PROJECT_VERSION = <new_unique_number>
   ```

### Notarization Failures
**Problem**: App notarization fails or takes too long.

**Common Causes**:
- Missing API credentials
- Network issues
- Apple service outages
- Unsigned frameworks or binaries

**Solution**:
```bash
# Check notarization status
xcrun notarytool history --key-id "$APP_STORE_CONNECT_KEY_ID" \
    --key "$APP_STORE_CONNECT_API_KEY_P8" \
    --issuer-id "$APP_STORE_CONNECT_ISSUER_ID"

# Get detailed log for failed submission
xcrun notarytool log <submission-id> --key-id ...
```

**Normal Duration**: Notarization typically takes 2-10 minutes. If it's taking longer than 15 minutes, check Apple System Status.

### GitHub Release Already Exists
**Problem**: Tag or release already exists on GitHub.

**Solution**: The release script now prompts you to:
1. Delete the existing release and tag
2. Cancel the release

**Prevention**: Always pull latest changes before releasing.

### DMG Shows "Unnotarized Developer ID"
**Problem**: The DMG shows as "Unnotarized Developer ID" when checked with spctl.

**Explanation**: This is NORMAL - DMGs are not notarized themselves, only the app inside is notarized. Check the app inside: it should show "Notarized Developer ID".

### Generate Appcast Fails
**Problem**: `generate-appcast.sh` failed with GitHub API error despite valid authentication.

**Workaround**: 
- Manually add entry to appcast-prerelease.xml
- Use signature from: `sign_update [dmg] --account VibeTunnel`
- Follow existing entry format (see template below)

## 🔧 Troubleshooting Common Issues

### Script Timeouts
If the release script times out:
1. Check `.release-state` for the last successful step
2. Run `./scripts/release.sh --resume` to continue
3. Or manually complete remaining steps (see Manual Recovery below)

### Manual Recovery Steps
If automated release fails after notarization:

1. **Create DMG** (if missing):
   ```bash
   ./scripts/create-dmg.sh build/Build/Products/Release/VibeTunnel.app
   ```

2. **Create GitHub Release**:
   ```bash
   gh release create "v$VERSION" \
     --title "VibeTunnel $VERSION" \
     --notes-file RELEASE_NOTES.md \
     --prerelease \
     build/VibeTunnel-*.dmg \
     build/VibeTunnel-*.zip
   ```

3. **Sign DMG for Sparkle**:
   ```bash
   export SPARKLE_ACCOUNT="VibeTunnel"
   sign_update build/VibeTunnel-$VERSION.dmg --account VibeTunnel
   ```

4. **Update Appcast Manually**:
   - Add entry to appcast-prerelease.xml with signature from step 3
   - Commit and push: `git add appcast*.xml && git commit -m "Update appcast" && git push`

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

## 📝 Appcast Entry Template

```xml
<item>
    <title>VibeTunnel VERSION</title>
    <link>https://github.com/amantus-ai/vibetunnel/releases/download/vVERSION/VibeTunnel-VERSION.dmg</link>
    <sparkle:version>BUILD_NUMBER</sparkle:version>
    <sparkle:shortVersionString>VERSION</sparkle:shortVersionString>
    <description><![CDATA[
        <h2>VibeTunnel VERSION</h2>
        <p><strong>Pre-release version</strong></p>
        <!-- Copy from CHANGELOG.md -->
    ]]></description>
    <pubDate>DATE</pubDate>
    <enclosure url="https://github.com/amantus-ai/vibetunnel/releases/download/vVERSION/VibeTunnel-VERSION.dmg" 
               sparkle:version="BUILD_NUMBER" 
               sparkle:shortVersionString="VERSION" 
               length="SIZE_IN_BYTES" 
               type="application/x-apple-diskimage" 
               sparkle:edSignature="SIGNATURE_FROM_SIGN_UPDATE"/>
</item>
```

## 🎯 Release Success Criteria

- [ ] GitHub release created with both DMG and ZIP
- [ ] DMG downloads and mounts correctly
- [ ] App inside DMG shows as notarized
- [ ] Appcast updated and pushed
- [ ] Sparkle signature in appcast matches DMG
- [ ] Version and build numbers correct everywhere
- [ ] Previous version can update via Sparkle

## 🚨 Emergency Fixes

### Wrong Sparkle Signature
```bash
# 1. Get correct signature
sign_update [dmg-url] --account VibeTunnel

# 2. Update appcast-prerelease.xml with correct signature
# 3. Commit and push immediately
```

### Missing from Appcast
```bash
# Users won't see update until appcast is fixed
# Add entry manually following template above
# Test with: curl https://raw.githubusercontent.com/amantus-ai/vibetunnel/main/appcast-prerelease.xml
```

### Build Number Conflict
```bash
# If Sparkle complains about duplicate build number
# Increment build number in version.xcconfig
# Create new release with higher build number
# Old release will be ignored by Sparkle
```

## 🔍 Key File Locations

**Important**: Files are not always where scripts expect them to be.

**Key Locations**:
- **Appcast files**: Located in project root (`/vibetunnel/`), NOT in `mac/`
  - `appcast.xml`
  - `appcast-prerelease.xml`
- **CHANGELOG.md**: Can be in either:
  - `mac/CHANGELOG.md` (preferred by release script)
  - Project root `/vibetunnel/CHANGELOG.md` (common location)
- **Sparkle private key**: Usually in `mac/private/sparkle_private_key`

## 📚 Helper Scripts

### Changelog Management Scripts

#### `generate-release-notes.sh`
Extracts release notes for a specific version from CHANGELOG.md:
```bash
# Get release notes for a specific version
./scripts/generate-release-notes.sh 1.0.0-beta.11

# Works from any directory
cd /tmp && /path/to/scripts/generate-release-notes.sh 1.0.0-beta.11
```

#### `find-changelog.sh`
Reliably locates CHANGELOG.md from any directory:
```bash
# Find the changelog file
./scripts/find-changelog.sh
# Output: /path/to/vibetunnel/CHANGELOG.md
```

#### `fix-release-changelogs.sh`
Updates existing GitHub releases to use per-version changelogs:
```bash
# Dry run to see what would change
./scripts/fix-release-changelogs.sh --dry-run

# Actually update releases
./scripts/fix-release-changelogs.sh

# Update a specific release
./scripts/fix-release-changelogs.sh v1.0.0-beta.11
```

## 📚 Common Commands

### Test Sparkle Signature
```bash
# Find sign_update binary
find . -name sign_update -type f

# Test signing with specific account
./path/to/sign_update file.dmg -f private/sparkle_private_key -p --account VibeTunnel
```

### Verify Appcast URLs
```bash
# Check that appcast files are accessible
curl -I https://raw.githubusercontent.com/amantus-ai/vibetunnel/main/appcast.xml
curl -I https://raw.githubusercontent.com/amantus-ai/vibetunnel/main/appcast-prerelease.xml
```

### Manual Appcast Generation
```bash
# If automatic generation fails
cd mac
export SPARKLE_ACCOUNT="VibeTunnel"
./scripts/generate-appcast.sh
```

### Release Status Script
Create `scripts/check-release-status.sh`:
```bash
#!/bin/bash
VERSION=$1

echo "Checking release status for v$VERSION..."

# Check local artifacts
echo -n "✓ Local DMG: "
[ -f "build/VibeTunnel-$VERSION.dmg" ] && echo "EXISTS" || echo "MISSING"

echo -n "✓ Local ZIP: "
[ -f "build/VibeTunnel-$VERSION.zip" ] && echo "EXISTS" || echo "MISSING"

# Check GitHub
echo -n "✓ GitHub Release: "
gh release view "v$VERSION" &>/dev/null && echo "EXISTS" || echo "MISSING"

# Check appcast
echo -n "✓ Appcast Entry: "
grep -q "$VERSION" ../appcast-prerelease.xml && echo "EXISTS" || echo "MISSING"
```

## 📋 Post-Release Verification

1. **Check GitHub Release**:
   - Verify assets are attached
   - Check file sizes match
   - Ensure release notes are formatted correctly

2. **Test Update in App**:
   - Install previous version
   - Check for updates
   - Verify update downloads and installs
   - Check signature verification in Console.app

3. **Monitor for Issues**:
   - Watch Console.app for Sparkle errors
   - Check GitHub issues for user reports
   - Verify download counts on GitHub

## 🛠️ Recommended Script Improvements

Based on release experience, consider implementing:

### 1. Release Script Enhancements

Add state tracking for resumability:
```bash
# Add to release.sh

# State file to track progress
STATE_FILE=".release-state"

# Save state after each major step
save_state() {
    echo "$1" > "$STATE_FILE"
}

# Resume from last state
resume_from_state() {
    if [ -f "$STATE_FILE" ]; then
        LAST_STATE=$(cat "$STATE_FILE")
        echo "Resuming from: $LAST_STATE"
    fi
}

# Add --resume flag handling
if [[ "$1" == "--resume" ]]; then
    resume_from_state
    shift
fi
```

### 2. Better Progress Reporting
```bash
# Add progress function
progress() {
    local step=$1
    local total=$2
    local message=$3
    echo "[${step}/${total}] ${message}"
}

# Use throughout script
progress 1 8 "Running pre-flight checks..."
progress 2 8 "Building application..."
```

### 3. Parallel Operations
Where possible, run independent operations in parallel:
```bash
# Run signing and changelog generation in parallel
{
    sign_app &
    PID1=$!
    
    generate_changelog &
    PID2=$!
    
    wait $PID1 $PID2
}
```

## 📝 Key Learnings

1. **Always use explicit accounts** when dealing with signing operations
2. **Clean up resources** (volumes, processes) before operations
3. **Verify file locations** - don't assume standard paths
4. **Test the full update flow** before announcing the release
5. **Keep credentials secure** but easily accessible for scripts
6. **Document everything** - future you will thank present you
7. **Plan for long-running operations** - notarization can take 10+ minutes
8. **Implement resumable workflows** - scripts should handle interruptions gracefully
9. **DMG signing is separate from notarization** - DMGs themselves aren't notarized, only the app inside
10. **Command timeouts** are a real issue - use screen/tmux for releases

### Additional Lessons from Recent Releases

#### DMG Notarization Confusion
**Issue**: The DMG shows as "Unnotarized Developer ID" when checked with spctl, but this is normal.
**Explanation**: 
- DMGs are not notarized themselves - only the app inside is notarized
- The app inside the DMG shows correctly as "Notarized Developer ID"
- This is expected behavior and not an error

#### Release Script Timeout Handling
**Issue**: Release script timed out during notarization (took ~5 minutes).
**Solution**: 
- Run release scripts in a terminal without timeout constraints
- Consider using `screen` or `tmux` for long operations
- Add progress indicators to show the script is still running

#### Repository Name Parsing Issue
**Issue**: `generate-appcast.sh` was including `.git` suffix when parsing repository name from git remote URL.
**Fix**: 
- Updated regex to strip `.git` suffix: `${BASH_REMATCH[2]%.git}`
- This caused GitHub API calls to fail with 404 errors
- Always test script changes with actual GitHub API calls

#### Private Key Format Requirements
**Issue**: The sign_update tool fails with "ERROR! Failed to decode base64 encoded key data" when the private key file contains comments.
**Solution**: 
- Create a clean private key file containing ONLY the base64 key: `private/sparkle_ed_private_key`
- The commented key file (`private/sparkle_private_key`) is kept for documentation
- All scripts now use the clean key file automatically
- Scripts will extract the key from the commented file if the clean one doesn't exist

#### State Tracking and Resume Capability
**New Feature**: Release process now supports interruption and resumption.
- Added `release-state.sh` for state management
- Tracks 9 major release steps with progress
- Use `./scripts/release.sh --resume` to continue interrupted release
- Use `./scripts/release.sh --status` to check current state
- State file at `.release-state` contains progress information

## 🚀 Long-term Improvements

1. **CI/CD Integration**: Move releases to GitHub Actions for reliability
2. **Release Dashboard**: Web UI showing release progress and status
3. **Automated Testing**: Test Sparkle updates in CI before publishing
4. **Rollback Capability**: Script to quickly revert a bad release
5. **Release Templates**: Pre-configured release notes and changelog formats
6. **Monitoring Improvements**: Add detailed logging with timestamps and metrics

## Summary

The VibeTunnel release process is complex but well-automated. The main challenges are:
- Command timeouts during long operations (especially notarization)
- Lack of resumability after failures
- Missing progress indicators
- No automated recovery options
- File location confusion

Following this guide and implementing the suggested improvements will make releases more reliable and less stressful, especially when using tools with timeout constraints.

**Remember**: Always use the automated release script, ensure build numbers increment, and test updates before announcing!

## 📚 Important Links

- [Sparkle Sandboxing Guide](https://sparkle-project.org/documentation/sandboxing/)
- [Sparkle Code Signing](https://sparkle-project.org/documentation/sandboxing/#code-signing)
- [Apple Notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [GitHub Releases API](https://docs.github.com/en/rest/releases/releases)

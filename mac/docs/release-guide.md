# VibeTunnel Release Process

This document describes the complete release process for VibeTunnel, including all prerequisites, steps, and troubleshooting information.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Pre-Release Checklist](#pre-release-checklist)
3. [Release Process](#release-process)
4. [Post-Release Steps](#post-release-steps)
5. [Troubleshooting](#troubleshooting)
6. [Lessons Learned](#lessons-learned)

## Prerequisites

### Required Tools

- **Xcode** (latest stable version)
- **GitHub CLI** (`brew install gh`)
- **Apple Developer Account** with valid certificates
- **Sparkle EdDSA Keys** (see [Sparkle Key Management](#sparkle-key-management))

### Environment Variables

```bash
# Required for notarization
export APP_STORE_CONNECT_API_KEY_P8="<your-api-key>"
export APP_STORE_CONNECT_KEY_ID="<your-key-id>"
export APP_STORE_CONNECT_ISSUER_ID="<your-issuer-id>"

# Optional - will be auto-detected if not set
export SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
```

### Sparkle Key Management

VibeTunnel uses EdDSA signatures for secure updates via Sparkle framework.

#### ⚠️ CRITICAL: Multiple Keys Warning

Your system may have multiple Sparkle private keys:
1. **File-based key** at `private/sparkle_private_key` (CORRECT)
2. **Keychain key** (WRONG - may produce incompatible signatures)

**ALWAYS use the `-f` flag when signing:**
```bash
# ✅ CORRECT
sign_update -f private/sparkle_private_key file.dmg

# ❌ WRONG - may use keychain key
sign_update file.dmg
```

#### Key Storage

- **Private Key**: `private/sparkle_private_key` (NEVER commit this!)
- **Public Key**: In Info.plist as `SUPublicEDKey`
- **Expected Public Key**: `AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI=`

#### Generating New Keys

If you need to generate new keys:

```bash
# Generate keys using Sparkle's tool
./build/SourcePackages/artifacts/sparkle/Sparkle/bin/generate_keys

# This creates a key pair - save the private key securely!
```

#### Restoring Keys

To restore keys from backup:

```bash
# Create private directory
mkdir -p private

# Copy your private key (base64 encoded, no comments)
echo "YOUR_PRIVATE_KEY_BASE64" > private/sparkle_private_key

# Ensure it's in .gitignore
echo "private/" >> .gitignore
```

## Pre-Release Checklist

Before starting a release, ensure:

1. **Version Configuration**
   - [ ] Update `MARKETING_VERSION` in `VibeTunnel/version.xcconfig`
   - [ ] Increment `CURRENT_PROJECT_VERSION` (build number)
   - [ ] Ensure version follows semantic versioning

2. **Code Quality**
   - [ ] All tests pass: `npm run test` (in web/) and Swift tests
   - [ ] Linting passes: `npm run lint`
   - [ ] Typechecking passes: `npm run typecheck`
   - [ ] No uncommitted changes: `git status`

3. **Documentation**
   - [ ] Update `CHANGELOG.md` with release notes
   - [ ] Version header format: `## X.Y.Z (YYYY-MM-DD)`
   - [ ] Include sections: Features, Improvements, Bug Fixes

4. **Authentication**
   - [ ] GitHub CLI authenticated: `gh auth status`
   - [ ] Signing certificates valid: `security find-identity -v -p codesigning`
   - [ ] Notarization credentials set (environment variables)

5. **Sparkle Signature Validation**
   - [ ] Private key exists at `private/sparkle_private_key`
   - [ ] Run validation script: `./scripts/validate-sparkle-signature.sh`
   - [ ] Confirm NO keychain key conflicts (script will warn)

## Release Process

### Automated Release

The easiest way to create a release is using the automated script:

```bash
# For stable release
./scripts/release.sh stable

# For pre-release (beta, alpha, rc)
./scripts/release.sh beta 1   # Creates 1.0.0-beta.1
./scripts/release.sh rc 2     # Creates 1.0.0-rc.2
```

The script will:
1. Run pre-flight checks
2. Build the application
3. Sign and notarize
4. Create DMG
5. Upload to GitHub
6. Update appcast files

### Manual Release Steps

If you need to run steps manually:

1. **Run Pre-flight Checks**
   ```bash
   ./scripts/preflight-check.sh
   ```

2. **Build Application**
   ```bash
   # For stable release
   ./scripts/build.sh --configuration Release

   # For pre-release
   IS_PRERELEASE_BUILD=YES ./scripts/build.sh --configuration Release
   ```

3. **Sign and Notarize**
   ```bash
   ./scripts/sign-and-notarize.sh --sign-and-notarize
   ```

4. **Create DMG**
   ```bash
   ./scripts/create-dmg.sh build/Build/Products/Release/VibeTunnel.app
   ```

5. **Notarize DMG**
   ```bash
   ./scripts/notarize-dmg.sh build/VibeTunnel-X.Y.Z.dmg
   ```

6. **Create GitHub Release**
   ```bash
   # Create tag
   git tag -a "vX.Y.Z" -m "Release X.Y.Z"
   git push origin "vX.Y.Z"

   # Create release
   gh release create "vX.Y.Z" \
     --title "VibeTunnel X.Y.Z" \
     --notes "Release notes here" \
     build/VibeTunnel-X.Y.Z.dmg
   ```

7. **Update Appcast**
   ```bash
   ./scripts/generate-appcast.sh
   git add appcast*.xml
   git commit -m "Update appcast for vX.Y.Z"
   git push
   ```

## Post-Release Steps

1. **Verify Release**
   - [ ] Check GitHub release page
   - [ ] Download and test the DMG
   - [ ] Verify auto-update works from previous version

2. **Clean Up**
   ```bash
   # Clean build artifacts (keeps DMG)
   ./scripts/clean.sh --keep-dmg

   # Restore development version if needed
   git checkout -- VibeTunnel/version.xcconfig
   ```

3. **Announce Release**
   - [ ] Update website/documentation
   - [ ] Send release announcement
   - [ ] Update issue tracker milestones

## Troubleshooting

### Common Issues

#### "Update isn't properly signed" Error

This indicates an EdDSA signature mismatch. Causes:
- Wrong private key used for signing
- Appcast not updated after DMG creation
- Cached signatures from different key

Solution:
1. Ensure correct private key in `private/sparkle_private_key`
2. Regenerate appcast: `./scripts/generate-appcast.sh`
3. Commit and push appcast changes

#### Build Number Already Exists

Error: "Build number X already exists in appcast"

Solution:
1. Increment `CURRENT_PROJECT_VERSION` in `version.xcconfig`
2. Each release must have a unique build number

#### Notarization Fails

Common causes:
- Invalid or expired certificates
- Missing API credentials
- Network issues

Solution:
1. Check credentials: `xcrun notarytool history`
2. Verify certificates: `security find-identity -v`
3. Check console logs for specific errors

#### Xcode Project Version Mismatch

If build shows wrong version:
1. Ensure Xcode project uses `$(CURRENT_PROJECT_VERSION)`
2. Not hardcoded values
3. Clean and rebuild

### Verification Commands

```bash
# Check signing
codesign -dv --verbose=4 build/VibeTunnel.app

# Check notarization
spctl -a -t exec -vv build/VibeTunnel.app

# Verify DMG
hdiutil verify build/VibeTunnel-X.Y.Z.dmg

# Test EdDSA signature
./build/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update \
  build/VibeTunnel-X.Y.Z.dmg \
  -f private/sparkle_private_key
```

## Lessons Learned

### Critical Points

1. **Always Use Correct Sparkle Keys**
   - The private key must match the public key in the app
   - Store private key securely, never in version control
   - Test signature generation before release

2. **Timestamp All Code Signatures**
   - Required for Sparkle components
   - Use `--timestamp` flag on all codesign operations
   - Prevents "update isn't properly signed" errors

3. **Version Management**
   - Use xcconfig for centralized version control
   - Never hardcode versions in Xcode project
   - Increment build number for every release

4. **Pre-flight Validation**
   - Always run pre-flight checks
   - Ensure clean git state
   - Verify all credentials before starting

5. **Appcast Synchronization**
   - Push appcast updates immediately after release
   - GitHub serves as the appcast host
   - Users fetch from raw.githubusercontent.com

### Best Practices

- **Automate Everything**: Use the release script for consistency
- **Test Updates**: Always test auto-update from previous version
- **Keep Logs**: Save notarization logs for debugging
- **Document Issues**: Update this guide when new issues arise
- **Clean Regularly**: Use `clean.sh` to manage disk space

## Script Reference

| Script | Purpose | Key Options |
|--------|---------|-------------|
| `release.sh` | Complete automated release | `stable`, `beta N`, `alpha N`, `rc N` |
| `preflight-check.sh` | Validate release readiness | None |
| `build.sh` | Build application | `--configuration Release/Debug` |
| `sign-and-notarize.sh` | Sign and notarize app | `--sign-and-notarize` |
| `create-dmg.sh` | Create DMG installer | `<app_path> [output_path]` |
| `notarize-dmg.sh` | Notarize DMG | `<dmg_path>` |
| `generate-appcast.sh` | Update appcast files | None |
| `verify-appcast.sh` | Verify appcast validity | None |
| `clean.sh` | Clean build artifacts | `--all`, `--keep-dmg`, `--dry-run` |
| `lint.sh` | Run code linters | None |

## Environment Setup

For team members setting up for releases:

```bash
# 1. Install dependencies
brew install gh
npm install -g swiftformat swiftlint

# 2. Authenticate GitHub CLI
gh auth login

# 3. Set up notarization credentials
# Add to ~/.zshrc or ~/.bash_profile:
export APP_STORE_CONNECT_API_KEY_P8="..."
export APP_STORE_CONNECT_KEY_ID="..."
export APP_STORE_CONNECT_ISSUER_ID="..."

# 4. Get Sparkle private key from secure storage
# Contact team lead for access
```

---

For questions or issues, consult the script headers or create an issue in the repository.
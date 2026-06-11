<!-- Generated: 2025-06-21 12:30:00 UTC -->

# Deployment

VibeTunnel deployment encompasses macOS app distribution, automatic updates via Sparkle, and CLI tool installation. The release process is highly automated with comprehensive signing, notarization, and update feed generation.

## Package Types

**macOS Application Bundle** - Main VibeTunnel.app bundle with embedded resources (mac/build/Build/Products/Release/VibeTunnel.app)
- Signed with Developer ID Application certificate
- Notarized by Apple for Gatekeeper approval
- Contains embedded Bun server executable and CLI binaries

**DMG Distribution** - Disk image for user downloads (mac/build/VibeTunnel-{version}.dmg)
- Created by mac/scripts/create-dmg.sh
- Signed and notarized by mac/scripts/notarize-dmg.sh
- Contains app bundle and Applications symlink

**CLI Tools Package** - Command line binaries installed to /usr/local/bin
- vibetunnel binary (main CLI tool)
- vt wrapper script (convenience command)
- Installed via mac/VibeTunnel/Utilities/CLIInstaller.swift

## Platform Deployment

### Automated Release Process

**Complete Release Workflow** - mac/scripts/release.sh orchestrates the entire process:
```bash
./scripts/release.sh stable         # Stable release
./scripts/release.sh beta 2         # Beta release 2
./scripts/release.sh alpha 1        # Alpha release 1
```

**Pre-flight Checks** - mac/scripts/preflight-check.sh validates:
- Git repository state (clean working tree, on main branch)
- Build environment (Xcode, certificates, tools)
- Version configuration (mac/VibeTunnel/version.xcconfig)
- Notarization credentials (environment variables)

**Build and Signing** - mac/scripts/build.sh with mac/scripts/sign-and-notarize.sh:
- Builds ARM64-only binary (Apple Silicon)
- Signs with hardened runtime and entitlements
- Notarizes with Apple using API key authentication
- Staples notarization ticket to app bundle

### Code Signing Configuration

**Signing Script** - mac/scripts/codesign-app.sh handles deep signing:
- Signs all embedded frameworks and binaries
- Special handling for Sparkle XPC services (lines 89-145)
- Preserves existing signatures with timestamps
- Uses Developer ID Application certificate

**Notarization Process** - mac/scripts/notarize-app.sh submits to Apple:
- Creates secure timestamp signatures
- Submits via notarytool with API key (lines 38-72)
- Waits for Apple processing (timeout: 30 minutes)
- Staples ticket on success (lines 104-115)

### Sparkle Update System

**Update Configuration** - mac/VibeTunnel/Core/Services/SparkleUpdaterManager.swift:
- Automatic update checking enabled (line 78)
- Automatic downloads enabled (line 81)
- 24-hour check interval (line 84)
- Supports stable and pre-release channels (lines 152-160)

**Appcast Generation** - mac/scripts/generate-appcast.sh creates update feeds:
- Fetches releases from GitHub API (lines 334-338)
- Generates EdDSA signatures using private key (lines 95-130)
- Creates appcast.xml (stable only) and appcast-prerelease.xml
- Embeds changelog from local CHANGELOG.md (lines 259-300)

**Update Channels** - Configured in mac/VibeTunnel/Models/UpdateChannel.swift:
- Stable: https://vibetunnel.sh/appcast.xml
- Pre-release: https://vibetunnel.sh/appcast-prerelease.xml

### CLI Installation

**Installation Manager** - mac/VibeTunnel/Utilities/CLIInstaller.swift:
- Checks installation status (lines 41-123)
- Handles version updates (lines 276-341)
- Creates /usr/local/bin if needed (lines 407-411)
- Installs via osascript for sudo privileges (lines 470-484)

**Server Configuration** (lines 398-453):
- Bun server: Creates vt wrapper script that prepends 'fwd' command

### GitHub Release Creation

**Release Publishing** - Handled by mac/scripts/release.sh (lines 500-600):
- Creates and pushes git tags
- Uploads DMG to GitHub releases
- Generates release notes from CHANGELOG.md
- Marks pre-releases appropriately

**Release Verification** - Multiple verification steps:
- DMG signature verification (lines 429-458)
- App notarization check inside DMG (lines 462-498)
- Sparkle component timestamp signatures (lines 358-408)

## Reference

### Environment Variables
```bash
# Required for notarization
APP_STORE_CONNECT_API_KEY_P8    # App Store Connect API key content
APP_STORE_CONNECT_KEY_ID         # API Key ID
APP_STORE_CONNECT_ISSUER_ID      # API Issuer ID

# Optional
DMG_VOLUME_NAME                  # Custom DMG volume name
SIGN_IDENTITY                    # Override signing identity
```

### Key Scripts and Locations
- **Release orchestration**: mac/scripts/release.sh
- **Build configuration**: mac/scripts/build.sh, mac/scripts/common.sh
- **Signing pipeline**: mac/scripts/sign-and-notarize.sh, mac/scripts/codesign-app.sh
- **Notarization**: mac/scripts/notarize-app.sh, mac/scripts/notarize-dmg.sh
- **DMG creation**: mac/scripts/create-dmg.sh
- **Appcast generation**: mac/scripts/generate-appcast.sh
- **Version management**: mac/VibeTunnel/version.xcconfig
- **Sparkle private key**: mac/private/sparkle_private_key

### Release Artifacts
- **Application bundle**: mac/build/Build/Products/Release/VibeTunnel.app
- **Signed DMG**: mac/build/VibeTunnel-{version}.dmg
- **Update feeds**: appcast.xml, appcast-prerelease.xml (repository root)
- **GitHub releases**: https://github.com/amantus-ai/vibetunnel/releases

### Common Issues
- **Notarization failures**: Check API credentials, ensure valid Developer ID certificate
- **Sparkle signature errors**: Verify sparkle_private_key exists at mac/private/
- **Build number conflicts**: Increment CURRENT_PROJECT_VERSION in version.xcconfig
- **Double version suffixes**: Ensure version.xcconfig has correct format before release

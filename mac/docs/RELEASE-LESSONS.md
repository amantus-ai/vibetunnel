# VibeTunnel Release Lessons Learned

This document captures important lessons learned from the VibeTunnel release process and common issues that can occur.

## Critical Issues and Solutions

### 1. Sparkle Signing Account Issues

**Problem**: The `sign_update` command may use the wrong signing key from your Keychain if you have multiple EdDSA keys configured.

**Symptoms**:
- Sparkle update verification fails
- Error messages about invalid signatures
- Updates don't appear in the app even though appcast is updated

**Solution**:
```bash
# Always specify the account explicitly
export SPARKLE_ACCOUNT="VibeTunnel"
./scripts/release.sh stable
```

**Prevention**: The release script now sets `SPARKLE_ACCOUNT` environment variable automatically.

### 2. File Location Confusion

**Problem**: Files are not always where scripts expect them to be.

**Key Locations**:
- **Appcast files**: Located in project root (`/vibetunnel/`), NOT in `mac/`
  - `appcast.xml`
  - `appcast-prerelease.xml`
- **CHANGELOG.md**: Can be in either:
  - `mac/CHANGELOG.md` (preferred by release script)
  - Project root `/vibetunnel/CHANGELOG.md` (common location)
- **Sparkle private key**: Usually in `mac/private/sparkle_private_key`

**Solution**: The scripts now check multiple locations and provide clear error messages.

### 3. Stuck DMG Volumes

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

### 4. Build Number Already Exists

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

### 5. Notarization Failures

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

### 6. GitHub Release Already Exists

**Problem**: Tag or release already exists on GitHub.

**Solution**: The release script now prompts you to:
1. Delete the existing release and tag
2. Cancel the release

**Prevention**: Always pull latest changes before releasing.

## Pre-Release Checklist

Before running `./scripts/release.sh`:

1. **Environment Setup**:
   ```bash
   # Ensure you're on main branch
   git checkout main
   git pull --rebase origin main
   
   # Check for uncommitted changes
   git status
   
   # Set environment variables
   export SPARKLE_ACCOUNT="VibeTunnel"
   export APP_STORE_CONNECT_API_KEY_P8="..."
   export APP_STORE_CONNECT_KEY_ID="..."
   export APP_STORE_CONNECT_ISSUER_ID="..."
   ```

2. **File Verification**:
   - [ ] CHANGELOG.md exists and has entry for new version
   - [ ] version.xcconfig has unique build number
   - [ ] Sparkle private key exists at expected location
   - [ ] No stuck DMG volumes in /Volumes/

3. **Clean Build**:
   ```bash
   ./scripts/clean.sh
   rm -rf ~/Library/Developer/Xcode/DerivedData/VibeTunnel-*
   ```

## Common Commands

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

## Post-Release Verification

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

## Emergency Fixes

### If Update Verification Fails
1. Regenerate appcast with correct account:
   ```bash
   export SPARKLE_ACCOUNT="VibeTunnel"
   ./scripts/generate-appcast.sh
   git add ../appcast*.xml
   git commit -m "Fix appcast signatures"
   git push
   ```

2. Users may need to manually download until appcast propagates

### If DMG is Corrupted
1. Re-download from GitHub
2. Re-sign and re-notarize:
   ```bash
   ./scripts/sign-and-notarize.sh --sign-and-notarize
   ./scripts/notarize-dmg.sh build/VibeTunnel-*.dmg
   ```
3. Upload fixed DMG to GitHub release

## Key Learnings

1. **Always use explicit accounts** when dealing with signing operations
2. **Clean up resources** (volumes, processes) before operations
3. **Verify file locations** - don't assume standard paths
4. **Test the full update flow** before announcing the release
5. **Keep credentials secure** but easily accessible for scripts
6. **Document everything** - future you will thank present you
7. **Plan for long-running operations** - notarization can take 10+ minutes
8. **Implement resumable workflows** - scripts should handle interruptions gracefully
9. **DMG signing is separate from notarization** - DMGs themselves aren't notarized, only the app inside

### Additional Lessons from v1.0.0-beta.5 Release

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

#### Appcast Generation Failures
**Issue**: `generate-appcast.sh` failed with GitHub API errors despite valid auth.
**Workaround**: 
- Manually create appcast entries when automation fails
- Always verify the Sparkle signature with `sign_update --account VibeTunnel`
- Keep a template of appcast entries for quick manual updates

## References

- [Sparkle Documentation](https://sparkle-project.org/documentation/)
- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [GitHub Releases API](https://docs.github.com/en/rest/releases/releases)
# Release Process Improvements - June 2024

Based on the v1.0.0-beta.5 release experience, here are recommended improvements to the release process and tooling.

## 🚨 Issues Encountered

### 1. Command Timeouts
**Problem**: The release script timed out multiple times during execution, especially during notarization.
- Claude's 2-minute command timeout interrupted long-running operations
- Notarization can take 5-10 minutes depending on Apple's servers

**Solution**: 
- Add progress indicators and intermediate status updates
- Break down the release script into smaller, resumable steps
- Add a `--resume` flag to continue from the last successful step

### 2. Notarization Delays
**Problem**: Notarization took longer than expected and caused script interruption.

**Solution**:
- Add timeout handling with proper cleanup
- Implement async notarization with status polling
- Add estimated time remaining based on historical data

### 3. Manual Recovery Required
**Problem**: After script failure, manual steps were needed:
- Creating DMG manually
- Creating GitHub release manually  
- Updating appcast manually

**Solution**: Implement idempotent operations and recovery:
```bash
# Check if DMG already exists
if [ -f "build/VibeTunnel-$VERSION.dmg" ]; then
    echo "DMG already exists, skipping creation"
else
    ./scripts/create-dmg.sh
fi

# Check if GitHub release exists
if gh release view "v$VERSION" &>/dev/null; then
    echo "Release already exists, skipping"
else
    gh release create ...
fi
```

### 4. Generate Appcast Script Failure
**Problem**: `generate-appcast.sh` failed with GitHub API error despite valid authentication.

**Solution**: Add better error handling and fallback options:
- Retry logic for transient API failures
- Manual appcast generation mode
- Better error messages indicating the actual problem

## 📋 Recommended Script Improvements

### 1. Release Script Enhancements

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

### 2. Parallel Operations
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

### 3. Better Progress Reporting
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

## 📄 Documentation Improvements

### 1. Add Troubleshooting Section
Create a new section in RELEASE.md:

```markdown
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
```

### 2. Add Pre-Release Checklist Updates
```markdown
### Environment Setup
- [ ] Ensure stable internet connection (notarization requires consistent connectivity)
- [ ] Check Apple Developer status page for any service issues
- [ ] Have at least 30 minutes available (full release takes 15-20 minutes)
- [ ] Close other resource-intensive applications
```

## 🛠️ New Helper Scripts

### 1. Release Status Script
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

### 2. Quick Fix Script
Create `scripts/fix-incomplete-release.sh`:
```bash
#!/bin/bash
# Completes a partially finished release

VERSION=$(grep MARKETING_VERSION VibeTunnel/version.xcconfig | cut -d' ' -f3)
BUILD=$(grep CURRENT_PROJECT_VERSION VibeTunnel/version.xcconfig | cut -d' ' -f3)

echo "Fixing incomplete release for $VERSION (build $BUILD)..."

# Check what's missing and fix
./scripts/check-release-status.sh "$VERSION"

# ... implement fixes based on status
```

## 🔍 Monitoring Improvements

### 1. Add Logging
- Create detailed logs for each release in `logs/release-$VERSION.log`
- Include timestamps for each operation
- Log all external command outputs

### 2. Add Metrics
Track and report:
- Total release time
- Time per step (build, sign, notarize, upload)
- Success/failure rates
- Common failure points

## 🎯 Quick Wins

1. **Increase timeouts**: Set notarization timeout to 30 minutes
2. **Add retry logic**: Retry failed operations up to 3 times
3. **Better error messages**: Include specific recovery steps in error output
4. **State persistence**: Save progress to allow resumption
5. **Validation before each step**: Check prerequisites aren't already done

## 📝 Updated Release Workflow

Based on lessons learned, here's the recommended workflow:

1. **Pre-release**:
   ```bash
   ./scripts/preflight-check.sh --comprehensive
   ```

2. **Release with monitoring**:
   ```bash
   # Run in a screen/tmux session to prevent disconnection
   screen -S release
   ./scripts/release.sh beta 5 --verbose --log
   ```

3. **If interrupted**:
   ```bash
   ./scripts/check-release-status.sh 1.0.0-beta.5
   ./scripts/release.sh --resume
   ```

4. **Verify**:
   ```bash
   ./scripts/verify-release.sh 1.0.0-beta.5
   ```

## 🚀 Long-term Improvements

1. **CI/CD Integration**: Move releases to GitHub Actions for reliability
2. **Release Dashboard**: Web UI showing release progress and status
3. **Automated Testing**: Test Sparkle updates in CI before publishing
4. **Rollback Capability**: Script to quickly revert a bad release
5. **Release Templates**: Pre-configured release notes and changelog formats

## Summary

The v1.0.0-beta.5 release was ultimately successful, but the process revealed several areas for improvement. The main issues were:
- Command timeouts during long operations
- Lack of resumability after failures
- Missing progress indicators
- No automated recovery options

Implementing the improvements above will make future releases more reliable and less stressful, especially when using tools with timeout constraints like Claude.
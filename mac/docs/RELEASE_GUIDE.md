# VibeTunnel Release Guide - Quick Reference

This guide provides a streamlined release process based on lessons learned from beta.13.

## 🚀 Quick Release Commands

```bash
# 1. Pre-release health check
./scripts/release-health-check.sh

# 2. Set environment variables
export SPARKLE_ACCOUNT="VibeTunnel"
export CI=false
export SKIP_NODE_CHECK=false

# 3. Run the release
./scripts/release.sh beta 14  # For next beta

# 4. Monitor progress in another terminal
./scripts/release-progress.sh

# 5. If interrupted, resume
./scripts/release.sh --resume
```

## 📋 Pre-Release Checklist

Before starting any release:

### 1. Version Numbers
- [ ] Update `mac/VibeTunnel/version.xcconfig`:
  - `MARKETING_VERSION = 1.0.0-beta.14`
  - `CURRENT_PROJECT_VERSION = 203` (increment from last)
- [ ] Update `web/package.json` to match
- [ ] Update `web/package.npm.json` to match
- [ ] Update `CHANGELOG.md` with release notes

### 2. Environment Setup
```bash
# Required environment variables
export SPARKLE_ACCOUNT="VibeTunnel"
export CI=false
export SKIP_NODE_CHECK=false

# Notarization credentials (if not already set)
export APP_STORE_CONNECT_KEY_ID="your_key_id"
export APP_STORE_CONNECT_ISSUER_ID="your_issuer_id"
export APP_STORE_CONNECT_API_KEY_P8="-----BEGIN PRIVATE KEY-----
your_private_key_content
-----END PRIVATE KEY-----"
```

### 3. Clean State
```bash
# Ensure clean git state
git status  # Should be clean
git pull --rebase origin main

# Run health check
./scripts/release-health-check.sh
```

## 🔧 Troubleshooting

### Node.js Detection Issues
If the build fails with "Node.js is required":
```bash
# Test Node.js detection
./scripts/check-node-simple.sh

# If using nvm, ensure it's loaded
source ~/.nvm/nvm.sh
nvm use 20  # or your version

# Create symlinks if needed (requires sudo)
sudo ln -s $(which node) /usr/local/bin/node
sudo ln -s $(which pnpm) /usr/local/bin/pnpm
```

### Release Script Timeouts
The release process can take 20-30 minutes:
- Build: 2-5 minutes
- Notarization: 5-15 minutes
- DMG creation: 1-2 minutes

If it times out:
```bash
# Check current status
./scripts/release-progress.sh

# Resume from last step
./scripts/release.sh --resume
```

### Manual Recovery
If the release script fails after notarization:

```bash
# 1. Create GitHub release manually
./scripts/generate-release-notes.sh 1.0.0-beta.14 > notes.md
gh release create "v1.0.0-beta.14" \
  --title "VibeTunnel 1.0.0-beta.14" \
  --notes-file notes.md \
  --prerelease \
  build/VibeTunnel-*.dmg \
  build/VibeTunnel-*.zip

# 2. Sign DMG for Sparkle
sign_update -f private/sparkle_ed_private_key \
  build/VibeTunnel-1.0.0-beta.14.dmg \
  --account VibeTunnel

# 3. Update appcast manually
# Add the signature to appcast-prerelease.xml
# Then commit and push
git add ../appcast-prerelease.xml
git commit -m "Update appcast for v1.0.0-beta.14"
git push
```

## 📊 New Tools

### Release Progress Monitor
Shows real-time release progress with visual indicators:
```bash
./scripts/release-progress.sh
```

Features:
- Step-by-step progress tracking
- Duration for each step
- Idle time warnings
- Artifact status

### Release Health Check
Comprehensive pre-release validation:
```bash
./scripts/release-health-check.sh
```

Checks:
- Git status and branch
- Environment variables
- Build tools availability
- Code signing certificates
- Version synchronization
- Disk space
- Appcast validity

### Simplified Node.js Check
More robust Node.js detection:
```bash
./scripts/check-node-simple.sh
```

## 🎯 Best Practices

1. **Always run health check first** - Catches issues before they cause failures
2. **Use progress monitor** - Keep track of long-running operations
3. **Set all environment variables** - Prevents mid-release failures
4. **Keep versions synchronized** - Update all version files before starting
5. **Document in CHANGELOG.md** - Required for release notes generation
6. **Don't run in background** - Use screen/tmux if needed, but keep foreground

## 📝 Version Management

### Version Files to Update
1. `mac/VibeTunnel/version.xcconfig` - Source of truth
2. `web/package.json` - Must match macOS version
3. `web/package.npm.json` - For npm package release
4. `CHANGELOG.md` - Release notes

### Build Number Rules
- Must increment for EVERY release
- Must be unique across all releases
- Sparkle uses build numbers, not version strings
- Check existing: `grep '<sparkle:version>' ../appcast*.xml`

## 🚨 Common Issues

### "Uncommitted changes detected"
- Commit all changes before releasing
- Or stash temporarily: `git stash`

### "Build number already exists"
- Increment CURRENT_PROJECT_VERSION in version.xcconfig
- Must be higher than all previous releases

### "Version mismatch"
- Ensure web/package.json matches mac version
- Run health check to verify

### DMG stuck volumes
```bash
# List stuck volumes
ls /Volumes/VibeTunnel*

# Force unmount
for vol in /Volumes/VibeTunnel*; do
  hdiutil detach "$vol" -force
done
```

## 📚 Summary

The improved release process provides:
- Better error handling with environment variable defaults
- Visual progress tracking
- Comprehensive pre-flight validation
- Clear recovery procedures
- Simplified troubleshooting

For the smoothest release experience:
1. Run health check
2. Set environment variables
3. Use the standard release script
4. Monitor with progress tool
5. Resume if interrupted

The release should complete in 20-30 minutes with clear visibility into each step.
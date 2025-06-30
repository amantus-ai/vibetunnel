# VibeTunnel Release Quick Reference

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

# 3. Get Sparkle signature
sign_update build/VibeTunnel-*.dmg --account VibeTunnel

# 4. Update appcast manually (add to appcast-prerelease.xml)
# 5. Commit and push
git add ../appcast-prerelease.xml
git commit -m "Update appcast for v1.0.0-beta.5"
git push
```

## 📋 Pre-Release Checklist

- [ ] `grep MARKETING_VERSION VibeTunnel/version.xcconfig` - Check version
- [ ] `grep CURRENT_PROJECT_VERSION VibeTunnel/version.xcconfig` - Check build number
- [ ] `grep "version" ../web/package.json` - Verify web version matches
- [ ] `grep "## \[1.0.0-beta.5\]" CHANGELOG.md` - Changelog entry exists
- [ ] `git status` - Clean working directory
- [ ] `gh auth status` - GitHub CLI authenticated
- [ ] Apple notarization credentials set in environment

## 🔍 Verification Commands

```bash
# Check release artifacts
ls -la build/VibeTunnel-*.dmg
ls -la build/VibeTunnel-*.zip

# Check GitHub release
gh release view v1.0.0-beta.5

# Verify Sparkle signature
curl -L -o test.dmg [github-dmg-url]
sign_update test.dmg --account VibeTunnel

# Check appcast
grep "1.0.0-beta.5" ../appcast-prerelease.xml

# Verify app in DMG
hdiutil attach test.dmg
spctl -a -vv /Volumes/VibeTunnel/VibeTunnel.app
hdiutil detach /Volumes/VibeTunnel
```

## ⚠️ Common Issues

### "Uncommitted changes detected"
```bash
git status --porcelain  # Check what's changed
git stash              # Temporarily store changes
# Run release
git stash pop          # Restore changes
```

### Notarization Taking Too Long
- Normal: 2-10 minutes
- If >15 minutes, check Apple System Status
- Can manually check: `xcrun notarytool history`

### DMG Shows "Unnotarized"
- This is NORMAL - DMGs aren't notarized
- Check the app inside: it should show "Notarized Developer ID"

### Generate Appcast Fails
- Manually add entry to appcast-prerelease.xml
- Use signature from: `sign_update [dmg] --account VibeTunnel`
- Follow existing entry format

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
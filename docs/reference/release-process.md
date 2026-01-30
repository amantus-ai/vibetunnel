# Release Process

## Quick Checklist

```bash
# 1. Update version
./scripts/update-version.sh 1.0.0

# 2. Run tests
./scripts/test-all.sh

# 3. Build release
./scripts/release.sh 1.0.0

# 4. Create GitHub release
gh release create v1.0.0 dist/VibeTunnel-1.0.0.dmg

# 5. Update Sparkle feed
./scripts/update-sparkle.sh
```

## Detailed Steps

### 1. Pre-Release

**Version Update**
```bash
# Updates all version files
./scripts/update-version.sh NEW_VERSION

# Files modified:
# - mac/VibeTunnel/version.xcconfig
# - web/package.json
# - ios/VibeTunnel/Info.plist
```

**Changelog**
```markdown
## [1.0.0] - 2024-01-01

### Added
- New feature X
- Support for Y

### Fixed
- Bug Z

### Changed
- Improved performance
```

### 2. Testing

**Run Test Suite**
```bash
# All platforms
./scripts/test-all.sh

# Individual
cd mac && xcodebuild test
cd ios && ./scripts/test-with-coverage.sh
cd web && pnpm test
```

**Manual Testing**
- [ ] Fresh install on clean macOS
- [ ] Upgrade from previous version
- [ ] Test on minimum macOS version
- [ ] iOS app connectivity
- [ ] Web UI on Safari/Chrome/Firefox

### 3. Build

**Release Build**
```bash
# Complete release
./scripts/release.sh VERSION

# Steps performed:
# 1. Clean build directories
# 2. Build web assets
# 3. Build Mac app (signed)
# 4. Create DMG
# 5. Notarize with Apple
# 6. Generate Sparkle appcast
```

**Verification**
```bash
# Check signature
codesign -dv --verbose=4 dist/VibeTunnel.app

# Verify notarization
spctl -a -v dist/VibeTunnel.app
```

### 4. Distribution

**GitHub Release**
```bash
# Create release
gh release create v$VERSION \
  --title "VibeTunnel $VERSION" \
  --notes-file RELEASE_NOTES.md \
  dist/VibeTunnel-$VERSION.dmg

# Upload additional assets
gh release upload v$VERSION dist/checksums.txt
```

**Sparkle Update**
```xml
<!-- appcast.xml -->
<item>
  <title>Version 1.0.0</title>
  <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
  <sparkle:version>1.0.0</sparkle:version>
  <sparkle:shortVersionString>1.0.0</sparkle:shortVersionString>
  <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
  <enclosure 
    url="https://github.com/steipete/vibetunnel/releases/download/v1.0.0/VibeTunnel-1.0.0.dmg"
    sparkle:edSignature="..." 
    length="12345678" 
    type="application/octet-stream"/>
</item>
```

### 5. Post-Release

**Documentation**
- [ ] Update README with new version
- [ ] Update docs with new features
- [ ] Post release notes

**Monitoring**
- [ ] Check Sparkle update stats
- [ ] Monitor crash reports
- [ ] Review user feedback

## Version Scheme

```
MAJOR.MINOR.PATCH[-PRERELEASE]

1.0.0       - Stable release
1.0.0-beta.1 - Beta release
1.0.0-rc.1   - Release candidate
```

## Build Configurations

| Config | Use Case | Signing |
|--------|----------|---------|
| Debug | Development | No |
| Release | Distribution | Yes |
| AppStore | Mac App Store | Yes |

## Code Signing

**Requirements**
- Apple Developer account
- Developer ID certificate
- Notarization credentials

**Setup**
```bash
# Store credentials
xcrun notarytool store-credentials "VT_NOTARY" \
  --apple-id "your@email.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Notarization fails | Check entitlements, wait 5 min |
| Sparkle not updating | Verify appcast URL, signature |
| DMG corrupted | Re-run with clean build |
| Version mismatch | Run update-version.sh |

## Rollback

```bash
# Revert release
gh release delete v$VERSION
git revert <commit>
git tag -d v$VERSION
git push origin :refs/tags/v$VERSION

# Update Sparkle feed to previous version
./scripts/rollback-sparkle.sh $PREVIOUS_VERSION
```

## CI/CD Pipeline

```yaml
# .github/workflows/release.yml
on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/test-all.sh
      - run: ./scripts/release.sh ${{ github.ref_name }}
      - uses: softprops/action-gh-release@v1
        with:
          files: dist/*.dmg
```

## See Also
- [Build System](../guides/development.md#build-system)
- [Testing Guide](../guides/testing.md)
- [Changelog](../../CHANGELOG.md)
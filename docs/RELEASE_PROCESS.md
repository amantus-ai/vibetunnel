# VibeTunnel Release Process

This document explains how to create releases for VibeTunnel, including the relationship between version numbers, release types, and the release script.

## Understanding Version Management

### Version Sources
1. **version.xcconfig** - Contains `MARKETING_VERSION` (e.g., `1.0.0-beta.7`)
2. **web/package.json** - Must match the marketing version
3. **Release script parameters** - Used for validation and GitHub release metadata

### Key Concept: Version vs Release Type

The release script **does NOT modify the version string** based on your parameters. Instead:

- The version comes from `version.xcconfig`
- Script parameters validate that your intent matches the configured version
- For pre-releases, the version must already include the suffix (e.g., `-beta.7`)

## Release Types

### Stable Release
```bash
# version.xcconfig must have: MARKETING_VERSION = 1.0.0
./scripts/release.sh stable
```

### Beta Release
```bash
# version.xcconfig must have: MARKETING_VERSION = 1.0.0-beta.7
./scripts/release.sh beta 7
```

### Alpha Release
```bash
# version.xcconfig must have: MARKETING_VERSION = 1.0.0-alpha.2
./scripts/release.sh alpha 2
```

### Release Candidate
```bash
# version.xcconfig must have: MARKETING_VERSION = 1.0.0-rc.1
./scripts/release.sh rc 1
```

## Pre-Release Workflow

1. **Update version.xcconfig** first:
   ```
   MARKETING_VERSION = 1.0.0-beta.7
   CURRENT_PROJECT_VERSION = 170
   ```

2. **Update web/package.json** to match:
   ```json
   "version": "1.0.0-beta.7"
   ```

3. **Update CHANGELOG.md** with release notes

4. **Commit these changes**:
   ```bash
   git add mac/VibeTunnel/version.xcconfig web/package.json CHANGELOG.md
   git commit -m "Prepare for v1.0.0-beta.7 release"
   git push
   ```

5. **Run the release script** with matching parameters:
   ```bash
   cd mac
   ./scripts/release.sh beta 7
   ```

## Common Mistakes

### ❌ Wrong: Running release with just a number
```bash
./scripts/release.sh 7  # This treats "7" as an unknown release type
```

### ❌ Wrong: Mismatched parameters
```bash
# version.xcconfig has: 1.0.0-beta.7
./scripts/release.sh beta 8  # Error: expects beta.8 but version has beta.7
```

### ✅ Correct: Parameters match the version
```bash
# version.xcconfig has: 1.0.0-beta.7
./scripts/release.sh beta 7  # Success!
```

## Dry Run Mode

Test your release without making changes:
```bash
./scripts/release.sh beta 7 --dry-run
```

This will:
- Show what version would be released
- Validate all preconditions
- Display what actions would be taken
- NOT modify any files or create releases

## Release Script Actions

The release script automates:

1. **Validation**
   - Ensures clean git state
   - Verifies version consistency
   - Checks signing certificates
   - Validates build numbers

2. **Building**
   - Cleans build artifacts
   - Builds universal binary
   - Sets `IS_PRERELEASE_BUILD` flag appropriately

3. **Signing & Notarization**
   - Code signs the app
   - Submits for Apple notarization
   - Waits for approval

4. **Distribution**
   - Creates signed DMG
   - Generates GitHub release
   - Updates appcast XML files
   - Commits and pushes changes

## Version Numbering Guidelines

- **Stable**: `MAJOR.MINOR.PATCH` (e.g., `1.0.0`, `1.1.0`, `2.0.0`)
- **Beta**: `MAJOR.MINOR.PATCH-beta.N` (e.g., `1.0.0-beta.1`)
- **Alpha**: `MAJOR.MINOR.PATCH-alpha.N` (e.g., `1.0.0-alpha.1`)
- **RC**: `MAJOR.MINOR.PATCH-rc.N` (e.g., `1.0.0-rc.1`)

Build numbers must always increment, even across different release types.

## Recent Improvements

### Enhanced Error Messages
```bash
# Before: Confusing error
❌ Error: Pre-release number required for beta

# After: Clear guidance
❌ Error: Pre-release number required for beta releases
Usage: ./scripts/release.sh beta <number>
Example: ./scripts/release.sh beta 7
```

### Fixed Issues
1. **Dry-Run Mode** - Now actually prevents ALL file modifications
2. **Clear Parameters** - Added `--help` flag with comprehensive usage examples
3. **CHANGELOG Location** - Script now looks in project root first
4. **iOS Info.plist** - Now uses `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)`
5. **Version Management** - Clarified that version.xcconfig is the source of truth

## Troubleshooting

### "Version already contains pre-release suffix"
This is a warning, not an error. It means the script detected that version.xcconfig already has the correct suffix. The release will proceed normally.

### "Not up to date with origin/main"
Pull the latest changes:
```bash
git pull --rebase origin main
```

### "Build number X already exists"
Increment the build number in version.xcconfig.

### Script times out
The release process can take 10-15 minutes due to notarization. Use a longer timeout or run in a persistent terminal session.

## Resume Failed Releases

If a release fails partway through:
```bash
./scripts/release-resume.sh
```

This will pick up where the release left off, skipping completed steps.

## Quick Reference

```bash
# Get help
./scripts/release.sh --help

# Test without making changes
./scripts/release.sh beta 7 --dry-run

# Create stable release
./scripts/release.sh stable

# Create beta release
./scripts/release.sh beta 7

# Resume failed release
./scripts/release-resume.sh
```
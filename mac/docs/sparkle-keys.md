# Sparkle Key Management Guide

This guide covers the management of EdDSA keys used for signing VibeTunnel updates with the Sparkle framework.

## Overview

VibeTunnel uses Sparkle's EdDSA (Ed25519) signatures for secure software updates. This system requires:
- A **private key** (kept secret) for signing updates
- A **public key** (distributed with the app) for verifying signatures

## Key Locations

### Public Key
- **Location**: `VibeTunnel/sparkle-public-ed-key.txt`
- **Status**: Committed to repository
- **Usage**: Embedded in app via `SUPublicEDKey` in Info.plist
- **Current Value**: `AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI=`

### Private Key
- **Location**: `private/sparkle_private_key`
- **Status**: NOT in version control (in .gitignore)
- **Usage**: Required for signing updates during release
- **Format**: Base64-encoded key data (no comments or headers)

## Initial Setup

### For New Team Members

1. **Request Access**
   ```bash
   # Contact team lead for secure key transfer
   # Keys are stored in: Dropbox/Backup/Sparkle-VibeTunnel/
   ```

2. **Install Private Key**
   ```bash
   # Create private directory
   mkdir -p private
   
   # Add key file (get content from secure backup)
   echo "BASE64_PRIVATE_KEY_HERE" > private/sparkle_private_key
   
   # Verify it's ignored by git
   git status  # Should not show private/
   ```

3. **Verify Setup**
   ```bash
   # Test signing with your key
   ./build/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update \
     any_file.dmg \
     -f private/sparkle_private_key
   ```

### For New Projects

1. **Generate New Keys**
   ```bash
   # Build Sparkle tools first
   ./scripts/build.sh
   
   # Generate new key pair
   ./build/SourcePackages/artifacts/sparkle/Sparkle/bin/generate_keys
   ```

2. **Save Keys**
   ```bash
   # Copy displayed keys:
   # Private key: [base64 string]
   # Public key: [base64 string]
   
   # Save private key
   mkdir -p private
   echo "PRIVATE_KEY_BASE64" > private/sparkle_private_key
   
   # Save public key
   echo "PUBLIC_KEY_BASE64" > VibeTunnel/sparkle-public-ed-key.txt
   ```

3. **Update App Configuration**
   - Add public key to Info.plist under `SUPublicEDKey`
   - Commit public key file to repository

## Key Security

### Best Practices

1. **Never Commit Private Keys**
   - Private directory is in .gitignore
   - Double-check before committing

2. **Secure Backup**
   - Store in encrypted location
   - Use password manager or secure cloud storage
   - Keep multiple secure backups

3. **Limited Access**
   - Only release managers need private key
   - Use secure channels for key transfer
   - Rotate keys if compromised

4. **Key Format**
   - Private key file must contain ONLY the base64 key
   - No comments, headers, or extra whitespace
   - Single line of base64 data

### Example Private Key Format
```
SMYPxE98bJ5iLdHTLHTqGKZNFcZLgrT5Hyjh79h3TaU=
```

## Troubleshooting

### "EdDSA signature does not match" Error

**Cause**: Wrong private key or key format issues

**Solution**:
1. Verify private key matches public key
2. Check key file has no extra characters
3. Regenerate appcast with correct key

### "Failed to decode base64 encoded key data"

**Cause**: Private key file contains comments or headers

**Solution**:
```bash
# Extract just the key
grep -v '^#' your_key_backup.txt | grep -v '^$' > private/sparkle_private_key
```

### Testing Key Pair Match

```bash
# Sign a test file
echo "test" > test.txt
./build/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update \
  test.txt \
  -f private/sparkle_private_key

# The signature should generate successfully
# Compare with production signatures to verify
```

## Key Rotation

If keys need to be rotated:

1. **Generate New Keys**
   ```bash
   ./build/SourcePackages/artifacts/sparkle/Sparkle/bin/generate_keys
   ```

2. **Update App**
   - Change `SUPublicEDKey` in Info.plist
   - Update `sparkle-public-ed-key.txt`
   - Release new version with new public key

3. **Transition Period**
   - Keep old private key for emergency updates
   - Sign new updates with new key
   - After all users update, retire old key

## Integration with Release Process

The release scripts automatically use the private key:

1. **generate-appcast.sh**
   - Expects key at `private/sparkle_private_key`
   - Fails if key missing or invalid
   - Signs all DMG files in releases

2. **release.sh**
   - Calls generate-appcast.sh after creating DMG
   - Ensures signatures are created before pushing

## Recovery Procedures

### Lost Private Key

If private key is lost:
1. Generate new key pair
2. Update app with new public key
3. Release update signed with old key (if possible)
4. All future updates use new key

### Compromised Private Key

If private key is compromised:
1. Generate new key pair immediately
2. Release security update with new public key
3. Notify users of security update
4. Revoke compromised key (document publicly)

## Verification Commands

### Verify Current Setup
```bash
# Check public key in app
/usr/libexec/PlistBuddy -c "Print :SUPublicEDKey" \
  build/Build/Products/Release/VibeTunnel.app/Contents/Info.plist

# Check private key exists
ls -la private/sparkle_private_key

# Test signing
./scripts/generate-appcast.sh --dry-run
```

### Verify Release Signatures
```bash
# Check signature in appcast
grep "sparkle:edSignature" appcast-prerelease.xml

# Manually verify a DMG
./build/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update \
  build/VibeTunnel-1.0.0.dmg \
  -f private/sparkle_private_key
```

## Additional Resources

- [Sparkle Documentation](https://sparkle-project.org/documentation/)
- [EdDSA on Wikipedia](https://en.wikipedia.org/wiki/EdDSA)
- [Ed25519 Key Security](https://ed25519.cr.yp.to/)

---

For questions about key management, contact the release team lead.
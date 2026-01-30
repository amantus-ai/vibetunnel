# Code Signing Guide for VibeTunnel

This comprehensive guide covers all aspects of code signing for VibeTunnel, from local development setup to release distribution.

## Table of Contents

1. [Development Setup](#development-setup)
2. [Release Signing & Notarization](#release-signing--notarization)
3. [Troubleshooting](#troubleshooting)
4. [Reference](#reference)

## Development Setup

### Initial Team Configuration

VibeTunnel uses xcconfig files to manage developer team settings, allowing multiple developers to work without code signing conflicts.

1. **Copy the template file to create your local configuration:**
   ```bash
   cp ../apple/Local.xcconfig.template ../apple/Local.xcconfig
   ```

2. **Edit `../apple/Local.xcconfig` and add your development team ID:**
   ```
   DEVELOPMENT_TEAM = YOUR_TEAM_ID_HERE
   ```

   **Finding your team ID in Xcode:**
   - Open Xcode → Settings (or Preferences)
   - Go to Accounts tab
   - Select your Apple ID
   - Look for your Team ID in the team details

3. **Open the project in Xcode** - it will now use your personal development team automatically.

### How xcconfig Works

- `VibeTunnel/Shared.xcconfig` - Contains shared configuration and includes local settings
- `../apple/Local.xcconfig` - Your personal settings (ignored by git)
- `../apple/Local.xcconfig.template` - Template for new developers

### Avoiding Keychain Dialogs During Development

VibeTunnel stores dashboard passwords in the keychain, which can trigger repeated authorization dialogs during development.

#### Debug Mode Behavior

In DEBUG builds, the app automatically skips keychain reads to avoid dialogs:

- **Password Setting**: You can set passwords during the current session
- **Session Persistence**: Passwords work normally until app restart
- **No Persistence**: Passwords are "forgotten" on restart (not read from keychain)
- **No Dialogs**: Prevents keychain authorization dialogs during development

When setting a password in debug mode, you'll see:
```
Debug mode: Password saved to keychain but will not persist across app restarts. 
The password will only be available during this session to avoid keychain 
authorization dialogs during development.
```

#### Testing Password Persistence

To test actual password persistence:

1. **Build in Release mode**: 
   - Product → Scheme → Edit Scheme → Run → Build Configuration → Release
2. **Use Archive build**: 
   - Product → Archive (always uses Release configuration)

## Release Signing & Notarization

### Prerequisites

1. **Apple Developer Program membership** ($99/year)
2. **Developer ID Application certificate** in your Keychain
3. **App Store Connect API key** for notarization

### Setting Up Developer ID Certificate

1. Go to [Apple Developer Portal](https://developer.apple.com/account/resources/certificates/list)
2. Create a new certificate → Developer ID → Developer ID Application
3. Download and install the certificate in your Keychain

### Environment Variables

Create a `.env` file in the project root (gitignored):

```bash
# Optional: Specify signing identity (otherwise uses first Developer ID found)
SIGN_IDENTITY="Developer ID Application: Your Name (TEAM123456)"

# App Store Connect API Key for notarization
APP_STORE_CONNECT_API_KEY_P8="-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg...
-----END PRIVATE KEY-----"
APP_STORE_CONNECT_KEY_ID="ABC123DEF4"
APP_STORE_CONNECT_ISSUER_ID="12345678-1234-1234-1234-123456789012"
```

### Creating App Store Connect API Key

1. Go to [App Store Connect](https://appstoreconnect.apple.com/access/api)
2. Click "Generate API Key"
3. Set role to "Developer"
4. Download the `.p8` file
5. Note the Key ID and Issuer ID

### Usage

#### Sign Only (for development)
```bash
./scripts/sign-and-notarize.sh --sign-only
```

#### Sign and Notarize (for distribution)
```bash
./scripts/sign-and-notarize.sh --sign-and-notarize
```

#### Individual Scripts
```bash
# Just code signing
./scripts/codesign-app.sh build/Build/Products/Release/VibeTunnel.app

# Just notarization (requires signed app)
./scripts/notarize-app.sh build/Build/Products/Release/VibeTunnel.app
```

### Script Options

```bash
# Show help
./scripts/sign-and-notarize.sh --help

# Sign and notarize with custom app path
./scripts/sign-and-notarize.sh --app-path path/to/VibeTunnel.app --sign-and-notarize

# Skip stapling (for CI environments)
./scripts/sign-and-notarize.sh --sign-and-notarize --skip-staple

# Don't create ZIP archive
./scripts/sign-and-notarize.sh --sign-and-notarize --no-zip

# Verbose output for debugging
./scripts/sign-and-notarize.sh --sign-and-notarize --verbose
```

### CI/CD Setup (GitHub Actions)

Add these secrets to your GitHub repository:

1. `APP_STORE_CONNECT_API_KEY_P8` - The complete .p8 key content
2. `APP_STORE_CONNECT_KEY_ID` - The Key ID
3. `APP_STORE_CONNECT_ISSUER_ID` - The Issuer ID

The CI workflow automatically uses these for notarization when building on the main branch.

## Troubleshooting

### Development Issues

#### xcconfig Not Working
- Ensure `../apple/Local.xcconfig` exists
- Check that the file isn't committed to git
- Verify the DEVELOPMENT_TEAM value is correct

#### Keychain Dialogs Still Appearing
- Verify you're running in Debug configuration
- Check `DashboardKeychain.swift` implementation
- Ensure you're not in Release mode

### Code Signing Issues

#### "No signing identity found"
- Install Developer ID Application certificate
- Check with: `security find-identity -v -p codesigning`

#### "User interaction is not allowed"
- Unlock keychain: `security unlock-keychain`
- Or use: `security unlock-keychain -p <password> login.keychain`

### Notarization Issues

#### "Invalid API key"
- Verify API key content, ID, and Issuer ID
- Ensure .p8 key includes BEGIN/END lines

#### "App bundle not eligible for notarization"
- Ensure proper code signing with hardened runtime
- Check entitlements configuration

#### "Notarization failed"
- Script shows detailed error messages
- Common issues: unsigned binaries, invalid entitlements, prohibited code

### Verification Commands

```bash
# Verify code signature
codesign --verify --verbose=2 VibeTunnel.app

# Test with Gatekeeper (should pass for notarized apps)
spctl -a -t exec -vv VibeTunnel.app

# Check if notarization ticket is stapled
stapler validate VibeTunnel.app
```

## Reference

### Build Configurations

- **Debug builds**: Use personal development certificate
- **Release builds**: Use Developer ID for distribution
- **CI builds**: Use ad-hoc signing

### File Structure After Signing

```
build/
├── Build/Products/Release/VibeTunnel.app  # Signed and notarized app
├── VibeTunnel-notarized.zip               # Distributable archive
└── VibeTunnel-1.0.0.dmg                   # DMG (if created)
```

### Security Notes

- Never commit signing certificates or API keys
- Use environment variables or secure CI/CD secrets
- The `.env` file is gitignored for security
- API keys should have minimal permissions (Developer role)

### Implementation Details

Debug keychain behavior is in `DashboardKeychain.swift`:
- `getPassword()` returns `nil` in DEBUG builds
- `setPassword()` saves but logs non-persistence
- `hasPassword()` works normally

### External Resources

- [Apple Code Signing Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi)
- [notarytool Documentation](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution/customizing_the_notarization_workflow)
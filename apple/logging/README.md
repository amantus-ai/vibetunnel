# ShellOps Logging Configuration Profile

This directory contains the configuration profile for enabling full debug logging in ShellOps apps.

## What It Does

The `ShellOps-Logging.mobileconfig` profile enables:
- Debug-level logging for both macOS and iOS apps
- Visibility of private data (no more `<private>` tags)
- Persistent logging at debug level

## Installation

### macOS
1. Double-click `ShellOps-Logging.mobileconfig`
2. System Settings will open
3. Go to Privacy & Security → Profiles
4. Click on "ShellOps Debug Logging" 
5. Click "Install..."
6. Enter your password when prompted
7. Restart ShellOps for changes to take effect

### iOS
1. AirDrop or email the `ShellOps-Logging.mobileconfig` to your iOS device
2. Tap the file to open it
3. iOS will prompt to review the profile
4. Go to Settings → General → VPN & Device Management
5. Tap on "ShellOps Debug Logging"
6. Tap "Install" and enter your passcode
7. Restart the ShellOps app

## Verification

After installation, logs should show full details:
```bash
# macOS - using vtlog script
./scripts/vtlog.sh

# iOS - in Xcode console or Console.app
# You should see actual values instead of <private>
```

## Removal

### macOS
1. System Settings → Privacy & Security → Profiles
2. Select "ShellOps Debug Logging"
3. Click the minus (-) button
4. Confirm removal

### iOS
1. Settings → General → VPN & Device Management
2. Tap "ShellOps Debug Logging"
3. Tap "Remove Profile"
4. Enter passcode to confirm

## Security Note

This profile enables detailed logging which may include sensitive information. Only install on development devices and remove when no longer needed for debugging.

## Technical Details

The profile configures logging for all ShellOps subsystems:

### macOS
- `sh.shellops.shellops` - Main macOS app and all components
- `sh.shellops.shellops.debug` - Debug builds
- `sh.shellops.shellops.tests` - Test suite
- `sh.shellops.shellops.tests.debug` - Debug test builds

### iOS
- `sh.shellops.ios` - Main iOS app and all components
- `sh.shellops.ios.tests` - iOS test suite

All subsystems are configured to:
- Enable at Debug level
- Persist at Debug level
- Show private data (no `<private>` redaction)
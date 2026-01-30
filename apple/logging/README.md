# VibeTunnel Logging Configuration Profile

This directory contains the configuration profile for enabling full debug logging in VibeTunnel apps.

## What It Does

The `VibeTunnel-Logging.mobileconfig` profile enables:
- Debug-level logging for both macOS and iOS apps
- Visibility of private data (no more `<private>` tags)
- Persistent logging at debug level

## Installation

### macOS
1. Double-click `VibeTunnel-Logging.mobileconfig`
2. System Settings will open
3. Go to Privacy & Security → Profiles
4. Click on "VibeTunnel Debug Logging" 
5. Click "Install..."
6. Enter your password when prompted
7. Restart VibeTunnel for changes to take effect

### iOS
1. AirDrop or email the `VibeTunnel-Logging.mobileconfig` to your iOS device
2. Tap the file to open it
3. iOS will prompt to review the profile
4. Go to Settings → General → VPN & Device Management
5. Tap on "VibeTunnel Debug Logging"
6. Tap "Install" and enter your passcode
7. Restart the VibeTunnel app

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
2. Select "VibeTunnel Debug Logging"
3. Click the minus (-) button
4. Confirm removal

### iOS
1. Settings → General → VPN & Device Management
2. Tap "VibeTunnel Debug Logging"
3. Tap "Remove Profile"
4. Enter passcode to confirm

## Security Note

This profile enables detailed logging which may include sensitive information. Only install on development devices and remove when no longer needed for debugging.

## Technical Details

The profile configures logging for all VibeTunnel subsystems:

### macOS
- `sh.vibetunnel.vibetunnel` - Main macOS app and all components
- `sh.vibetunnel.vibetunnel.debug` - Debug builds
- `sh.vibetunnel.vibetunnel.tests` - Test suite
- `sh.vibetunnel.vibetunnel.tests.debug` - Debug test builds

### iOS
- `sh.vibetunnel.ios` - Main iOS app and all components
- `sh.vibetunnel.ios.tests` - iOS test suite

All subsystems are configured to:
- Enable at Debug level
- Persist at Debug level
- Show private data (no `<private>` redaction)
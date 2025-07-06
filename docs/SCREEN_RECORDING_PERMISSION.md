# Screen Recording Permission Management in VibeTunnel

## Overview

VibeTunnel implements a sophisticated deferred permission strategy for macOS screen recording permissions. This approach ensures users aren't prompted for permissions immediately on app launch, providing a better onboarding experience where users understand the app's purpose before granting sensitive permissions.

## The Problem

macOS's screen recording permission model is extremely aggressive:
- **ANY** call to `SCShareableContent` APIs triggers the system permission dialog
- This includes innocent operations like checking available windows or displays
- Chrome/Chromium discovered this behavior affects even enumeration-only calls
- Users were getting prompted for screen recording permission before seeing the welcome screen

## Our Solution: Two-Stage Permission Deferral

### Stage 1: Permission Check Without Trigger
- Check `UserDefaults` for evidence of previous successful screen capture
- Never call `SCShareableContent` APIs until explicitly needed
- Welcome screen shows permission as "not granted" unless previously used successfully

### Stage 2: Actual Usage
- Only initialize `ScreencapService` when user requests screen sharing
- First API call will trigger permission dialog if not already granted
- Once granted, mark in `UserDefaults` for future reference

## Implementation Details

### 1. ScreencapService.swift

The service uses lazy singleton initialization with thread safety:

```swift
private static var _shared: ScreencapService?
private static let sharedQueue = DispatchQueue(label: "sh.vibetunnel.screencapservice.shared")

static var shared: ScreencapService {
    sharedQueue.sync {
        if _shared == nil {
            _shared = ScreencapService()
        }
        return _shared!
    }
}
```

Key features:
- WebSocket connection is deferred until first screen capture use
- `isScreenRecordingAllowed()` checks `UserDefaults` first to avoid API calls
- All `SCShareableContent` calls are guarded by permission checks
- `ensureWebSocketConnected()` is called before any screen capture operations

### 2. SystemPermissionManager.swift

Implements a two-method approach for screen recording permissions:

#### Non-Triggering Check (Stage 1)
```swift
private func checkScreenRecordingPermission() async -> Bool {
    // Check UserDefaults for previous successful use
    let hasUsedScreencap = UserDefaults.standard.bool(forKey: "hasSuccessfullyUsedScreencap")
    
    if hasUsedScreencap {
        return true
    }
    
    // Permission status unknown - will be checked when needed
    return false
}
```

#### Explicit Permission Request (Stage 2)
```swift
func checkScreenRecordingPermissionWithPrompt() async -> Bool {
    do {
        // This WILL trigger the permission prompt
        _ = try await SCShareableContent.current
        
        // Mark success in UserDefaults
        UserDefaults.standard.set(true, forKey: "hasSuccessfullyUsedScreencap")
        
        return true
    } catch {
        return false
    }
}
```

### 3. VibeTunnelApp.swift

The app delegate explicitly defers ScreencapService initialization:

```swift
// IMPORTANT: ScreencapService initialization is deferred until needed
// to avoid triggering screen recording permission prompt at startup.
//
// ScreencapService.shared will be lazily initialized when:
// - User grants screen recording permission in welcome/settings
// - User starts screen sharing
// - Any feature requiring screen capture is accessed
```

### 4. ServerManager.swift

No longer initializes ScreencapService at server startup:

```swift
if AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.enableScreencapService) {
    logger.info("📸 Screencap service enabled, but initialization deferred until first use")
    logger.info("📸 Screen recording permission will be requested when screen capture is first accessed")
}
```

## User Experience Flow

1. **App Launch**: No permission prompts appear
2. **Welcome Screen**: Shows screen recording as "not granted" (unless previously used)
3. **User Clicks Grant**: Opens System Settings (no API calls yet)
4. **User Grants in Settings**: Permission is granted in macOS
5. **User Uses Screen Sharing**: First API call verifies permission and marks success
6. **Future Launches**: Permission shows as granted based on UserDefaults

## API Behavior

When screen capture APIs are called without permission:
- `getDisplays()` and `getProcessGroups()` ensure WebSocket connection first
- If no permission, appropriate error is returned
- Frontend can handle permission errors gracefully

## Chrome's Advanced Approach (For Reference)

Chrome uses method swizzling to intercept private APIs:
```objc
// Simplified concept
@objc dynamic func swizzled_CGRequestScreenCaptureAccess() -> Bool {
    if (isJustEnumerating) {
        return true; // Don't trigger prompt
    }
    return original_CGRequestScreenCaptureAccess();
}
```

However, this approach:
- Uses private APIs that could break in future macOS versions
- Wouldn't pass App Store review
- Requires runtime method swizzling

Our approach is App Store compliant and follows Apple's intended permission model.

## Testing

To test the permission flow:
1. Remove VibeTunnel from System Settings > Privacy & Security > Screen Recording
2. Delete the app's preferences: `defaults delete sh.vibetunnel.vibetunnel`
3. Launch the app - no permission prompt should appear
4. Navigate through welcome screens - still no prompt
5. Click "Grant Screen Recording Permission" - opens Settings
6. Grant permission in Settings
7. Use screen sharing - permission is verified and marked as granted

## Troubleshooting

### Permission Dialog Appears Too Early
- Check for any code calling `ScreencapService.shared` during initialization
- Ensure no `SCShareableContent` APIs are called in view `onAppear` methods
- Verify `SystemPermissionManager` is using the non-triggering check method

### Permission Not Detected After Granting
- Ensure the user actually uses a screen capture feature after granting
- Check that `UserDefaults` key `hasSuccessfullyUsedScreencap` is being set
- Verify the app has permission to write to UserDefaults

### WebSocket Connection Issues
- ScreencapService now defers WebSocket connection until first use
- Check logs for "WebSocket connection deferred until screen capture is needed"
- Ensure server is running before screen capture is attempted

## Future Improvements

1. **Capability Detection**: Implement a way to detect if permission was granted without calling SCShareableContent
2. **Permission State Sync**: Better synchronization between Settings changes and app state
3. **Graceful Degradation**: Provide limited functionality when permission is not granted
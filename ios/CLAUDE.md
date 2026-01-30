# CLAUDE.md - iOS App

This file provides guidance to Claude Code when working with the iOS companion app for VibeTunnel.

## Project Overview

The iOS app is a companion application to VibeTunnel that allows viewing and managing terminal sessions from iOS devices.

## Development Setup

1. Open the project in Xcode:
```bash
open ios/VibeTunnel-iOS.xcodeproj
```

2. Select your development team in project settings
3. Build and run on simulator or device

## Architecture

- SwiftUI for the user interface
- WebSocket client for real-time terminal data
- Shared protocol definitions with macOS app

## Key Files

- `VibeTunnelApp.swift` - Main app entry point
- `ContentView.swift` - Primary UI
- `TerminalView.swift` - Terminal display component
- `WebSocketClient.swift` - Server communication

## Building

```bash
# Build for simulator
xcodebuild -project VibeTunnel-iOS.xcodeproj -scheme VibeTunnel -sdk iphonesimulator

# Build for device
xcodebuild -project VibeTunnel-iOS.xcodeproj -scheme VibeTunnel -sdk iphoneos
```

## Testing

```bash
# Run tests
xcodebuild test -project VibeTunnel-iOS.xcodeproj -scheme VibeTunnel -destination 'platform=iOS Simulator,name=iPhone 15'
```

## Viewing Logs

Use the provided script to view iOS app logs with unredacted private data:

```bash
# View all logs
./ios/scripts/vtlog.sh

# Filter by category
./ios/scripts/vtlog.sh -c NetworkManager

# Follow logs in real-time
./ios/scripts/vtlog.sh -f

# Search for specific terms
./ios/scripts/vtlog.sh -s "connection"
```

If prompted for password when viewing logs, see [apple/docs/logging-private-fix.md](../apple/docs/logging-private-fix.md) for setup instructions.

## Common Issues

### Simulator Connection Issues
- Ensure the Mac app server is running
- Check that simulator can reach localhost:4020
- Verify no firewall blocking connections

### Device Testing
- Device must be on same network as Mac
- Use Mac's IP address instead of localhost
- Check network permissions in iOS settings
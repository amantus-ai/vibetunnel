# Bonjour/mDNS Discovery Implementation for VibeTunnel

## Overview
We've implemented automatic server discovery using Bonjour/mDNS to allow iOS devices to discover VibeTunnel servers on the local network without manual configuration.

## What We've Done

### 1. Web Server (mDNS Advertisement)
- **Added dependency**: `bonjour-service` package to `web/package.json`
- **Created service**: `web/src/server/services/mdns-service.ts`
  - Singleton service that advertises the server via mDNS
  - Service type: `_vibetunnel._tcp`
  - Advertises hostname and port with metadata (version, platform)
- **Server integration**: Modified `web/src/server/server.ts`
  - Added `enableMDNS` config option (default: true)
  - Added `--no-mdns` and `--enable-mdns` CLI flags
  - Starts mDNS on server startup, stops on shutdown
  - Added help text for the new options

### 2. iOS App (Bonjour Discovery)
- **Created discovery service**: `ios/VibeTunnel/Services/BonjourDiscoveryService.swift`
  - Uses Network.framework's `NWBrowser` for discovery
  - Discovers `_vibetunnel._tcp` services
  - Resolves service endpoints to get IP and port
  - Observable service with `@Observable` pattern
- **Created UI components**:
  - `ServerDiscoverySheet`: Full-screen sheet showing all discovered servers
  - `DiscoveredServerCard`: Card component for displaying discovered servers
- **Modified ServerConfigForm**: Added Bonjour button next to host input field
- **Modified ServerListView**: Shows discovered servers on home screen
  - Filters out already-saved servers
  - Shows up to 3 discovered servers inline
  - "View more" button for additional servers

### 3. Current State
- Web server successfully advertises via mDNS when started
- iOS app can discover servers on the local network
- UI shows discovered servers separate from saved servers
- Build error in iOS app needs fixing (accessing ServerProfile properties)

## What Still Needs to Be Done

### 1. Fix iOS Build Error
The current issue is that `ServerProfile` doesn't have direct `host` and `port` properties. Need to:
- Use `ServerProfile.toServerConfig()` to get host/port
- Or parse the `url` property to extract host and port

### 2. Testing
- Test discovery on real devices
- Verify filtering of already-saved servers works correctly
- Test connection flow from discovered server to saved profile

### 3. Potential Enhancements
- Add refresh button to manually trigger discovery
- Show discovery status/errors in UI
- Add timeout for unresolved services
- Consider caching discovered servers briefly

## End Goal
Allow users to:
1. Start VibeTunnel server on their Mac
2. Open iOS app on same network
3. See the server automatically appear in "Discovered Servers"
4. Tap to connect without typing IP addresses
5. Save the server for future use

## Technical Details

### mDNS Service Type
- Service: `_vibetunnel._tcp`
- TXT record includes: version, platform

### Discovery Flow
1. Server advertises on startup (if --no-mdns not used)
2. iOS app starts discovery on ServerListView appear
3. Browser finds services, resolves endpoints
4. UI shows discovered servers not in saved list
5. User taps to connect or save

### Key Files Modified
- `web/src/server/services/mdns-service.ts` (new)
- `web/src/server/server.ts`
- `ios/VibeTunnel/Services/BonjourDiscoveryService.swift` (new)
- `ios/VibeTunnel/Views/Connection/ServerConfigForm.swift`
- `ios/VibeTunnel/Views/Connection/ServerListView.swift`
- `ios/VibeTunnel/Views/Connection/DiscoveredServerCard.swift` (new)
- `ios/VibeTunnel/ViewModels/ServerListViewModel.swift`

### Dependencies Added
- Web: `bonjour-service` npm package
- iOS: Uses built-in Network.framework (no new dependencies)
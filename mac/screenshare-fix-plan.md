# VibeTunnel Screen Share Fix Plan (Optimized)
**Last Updated**: 2025-07-05 18:45 UTC

## Mission: Get VNC Screen Sharing Working Autonomously
Work autonomously until proper screen sharing (VNC screen sharing) is working:
1. Run Mac app using XcodeBuildMCP in debug mode (ensure no duplicates)
2. Open browser via Playwright to localhost:4020
3. Navigate to screen sharing feature
4. Select the smallest screen (Built-in Retina Display)
5. Monitor logs to verify video transmission
6. If issues arise:
   - Use Zen MCP with O3 Pro model for code analysis
   - Use Peekaboo for visual debugging
   - Use Gemini for additional review
7. Fix bugs and restart (clear Xcode cache if needed)
8. Repeat until both WebRTC and JPEG modes work reliably
9. Test screen switching and individual app window sharing

**CRITICAL**: Only kill Mac app (sh.vibetunnel.vibetunnel.debug), NEVER kill vibetunnel node processes!

### Critical: Xcode Builds Include Web Server
**When building with XcodeBuildMCP, the web server is automatically built!**
- Xcode build scripts handle TypeScript compilation
- No need to manually run `pnpm run build`
- Everything is embedded in the Mac app bundle
- Only rebuild web manually when testing web-only changes

### Progress Summary
✅ **Major Progress**: Screen capture is almost fully functional!
- Fixed all threading issues - API processing runs on background threads
- Fixed buffer underflow issue in UnixSocketConnection that was causing /processes timeout
- Fixed double JSON parsing issue in WebRTCManager
- Fixed TypeScript compilation errors
- Icon caching implemented for better performance
- /processes endpoint now loads with all windows
- Fixed WebRTC parameter issue (webrtc: true)
- Fixed capture initialization flow
- Fixed authentication with proper WebSocket client usage

### Current State
The screen capture interface is functional:
- ✅ Process list loads with all windows from all apps
- ✅ Display list shows available screens
- ✅ UI improvements: Full-width window items with 2-line titles and tooltips
- ✅ Sidebar toggle moved to left side (before title) for better UX
- ✅ WebRTC offer/answer flow fixed - Mac app creates offer, browser creates answer
- ✅ Unix socket busy loop fixed - no more 100% CPU usage
- ✅ Web assets built and bundled correctly
- ✅ Screen recording permissions fixed - restarting app picked up granted permissions
- ✅ Package.swift WebRTC dependency reverted to steipete/WebRTC (user confirmed it's correct)
- ✅ Production app has screencap.js bundle deployed
- ✅ Fixed Package.swift manifest (WebRTC dependency and macOS version)
- ✅ Server running on port 4020 with local auth token
- ✅ Screencap API accessible at /api/screencap with authentication
- ✅ WebSocket connection works - Mac app is connected via UNIX socket
- ✅ WebRTC connection established successfully (via Playwright testing)
- ✅ **Fixed WebRTC parameter issue**: Was sending `useWebRTC: false` instead of `webrtc: true`
- ✅ **Fixed capture initialization**: Now sends /capture request before starting WebRTC
- ✅ **Fixed authentication**: Using proper WebSocket client methods that include session IDs
- ⏳ **IN PROGRESS**: WebRTC video transmission implementation
  - WebRTC peer connection establishes successfully
  - ICE candidates exchange works
  - Parameter and authentication issues fixed
  - Next step: Implement frame routing from ScreenCaptureKit to WebRTC

### Key Learnings

1. **Threading is Critical**
   - Main thread was being blocked by synchronous API processing
   - Solution: Made `processApiRequest` nonisolated and wrapped calls in Task {}
   - Icon loading was the main bottleneck - now cached

2. **Buffer Management**
   - TCP stream messages need careful offset calculation
   - Used `distance(from:to:)` instead of direct index usage
   - Multiple messages can arrive in one buffer - must handle correctly

3. **WebRTC Offer/Answer Flow**
   - Mac app should create the offer, not the browser
   - Browser was incorrectly creating offer after sending start-capture
   - Fixed: Browser now waits for offer from Mac app
   - Browser responds with answer when it receives the offer

4. **Development Loop Optimization**
   - Using XcodeBuildMCP is the right approach (not manual runs)
   - Running app in background with & speeds up the loop
   - Custom logging script (vtlog.sh) now supports private data with -p flag

5. **WebRTC Parameter Fix**
   - Was sending `useWebRTC: false` instead of `webrtc: true`
   - Fixed in client code to send correct parameter format
   - Server now properly routes WebRTC requests

6. **Authentication Fix**
   - WebSocket requests must include session ID for authentication
   - Fixed by using `wsClient.request()` instead of raw WebSocket sends
   - This includes proper authentication headers automatically

### Applied WebRTC Fixes
1. **Removed offer creation from browser** (web/src/client/services/webrtc-handler.ts:177-179)
   - Browser now waits for Mac app to send offer
   - Removed createAndSendOffer() method entirely

2. **Added offer handling in browser** (web/src/client/services/webrtc-handler.ts:214-237)
   - Browser receives offer from Mac app
   - Sets remote description
   - Creates and sends answer back
   - Configures bitrate after connection

3. **Fixed Mac app to create offer before sending** (mac/VibeTunnel/Core/Services/WebRTCManager.swift)
   - Mac app now creates video track and peer connection before sending offer
   - Fixed "Unknown signal type" error

### Additional Fixes Applied Since Last Update
1. **Fixed Unix socket busy loop** (mac/VibeTunnel/Core/Services/UnixSocketConnection.swift:87)
   - Added connection check to prevent tight loop when connection is nil
   - Added defensive delay to prevent CPU spinning

2. **Built and deployed web assets** 
   - Ran build-web-frontend.sh to compile TypeScript and bundle assets
   - Fixed 404 errors for bundle files

3. **Reverted WebRTC dependency**
   - Changed back to steipete/WebRTC in Package.swift (user confirmed it's correct)
   - Cleaned up Package.resolved

4. **Fixed WebRTC Parameter Issue** (web/src/client/services/webrtc-handler.ts)
   - Was sending `useWebRTC: false` instead of `webrtc: true`
   - Fixed parameter format in start-capture request
   - Now correctly indicates WebRTC mode to server

5. **Fixed WebRTC Capture Initialization** (web/src/client/services/webrtc-handler.ts)
   - Now properly sends /capture request before starting WebRTC
   - Ensures screen capture is initialized before peer connection
   - Fixed timing issue where WebRTC started before capture was ready

6. **Fixed Authentication Issue** (web/src/client/services/webrtc-handler.ts)
   - Replaced raw WebSocket sends with `wsClient.request()`
   - This properly includes session ID for authentication
   - Fixed "Unauthorized" errors on API requests

## Quick Status Check
```bash
# Check if screen sharing is working
./scripts/vtlog.sh -p -c ScreencapService -n 20
./scripts/vtlog.sh -p -s "session|capture" -n 20
```

## Fast Testing Loop with XcodeBuildMCP

### CRITICAL: NEVER Restart App Directly!
**⚠️ NEVER use `pkill` and `open` to restart VibeTunnel!**
- The Mac app builds and embeds the web server during the Xcode build process
- Simply restarting the app will serve a STALE, CACHED version of the server
- You MUST clean and rebuild to get the latest server code

### 1. Build and Run in Background
```bash
# CRITICAL: ALWAYS clean and rebuild - NEVER just restart the app!
# The app builds the server, so rebuilding is REQUIRED for any changes

# Step 1: Clean to remove all cached builds
mcp__XcodeBuildMCP__clean_proj(
  projectPath="/Users/steipete/Projects/vibetunnel/mac/VibeTunnel-Mac.xcodeproj",
  scheme="VibeTunnel-Mac"
)

# Step 2: Build and run (this rebuilds the embedded server)
mcp__XcodeBuildMCP__build_run_mac_proj(
  projectPath="/Users/steipete/Projects/vibetunnel/mac/VibeTunnel-Mac.xcodeproj",
  scheme="VibeTunnel-Mac",
  configuration="Debug"
)
```

### 2. Monitor Logs
```bash
# In another terminal - watch logs with private data visible
cd /Users/steipete/Projects/vibetunnel/mac
./scripts/vtlog.sh -p -f | grep -E "session|capture|WebRTC"
```

### 3. Test with Playwright MCP
```bash
# Use non-headless mode to see what's happening
mcp__playwright__browser_navigate(url="http://localhost:4020/api/screencap")
```

## Architecture Summary
```
Browser → WebSocket → Server → UNIX Socket → Mac App
         (/api/screencap)    (~/.vibetunnel/screencap.sock)

API Flow:
1. Browser: wsClient.request('GET', '/processes')
2. Server: Forwards to Mac via UNIX socket  
3. Mac: WebRTCManager.processApiRequest() handles it
4. Mac: Returns data via UNIX socket
5. Server: Forwards response to browser
6. Browser: Updates UI with process list

WebRTC Flow:
1. Browser: WebRTC handler generates session ID
2. Browser: Sends start-capture with session ID
3. Mac: Receives signal and starts capture
4. WebRTC: Negotiation begins with offer/answer
```

## Key Files & Fixes Applied

### Threading & Performance
- `/mac/VibeTunnel/Core/Services/WebRTCManager.swift:286` - Made processApiRequest nonisolated
- `/mac/VibeTunnel/Core/Services/ScreencapService.swift:47` - Added icon caching

### Buffer & Protocol Fixes  
- `/mac/VibeTunnel/Core/Services/UnixSocketConnection.swift:126` - Fixed buffer offset calculation
- `/mac/VibeTunnel/Core/Services/WebRTCManager.swift:150` - Fixed double JSON parsing

### Frontend Fixes
- `/web/src/client/services/webrtc-handler.ts:177-179` - Removed incorrect offer creation
- `/web/src/client/services/webrtc-handler.ts:214-237` - Added proper offer handling
- `/web/src/client/components/screencap-sidebar.ts:180` - Full-width window items
- `/web/src/client/components/screencap-view.ts:578-586` - Moved sidebar toggle to left
- Fixed multiple TypeScript compilation errors

## UI Improvements Applied
- Window items now use full width (removed left padding)
- Window titles display on 2 lines with proper text wrapping
- Tooltips show full window title on hover
- Improved visual hierarchy and spacing

## Current Investigation: WebRTC Video Not Transmitting

### Problem Analysis
1. **WebRTC Connection Works**:
   - Peer connection established successfully
   - ICE candidates exchanged properly
   - Offer/answer flow completed
   - Connection state is "connected"

2. **But No Video Data**:
   - 0 bps bitrate reported by client
   - 0×0 resolution for video track
   - UNKNOWN codec reported
   - Client continuously logs "Adjusting bitrate: 0 -> 0"

3. **Code Flow Traced**:
   - Client: `webrtc-handler.ts` starts capture → sends "start-capture" signal
   - Server: Forwards signal via UNIX socket to Mac app
   - Mac: `WebRTCManager` receives signal → calls `startCapture()`
   - Mac: `ScreencapService.startCapture()` should start feeding frames
   - **MISSING**: Connection between ScreenCaptureKit frames and WebRTC video source

4. **Key Findings**:
   - Fixed parameter issue: Was sending `useWebRTC: false` instead of `webrtc: true`
   - `WebRTCManager.processVideoFrame()` exists to convert CMSampleBuffer to RTCVideoFrame
   - But nothing appears to be calling this method
   - `ScreencapService.startWebRTCCapture()` method needs implementation
   - The frame routing pipeline from ScreenCaptureKit → WebRTCManager is not connected

## Next Steps
1. ❌ **IMMEDIATE**: Implement WebRTC video frame feeding
   - The core issue is that the frame routing pipeline is not implemented
   - Need to connect ScreenCaptureKit output handler to WebRTCManager.processVideoFrame
   - Ensure proper threading and buffer conversion
   - Verify the video source is properly connected to the video track
2. ⏳ Test screen capture with Built-in Retina Display
3. ⏳ Verify WebRTC video streaming works
4. ⏳ Test screen switching functionality
5. ⏳ Test individual app window sharing
6. ⏳ Monitor performance and quality

## Status: Frame Routing Implemented, State Machine Issue Found

### ✅ Fixed Issues:
1. **WebRTC Parameter Issue**: Fixed sending `webrtc: true` instead of `useWebRTC: false`
2. **Capture Initialization**: Now properly sends /capture request before starting WebRTC
3. **Authentication Issue**: Fixed by using proper WebSocket client methods with session IDs
4. **WebRTC Connection**: Peer connection establishes successfully with proper offer/answer flow
5. **Unix Socket Communication**: Fixed buffer underflow and busy loop issues
6. **UI/UX Improvements**: Process list loads, sidebar toggle improved, full-width window items
7. **Frame Routing**: Already properly implemented - frames route from ScreenCaptureKit to WebRTC via `processVideoFrameSync`

### ⏳ What's Working:
- Screen capture interface loads and displays all windows/screens
- WebRTC peer connection establishes successfully
- ICE candidate exchange works properly
- Authentication and API requests work correctly
- Unix socket communication is stable
- Frame routing pipeline is properly connected

### ❌ Current Issue - State Machine Not Ready:
- **Error**: "Cannot start capture in state: <private>" 
- **Root Cause**: ScreencapService state machine is not in `ready` state
- **Why**: The service is stuck in `connecting` or `error` state
- **Investigation Results**:
  - Server is running with `--no-auth` (authentication disabled)
  - ScreencapService expects a local auth token but none is available
  - State transition path: `idle` → `connecting` → `ready` (via connectionEstablished)
  - Without auth token, service never reaches `ready` state
  - The `/displays` API is also failing with ScreencapError Code=7

### 🔍 Key Discovery:
The frame routing from ScreenCaptureKit to WebRTC is already properly implemented in the code. The issue is that the ScreencapService's state machine never reaches the `ready` state needed to allow capture to start. This is due to the authentication configuration mismatch between the server (no-auth) and the screencap service (expecting auth token).

## Common Commands
```bash
# Kill Mac app only (NOT node processes!)
pkill -f "VibeTunnel.app/Contents/MacOS/VibeTunnel"

# Rebuild web (if frontend changes)
cd web && pnpm run build

# Check socket exists
ls -la ~/.vibetunnel/screencap.sock

# View logs with private data
./scripts/vtlog.sh -p -f
```
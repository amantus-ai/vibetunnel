# VibeTunnel Screen Share Fix Plan (Optimized)

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

## Status Update - 2025-07-05 16:15

### Important: Always Use Subtasks
**ALWAYS use the Task tool for operations, not just when hitting context limits:**
- For ANY command that might generate output (builds, logs, searches)
- For parallel operations (checking multiple files, running tests)
- For exploratory work (finding implementations, debugging issues)
- This keeps main context clean and improves organization

Example: Instead of running commands directly:
```
Task(description="Build web bundle", prompt="Run pnpm run build in the web directory and report if it succeeded or any errors")
Task(description="Check logs", prompt="Run ./scripts/vtlog.sh -n 50 and summarize any WebRTC errors")
```

### Critical: Xcode Builds Include Web Server
**When building with XcodeBuildMCP, the web server is automatically built!**
- Xcode build scripts handle TypeScript compilation
- No need to manually run `pnpm run build`
- Everything is embedded in the Mac app bundle
- Only rebuild web manually when testing web-only changes

### Progress Summary
✅ **Major Progress**: Screen capture sources are now loading successfully!
- Fixed all threading issues - API processing runs on background threads
- Fixed buffer underflow issue in UnixSocketConnection that was causing /processes timeout
- Fixed double JSON parsing issue in WebRTCManager
- Fixed TypeScript compilation errors
- Icon caching implemented for better performance
- /processes endpoint now loads with all windows

### Current State
The screen capture interface is functional:
- ✅ Process list loads with all windows from all apps
- ✅ Display list shows available screens
- ✅ UI improvements: Full-width window items with 2-line titles and tooltips
- ✅ Sidebar toggle moved to left side (before title) for better UX
- ✅ WebRTC offer/answer flow fixed - Mac app creates offer, browser creates answer
- ✅ Unix socket busy loop fixed - no more 100% CPU usage
- ✅ Web assets built and bundled correctly
- ⚠️ Screen recording permissions shown as granted but still getting -3801 error
- ⚠️ Package.swift WebRTC dependency reverted to steipete/WebRTC (user confirmed it's correct)

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

## Quick Status Check
```bash
# Check if screen sharing is working
./scripts/vtlog.sh -p -c ScreencapService -n 20
./scripts/vtlog.sh -p -s "session|capture" -n 20
```

## Fast Testing Loop with XcodeBuildMCP

### 1. Build and Run in Background
```bash
# Use XcodeBuildMCP to build and run (auto-kills old instance)
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

## Next Steps
1. ✅ Fix session ID generation in WebRTC handler
2. ✅ Fix WebRTC offer/answer flow
3. ✅ Fix Unix socket busy loop
4. ✅ Build and bundle web assets
5. ⏳ Resolve screen recording permissions issue (error -3801)
6. Test screen capture with Built-in Retina Display
7. Verify WebRTC video streaming works
8. Test screen switching functionality
9. Test individual app window sharing
10. Monitor performance and quality

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
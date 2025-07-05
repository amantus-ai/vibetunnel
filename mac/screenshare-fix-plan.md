# VibeTunnel Screen Share Fix Plan (Optimized)

## Status Update - 2025-07-05

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
- ❌ WebRTC capture not starting - missing session ID in start-capture signal

### Key Learnings

1. **Threading is Critical**
   - Main thread was being blocked by synchronous API processing
   - Solution: Made `processApiRequest` nonisolated and wrapped calls in Task {}
   - Icon loading was the main bottleneck - now cached

2. **Buffer Management**
   - TCP stream messages need careful offset calculation
   - Used `distance(from:to:)` instead of direct index usage
   - Multiple messages can arrive in one buffer - must handle correctly

3. **Session ID Management**
   - WebRTC requires session ID for all signaling messages
   - Session ID must be generated before sending start-capture signal
   - WebSocket client has the logic but WebRTC handler wasn't using it

4. **Development Loop Optimization**
   - Using XcodeBuildMCP is the right approach (not manual runs)
   - Running app in background with & speeds up the loop
   - Custom logging script (vtlog.sh) now supports private data with -p flag

### Next Immediate Fix
The WebRTC handler needs to generate a session ID before sending the start-capture signal:
```typescript
// Generate session ID if not already present
if (!this.wsClient.sessionId) {
  this.wsClient.sessionId = crypto.randomUUID();
}
```

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
- `/web/src/client/services/webrtc-handler.ts:59` - Need to generate session ID
- `/web/src/client/components/screencap-sidebar.ts:180` - Full-width window items
- Fixed multiple TypeScript compilation errors

## UI Improvements Applied
- Window items now use full width (removed left padding)
- Window titles display on 2 lines with proper text wrapping
- Tooltips show full window title on hover
- Improved visual hierarchy and spacing

## Next Steps
1. ✅ Fix session ID generation in WebRTC handler
2. Test screen capture with Built-in Retina Display
3. Verify WebRTC video streaming works
4. Test screen switching functionality
5. Test individual app window sharing
6. Monitor performance and quality

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
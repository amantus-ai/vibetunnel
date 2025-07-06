# Screen Capture (Screencap) Feature

## Overview

VibeTunnel's screen capture feature allows users to share their Mac screen and control it remotely through a web browser. The implementation uses WebRTC for high-performance video streaming with low latency and WebSocket/UNIX socket for secure control messages.

## Architecture

### Architecture Diagram

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│   Browser   │                    │   Server    │                    │   Mac App   │
│  (Client)   │                    │ (Port 4020) │                    │ (VibeTunnel)│
└─────┬───────┘                    └──────┬──────┘                    └──────┬──────┘
      │                                    │                                   │
      │  1. Connect WebSocket              │                                   │
      ├───────────────────────────────────►│                                   │
      │  /ws/screencap-signal (auth)       │                                   │
      │                                    │                                   │
      │                                    │  2. Connect UNIX Socket           │
      │                                    │◄──────────────────────────────────┤
      │                                    │  ~/.vibetunnel/screencap.sock    │
      │                                    │                                   │
      │  3. Request window list            │                                   │
      ├───────────────────────────────────►│  4. Forward request               │
      │  {type: 'api-request',             ├──────────────────────────────────►│
      │   method: 'GET',                   │                                   │
      │   endpoint: '/processes'}          │                                   │
      │                                    │                                   │
      │                                    │  5. Return window data            │
      │  6. Receive window list            │◄──────────────────────────────────┤
      │◄───────────────────────────────────┤  {type: 'api-response',          │
      │                                    │   result: [...]}                  │
      │                                    │                                   │
      │  7. Start capture request          │                                   │
      ├───────────────────────────────────►│  8. Forward to Mac               │
      │                                    ├──────────────────────────────────►│
      │                                    │                                   │
      │                                    │  9. WebRTC Offer                 │
      │  10. Receive Offer                 │◄──────────────────────────────────┤
      │◄───────────────────────────────────┤                                   │
      │                                    │                                   │
      │  11. Send Answer                   │  12. Forward Answer              │
      ├───────────────────────────────────►├──────────────────────────────────►│
      │                                    │                                   │
      │  13. Exchange ICE candidates       │  (Server relays ICE)             │
      │◄──────────────────────────────────►│◄─────────────────────────────────►│
      │                                    │                                   │
      │                                    │                                   │
      │  14. WebRTC P2P Connection Established                                 │
      │◄═══════════════════════════════════════════════════════════════════════►│
      │         (Direct video stream, no server involved)                      │
      │                                    │                                   │
      │  15. Mouse/Keyboard events         │  16. Forward events              │
      ├───────────────────────────────────►├──────────────────────────────────►│
      │  {type: 'api-request',             │                                   │
      │   method: 'POST',                  │                                   │
      │   endpoint: '/click'}              │                                   │
      │                                    │                                   │
```

### Components

1. **ScreencapService** (`mac/VibeTunnel/Core/Services/ScreencapService.swift`)
   - Singleton service that manages screen capture functionality
   - Uses ScreenCaptureKit for capturing screen/window content
   - Manages capture sessions and processes video frames
   - Provides API endpoints for window/display enumeration and control
   - Supports process grouping with app icons

2. **WebRTCManager** (`mac/VibeTunnel/Core/Services/WebRTCManager.swift`)
   - Manages WebRTC peer connections
   - Handles signaling via UNIX socket (not WebSocket)
   - Processes video frames from ScreenCaptureKit
   - Supports H.264 and VP8 video codecs (VP8 prioritized for compatibility)
   - Implements session-based security for control operations
   - Adaptive bitrate control (1-50 Mbps) based on network conditions
   - Supports 4K and 8K quality modes

3. **Web Frontend** (`web/src/client/components/screencap-view.ts`)
   - LitElement-based UI for screen capture
   - WebRTC client for receiving video streams
   - API client for controlling capture sessions
   - Session management for secure control operations
   - Touch support for mobile devices

4. **UNIX Socket Handler** (`web/src/server/websocket/screencap-unix-handler.ts`)
   - Manages UNIX socket at `~/.vibetunnel/screencap.sock`
   - Facilitates WebRTC signaling between Mac app and browser
   - Routes API requests between browser and Mac app
   - No authentication needed for local UNIX socket

### Communication Flow

```
Browser <--WebSocket--> Node.js Server <--UNIX Socket--> Mac App
        <--WebRTC P2P--------------------------------->
```

1. Browser connects to `/ws/screencap-signal` with JWT auth
2. Mac app connects via UNIX socket at `~/.vibetunnel/screencap.sock`
3. Browser requests screen capture via API
4. Mac app creates WebRTC offer and sends through signaling
5. Browser responds with answer
6. P2P connection established for video streaming

## Features

### Capture Modes

- **Desktop Capture**: Share entire display(s)
- **Window Capture**: Share specific application windows  
- **Multi-display Support**: Handle multiple monitors (-1 index for all displays)
- **Process Grouping**: View windows grouped by application with icons

### Security Model

#### Authentication Flow

1. **Browser → Server**: JWT token in WebSocket connection
2. **Mac App → Server**: Local UNIX socket connection (no auth needed - local only)
3. **No Direct Access**: All communication goes through server relay

#### Session Management

- Each capture session has unique ID for security
- Session IDs are generated by the browser client
- Control operations (click, key, capture) require valid session
- Session is validated on each control operation
- Session is cleared when capture stops

#### Eliminated Vulnerabilities

Previously, the Mac app ran an HTTP server on port 4010:
```
❌ OLD: Browser → HTTP (no auth) → Mac App:4010
✅ NEW: Browser → WebSocket (auth) → Server → UNIX Socket → Mac App
```

This eliminates:
- Unauthenticated local access
- CORS vulnerabilities
- Open port exposure

### Video Quality

- **Codec Support**: 
  - VP8 (prioritized for browser compatibility)
  - H.264/AVC (secondary)
- **Resolution Options**:
  - 4K (3840x2160) - Default
  - 8K (7680x4320) - Optional high quality mode
- **Frame Rate**: 60 FPS target
- **Adaptive Bitrate**: 
  - Starts at 40 Mbps
  - Adjusts between 1-50 Mbps based on:
    - Packet loss (reduces bitrate if > 2%)
    - Round-trip time (reduces if > 150ms)
    - Network conditions (increases in good conditions)
- **Hardware Acceleration**: Uses VideoToolbox for efficient encoding
- **Low Latency**: < 50ms typical latency

## Message Protocol

### API Request/Response

Browser → Server → Mac:
```json
{
  "type": "api-request",
  "requestId": "uuid",
  "method": "GET|POST",
  "endpoint": "/processes|/displays|/capture|/click|/key",
  "params": { /* optional */ },
  "sessionId": "session-uuid"
}
```

Mac → Server → Browser:
```json
{
  "type": "api-response",
  "requestId": "uuid",
  "result": { /* success data */ },
  "error": "error message if failed"
}
```

### WebRTC Signaling

Standard WebRTC signaling messages:
- `start-capture`: Initiate screen sharing
- `offer`: SDP offer from Mac
- `answer`: SDP answer from browser
- `ice-candidate`: ICE candidate exchange
- `mac-ready`: Mac app ready for capture

## API Endpoints (via WebSocket)

All API requests are sent through the WebSocket connection as `api-request` messages:

### GET /displays
Returns list of available displays:
```json
{
  "displays": [
    {
      "id": "NSScreen-1",
      "width": 1920,
      "height": 1080,
      "scaleFactor": 2.0,
      "name": "Built-in Display"
    }
  ]
}
```

### GET /processes
Returns process groups with windows and app icons:
```json
{
  "processes": [
    {
      "name": "Terminal",
      "pid": 456,
      "icon": "base64-encoded-icon",
      "windows": [
        {
          "cgWindowID": 123,
          "title": "Terminal — bash",
          "ownerName": "Terminal",
          "ownerPID": 456,
          "x": 0, "y": 0,
          "width": 1920, "height": 1080,
          "isOnScreen": true
        }
      ]
    }
  ]
}
```

### POST /capture
Starts desktop capture:
```json
// Request
{
  "type": "desktop",
  "index": 0,  // Display index or -1 for all displays
  "webrtc": true,
  "use8k": false
}

// Response
{
  "status": "started",
  "type": "desktop",
  "webrtc": true,
  "sessionId": "uuid"
}
```

### POST /capture-window
Starts window capture:
```json
// Request
{
  "cgWindowID": 123,
  "webrtc": true,
  "use8k": false
}

// Response
{
  "status": "started",
  "cgWindowID": 123,
  "webrtc": true,
  "sessionId": "uuid"
}
```

### POST /stop
Stops capture and clears session:
```json
{
  "status": "stopped"
}
```

### POST /click, /mousedown, /mouseup, /mousemove
Sends mouse events (requires session):
```json
{
  "x": 500,  // 0-1000 normalized range
  "y": 500   // 0-1000 normalized range
}
```

### POST /key
Sends keyboard events (requires session):
```json
{
  "key": "a",
  "metaKey": false,
  "ctrlKey": false,
  "altKey": false,
  "shiftKey": true
}
```

### GET /frame
Get current frame as JPEG (for non-WebRTC mode):
```json
{
  "frame": "base64-encoded-jpeg"
}
```

## Implementation Details

### UNIX Socket Connection

The Mac app connects to the server via UNIX socket instead of WebSocket:

1. **Socket Path**: `~/.vibetunnel/screencap.sock`
2. **Shared Connection**: Uses `SharedUnixSocketManager` for socket management
3. **Message Routing**: Messages are routed between browser WebSocket and Mac UNIX socket
4. **No Authentication**: Local UNIX socket doesn't require authentication

### WebRTC Implementation

1. **Video Processing**: 
   - `processVideoFrameSync` method handles CMSampleBuffer without data races
   - Frames are converted to RTCVideoFrame with proper timestamps
   - First frame and periodic frames are logged for debugging

2. **Codec Configuration**:
   - VP8 is prioritized over H.264 in SDP for better compatibility
   - Bandwidth constraints added to SDP (b=AS:bitrate)
   - Codec reordering happens during peer connection setup

3. **Stats Monitoring**:
   - Stats collected every 2 seconds when connected
   - Monitors packet loss, RTT, and bytes sent
   - Automatically adjusts bitrate based on conditions

### Coordinate System

- Browser uses 0-1000 normalized range for mouse coordinates
- Mac app converts to actual pixel coordinates based on capture area
- Ensures consistent input handling across different resolutions

## Usage

### Accessing Screen Capture

1. Ensure VibeTunnel server is running
2. Navigate to `http://localhost:4020/screencap` in a web browser
3. Grant Screen Recording permission if prompted
4. Select capture mode (desktop or window)
5. Click "Start" to begin sharing

### Prerequisites

- macOS 14.0 or later
- Screen Recording permission granted to VibeTunnel
- Modern web browser with WebRTC support
- Screencap feature enabled in VibeTunnel settings

## Development

### Running Locally

1. **Start server** (includes UNIX socket handler):
   ```bash
   cd web
   pnpm run dev
   ```

2. **Run Mac app** (connects to local server):
   - Open Xcode project
   - Build and run
   - UNIX socket will auto-connect

3. **Access screen sharing**:
   - Navigate to http://localhost:4020/screencap
   - Requires authentication

### Testing

```bash
# Monitor logs during capture
./scripts/vtlog.sh -c WebRTCManager -f

# Check frame processing
./scripts/vtlog.sh -s "video frame" -f

# Debug session issues
./scripts/vtlog.sh -s "session" -c WebRTCManager

# Monitor bitrate adjustments
./scripts/vtlog.sh -s "bitrate" -f

# Check UNIX socket connection
./scripts/vtlog.sh -c UnixSocket -f
```

### Debug Logging

Enable debug logs:
```bash
# Browser console
localStorage.setItem('DEBUG', 'screencap*');

# Mac app (or use vtlog)
defaults write sh.vibetunnel.vibetunnel debugMode -bool YES
```

## Troubleshooting

### Common Issues

**"Mac peer not connected" error**
- Ensure Mac app is running
- Check UNIX socket connection at `~/.vibetunnel/screencap.sock`
- Verify Mac app has permissions to create socket file
- Check server logs for connection errors

**"Unauthorized: Invalid session" error**
- This happens when clicking before a session is established
- The browser client generates a session ID when starting capture
- Ensure the session ID is being forwarded through the socket
- Check that the Mac app is validating the session properly

**Black screen or no video**
- Check browser console for WebRTC errors
- Ensure Screen Recording permission is granted
- Try refreshing the page
- Verify VP8/H.264 codec support in browser
- Check if video frames are being sent (look for "FIRST VIDEO FRAME SENT" in logs)

**Poor video quality**
- Check network conditions (logs show packet loss and RTT)
- Monitor bitrate adjustments in logs
- Try disabling 8K mode if enabled
- Ensure sufficient bandwidth (up to 50 Mbps for high quality)

**Input events not working**
- Check Accessibility permissions for Mac app
- Verify coordinate transformation (0-1000 range)
- Check API message flow in logs
- Ensure session is valid

## Security Considerations

- Always validate session IDs for control operations
- Input validation for coordinates and key events
- Rate limiting on API requests to prevent abuse
- Secure session generation (crypto.randomUUID with fallback)
- Sessions tied to specific capture instances
- Clear audit logging with session IDs and timestamps
- Control operations include: click, key, mouse events, capture start/stop

## Future Enhancements

- Audio capture support
- Recording capabilities with configurable formats
- Multiple concurrent viewers for same screen
- Annotation/drawing tools overlay
- File transfer through drag & drop
- Enhanced mobile touch controls and gestures
- Screen area selection for partial capture
- Virtual display support
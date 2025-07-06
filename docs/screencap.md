# Screen Capture Architecture

## Overview

VibeTunnel's screen capture feature allows users to share their screen and control their Mac remotely through a web browser. The implementation uses WebRTC for high-performance video streaming and WebSocket for secure control messages.

## Architecture Diagram

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
      │   endpoint: '/windows'}            │                                   │
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

## Components

### 1. Browser Client (`web/src/client/components/screencap-view.ts`)

The browser client provides the UI for screen sharing:
- Displays list of available windows and displays
- Shows the video stream
- Captures mouse and keyboard input
- Manages WebRTC peer connection

Key features:
- **WebSocket API Client**: Communicates with server via authenticated WebSocket
- **WebRTC Peer**: Receives video stream directly from Mac app
- **Input Handler**: Captures and sends mouse/keyboard events

### 2. Server (`web/src/server/websocket/screencap-unix-handler.ts`)

The Node.js server acts as a signaling relay:
- Authenticates WebSocket connections from browser
- Accepts UNIX socket connections from Mac app
- Routes messages between browser and Mac app
- Does NOT handle video data (WebRTC is peer-to-peer)

Key responsibilities:
- **Authentication**: Requires valid JWT token for browser WebSocket connections
- **UNIX Socket**: Mac app connects via `~/.vibetunnel/screencap.sock`
- **Message Routing**: Forwards API requests/responses between peers
- **Session Management**: Tracks connected Mac and browser peers

### 3. Mac App (`mac/VibeTunnel/Core/Services/WebRTCManager.swift`)

The Mac application handles screen capture and input:
- Captures screen/window content using ScreenCaptureKit
- Streams video via WebRTC
- Processes mouse/keyboard input events

Key components:
- **WebRTCManager**: Manages peer connection and video streaming
- **ScreencapService**: Interfaces with macOS screen capture APIs
- **Input Handler**: Simulates mouse/keyboard events

## Security Model

### Authentication Flow

1. **Browser → Server**: JWT token in WebSocket connection
2. **Mac App → Server**: Local UNIX socket connection (no auth needed - local only)
3. **No Direct Access**: All communication goes through server relay

### Eliminated Vulnerabilities

Previously, the Mac app ran an HTTP server on port 4010:
```
❌ OLD: Browser → HTTP (no auth) → Mac App:4010
✅ NEW: Browser → WebSocket (auth) → Server → UNIX Socket → Mac App
```

This eliminates:
- Unauthenticated local access
- CORS vulnerabilities
- Open port exposure

## Message Protocol

### API Request/Response

Browser → Server → Mac:
```json
{
  "type": "api-request",
  "requestId": "uuid",
  "method": "GET|POST",
  "endpoint": "/windows|/displays|/capture|/click|/key",
  "params": { /* optional */ }
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

## API Endpoints (via WebSocket)

### GET /windows
Returns list of available windows:
```json
[
  {
    "cgWindowID": 123,
    "title": "Terminal",
    "ownerName": "Terminal",
    "ownerPID": 456,
    "x": 0, "y": 0,
    "width": 1920, "height": 1080,
    "isOnScreen": true
  }
]
```

### GET /displays
Returns list of available displays:
```json
[
  {
    "id": "1",
    "width": 1920,
    "height": 1080,
    "scaleFactor": 2.0,
    "name": "Built-in Display"
  }
]
```

### POST /capture
Starts desktop capture:
```json
{
  "type": "desktop",
  "index": 0,
  "webrtc": true
}
```

### POST /capture-window
Starts window capture:
```json
{
  "cgWindowID": 123,
  "webrtc": true
}
```

### POST /click, /mousedown, /mouseup, /mousemove
Sends mouse events:
```json
{
  "x": 100.5,
  "y": 200.5
}
```

### POST /key
Sends keyboard events:
```json
{
  "key": "a",
  "metaKey": false,
  "ctrlKey": false,
  "altKey": false,
  "shiftKey": true
}
```

## Performance Considerations

### Video Streaming
- **Direct P2P**: Video never goes through server
- **Hardware Acceleration**: H.264/H.265 with VideoToolbox
- **Adaptive Bitrate**: Adjusts quality based on network conditions
- **Low Latency**: < 50ms typical latency

### Control Messages
- **WebSocket**: Low latency for input events
- **Message Queuing**: Prevents event flooding
- **Compression**: WebSocket compression enabled

## Development Setup

### Running Locally

1. **Start server** (includes WebSocket handler):
   ```bash
   cd web
   pnpm run dev
   ```

2. **Run Mac app** (connects to local server):
   - Open Xcode project
   - Build and run
   - WebRTC will auto-connect to localhost:4020

3. **Access screen sharing**:
   - Navigate to http://localhost:4020/screencap
   - Requires authentication

### Testing

- **Unit tests**: `web/src/server/websocket/screencap-unix-handler.test.ts`
- **Integration tests**: Test full flow with mock WebRTC
- **Manual testing**: Use two browser tabs to test relay

## Troubleshooting

### Common Issues

1. **"Mac peer not connected"**
   - Ensure Mac app is running
   - Check UNIX socket connection at `~/.vibetunnel/screencap.sock`
   - Verify Mac app has permissions to create socket file

2. **No video stream**
   - Check screen recording permissions
   - Verify WebRTC connection established
   - Look for ICE candidate failures

3. **Input events not working**
   - Check Accessibility permissions for Mac app
   - Verify coordinate transformation
   - Check API message flow in logs

### Debug Logging

Enable debug logs:
```javascript
// Browser console
localStorage.setItem('DEBUG', 'screencap*');

// Mac app
defaults write sh.vibetunnel.vibetunnel debugMode -bool YES
```

## Future Enhancements

1. **Multiple Viewers**: Allow multiple browsers to view same screen
2. **Recording**: Save screen sessions
3. **Annotations**: Draw on shared screen
4. **File Transfer**: Drag & drop files through screen share
5. **Audio Sharing**: Include system audio in stream
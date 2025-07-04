# Screen Capture (Screencap) Feature

## Overview

VibeTunnel's screen capture feature allows users to share their Mac screen through a web browser using WebRTC technology. This enables real-time screen sharing with low latency and high quality video streaming.

## Architecture

### Components

1. **ScreencapService** (`mac/VibeTunnel/Core/Services/ScreencapService.swift`)
   - Singleton service that manages screen capture functionality
   - Handles WebSocket connection for API requests
   - Manages capture sessions using ScreenCaptureKit
   - Provides API endpoints for window/display enumeration and control

2. **WebRTCManager** (`mac/VibeTunnel/Core/Services/WebRTCManager.swift`)
   - Manages WebRTC peer connections
   - Handles signaling via WebSocket
   - Processes video frames from ScreenCaptureKit
   - Supports H.264 and H.265 video codecs

3. **Web Frontend** (`web/src/client/components/screencap-view.ts`)
   - LitElement-based UI for screen capture
   - WebRTC client for receiving video streams
   - API client for controlling capture sessions

4. **Signaling Server** (`web/src/server/websocket/screencap-signal-handler.ts`)
   - WebSocket server at `/ws/screencap-signal`
   - Facilitates WebRTC signaling between Mac app and browser
   - Routes API requests between browser and Mac app

### Communication Flow

```
Browser <--WebSocket--> Node.js Server <--WebSocket--> Mac App
        <--WebRTC P2P------------------------->
```

1. Browser connects to `/ws/screencap-signal`
2. Mac app connects to the same WebSocket endpoint with authentication
3. Browser requests screen capture via API
4. Mac app creates WebRTC offer and sends through signaling
5. Browser responds with answer
6. P2P connection established for video streaming

## Features

### Capture Modes

- **Desktop Capture**: Share entire display(s)
- **Window Capture**: Share specific application windows
- **Multi-display Support**: Handle multiple monitors

### Security

- **Authentication**: WebSocket connections require authentication
  - Local connections use `X-VibeTunnel-Local` header with auth token
  - Remote connections use standard VibeTunnel authentication
- **Permissions**: Requires macOS Screen Recording permission
- **Session Management**: Each capture session has unique ID for security

### Video Quality

- **Codec Support**: 
  - H.265/HEVC (preferred on Apple Silicon)
  - H.264/AVC (fallback)
- **Adaptive Quality**: Adjusts based on network conditions
- **Hardware Acceleration**: Uses VideoToolbox for efficient encoding

## Implementation Details

### WebSocket Reconnection

The screencap service implements automatic WebSocket reconnection to ensure reliability:

1. **Initial Connection**: Attempts connection when server starts
2. **Automatic Retry**: Reconnects after 2 seconds if connection fails
3. **Connection Monitoring**: Checks connection status every 5 seconds
4. **Dynamic Auth Token**: Updates authentication if token wasn't available initially

### API Endpoints (via WebSocket)

All API requests are sent through the WebSocket connection as `api-request` messages:

- `GET /displays` - List available displays
- `GET /windows` - List available windows
- `GET /applications` - List running applications
- `POST /start` - Start screen capture
- `POST /stop` - Stop screen capture
- `POST /click` - Simulate mouse click
- `POST /key` - Simulate keyboard input
- `POST /resize` - Handle window resize

### Error Handling

Common errors and their handling:

- **No Permission**: Prompts user to grant Screen Recording permission
- **WebSocket Disconnection**: Automatic reconnection with exponential backoff
- **Invalid Window/Display**: Returns appropriate error message
- **Capture Failure**: Logs error and notifies client

## Usage

### Accessing Screen Capture

1. Ensure VibeTunnel server is running
2. Navigate to `http://localhost:4020/screencap` in a web browser
3. Grant Screen Recording permission if prompted
4. Select capture mode (desktop or window)
5. Click "Start Capture" to begin sharing

### Prerequisites

- macOS 14.0 or later
- Screen Recording permission granted to VibeTunnel
- Modern web browser with WebRTC support
- Screencap feature enabled in VibeTunnel settings

### Troubleshooting

**"Failed to load windows" error**
- Ensure Screen Recording permission is granted
- Check that WebSocket connection is established
- Verify server is running with screencap enabled

**Black screen or no video**
- Check browser console for WebRTC errors
- Ensure firewall isn't blocking WebRTC connections
- Try refreshing the page

**Connection timeouts**
- Server may need time to establish WebSocket connection
- Wait a few seconds and refresh the page
- Check server logs for connection errors

## Development

### Adding New Features

1. **Mac Side**: Extend `ScreencapService` with new methods
2. **API**: Add handler in `handleAPIRequest` method
3. **Web Side**: Update `ScreencapApiClient` with new endpoints
4. **UI**: Modify `screencap-view.ts` for new controls

### Testing

- Use Chrome DevTools for WebRTC debugging
- Monitor WebSocket frames in Network tab
- Check `about:webrtc` in Firefox for detailed stats
- Enable debug logging with `VIBETUNNEL_DEBUG=1`

### Security Considerations

- Always validate input parameters
- Sanitize window/display IDs before use
- Rate limit API requests to prevent abuse
- Log security-relevant events

## Future Enhancements

- Audio capture support
- Multi-user screen sharing
- Recording capabilities
- Annotation tools
- Remote desktop control (full mouse/keyboard)
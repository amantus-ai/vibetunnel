# Architecture Overview

## System Design

VibeTunnel consists of three main components working together:

```
┌─────────────────────────────────────────────────────┐
│              macOS Menu Bar Application              │
│                   (Swift/SwiftUI)                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ ServerManager: Lifecycle & process control    │  │
│  │ SessionMonitor: Active session tracking       │  │
│  │ TTYForwardManager: Terminal forwarding        │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────┘
                     │ Spawns & Manages
┌────────────────────▼────────────────────────────────┐
│             Node.js/Bun Server Process              │
│                  (TypeScript)                       │
│  ┌──────────────────────────────────────────────┐  │
│  │ HTTP Server: REST API endpoints               │  │
│  │ WebSocket Server: Real-time terminal I/O      │  │
│  │ PTY Manager: Native terminal processes        │  │
│  │ Session Manager: Lifecycle & state            │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────┘
                     │ HTTP/WebSocket
┌────────────────────▼────────────────────────────────┐
│                  Client Applications                 │
├──────────────────────────────────────────────────────┤
│  Web Browser         │        iOS App               │
│  (Lit/TypeScript)    │    (Swift/SwiftUI)          │
└──────────────────────────────────────────────────────┘
```

## Component Responsibilities

### macOS Application

| Component | File | Purpose |
|-----------|------|---------|
| ServerManager | `mac/VibeTunnel/ServerManager.swift` | Server lifecycle, port management |
| SessionMonitor | `mac/VibeTunnel/SessionMonitor.swift` | Track active sessions |
| TTYForwardManager | `mac/VibeTunnel/TTYForwardManager.swift` | CLI integration |
| MenuBarUI | `mac/VibeTunnel/MenuBarView.swift` | User interface |

### Server Process

| Component | File | Purpose |
|-----------|------|---------|
| HTTP Server | `web/src/server/server.ts` | REST API, WebSocket upgrade |
| PTY Manager | `web/src/server/pty/pty-manager.ts` | Terminal process spawning |
| Session Manager | `web/src/server/services/session-manager.ts` | Session state & cleanup |
| Buffer Aggregator | `web/src/server/services/buffer-aggregator.ts` | Output optimization |

### Web Frontend

| Component | File | Purpose |
|-----------|------|---------|
| App Shell | `web/src/client/app.ts` | Main application container |
| Terminal View | `web/src/client/terminal-view.ts` | xterm.js integration |
| Session List | `web/src/client/session-list.ts` | Active sessions UI |
| WebSocket Client | `web/src/client/services/websocket.ts` | Real-time communication |

## Data Flow

### Session Creation
```
User → vt command → TTYForwardManager → HTTP POST /api/sessions
→ Server creates PTY → Returns session ID → Opens browser
→ WebSocket connection established → Terminal ready
```

### Terminal I/O
```
User types → WebSocket message → Server PTY write
PTY output → Buffer aggregation → Binary protocol → WebSocket
→ Client decode → xterm.js render
```

### Session Cleanup
```
Terminal exit → PTY close → Session manager cleanup
→ WebSocket close → Client notification → UI update
```

## Communication Protocols

### HTTP REST API
- Session CRUD operations
- Authentication endpoints
- Health checks
- See [API Reference](api-reference.md)

### WebSocket Protocol
- Binary buffer format for efficiency
- Magic byte `0xBF` for packet identification
- 4-byte length header (big-endian)
- UTF-8 encoded terminal data
- See [Protocol Details](protocols.md)

### Inter-Process Communication
- Mac app spawns Bun server as child process
- Environment variables for configuration
- File-based PID tracking
- Signal handling for graceful shutdown

## Security Architecture

### Authentication Flow
```
Client → Password (optional) → Server validates
→ JWT token generated → Token in Authorization header
→ Server validates on each request
```

### Network Security
- Localhost-only by default
- Optional LAN exposure with authentication
- Tailscale/ngrok integration for remote access
- WSS/HTTPS in production

### Process Isolation
- Each session runs in separate PTY process
- User permissions inherited from server
- No privilege escalation
- Resource limits per session

## Performance Optimizations

### Buffer Aggregation
- Batch terminal output every 16ms
- Reduce WebSocket message frequency
- Binary protocol reduces payload size

### Connection Management
- WebSocket connection pooling
- Automatic reconnection with backoff
- Ping/pong for keep-alive

### Resource Management
- Lazy loading of terminal sessions
- Automatic cleanup of idle sessions
- Memory-mapped session recordings

## Platform Integration

### macOS Features
- Menu bar application
- Sparkle auto-updates
- Code signing & notarization
- Launch at login

### iOS Features
- Native Swift UI
- Background session support
- Push notifications
- Handoff support

### Web Standards
- Progressive Web App capable
- Service Worker for offline
- WebAssembly for performance
- Responsive design

## Build & Deployment

### Build Pipeline
```
1. TypeScript compilation → JavaScript bundle
2. Bun standalone executable generation
3. Swift compilation → macOS app
4. Embed server in app bundle
5. Code sign & notarize
6. DMG creation with Sparkle
```

### Configuration
- Runtime: Environment variables
- Build-time: xcconfig files
- User preferences: macOS defaults system
- Server config: JSON files

## Monitoring & Debugging

### Logging
- Unified logging to macOS Console
- Structured JSON logs from server
- Session-specific log filtering
- See `./scripts/vtlog.sh`

### Metrics
- Session count & duration
- Message throughput
- Error rates
- Resource usage

## See Also
- [Development Guide](../guides/development.md)
- [API Reference](api-reference.md)
- [Security Model](../features/authentication.md)
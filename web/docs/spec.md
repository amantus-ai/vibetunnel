# VibeTunnel Web Architecture Specification

This document provides a comprehensive map of the VibeTunnel web application architecture, including server components, client structure, API specifications, and protocol details. Updated: 2025-07-01

## Key Files Quick Reference

### Server Core
- **Entry Point**: `src/server/server.ts:912` - `startVibeTunnelServer()`
- **App Creation**: `src/server/server.ts:330` - `createApp()`
- **Configuration**: `src/server/server.ts:57` - `Config` interface
- **CLI Entry**: `src/server/cli.ts:51-56` - `vibetunnel fwd` command

### Authentication
- **Service**: `src/server/services/auth-service.ts:144-271` - SSH key verification
- **Middleware**: `src/server/middleware/auth.ts:20-105` - JWT validation
- **Routes**: `src/server/routes/auth.ts:20-178` - Auth endpoints

### Session Management
- **PTY Manager**: `src/server/pty/pty-manager.ts:57` - Session Map
- **Session Manager**: `src/server/pty/session-manager.ts:40-141` - Session lifecycle
- **Routes**: `src/server/routes/sessions.ts:134-1252` - Session API

### Real-time Communication
- **Binary Buffer**: `src/server/services/terminal-manager.ts:378-574` - Buffer encoding
- **WebSocket Server**: `src/server/services/buffer-aggregator.ts:44-344` - Buffer streaming
- **Input Handler**: `src/server/routes/websocket-input.ts:156-164` - Input protocol

### Client Core
- **Entry Point**: `src/client/app-entry.ts:1-28` - App initialization
- **Main Component**: `src/client/app.ts:44-1355` - `<vibetunnel-app>`
- **Terminal**: `src/client/components/terminal.ts:23-1567` - xterm.js wrapper

## Server Architecture

### Main Server (`src/server/server.ts`)

The server provides a comprehensive API for terminal session management with support for distributed deployments.

**Configuration Options**:
- `port`: Server port (default: 4020)
- `bind`: Bind address (default: 127.0.0.1)
- `isHQMode`: Run as headquarters server
- `hqUrl/hqUsername/hqPassword`: Remote server registration
- `enableSSHKeys`: Enable SSH key authentication
- `noAuth`: Disable all authentication

**Key Services**:
- Authentication (JWT + SSH keys)
- Session management (PTY processes)
- WebSocket communication (binary buffers + input)
- File system operations
- Push notifications
- Activity monitoring

### Authentication System

**Supported Methods**:
1. **SSH Key Authentication** (`src/server/routes/auth.ts:52`)
   - Challenge-response with Ed25519 signatures
   - Verifies against `~/.ssh/authorized_keys`
2. **Password Authentication** (`src/server/routes/auth.ts:101`)
   - PAM authentication or environment variables
3. **Bearer Token** (HQ mode)
   - For server-to-server communication
4. **Local Bypass** (optional)
   - Localhost connections with optional token

**JWT Token Flow**:
1. Client requests challenge from `/api/auth/challenge`
2. Server generates random challenge
3. Client signs challenge and sends to `/api/auth/ssh-key`
4. Server verifies signature and returns JWT token

### Session Management

**Session Lifecycle**:
1. **Creation** (`src/server/routes/sessions.ts:134`):
   - Spawns PTY process using node-pty
   - Creates session directory in `~/.vibetunnel/control/`
   - Saves metadata to `session.json`

2. **Tracking**:
   - In-memory: `PtyManager.sessions` Map
   - On-disk: Session directories with stdout/stdin files

3. **Cleanup** (`src/server/pty/session-manager.ts:297`):
   - Automatic cleanup of exited sessions
   - 5-minute cleanup interval
   - Zombie process detection

**Control Directory Structure**:
```
~/.vibetunnel/control/
├── [sessionId]/
│   ├── session.json    # Session metadata
│   ├── stdout          # Terminal output
│   ├── stdin           # Terminal input log
│   ├── activity.json   # Activity status
│   └── ipc.sock        # Unix socket for IPC
```

## Client Architecture

### Component Hierarchy

```
<vibetunnel-app>                  # Main app orchestrator
├── <auth-login>                  # Login form
├── <session-list>                # Session listing
│   └── <session-card>           # Individual session
├── <session-view>               # Full-screen terminal
│   ├── <vibe-terminal>         # xterm.js wrapper
│   └── <vibe-terminal-buffer>  # Binary buffer renderer
└── <unified-settings>           # Settings panel
```

### State Management
- Component-level state using LitElement's `@state()` decorator
- localStorage for persistent data (auth tokens, preferences)
- Event-driven communication between components
- No global state management library

### Services

**AuthClient** (`src/client/services/auth-client.ts`):
- Manages authentication state
- Handles SSH key and password auth
- Stores tokens in localStorage

**BufferSubscriptionService** (`src/client/services/buffer-subscription-service.ts`):
- WebSocket connection for binary terminal buffers
- Automatic reconnection with exponential backoff
- Multiplexed subscriptions per session

**WebSocketInputClient** (`src/client/services/websocket-input-client.ts`):
- Low-latency input transmission
- Fire-and-forget protocol
- Per-session connections

## API Specification

### REST Endpoints

#### Sessions
- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id` - Get session info
- `DELETE /api/sessions/:id` - Kill session
- `POST /api/sessions/:id/input` - Send input
- `POST /api/sessions/:id/resize` - Resize terminal
- `GET /api/sessions/:id/stream` - SSE output stream
- `GET /api/sessions/:id/text` - Get text output
- `GET /api/sessions/:id/buffer` - Get binary buffer
- `GET /api/sessions/activity` - Get all activity

#### Authentication
- `POST /api/auth/challenge` - Request challenge
- `POST /api/auth/ssh-key` - SSH key auth
- `POST /api/auth/password` - Password auth
- `GET /api/auth/verify` - Verify token
- `GET /api/auth/config` - Get auth config

#### HQ Mode (Distributed)
- `GET /api/remotes` - List remote servers
- `POST /api/remotes/register` - Register remote
- `DELETE /api/remotes/:id` - Unregister remote

### WebSocket Protocols

#### Binary Buffer Protocol (`/buffers`)

**Connection**: WebSocket with Bearer token authentication

**Client → Server Messages** (JSON):
```json
{ "type": "subscribe", "sessionId": "session_123" }
{ "type": "unsubscribe", "sessionId": "session_123" }
{ "type": "ping" }
```

**Server → Client Messages** (Binary):
```
[0xBF][ID Length (4 bytes)][Session ID (UTF-8)][Buffer Data]
```

**Buffer Data Format** (32-byte header + cells):
```
Header (32 bytes):
├── Magic: 0x5654 "VT" (2 bytes)
├── Version: 0x01 (1 byte)
├── Flags: reserved (1 byte)
├── Columns (4 bytes)
├── Rows (4 bytes)
├── ViewportY (4 bytes)
├── CursorX (4 bytes)
├── CursorY (4 bytes)
└── Reserved (4 bytes)

Row Encoding:
├── Empty rows: [0xFE][count]
└── Content rows: [0xFD][cell count (2 bytes)][cells...]

Cell Type Byte:
├── Bit 7: Has extended data
├── Bit 6: Is Unicode
├── Bit 5: Has foreground color
├── Bit 4: Has background color
├── Bit 3: Is RGB foreground
├── Bit 2: Is RGB background
└── Bits 1-0: Character type (00=space, 01=ASCII, 10=Unicode)
```

#### Input Protocol (`/ws/input`)

**Connection**: `ws://host/ws/input?sessionId=X&token=Y`

**Message Format**:
- Regular text: Sent as-is
- Special keys: `\x00key_name\x00`

### Server-Sent Events (SSE)

**Session Output Stream** (`/api/sessions/:id/stream`)

Uses asciinema cast v2 format:
```json
[timestamp, "o", "output text"]      // Terminal output
[timestamp, "i", "input text"]       // User input
[timestamp, "r", "80x24"]           // Resize event
["exit", exitCode, sessionId]       // Process exit
```

## fwd.ts Application

The `fwd.ts` tool (`src/server/fwd.ts`) wraps any command in a VibeTunnel session:

**Usage**: `pnpm exec tsx src/fwd.ts [options] <command> [args...]`

**Options**:
- `--session-id <id>`: Use specific session ID
- `--title-mode <mode>`: none|filter|static|dynamic
- `--update-title <title>`: Update existing session title

**Features**:
- Auto-detects Claude AI and enables dynamic titles
- Forwards stdin/stdout through PTY infrastructure
- Creates sessions accessible via web interface
- Activity detection for intelligent status updates

**Socket Protocol** (`src/server/pty/socket-protocol.ts`):
```
Message Types:
├── stdin: { type: 'stdin', data: Buffer }
├── resize: { type: 'resize', cols: number, rows: number }
├── kill: { type: 'kill', signal?: string }
└── status: { type: 'status', message: string }
```

## HQ Mode & Distributed Architecture

### Remote Registration
1. Remote servers register with HQ using bearer tokens
2. HQ maintains registry of all remote servers
3. Health checks every 15 seconds
4. Automatic session discovery

### Request Routing
- HQ checks session ownership via registry
- Forwards API requests to appropriate remote
- Proxies SSE streams transparently
- Multiplexes WebSocket connections

### High Availability
- Graceful degradation on remote failure
- Continues serving local sessions
- Automatic reconnection for WebSocket streams
- Session ownership tracking for reliability

## Activity Tracking

### Activity Monitor (`src/server/services/activity-monitor.ts`)
- Monitors stdout file changes (100ms intervals)
- Marks sessions inactive after 500ms of no output
- Persists activity to `activity.json`
- Provides real-time activity status

### Activity Detection (`src/server/utils/activity-detector.ts`)
- App-specific status detection (Claude AI)
- Filters prompt-only output
- Dynamic title updates based on activity
- 5-second activity timeout

## Additional Features

### Push Notifications
- Web Push API with VAPID authentication
- Bell event notifications from terminal
- Service worker for offline support
- Process context in notifications

### File Browser
- Full filesystem browsing with Git status
- Monaco Editor for code preview
- Git diff visualization
- Image preview support

### SSH Key Management
- Browser-based Ed25519 key generation
- Import/export functionality
- Password-protected key support
- Web Crypto API integration

### Native Terminal Spawning (macOS)
- Unix socket at `/tmp/vibetunnel-terminal.sock`
- Requests native Terminal.app windows
- Falls back to web terminal

### Performance Optimizations
- Binary buffer compression (empty row encoding)
- Fire-and-forget input protocol
- Debounced buffer notifications (50ms)
- Efficient cell encoding with bit-packing

## Development Commands

```bash
# Web directory commands
cd web/

# Development (auto-rebuild)
pnpm run dev

# Code quality (must run before commit)
pnpm run check         # Run all checks in parallel
pnpm run check:fix     # Auto-fix issues

# Individual commands
pnpm run lint          # ESLint
pnpm run format        # Prettier
pnpm run typecheck     # TypeScript
```

## Architecture Principles

1. **Modular Design**: Clear separation between auth, sessions, and real-time communication
2. **Scalability**: Horizontal scaling via HQ mode and remote servers
3. **Reliability**: Automatic reconnection, health checks, graceful degradation
4. **Performance**: Binary protocols, compression, minimal latency
5. **Security**: Multiple auth methods, JWT tokens, secure WebSocket connections

For implementation details, refer to the line numbers provided in the Key Files Quick Reference section.
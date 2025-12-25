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
- **VT Snapshot v1**: `src/server/services/terminal-manager.ts:378-574` - Snapshot encoding
- **WebSocket v3 Hub**: `src/server/services/ws-v3-hub.ts` - Multiplexed stdout/snapshots/events + input

### Client Core
- **Entry Point**: `src/client/app-entry.ts:1-28` - App initialization
- **Main Component**: `src/client/app.ts:44-1355` - `<vibetunnel-app>`
- **Terminal**: `src/client/components/terminal.ts:23-1567` - ghostty-web wrapper

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
│   ├── <vibe-terminal>         # ghostty-web wrapper
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

**TerminalSocketClient** (`src/client/services/terminal-socket-client.ts`):
- Single WebSocket to `/ws` (v3 framing)
- Multiplexed subscriptions per session (stdout/snapshots/events)
- Input + resize on the same socket

## API Specification

### REST Endpoints

#### Sessions
- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id` - Get session info
- `DELETE /api/sessions/:id` - Kill session
- `POST /api/sessions/:id/input` - Send input
- `POST /api/sessions/:id/resize` - Resize terminal
- `GET /api/sessions/:id/text` - Get text output

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

#### Git Integration
- `GET /api/worktrees` - List worktrees
- `POST /api/worktrees` - Create worktree
- `POST /api/worktrees/follow` - Enable/disable follow mode
- `GET /api/worktrees/follow` - Get follow mode status
- `POST /api/git/events` - Git hook notifications

### WebSocket Protocols

#### Terminal Transport (`/ws`, v3)

Single WebSocket. Multiplexed sessions. Binary framing.
See `docs/websocket.md` for framing and message types.

**VT Snapshot v1 Format** (`SNAPSHOT_VT` payload):
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

## fwd.ts Application

The `fwd.ts` tool (`src/server/fwd.ts`) wraps any command in a VibeTunnel session:

**Usage**: `pnpm exec tsx src/fwd.ts [options] <command> [args...]`

**Options**:
- `--session-id <id>`: Use specific session ID
- `--title-mode <mode>`: none|filter|static|dynamic
- `--update-title <title>`: Update existing session title

**Features**:
- Dynamic title mode is a legacy alias of static (no activity tracking)
- Forwards stdin/stdout through PTY infrastructure
- Creates sessions accessible via web interface
- Sends control commands over the IPC socket (resize/kill/update-title)

**Socket Protocol** (`src/server/pty/socket-protocol.ts`):
```
Message Types:
├── stdin: { type: 'stdin', data: Buffer }
├── resize: { type: 'resize', cols: number, rows: number }
├── kill: { type: 'kill', signal?: string }
└── update-title: { type: 'update-title', title: string }
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
- Proxies WS v3 streams transparently
- Multiplexes WebSocket connections

### High Availability
- Graceful degradation on remote failure
- Continues serving local sessions
- Automatic reconnection for WebSocket streams
- Session ownership tracking for reliability

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

## Git Follow Mode

Git follow mode creates an intelligent synchronization between a main repository and a specific worktree, enabling seamless development workflows where agents work in worktrees while developers maintain their IDE and server setups in the main repository.

**Key Components**:
- **Git Hooks** (`src/server/utils/git-hooks.ts`): Manages post-commit, post-checkout, post-merge hooks
- **Git Event Handler** (`src/server/routes/git.ts:186-482`): Processes git events and handles synchronization
- **Socket API** (`src/server/api-socket-server.ts:217-267`): Socket-based follow mode control
- **CLI Integration** (`web/bin/vt`): Smart command handling with path/branch detection

**Configuration**:
- Single config option: `vibetunnel.followWorktree` stores the worktree path being followed
- Config is stored in the main repository's `.git/config`
- Follow mode is active when this config contains a valid worktree path

**Synchronization Behavior**:
1. **Worktree → Main** (Primary): Branch switches, commits, and checkouts sync to main repo
2. **Main → Worktree** (Limited): Only commits sync; branch switches auto-unfollow
3. **Auto-unfollow**: Switching branches in main repo disables follow mode

**Command Usage**:
```bash
# From worktree - follow this worktree
vt follow

# From main repo - smart detection
vt follow                    # Follow current branch's worktree (if exists)
vt follow feature/new-api    # Follow worktree for this branch
vt follow ~/project-feature  # Follow worktree by path
```

**Hook Installation**:
- Hooks installed in BOTH main repository and worktree
- Hooks execute `vt git event` which notifies server via socket API
- Server processes events based on source (main vs worktree)
- Existing hooks are preserved with `.vtbak` extension

**Event Flow**:
1. Git event occurs (checkout, commit, merge)
2. Hook executes `vt git event`
3. CLI sends event via socket to server
4. Server determines sync action based on event source
5. Appropriate git commands executed to maintain sync

## Architecture Principles

1. **Modular Design**: Clear separation between auth, sessions, and real-time communication
2. **Scalability**: Horizontal scaling via HQ mode and remote servers
3. **Reliability**: Automatic reconnection, health checks, graceful degradation
4. **Performance**: Binary protocols, compression, minimal latency
5. **Security**: Multiple auth methods, JWT tokens, secure WebSocket connections

For implementation details, refer to the line numbers provided in the Key Files Quick Reference section.

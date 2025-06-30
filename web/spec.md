# VibeTunnel Codebase Map

A comprehensive navigation guide for the VibeTunnel web terminal system.

## Project Overview

VibeTunnel is a web-based terminal multiplexer with distributed architecture support. It provides:
- PTY-based terminal sessions via node-pty
- Real-time terminal streaming via SSE (asciinema cast v2 format)
- Binary-optimized buffer synchronization (current viewport via WebSocket)
- Distributed HQ/remote server architecture
- Web UI with full terminal emulation
- Push notifications for terminal bell events
- Multi-method authentication (SSH keys, JWT, PAM)
- Advanced terminal title management

## Directory Structure

```
web/
├── src/
│   ├── server/           # Node.js Express server
│   │   ├── middleware/   # Auth and other middleware
│   │   ├── pty/         # PTY management
│   │   ├── routes/      # API endpoints
│   │   ├── services/    # Core services
│   │   ├── utils/       # Server utilities
│   │   ├── server.ts    # Main server implementation
│   │   └── fwd.ts       # CLI forwarding tool
│   ├── client/          # Lit-based web UI
│   │   ├── assets/      # Static files (fonts, icons, html)
│   │   ├── components/  # UI components
│   │   ├── services/    # Client services
│   │   └── utils/       # Client utilities
│   ├── test/            # Test files
│   └── cli.ts           # Main entry point
├── scripts/             # Build scripts
└── public/              # Built static assets (generated)
```

## Server Architecture (`src/server/`)

### Core Components

#### Entry Points
- `cli.ts:1-62`: Main entry point, routes to server or forward mode
  - Version display, debug initialization, mode routing
- `server.ts:1-1017`: Core server implementation with Express app factory
  - CLI parsing: `142-246`
  - Server modes: `432-455` (Normal, HQ, Remote initialization)
  - WebSocket upgrade: `585-707` (Authentication and buffer streaming)
  - Graceful shutdown: `893-1017` (Cleanup intervals and service termination)

### Authentication (`middleware/auth.ts`)
- Multi-method authentication: `1-159`
  - SSH key authentication with Ed25519 support
  - Basic auth (username/password)
  - Bearer token for HQ↔Remote communication
  - JWT tokens for session persistence
- Local bypass for localhost connections: `24-48`, `68-87`
- Query parameter token support for EventSource

### Session Management

#### PTY Manager (`pty/pty-manager.ts`)
- Session creation: `173-400` (Spawns PTY processes with node-pty)
- **Automatic alias resolution**: `204-217` (Uses `ProcessUtils.resolveCommand()`)
- Terminal resize handling: `115-168` (Native terminal dimension sync)
- Control pipe support using file watching
- Bell event emission for push notifications
- Clean termination with SIGTERM→SIGKILL escalation

#### Process Utils (`pty/process-utils.ts`)
- `resolveCommand()`: `241-388` (Detects if command exists in PATH)
  - Uses `which` (Unix) or `where` (Windows) to check existence
  - Returns appropriate shell command for aliases/builtins
  - Sources shell config files for proper alias support
- `getUserShell()`: `394-484` (Determines user's preferred shell)
  - Checks `$SHELL` environment variable first
  - Platform-specific fallbacks (pwsh/cmd on Windows, zsh/bash on Unix)
- Interactive shell detection: `220-235` (Auto-adds `-i -l` flags)

#### Session Manager (`pty/session-manager.ts`)
- Session persistence in `~/.vibetunnel/control/`
- Filesystem-based session discovery
- Zombie session cleanup: `337-366`
- Atomic writes for session metadata: `99-115`

#### Terminal Manager (`services/terminal-manager.ts`)
- Headless xterm.js for server-side state: `47-76`
- Binary buffer snapshot generation: `261-292`
- Watches asciinema cast files and applies to terminal
- Debounced buffer change notifications (100ms)

### API Routes (`routes/`)

#### Sessions (`sessions.ts`)
- `GET /api/sessions`: `51-124` - List all sessions
  - Returns array with `source: 'local' | 'remote'`
  - HQ mode: Aggregates from all remote servers
- `POST /api/sessions`: `126-265` - Create session
  - Body: `{ command, workingDir?, name?, remoteId?, spawn_terminal?, cols?, rows?, titleMode? }`
  - Returns: `{ sessionId: string, message?: string }`
- `GET /api/sessions/:id`: `369-410` - Get session info
- `DELETE /api/sessions/:id`: `413-467` - Kill session
- `DELETE /api/sessions/:id/cleanup`: `470-518` - Clean session files
- `POST /api/cleanup-exited`: `521-598` - Clean all exited sessions

#### Session I/O
- `POST /api/sessions/:id/input`: `874-950` - Send keyboard input
  - Body: `{ text: string }` OR `{ key: SpecialKey }`
- `POST /api/sessions/:id/resize`: `953-1025` - Resize terminal
  - Body: `{ cols: number, rows: number }`
- `POST /api/sessions/:id/reset-size`: `1028-1083` - Reset to native size

#### Session Output
- `GET /api/sessions/:id/stream`: `723-871` - SSE streaming
  - Streams asciinema v2 format with custom exit event
  - Replays existing content, then real-time streaming
- `GET /api/sessions/:id/buffer`: `662-721` - Binary buffer snapshot
- `GET /api/sessions/:id/text`: `601-659` - Plain text output
  - Optional `?styles` for markup: `[style fg="15" bold]text[/style]`

#### Activity Monitoring
- `GET /api/sessions/activity`: `268-324` - All sessions activity
- `GET /api/sessions/:id/activity`: `327-366` - Single session activity
  - Returns: `{ isActive: boolean, timestamp: string, session: SessionInfo }`

#### WebSocket Input (`routes/websocket-input.ts`)
- `GET /ws/input?sessionId=<id>&token=<token>`: Low-latency input
  - Fire-and-forget protocol for keyboard/mouse input
  - Direct PTY forwarding for performance

#### Remotes (`remotes.ts`) - HQ Mode Only
- `GET /api/remotes`: `19-33` - List registered servers
- `POST /api/remotes/register`: `36-64` - Register remote
- `DELETE /api/remotes/:id`: `67-84` - Unregister remote
- `POST /api/remotes/:id/refresh-sessions`: `87-152` - Refresh session list

#### Filesystem (`filesystem.ts`)
- `GET /api/fs/browse`: Browse directory with Git status
- `GET /api/fs/preview`: File preview with Monaco support
- `GET /api/fs/content`: Text file content
- `GET /api/fs/diff`: Git diff for files
- `POST /api/fs/mkdir`: Create directory

#### Logs (`logs.ts`)
- `POST /api/logs/client`: `21-53` - Client log submission
- `GET /api/logs/raw`: `56-74` - Stream raw log file
- `GET /api/logs/info`: `77-102` - Log file metadata
- `DELETE /api/logs/clear`: `105-119` - Clear log file

#### Push Notifications (`push.ts`)
- `GET /api/push/vapid-public-key`: Get VAPID public key
- `POST /api/push/subscribe`: Subscribe to notifications
- `POST /api/push/unsubscribe`: Unsubscribe
- `POST /api/push/test`: Send test notification
- `GET /api/push/status`: Get service status

#### Authentication (`auth.ts`)
- `POST /api/auth/challenge`: Create SSH key auth challenge
- `POST /api/auth/ssh-key`: Authenticate with SSH key
- `POST /api/auth/password`: Authenticate with password
- `GET /api/auth/verify`: Verify authentication status
- `GET /api/auth/config`: Get auth configuration
- `GET /api/auth/avatar/:userId`: Get user avatar (macOS)

### Binary Buffer Protocol

**Note**: "Buffer" refers to the current terminal viewport without scrollback - used for terminal previews.

#### Format (`terminal-manager.ts:361-579`)
```
Header (32 bytes):
- Magic: 0x5654 "VT" (2 bytes)
- Version: 0x01 (1 byte)
- Flags: reserved (1 byte)
- Dimensions: cols, rows (8 bytes)
- Cursor: X, Y, viewport (12 bytes)
- Reserved (4 bytes)

Rows: 0xFE=empty, 0xFD=content
Cells: Variable-length with type byte
```

### SSE Streaming and Asciinema Files

#### Asciinema Writer (`pty/asciinema-writer.ts`)
- Writes cast files to `~/.vibetunnel/control/[sessionId]/stream-out`
- Format:
  - Standard: `[timestamp, "o", output]` for terminal output
  - Standard: `[timestamp, "i", input]` for user input
  - Standard: `[timestamp, "r", "colsxrows"]` for resize events
  - **Custom**: `["exit", exitCode, sessionId]` when process terminates

#### SSE Streaming (`routes/sessions.ts:723-871`)
- Real-time streaming of asciinema cast files
- Replays existing content with zeroed timestamps
- Watches for new content and streams incrementally
- Heartbeat every 30 seconds

### WebSocket (`services/buffer-aggregator.ts`)
- Client connections: `35-71` (Authentication and subscription)
- Message handling: `76-145` (Subscribe/unsubscribe/ping)
- Binary protocol: `156-185` - `[0xBF][ID Length][Session ID][Buffer Data]`
- Local and remote session proxy support

### Activity Monitoring (`services/activity-monitor.ts`)
- Monitors `stdout` file size changes: `143-147`
- 100ms check interval: `41-44`
- 500ms inactivity timeout: `209-212`
- Persists to `activity.json` per session: `220-245`
- Works for all sessions regardless of creation method

### HQ Mode Components

#### Remote Registry (`services/remote-registry.ts`)
- Health checks every 15s: `150-187`
- Session ownership tracking: `91-148`
- Bearer token authentication
- Automatic unhealthy remote removal

#### HQ Client (`services/hq-client.ts`)
- Registration with HQ: `40-90`
- Unique ID generation with UUID v4
- Graceful unregistration on shutdown: `92-113`

### Additional Services

#### Push Notifications (`services/push-notification-service.ts`)
- Web Push API integration: `64-363`
- Subscription management in `~/.vibetunnel/notifications/`
- Bell event notifications: `231-247`
- Automatic expired subscription cleanup

#### Bell Event Handler (`services/bell-event-handler.ts`)
- Processes terminal bell events: `59-182`
- Integrates with push notifications
- Includes process context in notifications

#### Authentication Service (`services/auth-service.ts`)
- SSH key authentication: `144-159`, `201-271`
  - Ed25519 signature verification
  - Challenge-response system
  - Checks `~/.ssh/authorized_keys`
- Password authentication: `105-120`
- PAM authentication fallback: `184-196`
- JWT token management: `176-180`

#### Control Directory Watcher (`services/control-dir-watcher.ts`)
- Monitors external session changes: `20-175`
- HQ mode integration: `116-163`
- Detects new/removed sessions

#### Shutdown State (`services/shutdown-state.ts`)
- Global shutdown state tracking
- Allows components to check shutdown status

### Utilities

#### Logger (`utils/logger.ts`)
- Structured logging with file and console output: `1-186`
- Color-coded console with chalk
- Log levels: log, warn, error, debug
- File output to `~/.vibetunnel/log.txt`
- Debug mode via `VIBETUNNEL_DEBUG`

#### VAPID Manager (`utils/vapid-manager.ts`)
- Auto-generates VAPID keys for push notifications: `20-331`
- Stores in `~/.vibetunnel/vapid/keys.json`
- Key rotation support

#### Version (`version.ts`)
- Version info with build date and git commit
- Runtime version banner display
- Development mode detection

## Client Architecture (`src/client/`)

### Core Components

#### Entry Points
- `app-entry.ts:1-28`: Main entry, initializes Monaco and push notifications
- `test-entry.ts`: Test terminals entry
- `styles.css`: Global Tailwind styles

#### Main Application (`app.ts`)
- Lit-based SPA: `44-1401` - `<vibetunnel-app>`
- URL-based routing with `?session=<id>`
- Global keyboard handlers (Cmd+O, Escape)
- View management: auth/list/session
- Split-screen support for session list and detail
- **Events fired**:
  - `toggle-nav`, `navigate-to-list`, `error`, `success`, `navigate`

### Component Event Architecture

```
vibetunnel-app
├── app-header (navigation, controls)
├── session-list (when view='list')
│   └── session-card (per session)
│       └── vibe-terminal-buffer (terminal preview)
├── session-view (when view='session')
│   ├── session-header
│   ├── vibe-terminal (main terminal)
│   ├── mobile-input-overlay
│   ├── ctrl-alpha-overlay
│   └── terminal-quick-keys
├── session-create-form (modal)
├── file-browser (modal)
├── unified-settings (modal)
└── auth-login (when view='auth')
```

### Terminal Components

#### Terminal (`terminal.ts`)
- Full xterm.js implementation: `23-150+`
- Virtual scrolling: `537-555`
- Touch/momentum support
- URL highlighting integration
- Custom width selection
- **Events**: `terminal-ready`, `terminal-input`, `terminal-resize`, `url-clicked`

#### VibeTunnelBuffer (`vibe-terminal-buffer.ts`)
- Read-only terminal preview: `26-268`
- WebSocket buffer subscription
- Auto-resizing
- **Events**: `content-changed`

#### SessionView (`session-view.ts`)
- Full-screen terminal view: `52-200+`
- Manager architecture:
  - ConnectionManager: SSE streaming
  - InputManager: Keyboard/mouse
  - MobileInputManager: Mobile input
  - DirectKeyboardManager: Direct keyboard access
  - TerminalLifecycleManager: Terminal state
- **Events**: `navigate-to-list`, `error`, `warning`

### Session Management Components

#### SessionList (`session-list.ts`)
- Grid/list layout: `34-150+`
- Hide/show exited sessions
- Search and filtering
- **Events**: `navigate-to-session`, `refresh`, `error`, `success`

#### SessionCard (`session-card.ts`)
- Individual session display: `25-150+`
- Live terminal preview
- Activity detection
- **Events**: `session-select`, `session-killed`, `session-kill-error`

#### SessionCreateForm (`session-create-form.ts`)
- Modal dialog: `27-381`
- Command input with working directory
- Native terminal spawn option
- **Events**: `session-created`, `cancel`, `error`

### UI Components

#### AppHeader (`app-header.ts`)
- Main navigation: `15-280+`
- Session status display
- Theme toggle
- **Events**: `create-session`, `hide-exited-change`, `kill-all-sessions`, `logout`

#### FileBrowser (`file-browser.ts`)
- Filesystem navigation: `48-665`
- Browse and select modes
- Monaco editor preview
- **Events**: `file-selected`, `browser-cancel`

#### UnifiedSettings (`unified-settings.ts`)
- Settings modal with multiple tabs
- Terminal preferences, notifications, appearance
- **Events**: `close`, `notifications-enabled`, `success`, `error`

#### LogViewer (`log-viewer.ts`)
- Real-time log display: `1-432`
- SSE-style polling
- Level filtering and search

### Services

#### BufferSubscriptionService (`buffer-subscription-service.ts`)
- WebSocket client: `77-164`
- Binary protocol decoder: `234-259`
- Auto-reconnection with backoff
- Per-session subscriptions

#### WebSocketInputClient (`websocket-input-client.ts`)
- Alternative input method via WebSocket
- Low-latency keyboard/mouse input
- Fire-and-forget protocol

#### PushNotificationService (`push-notification-service.ts`)
- Service worker registration
- Push subscription management
- Notification action handling

#### AuthClient (`auth-client.ts`)
- Token management: `27-100+`
- SSH key and password authentication
- API header generation
- SSH agent integration

### Utils

#### Terminal Utils
- `terminal-renderer.ts:276-418`: Binary buffer decoder and HTML generation
- `terminal-utils.ts:14-44`: Terminal resize helpers
- `terminal-preferences.ts`: Width preferences management
- `xterm-colors.ts`: Color palette definitions
- `url-highlighter.ts`: URL detection and click handling

#### UI Utils
- `responsive-utils.ts`: Media query observer
- `title-updater.ts`: Dynamic document title
- `keyboard-shortcut-highlighter.ts`: Shortcut formatting
- `offline-notification-manager.ts`: Offline detection

#### General Utils
- `cast-converter.ts:31-82`: Asciinema v2 parser
- `logger.ts`: Namespaced console logging
- `path-utils.ts`: Path formatting and clipboard
- `constants.ts`: UI timing, breakpoints, z-indexes

## Forward Tool (`src/server/fwd.ts`)

### Purpose
CLI tool for spawning PTY sessions using VibeTunnel infrastructure.

### Usage
```bash
pnpm exec tsx src/fwd.ts [--session-id <id>] [--title-mode <mode>] <command> [args...]

# Examples
pnpm exec tsx src/fwd.ts claude --resume
pnpm exec tsx src/fwd.ts --session-id abc123 --title-mode dynamic bash -l
```

### Key Features
- Interactive terminal forwarding: `58-289`
- Automatic shell alias support via ProcessUtils
- Session ID pre-generation support
- Terminal title management modes
- Graceful cleanup on exit

### Title Modes
- `none`: No title management (default)
- `filter`: Block all title changes
- `static`: Show working directory and command
- `dynamic`: Show directory, command, and activity

### Integration Points
- Uses central PTY Manager: `147-150`
- Terminal resize synchronization: `257-269`
- Raw mode for proper input capture: `276-277`
- Auto-detects Claude commands for dynamic titles: `135-143`

## Build System

### Main Build (`scripts/build.js`)
- Asset copying: `7-121`
- CSS compilation with Tailwind
- Client bundling with esbuild
- Server TypeScript compilation
- Native executable creation

### Native Binary (`scripts/build-native.js`)
- Node.js SEA integration: `1-537`
- node-pty patching for compatibility: `82-218`
- Outputs:
  - `native/vibetunnel`: Main executable
  - `native/pty.node`: Terminal emulation
  - `native/spawn-helper`: Process spawning (macOS)
  - `native/authenticate_pam.node`: PAM auth

## Key Files Quick Reference

### Server Core
- `src/cli.ts`: Main entry point
- `src/server/server.ts`: Server implementation
- `src/server/middleware/auth.ts`: Authentication
- `src/server/routes/sessions.ts`: Session API
- `src/server/routes/websocket-input.ts`: WebSocket input
- `src/server/pty/pty-manager.ts`: PTY management
- `src/server/services/terminal-manager.ts`: Terminal state
- `src/server/services/activity-monitor.ts`: Activity tracking
- `src/server/fwd.ts`: CLI forwarding tool

### Client Core
- `src/client/app-entry.ts`: Entry point
- `src/client/app.ts`: Main SPA
- `src/client/components/terminal.ts`: Terminal renderer
- `src/client/components/session-view.ts`: Session viewer
- `src/client/services/buffer-subscription-service.ts`: WebSocket
- `src/client/services/websocket-input-client.ts`: Low-latency input
- `src/client/utils/cast-converter.ts`: Asciinema parser

### Configuration
- Environment: `PORT`, `VIBETUNNEL_USERNAME`, `VIBETUNNEL_PASSWORD`, `VIBETUNNEL_DEBUG`
- CLI: `--port`, `--username`, `--password`, `--hq`, `--hq-url`, `--name`
- Debug logging: Set `VIBETUNNEL_DEBUG=1` or `true`

### Protocols
- REST API: Session CRUD, terminal I/O
- SSE: Real-time asciinema streaming
- WebSocket: Binary buffer updates
- WebSocket Input: Low-latency keyboard/mouse
- Control pipes: External session control

### Session Data Storage
Each session has a directory in `~/.vibetunnel/control/[sessionId]/`:
- `session.json`: Session metadata
- `stream-out`: Asciinema cast file
- `stdin`: Input pipe
- `control`: Control pipe
- `stdout`: Raw output file
- `activity.json`: Activity status

## Development Notes

### Recent Improvements
- WebSocket input endpoint for lower latency
- Advanced terminal title management system
- Unified shutdown state management
- Atomic file writes for session data
- Split-screen support in web UI
- Enhanced activity monitoring with 100ms precision
- Improved command resolution for aliases
- Better error messages for spawn failures

### Testing
- Unit tests: `pnpm test`
- E2E tests: `pnpm run test:e2e`
- Vitest configuration with coverage

### Key Dependencies
- node-pty: Cross-platform PTY
- @xterm/headless: Terminal emulation
- Lit: Web components
- Express: HTTP server
- web-push: Push notifications
- TailwindCSS: Styling
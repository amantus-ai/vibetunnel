# VibeTunnel Codebase Map

A comprehensive navigation guide for the VibeTunnel web terminal system.

## Project Overview

VibeTunnel is a web-based terminal multiplexer with distributed architecture support. It provides:
- PTY-based terminal sessions via node-pty
- Real-time terminal streaming via SSE (asciinema cast files)
- Binary-optimized buffer synchronization (current viewport via WebSocket)
- Distributed HQ/remote server architecture
- Web UI with full terminal emulation

## Directory Structure

```
web/
├── src/
│   ├── server/           # Node.js Express server
│   │   ├── middleware/   # Auth and other middleware
│   │   ├── pty/         # PTY management
│   │   ├── routes/      # API endpoints
│   │   ├── services/    # Core services
│   │   ├── server.ts    # Server loader
│   │   └── fwd.ts       # CLI forwarding tool
│   ├── client/           # Lit-based web UI
│   │   ├── assets/      # Static files (fonts, icons, html)
│   │   ├── components/  # UI components
│   │   ├── services/    # Client services
│   │   └── utils/       # Client utilities
│   ├── test/            # Test files
│   └── index.ts         # Main entry point
├── scripts/             # Build scripts
└── public/              # Built static assets (generated)
```

## Server Architecture (`src/server/`)

### Core Components

#### Entry Points
- `index.ts` (1-25): Main entry point, chooses between server and forward modes
- `server/server.ts` (1-4): Simple loader for modular server
- `server/index.ts` (1-49): Server initialization, cleanup intervals, graceful shutdown
- `server/app.ts` (198-404): Express app factory, CLI parsing, mode configuration

#### Server Modes
1. **Normal Mode**: Standalone terminal server
2. **HQ Mode** (`--hq`): Central server managing remotes
3. **Remote Mode** (`--hq-url`): Registers with HQ server

### Authentication (`middleware/auth.ts`)
- Basic Auth: Username/password (46-55)
- Bearer Token: HQ↔Remote communication (28-44)
- Health endpoint bypass (14-16)

### Session Management

#### PTY Manager (`pty/pty-manager.ts`)
- `createSession()` (155-287): Spawns PTY processes
  - Supports `forwardToStdout` option for direct stdout forwarding
  - Supports `onExit` callback for handling process termination
  - **Automatic alias resolution**: Uses `ProcessUtils.resolveCommand()` to detect and run aliases through shell
- `sendInput()` (515-588): Handles keyboard input
- `killSession()` (687-764): SIGTERM→SIGKILL escalation
- `resizeSession()` (638-681): Terminal dimension changes
- Control pipe support using file watching on all platforms (414-475)
- `shutdown()` (937-974): Clean termination of all active sessions
- Proper TypeScript types throughout (no "as any" assertions)

#### Process Utils (`pty/process-utils.ts`)
- `resolveCommand()` (168-242): Detects if command exists in PATH or needs shell execution
  - Uses `which` (Unix) or `where` (Windows) to check command existence
  - Returns appropriate shell command with args for aliases/builtins
  - Platform-specific shell argument handling
- `getUserShell()` (219-281): Determines user's preferred shell
  - Checks `$SHELL` environment variable first
  - Windows: Checks for pwsh, PowerShell, Git Bash, then cmd.exe
  - Unix: Checks common shell paths (/bin/zsh, /bin/bash, etc.)

#### Session Manager (`pty/session-manager.ts`)
- Session persistence in `~/.vibetunnel/control/`
- `listSessions()` (155-224): Filesystem-based discovery
- `updateZombieSessions()` (231-257): Dead process cleanup

#### Terminal Manager (`services/terminal-manager.ts`)
- Headless xterm.js for server-side state (40-69)
- `getBufferSnapshot()` (255-323): Captures terminal buffer
- `encodeSnapshot()` (328-555): Binary protocol encoding
- Debounced buffer notifications (627-642)

### API Routes (`routes/`)

#### Sessions (`sessions.ts`)
- `GET /api/sessions` (40-120): List with HQ aggregation
  - Returns array of `SessionEntryWithId` objects with additional fields:
    - All fields from `SessionEntryWithId` (see types.ts)
    - `source`: 'local' | 'remote'
    - For remote sessions: `remoteId`, `remoteName`, `remoteUrl`
- `POST /api/sessions` (123-199): Create local/remote
- `DELETE /api/sessions/:id` (270-323): Kill session
- `GET /api/sessions/:id/stream` (517-627): SSE streaming of asciinema cast files
- `POST /api/sessions/:id/input` (630-695): Send input
- `POST /api/sessions/:id/resize` (698-767): Resize terminal
- `GET /api/sessions/:id/buffer` (569-631): Binary snapshot of current terminal view
- `GET /api/sessions/:id/text` (504-654): Plain text of current terminal view
  - Optional `?styles` query parameter adds style markup
  - Style format: `[style fg="color" bg="color" bold italic ...]text[/style]`
  - Colors: indexed (0-255) as `"15"`, RGB as `"255,128,0"`
  - Attributes: bold, dim, italic, underline, inverse, invisible, strikethrough
- `GET /api/sessions/activity` (255-311): Activity status for all sessions
  - Returns: `{ [sessionId]: ActivityStatus }` where ActivityStatus includes:
    - `isActive`: boolean - Currently generating output
    - `timestamp`: string - Last update time
    - `session`: SessionInfo object (see types.ts)
  - In HQ mode: aggregates activity from all remote servers
- `GET /api/sessions/:id/activity` (314-370): Activity status for specific session
  - Returns: `ActivityStatus` object (same format as above)
  - In HQ mode: forwards to appropriate remote server

#### Remotes (`remotes.ts`) - HQ Mode Only
- `GET /api/remotes` (15-27): List registered servers
- `POST /api/remotes/register` (30-52): Remote registration
- `DELETE /api/remotes/:id` (55-69): Unregister remote

#### Logs (`logs.ts`)
- `POST /api/logs/client` (24-56): Client-side log submission
  - Accepts: `{ level, module, args }`
  - Prefixes module with `CLIENT:` for identification
- `GET /api/logs/raw` (59-76): Stream raw log file
- `GET /api/logs/info` (79-104): Log file metadata
- `DELETE /api/logs/clear` (107-121): Clear log file

### Binary Buffer Protocol

**Note**: "Buffer" refers to the current terminal display state (visible viewport) without scrollback history - just what's currently shown at the bottom of the terminal. This is used for rendering terminal previews in the session list.

#### Format (`terminal-manager.ts:361-555`)
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

#### File Writing (`pty/asciinema-writer.ts`)
- **AsciinemaWriter** (separate file) writes cast files to `~/.vibetunnel/control/[sessionId]/stream-out`
- Used by PtyManager when creating sessions
- Records in asciinema v2 format with custom extensions:
  - Standard: `[timestamp, "o", output]` for terminal output
  - Standard: `[timestamp, "i", input]` for user input
  - Standard: `[timestamp, "r", "colsxrows"]` for resize events
  - **Custom**: `["exit", exitCode, sessionId]` when process terminates

#### SSE Streaming (`routes/sessions.ts:517-627`)
- Streams asciinema cast files from disk in real-time
- **StreamWatcher** monitors file changes and broadcasts to clients
- Replays existing content first (timestamps zeroed)
- Watches for new content and streams incrementally
- Closes connections on exit event

#### Client Playback (`client/utils/cast-converter.ts`)
- Parses asciinema v2 format
- Handles custom exit event to dispatch `session-exit`
- Supports batch loading and real-time streaming

### WebSocket (`services/buffer-aggregator.ts`)
- Client connections (31-68)
- Message handling (69-127)
- Local session buffers (131-195)
- Remote session proxy (200-232)
- Binary message format (136-164)

### Activity Monitoring (`services/activity-monitor.ts`)

#### Overview
Monitors all terminal sessions for activity by watching `stream-out` file changes.
- Works for ALL sessions regardless of creation method (server or fwd.ts)
- No performance impact on terminal output
- File-based persistence for cross-process access

#### Implementation
- `start()` (26-37): Begins monitoring with 100ms check interval
- `scanSessions()` (61-98): Discovers and monitors session directories
- `handleFileChange()` (146-168): Detects output by file size increase
- `updateActivityStates()` (173-182): Marks inactive after 500ms timeout
- `writeActivityStatus()` (187-198): Persists to `activity.json` per session

#### Activity Status Format
```json
{
  "isActive": boolean,
  "timestamp": "ISO 8601 date string",
  "session": {                                   // SessionInfo object from session.json
    "cmdline": ["command", "args"],
    "name": "session name",
    "cwd": "/working/directory",
    "pid": 12345,
    "status": "starting" | "running" | "exited",
    "exit_code": 0,
    "started_at": "ISO 8601 date string",
    "term": "xterm-256color",
    "spawn_type": "pty"
  }
}
```

### HQ Mode Components

#### Remote Registry (`services/remote-registry.ts`)
- Health checks every 15s (118-146)
- Session ownership tracking (82-96)
- Bearer token authentication

#### HQ Client (`services/hq-client.ts`)
- Registration with HQ (29-58)
- Unregister on shutdown (60-72)

### Logging Infrastructure (`utils/logger.ts`)

#### Server Logger
- Unified logging with file and console output
- Log levels: log, warn, error, debug
- File output to `~/.vibetunnel/log.txt`
- Formatted timestamps and module names
- Debug mode toggle
- Style guide compliance (see LOGGING_STYLE_GUIDE.md)

#### Client Logger (`client/utils/logger.ts`)
- Mirrors server logger interface
- Logs to browser console
- Sends logs to `/api/logs/client` endpoint
- Objects formatted as JSON before sending
- Integrates with server logging system

## Client Architecture (`src/client/`)

### Core Components

#### Entry Points
- `app-entry.ts` - Main application entry point
- `test-terminals-entry.ts` - Test terminals entry point
- `styles.css` - Global styles

#### Main Application Component
- `app.ts` - Lit-based SPA (15-331)
  - URL-based routing `?session=<id>`
  - Global keyboard handlers
  - Error/success message handling (74-90)
  - **Events fired**:
    - `toggle-nav` - Toggle navigation
    - `navigate-to-list` - Navigate to session list
    - `error` - Display error message
    - `success` - Display success message
    - `navigate` - Navigate to specific session
  - **Events listened**: Various events from child components

### Component Event Architecture

#### Terminal Components

##### `terminal.ts` - Custom DOM terminal renderer (17-1000+)
Full terminal implementation with xterm.js for rendering and input handling.
- Virtual scrolling (537-555)
- Touch/momentum support
- URL highlighting integration
- Copy/paste handling
- **Events fired**:
  - `terminal-ready` - When terminal is initialized and ready
  - `terminal-input` - When user types (detail: string)
  - `terminal-resize` - When terminal is resized (detail: { cols: number, rows: number })
  - `url-clicked` - When a URL is clicked (detail: string)

##### `session-view.ts` - Full-screen terminal view (29-1331)
Full-screen terminal view for an active session. Handles terminal I/O, streaming updates via SSE, file browser integration, and mobile overlays.
- SSE streaming (275-333)
- Mobile input overlays
- Resize synchronization
- **Events fired**:
  - `navigate-to-list` - When navigating back to session list
  - `error` - When an error occurs (detail: string)
  - `warning` - When a warning occurs (detail: string)
- **Events listened**:
  - `session-exit` - From SSE stream when session exits
  - `terminal-ready` - From terminal component when ready
  - `file-selected` - From file browser when file is selected
  - `browser-cancel` - From file browser when cancelled

##### `vibe-terminal-buffer.ts` - Terminal buffer display (25-268)
Displays a read-only terminal buffer snapshot with automatic resizing. Subscribes to buffer updates via WebSocket and renders the terminal content.
- **Events fired**:
  - `content-changed` - When terminal content changes (no detail)

#### Session Management Components

##### `session-list.ts` - Active sessions list view (61-700+)
Main session list view showing all active terminal sessions with real-time updates, search/filtering, and session management capabilities.
- **Events fired**:
  - `navigate` - When clicking on a session (detail: { sessionId: string })
  - `error` - When an error occurs (detail: string)
  - `success` - When an operation succeeds (detail: string)
  - `session-created` - When a new session is created (detail: Session)
  - `session-updated` - When a session is updated (detail: Session)
  - `sessions-changed` - When the session list changes
  - `toggle-create-form` - When toggling the create form
- **Events listened**:
  - `session-created` - From create form
  - `cancel` - From create form
  - `error` - From create form

##### `session-card.ts` - Individual session card (31-420+)
Individual session card component showing terminal preview and session controls. Displays a live terminal buffer preview and detects activity changes.
- **Events fired**:
  - `view-session` - When viewing a session (detail: Session)
  - `kill-session` - When killing a session (detail: Session)
  - `copy-session-id` - When copying session ID (detail: Session)
- **Events listened**:
  - `content-changed` - From vibe-terminal-buffer component

##### `session-create-form.ts` - New session creation form (27-381)
Modal dialog for creating new terminal sessions. Provides command input, working directory selection, and options for spawning in native terminal.
- **Events fired**:
  - `session-created` - When session is successfully created (detail: { sessionId: string, message?: string })
  - `cancel` - When form is cancelled
  - `error` - When creation fails (detail: string)
- **Events listened**:
  - `file-selected` - From file browser when directory is selected
  - `browser-cancel` - From file browser when cancelled

#### UI Components

##### `app-header.ts` - Application header (15-280+)
Main application header with logo, title, navigation controls, and session status.
- **Events fired**:
  - `toggle-nav` - Toggle navigation menu
  - `navigate-to-list` - Navigate to session list
  - `toggle-create-form` - Toggle session create form
  - `toggle-theme` - Toggle dark/light theme
  - `open-settings` - Open settings modal

##### `file-browser.ts` - File browser component (48-665)
Modal file browser for navigating the filesystem and selecting files/directories. Supports Git status display, file preview with Monaco editor, and diff viewing.
- **Events fired**:
  - `insert-path` - When inserting a file path into terminal (detail: { path: string, type: 'file' | 'directory' })
  - `open-in-editor` - When opening a file in external editor (detail: { path: string })
  - `directory-selected` - When a directory is selected in 'select' mode (detail: string)
  - `browser-cancel` - When the browser is cancelled or closed

##### `log-viewer.ts` - System log viewer (1-432)
Real-time log viewer with filtering and search capabilities.
- SSE-style polling every 2 seconds
- Client/server log distinction
- Log level filtering
- Relative timestamps
- Mobile-responsive layout
- Mac-style auto-hiding scrollbars
- **Features**:
  - Filter by log level (error, warn, log, debug)
  - Toggle client/server logs
  - Search/filter by text
  - Auto-scroll (smart - only when near bottom)
  - Download logs
  - Clear logs

##### Icon Components
- `vibe-logo.ts` - Application logo
- `terminal-icon.ts` - Terminal icon
- `copy-icon.ts` - Copy icon

### Services

#### Buffer Subscription (`services/buffer-subscription-service.ts`)
- WebSocket client (30-87)
- Binary protocol decoder (163-208)
- Auto-reconnection with backoff

### Utils

#### Cast Converter (`utils/cast-converter.ts`)
- Asciinema v2 parser (31-82)
- SSE stream handler (294-427)
- Batch loading (221-283)

#### Terminal Renderer (`utils/terminal-renderer.ts`)
- Binary buffer decoder (279-424)
- HTML generation
- Style mapping

#### Additional Utilities
- `url-highlighter.ts` - URL detection and highlighting
- `xterm-colors.ts` - Terminal color definitions
- `terminal-preferences.ts` - Terminal preference management

## Forward Tool (`src/server/fwd.ts`)

### Purpose
Simplified CLI tool that spawns PTY sessions using VibeTunnel infrastructure.

### Key Features
- Interactive terminal forwarding with colorful output (chalk)
- Session creation with pre-generated IDs support
- Graceful cleanup on exit
- **Automatic shell alias support** via ProcessUtils.resolveCommand()

### Usage
```bash
npx tsx src/fwd.ts [--session-id <id>] <command> [args...]

# Examples with aliases
npx tsx src/fwd.ts claude-danger  # Automatically resolved through shell
```

### Integration Points
- Uses PtyManager for all session management
- Control pipe and stdin forwarding handled by PtyManager
- Automatic cleanup via PtyManager's shutdown() method

## Key Files Quick Reference

### Server Core
- `src/index.ts`: Main entry point
- `src/server/server.ts`: Server loader
- `src/server/app.ts`: App configuration, CLI parsing
- `src/server/middleware/auth.ts`: Authentication logic
- `src/server/routes/sessions.ts`: Session API endpoints
- `src/server/pty/pty-manager.ts`: PTY process management with file-watching control pipes
- `src/server/pty/asciinema-writer.ts`: Cast file writer
- `src/server/services/terminal-manager.ts`: Terminal state & binary protocol
- `src/server/services/buffer-aggregator.ts`: WebSocket buffer distribution
- `src/server/services/stream-watcher.ts`: SSE file streaming
- `src/server/services/activity-monitor.ts`: Session activity detection
- `src/server/fwd.ts`: Simplified CLI forwarding tool

### Client Core
- `src/client/app-entry.ts`: Application entry point
- `src/client/app.ts`: Main SPA component
- `src/client/components/terminal.ts`: Terminal renderer
- `src/client/components/session-view.ts`: Session viewer
- `src/client/components/session-list.ts`: Session list view
- `src/client/services/buffer-subscription-service.ts`: WebSocket client
- `src/client/utils/cast-converter.ts`: Asciinema parser
- `src/client/assets/`: Static files (fonts, icons, HTML)

### Configuration
- Environment: `PORT`, `VIBETUNNEL_USERNAME`, `VIBETUNNEL_PASSWORD`, `VIBETUNNEL_DEBUG`
- CLI: `--port`, `--username`, `--password`, `--hq`, `--hq-url`, `--name`
- Express static: `.html` extension handling for clean URLs
- Debug logging: Set `VIBETUNNEL_DEBUG=1` or `VIBETUNNEL_DEBUG=true`

### Protocols
- REST API: Session CRUD, terminal I/O, activity status
- SSE: Real-time streaming of asciinema cast files from disk
- WebSocket: Binary buffer updates (current terminal viewport)
- Control pipes: External session control

### Session Data Storage
Each session has a directory in `~/.vibetunnel/control/[sessionId]/` containing:
- `session.json`: Session metadata
- `stream-out`: Asciinema cast file with terminal output
- `stdin`: Input pipe for sending keystrokes
- `control`: Control pipe for resize/kill commands
- `activity.json`: Activity status (written by ActivityMonitor)

## Development Notes

### Architecture Changes (Recent)
- PTY Manager now uses file watching for control pipes on all platforms (not just FIFO)
- No global exit handlers - clean shutdown via `shutdown()` method
- Simplified fwd.ts - control pipe and stdin forwarding handled by PTY Manager
- Added proper TypeScript types throughout (removed all "as any" assertions)
- Cleaned up logging and added colorful output messages using chalk
- **Unified logging infrastructure**:
  - Server-wide adoption of structured logger
  - Client-side logger with server integration
  - Centralized log viewer at `/logs`
  - Consistent style guide (LOGGING_STYLE_GUIDE.md)
- **Express enhancements**:
  - Auto `.html` extension resolution for static files

### Build System
- `pnpm run dev`: Auto-rebuilds TypeScript
- `pnpm run build`: Full build including Node.js SEA executable
- ESBuild: Fast bundling
- Node.js SEA: Creates standalone executable (Node.js 20+ required)
- Vitest: Testing framework
- Assets: Copied from `src/client/assets/` to `public/` during build

### Testing
- Unit tests: `pnpm test`
- E2E tests: `pnpm run test:e2e`
- Integration: `pnpm run test:integration`

### Key Dependencies
- node-pty: Cross-platform PTY
- @xterm/headless: Terminal emulation
- Lit: Web components
- Express: HTTP server
- TailwindCSS: Styling
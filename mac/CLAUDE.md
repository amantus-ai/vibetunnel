# CLAUDE.md for macOS Development

## SwiftUI Development Guidelines

* Aim to build all functionality using SwiftUI unless there is a feature that is only supported in AppKit.
* Design UI in a way that is idiomatic for the macOS platform and follows Apple Human Interface Guidelines.
* Use SF Symbols for iconography.
* Use the most modern macOS APIs. Since there is no backward compatibility constraint, this app can target the latest macOS version with the newest APIs.
* Use the most modern Swift language features and conventions. Target Swift 6 and use Swift concurrency (async/await, actors) and Swift macros where applicable.

## Logging Guidelines

**IMPORTANT**: Never use `print()` statements in production code. Always use the unified logging system with proper Logger instances.

### Setting up Loggers

Each Swift file should declare its own logger at the top of the file:

```swift
import os.log

private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "CategoryName")
```

### Log Levels

Choose the appropriate log level based on context:

- **`.debug`** - Detailed information useful only during development/debugging
  ```swift
  logger.debug("Detailed state: \(internalState)")
  ```

- **`.info`** - General informational messages about normal app flow
  ```swift
  logger.info("Session created with ID: \(sessionID)")
  ```

- **`.notice`** - Important events that are part of normal operation
  ```swift
  logger.notice("User authenticated successfully")
  ```

- **`.warning`** - Warnings about potential issues that don't prevent operation
  ```swift
  logger.warning("Failed to cache data, continuing without cache")
  ```

- **`.error`** - Errors that indicate failure but app can continue
  ```swift
  logger.error("Failed to load preferences: \(error)")
  ```

- **`.fault`** - Critical errors that indicate programming mistakes or system failures
  ```swift
  logger.fault("Unexpected nil value in required configuration")
  ```

### Common Patterns

```swift
// Instead of:
print("🔍 [GitRepositoryMonitor] findRepository called for: \(filePath)")

// Use:
logger.info("🔍 findRepository called for: \(filePath)")

// Instead of:
print("❌ [GitRepositoryMonitor] Failed to get git status: \(error)")

// Use:
logger.error("❌ Failed to get git status: \(error)")
```

### Benefits

- Logs are automatically categorized and searchable with `vtlog`
- Performance optimized (debug logs compiled out in release builds)
- Privacy-aware (use `\(value, privacy: .public)` when needed)
- Integrates with Console.app and system log tools
- Consistent format across the entire codebase

## Important Build Instructions

### Xcode Build Process
**CRITICAL**: When you build the Mac app with Xcode (using XcodeBuildMCP or manually), it automatically builds the web server as part of the build process. The Xcode build scripts handle:
- Building the TypeScript/Node.js server
- Bundling all web assets
- Creating the native executable
- Embedding everything into the Mac app bundle

**DO NOT manually run `pnpm run build` in the web directory when building the Mac app** - this is redundant and wastes time.

### Always Use Subtasks
**IMPORTANT**: Always use the Task tool for operations, not just when hitting context limits:
- For ANY command that might generate output (builds, logs, file reads)
- For parallel operations (checking multiple files, running searches)
- For exploratory work (finding implementations, debugging)
- This keeps the main context clean and allows better organization

Examples:
```
# Instead of: pnpm run build
Task(description="Build web bundle", prompt="Run pnpm run build in the web directory and report if it succeeded or any errors")

# Instead of: ./scripts/vtlog.sh -n 100
Task(description="Check VibeTunnel logs", prompt="Run ./scripts/vtlog.sh -n 100 and summarize any errors or warnings")

# Instead of: multiple file reads
Task(description="Analyze WebRTC implementation", prompt="Read WebRTCManager.swift and webrtc-handler.ts, then explain the offer/answer flow")
```

## VibeTunnel Architecture Overview

VibeTunnel is a macOS application that provides terminal access through web browsers. It consists of three main components:

### 1. Mac App (Swift/SwiftUI)
- Native macOS application that manages the entire system
- Spawns and manages the Bun/Node.js server process
- Handles terminal creation and management
- Provides system tray UI and settings

### 2. Web Server (Node.js)
- Runs on **localhost:4020** by default
- Serves the web frontend
- Manages WebSocket connections for terminal I/O
- Handles API requests and session management
- Routes logs from the frontend to the Mac app

### 3. Web Frontend (TypeScript/LitElement)
- Browser-based terminal interface
- Connects to the server via WebSocket
- Uses xterm.js for terminal rendering
- Sends logs back to server for centralized logging

## Logging Architecture

VibeTunnel has a sophisticated logging system that aggregates logs from all components:

### Log Flow
```
Frontend (Browser) → Server (Bun) → Mac App → macOS Unified Logging
     [module]         [CLIENT:module]      ServerOutput category
```

### Log Prefixing System

To help identify where logs originate, the system uses these prefixes:

1. **Frontend Logs**: 
   - Browser console: `[module-name] message`
   - When forwarded to server: `[CLIENT:module-name] message`

2. **Server Logs**:
   - Direct server logs: `[module-name] message`
   - No additional prefix needed

3. **Mac App Logs**:
   - Native Swift logs: Use specific categories (ServerManager, SessionService, etc.)
   - Server output: All captured under "ServerOutput" category

### Understanding Log Sources

When viewing logs with `vtlog`, you can identify the source:
- `[CLIENT:*]` - Originated from web frontend
- `[server]`, `[api]`, etc. - Server-side modules
- Category-based logs - Native Mac app components

## Debugging and Logging

The VibeTunnel Mac app uses the unified logging system with the subsystem `sh.vibetunnel.vibetunnel`. We provide a convenient `vtlog` script to simplify log access.

### Quick Start with vtlog

The `vtlog` script is located at `scripts/vtlog.sh`. It's designed to be context-friendly by default.

**Default behavior: Shows last 50 lines from the past 5 minutes**

```bash
# Show recent logs (default: last 50 lines from past 5 minutes)
./scripts/vtlog.sh

# Stream logs continuously (like tail -f)
./scripts/vtlog.sh -f

# Show only errors
./scripts/vtlog.sh -e

# Show more lines
./scripts/vtlog.sh -n 100

# View logs from different time range
./scripts/vtlog.sh -l 30m

# Filter by category
./scripts/vtlog.sh -c ServerManager

# Search for specific text
./scripts/vtlog.sh -s "connection failed"
```

### Common Use Cases

```bash
# Quick check for recent errors (context-friendly)
./scripts/vtlog.sh -e

# Debug server issues
./scripts/vtlog.sh --server -e

# Watch logs in real-time
./scripts/vtlog.sh -f

# Debug screen capture with more context
./scripts/vtlog.sh -c ScreencapService -n 100

# Find authentication problems in last 2 hours
./scripts/vtlog.sh -s "auth" -l 2h

# Export comprehensive debug logs
./scripts/vtlog.sh -d -l 1h --all -o ~/Desktop/debug.log

# Get all logs without tail limit
./scripts/vtlog.sh --all
```

### Available Categories
- **ServerManager** - Server lifecycle and configuration
- **SessionService** - Terminal session management
- **TerminalManager** - Terminal spawning and control
- **GitRepository** - Git integration features
- **ScreencapService** - Screen capture functionality
- **WebRTCManager** - WebRTC connections
- **UnixSocket** - Unix socket communication
- **WindowTracker** - Window tracking and focus
- **NgrokService** - Ngrok tunnel management
- **ServerOutput** - Node.js server output (includes frontend logs)

### Manual Log Commands

If you prefer using the native `log` command directly:

```bash
# Stream logs
log stream --predicate 'subsystem == "sh.vibetunnel.vibetunnel"' --level info

# Show historical logs
log show --predicate 'subsystem == "sh.vibetunnel.vibetunnel"' --info --last 30m

# Filter by category
log stream --predicate 'subsystem == "sh.vibetunnel.vibetunnel" AND category == "ServerManager"'
```

### Tips
- Run `./scripts/vtlog.sh --help` for full documentation
- Use `-d` flag for debug-level logs during development
- The app logs persist after the app quits, useful for crash debugging
- Add `--json` for machine-readable output
- Server logs (Node.js output) are under the "ServerOutput" category
- Look for `[CLIENT:*]` prefix to identify frontend-originated logs

## Testing the Web Interface

The VibeTunnel server runs on localhost:4020 by default. To test the web interface:

1. Ensure the Mac app is running. The user does that. Do not start the mac app yourself!
2. Access http://localhost:4020 in your browser
3. Use Playwright MCP for automated testing:
   ```
   # Example: Navigate to the interface
   # Take screenshots
   # Interact with terminal sessions
   ```

## Key Implementation Details

### Server Process Management
- The Mac app spawns the Bun server using `BunServer.swift`
- Server logs are captured and forwarded to macOS logging system
- Process lifecycle is tied to the Mac app lifecycle

### Log Aggregation
- All logs flow through the Mac app for centralized access
- Use `vtlog` to see logs from all components in one place
- Frontend errors are particularly useful for debugging UI issues

### Development Workflow
1. Use XcodeBuildMCP for Swift changes
2. The web frontend auto-reloads on changes (when `pnpm run dev` is running)
3. Use Playwright MCP to test integration between components
4. Monitor all logs with `vtlog -f` during development

## Unix Socket Communication Protocol

### Type Synchronization Between Mac and Web
When implementing new Unix socket message types between the Mac app and web server, it's essential to maintain type safety on both sides:

1. **Mac Side**: Define message types in Swift (typically in `ControlProtocol.swift` or related files)
2. **Web Side**: Create corresponding TypeScript interfaces in `web/src/shared/types.ts`
3. **Keep Types in Sync**: Whenever you add or modify Unix socket messages, update the types on both platforms to ensure type safety and prevent runtime errors

Example workflow:
- Add new message type to `ControlProtocol.swift` (Mac)
- Add corresponding interface to `types.ts` (Web)
- Update handlers on both sides to use the typed messages
- This prevents bugs from mismatched message formats and makes the protocol self-documenting
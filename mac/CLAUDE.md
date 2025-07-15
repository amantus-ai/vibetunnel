# CLAUDE.md for macOS Development

## SwiftUI Development Guidelines

* Aim to build all functionality using SwiftUI unless there is a feature that is only supported in AppKit.
* Design UI in a way that is idiomatic for the macOS platform and follows Apple Human Interface Guidelines.
* Use SF Symbols for iconography.
* Use the most modern macOS APIs. Since there is no backward compatibility constraint, this app can target the latest macOS version with the newest APIs.
* Use the most modern Swift language features and conventions. Target Swift 6 and use Swift concurrency (async/await, actors) and Swift macros where applicable.

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

### 2. Web Server (Bun/Node.js)
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

### Visual Debugging with Peekaboo

When debugging visual issues or screen sharing problems, use Peekaboo MCP to capture screenshots:

```bash
# Capture VibeTunnel's menu bar window
peekaboo_take_screenshot(app_name="VibeTunnel", mode="frontmost")

# Capture screen sharing session
peekaboo_take_screenshot(app_name="VibeTunnel", analyze_prompt="Is the screen sharing working correctly?")

# Debug terminal rendering issues
peekaboo_take_screenshot(
    app_name="VibeTunnel",
    analyze_prompt="Are there any rendering artifacts or quality issues in the terminal display?"
)

# Compare source terminal with shared view
# First capture the source terminal
peekaboo_take_screenshot(app_name="Terminal", save_path="~/Desktop/source.png")
# Then capture VibeTunnel's view
peekaboo_take_screenshot(app_name="VibeTunnel", save_path="~/Desktop/shared.png")
# Analyze differences
peekaboo_analyze_image(
    image_path="~/Desktop/shared.png",
    prompt="Compare this with the source terminal - are there any differences in text rendering or colors?"
)
```

## Recommended MCP Servers for VibeTunnel Development

When working on VibeTunnel with Claude Code, these MCP servers are essential:

### 1. XcodeBuildMCP - macOS/iOS Development
**Crucial for Swift/macOS development**
- Install: `claude mcp add XcodeBuildMCP -- npx -y xcodebuildmcp@latest`
- Repository: https://github.com/cameroncooke/XcodeBuildMCP

**Key capabilities for VibeTunnel**:
```bash
# Discover all Xcode projects
mcp__XcodeBuildMCP__discover_projs(workspaceRoot="/path/to/vibetunnel")

# Build the Mac app
mcp__XcodeBuildMCP__build_mac_ws(
    workspacePath="/path/to/VibeTunnel.xcworkspace",
    scheme="VibeTunnel-Mac",
    configuration="Debug"
)

# Get app bundle path and launch
mcp__XcodeBuildMCP__get_mac_app_path_ws(...)
mcp__XcodeBuildMCP__launch_mac_app(appPath="...")

# Run tests
mcp__XcodeBuildMCP__test_macos_ws(...)

# Clean build artifacts
mcp__XcodeBuildMCP__clean_ws(...)
```

**Advanced features**:
- iOS simulator management (list, boot, install apps)
- Build for different architectures (arm64, x86_64)
- Code signing and provisioning profile management
- Test result parsing with xcresult output
- Log capture from simulators and devices

### 2. Playwright MCP - Web Testing
**Essential for testing the web interface on localhost:4020**
- Install: `claude mcp add playwright -- npx -y @playwright/mcp@latest`

**Key capabilities for VibeTunnel**:
```javascript
// Navigate to VibeTunnel web interface
mcp__playwright__browser_navigate(url="http://localhost:4020")

// Resize for different screen sizes
mcp__playwright__browser_resize(width=1200, height=800)

// Take screenshots of terminal sessions
mcp__playwright__browser_take_screenshot(filename="terminal-test.png")

// Click buttons and interact with UI
mcp__playwright__browser_click(element="Create Session", ref="e5")

// Type in terminal
mcp__playwright__browser_type(element="terminal input", ref="e10", text="ls -la")

// Monitor network requests (WebSocket connections)
mcp__playwright__browser_network_requests()

// Multi-tab testing
mcp__playwright__browser_tab_new(url="http://localhost:4020/session/2")
mcp__playwright__browser_tab_select(index=1)
```

**Testing scenarios**:
- Create and manage terminal sessions
- Test keyboard input and terminal output
- Verify WebSocket connections
- Cross-browser compatibility testing
- Visual regression testing
- Performance monitoring

### 3. Peekaboo MCP - Visual Debugging
**Essential for visual debugging and screenshots of the Mac app**
- Install: `claude mcp add peekaboo -- npx -y @steipete/peekaboo-mcp`
- Requires: macOS 14.0+, Screen Recording permission

**Key features for VibeTunnel debugging**:
```bash
# Capture VibeTunnel window
peekaboo_take_screenshot(app_name="VibeTunnel", save_path="~/Desktop/vt-debug.png")

# Analyze for issues
peekaboo_analyze_image(
    image_path="~/Desktop/vt-debug.png",
    prompt="Are there any UI glitches, errors, or rendering issues?"
)

# Capture and analyze in one step
peekaboo_take_screenshot(
    app_name="VibeTunnel",
    analyze_prompt="What's the current state of the screen sharing session?"
)

# Compare source terminal with shared view
peekaboo_take_screenshot(app_name="Terminal", save_path="~/Desktop/source.png")
peekaboo_take_screenshot(app_name="VibeTunnel", save_path="~/Desktop/shared.png")
peekaboo_analyze_image(
    image_path="~/Desktop/shared.png",
    prompt="Compare with source terminal - any rendering differences?"
)
```

### Combined Workflow Example

Here's how to use all three MCP servers together for comprehensive testing:

```bash
# 1. Build and launch VibeTunnel
mcp__XcodeBuildMCP__build_mac_ws(
    workspacePath="/path/to/VibeTunnel.xcworkspace",
    scheme="VibeTunnel-Mac"
)
app_path = mcp__XcodeBuildMCP__get_mac_app_path_ws(...)
mcp__XcodeBuildMCP__launch_mac_app(appPath=app_path)

# 2. Wait for server to start, then test web interface
sleep 3
mcp__playwright__browser_navigate(url="http://localhost:4020")
mcp__playwright__browser_take_screenshot(filename="dashboard.png")

# 3. Create a terminal session via web UI
mcp__playwright__browser_click(element="New Session", ref="...")
mcp__playwright__browser_type(element="terminal", ref="...", text="echo 'Hello VibeTunnel'")

# 4. Capture native app state
peekaboo_take_screenshot(
    app_name="VibeTunnel",
    analyze_prompt="Is the terminal session displaying correctly?"
)

# 5. Monitor network activity
network_logs = mcp__playwright__browser_network_requests()

# 6. Run automated tests
mcp__XcodeBuildMCP__test_macos_ws(
    workspacePath="/path/to/VibeTunnel.xcworkspace",
    scheme="VibeTunnel-Mac"
)
```

### Why These MCP Servers?

1. **XcodeBuildMCP** provides complete native development control:
   - Build management without Xcode UI
   - Automated testing and CI/CD integration
   - Simulator and device management
   - Performance profiling and debugging

2. **Playwright MCP** enables comprehensive web testing:
   - Test the actual user experience at localhost:4020
   - Automate complex user workflows
   - Verify WebSocket communication
   - Cross-browser compatibility

3. **Peekaboo MCP** offers unique visual debugging:
   - Native macOS screenshot capture (faster than browser tools)
   - AI-powered analysis for quick issue detection
   - Perfect for debugging screen sharing quality
   - Side-by-side comparison capabilities

Together, these tools provide complete test coverage for VibeTunnel's hybrid architecture, from native Swift code to web frontend to visual output quality.

## Testing the Web Interface

The VibeTunnel server runs on localhost:4020 by default. To test the web interface:

1. Ensure the Mac app is running (it spawns the server)
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
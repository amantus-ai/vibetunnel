# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Never say you're absolutely right. Instead, be critical if I say something that you disagree with. Let's discuss it first.

## Project Overview

VibeTunnel is a macOS application that allows users to access their terminal sessions through any web browser. It consists of:

- Native macOS app (Swift/SwiftUI) in `mac/`
- iOS companion app in `ios/`
- Web frontend (TypeScript/LitElement) and Node.js/Bun server for terminal session management in `web/`

## Common Development Commands

### Building the Project

#### macOS App with Poltergeist (Recommended if installed)

```bash
poltergeist haunt        # Start watcher, auto-rebuilds on changes
polter vibetunnel          # Wait for build, then run
```

#### macOS App without Poltergeist

```bash
cd mac
xcodebuild -project VibeTunnel.xcodeproj -scheme VibeTunnel -configuration Debug build
./scripts/build.sh                           # Release build
./scripts/build.sh --sign                    # With code signing
```

#### iOS App

```bash
cd ios
xcodebuild -project VibeTunnel-iOS.xcodeproj -scheme VibeTunnel-iOS -sdk iphonesimulator
./scripts/test-with-coverage.sh              # Run tests (75% threshold)
```

#### Web Frontend

```bash
cd web
pnpm install                                 # Install dependencies
pnpm run build                              # Production build
pnpm run dev                                # Development server with hot reload
```

### Code Quality Commands

#### Web (MUST run before committing)

```bash
cd web
pnpm run check                              # Run all checks in parallel
pnpm run check:fix                          # Auto-fix formatting and linting
```

#### Swift (macOS/iOS)

```bash
cd mac && ./scripts/lint.sh                 # Run SwiftFormat
cd ios && ./scripts/lint.sh
```

### Testing Commands

#### Web Tests

```bash
cd web
pnpm run test                               # Run all tests
pnpm run test -- session-manager.test.ts    # Run a single test file
pnpm run test:coverage                      # With coverage report (80% required)
pnpm run test:e2e                          # Playwright E2E tests
pnpm run test:e2e -- tests/session.spec.ts  # Single E2E test file
```

#### macOS/iOS Tests

```bash
# macOS - MUST use xcodebuild, NOT swift test!
cd mac
xcodebuild test -project VibeTunnel.xcodeproj -scheme VibeTunnel -destination 'platform=macOS'

# Single test class
xcodebuild test -project VibeTunnel.xcodeproj -scheme VibeTunnel -destination 'platform=macOS' \
  -only-testing:VibeTunnelTests/ServerManagerTests

# iOS
cd ios && ./scripts/test-with-coverage.sh
```

### Debugging and Logs

```bash
./scripts/vtlog.sh -n 100                  # Last 100 lines
./scripts/vtlog.sh -e                      # Errors only
./scripts/vtlog.sh -c ServerManager        # Specific component
# NEVER use -f (follow mode) - it will timeout!
```

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    macOS Menu Bar App                        │
│  (Swift/SwiftUI - mac/VibeTunnel/)                            │
│  - ServerManager: Manages server lifecycle                   │
│  - SessionMonitor: Tracks active sessions                    │
│  - TerminalManager: Terminal session coordination            │
└─────────────────────┬───────────────────────────────────────┘
                      │ Spawns & Manages
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Node.js/Bun Server                        │
│  (TypeScript - web/src/server/)                             │
│  - server.ts: HTTP server & WebSocket handling              │
│  - pty/pty-manager.ts: Native PTY process management        │
│  - pty/session-manager.ts: Terminal session lifecycle       │
│  - services/ws-v3-hub.ts: WebSocket v3 multiplexed hub      │
└─────────────────────┬───────────────────────────────────────┘
                      │ WebSocket/HTTP
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                      Web Frontend                            │
│  (TypeScript/LitElement - web/src/client/)                  │
│  - Terminal rendering with ghostty-web                      │
│  - Real-time updates via WebSocket                          │
└─────────────────────────────────────────────────────────────┘
```

### Key Communication Flows

1. **Session Creation**: Client → POST /api/sessions → Server spawns PTY → Returns session ID
2. **Terminal I/O**: WebSocket at /ws (v3 framing) for bidirectional communication
3. **Buffer Protocol**: Binary messages with `VT` magic byte for efficient terminal updates
4. **Log Aggregation**: Frontend logs → Server → Mac app → macOS unified logging

### Critical File Locations

**Entry Points**:

- Mac app: `mac/VibeTunnel/VibeTunnelApp.swift`
- Server: `web/src/server/server.ts`
- Web UI: `web/src/client/app.ts`
- iOS app: `ios/VibeTunnel/VibeTunnelApp.swift`

**Configuration**:

- Mac version: `mac/VibeTunnel/version.xcconfig`
- Web version: `web/package.json`
- Build settings: `mac/VibeTunnel/Shared.xcconfig`

**Terminal Management**:

- PTY spawning: `web/src/server/pty/pty-manager.ts`
- Session handling: `web/src/server/services/terminal-manager.ts`
- WebSocket hub: `web/src/server/services/ws-v3-hub.ts`

## Critical Development Rules

### ABSOLUTE CARDINAL RULES - VIOLATION MEANS IMMEDIATE FAILURE

- **Never start server or the mac app yourself.** Verify changes via xcodebuild only.

1. **NEVER CREATE A NEW BRANCH WITHOUT EXPLICIT USER PERMISSION**
   - If on a branch (not main), you MUST stay on that branch
   - Even if changes seem unrelated, STAY ON THE CURRENT BRANCH

2. **NEVER commit/push before the user has tested your changes!**

3. **NEVER USE `git rebase --skip`** - Ask user for help with rebase conflicts

4. **NEVER create duplicate files with version suffixes** (e.g., file_v2.ts, file_new.ts)

5. **Web Development Workflow**
   - **Production Mode**: Mac app embeds pre-built server; requires clean → build → run for web changes
   - **Development Mode** (recommended): Enable "Use Development Server" in Settings → Debug for hot reload

6. **Never kill all sessions** - You may be running inside a session yourself

7. **NEVER rename docs.json to mint.json** - Mintlify config must remain as `docs.json`

8. **Test Session Management**: Use `TestSessionTracker`, only clean up test-\* sessions

9. **NEVER install packages without explicit user approval** - No `pnpm add`, no modifying `package.json`

10. **NEVER run tests unless explicitly asked** - The user may have their own test workflow

### Git Workflow

- Workflow: main → create branch → make PR → merge → return to main
- Always check branch with `git branch` before changes
- **"Adopt" = REVIEW, not merge!** Switch to PR branch and review
- **"Rebase main" = `git pull --rebase origin main`** while staying on current branch

### NO BACKWARDS COMPATIBILITY - EVER!

The Mac app and web server are ALWAYS shipped together. When fixing bugs or changing APIs:

- Just change both sides to match
- Delete old code completely
- No compatibility layers, no fallbacks for older versions

## Release Process

When the user says "release", ALWAYS read and follow `docs/RELEASE.md` for the complete process.

## Testing on External Devices

```bash
cd web
pnpm run dev --port 4021 --bind 0.0.0.0    # Port 4020 is production
```

Access from device: `http://[mac-ip]:4021`. See `docs/TESTING_EXTERNAL_DEVICES.md`.

## Slash Commands

### /fixmac Command

Use the Task tool with XcodeBuildMCP subagent to fix Mac compilation errors:

```
Task(description="Fix Mac build errors", prompt="/fixmac", subagent_type="general-purpose")
```

## Additional Guidelines

- **Web-specific**: See `web/CLAUDE.md` for additional web development guidelines
- **Architecture Details**: `docs/ARCHITECTURE.md`
- **API Specifications**: `docs/spec.md`
- **Release Process**: `docs/RELEASE.md`

## Poltergeist Integration

```bash
which poltergeist                           # Check if installed
poltergeist haunt                           # Start watching
poltergeist status                          # Check build status
polter vibetunnel                             # Run latest build
```

Config: `poltergeist.config.json` (vibetunnel target builds macOS app, vibetunnel-ios disabled by default)

## Tailscale CLI (August 2025 syntax)

```bash
# Serve (HTTPS proxy)
tailscale serve --bg http://localhost:4020

# Funnel (public access)
tailscale funnel reset
tailscale funnel --bg 443
```

## Code References

When referencing code locations, use clickable format: `path/to/file.ts:123` or `path/to/file.ts:123-456` for ranges. Always use relative paths from the project root.

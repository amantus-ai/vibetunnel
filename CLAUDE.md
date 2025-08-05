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

#### macOS App
```bash
cd mac
./scripts/build.sh                           # Build release version
./scripts/build.sh --configuration Debug     # Build debug version
./scripts/build.sh --sign                    # Build with code signing
```

#### iOS App
```bash
cd ios
xcodebuild -project VibeTunnel-iOS.xcodeproj -scheme VibeTunnel-iOS -sdk iphonesimulator
./scripts/test-with-coverage.sh              # Run tests with coverage (75% threshold)
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
pnpm run check                              # Run all checks in parallel (format, lint, typecheck)
pnpm run check:fix                          # Auto-fix formatting and linting issues
```

#### macOS
```bash
cd mac
./scripts/lint.sh                           # Run SwiftFormat
```

#### iOS
```bash
cd ios
./scripts/lint.sh                           # Run SwiftFormat
```

### Testing Commands

#### Web Tests
```bash
cd web
pnpm run test                               # Run all tests
pnpm run test:coverage                      # Run with coverage report (80% required)
pnpm run test:e2e                          # Run Playwright E2E tests
pnpm run test:e2e:debug                    # Debug E2E tests
```

#### macOS Tests
```bash
# MUST use xcodebuild, NOT swift test!
cd mac
xcodebuild test -project VibeTunnel.xcodeproj -scheme VibeTunnel -destination 'platform=macOS'
```

#### iOS Tests
```bash
cd ios
./scripts/test-with-coverage.sh             # Run with automatic simulator selection
```

### Debugging and Logs

```bash
# View VibeTunnel logs (from project root)
./scripts/vtlog.sh -n 100                  # Last 100 lines
./scripts/vtlog.sh -e                      # Errors only
./scripts/vtlog.sh -c ServerManager        # Specific component
./scripts/vtlog.sh -s "error"              # Search for text

# NEVER use -f (follow mode) in Claude Code - it will timeout!
```

## High-Level Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        macOS Menu Bar App                    │
│  (Swift/SwiftUI - mac/VibeTunnel/)                         │
│  - ServerManager: Manages server lifecycle                   │
│  - SessionMonitor: Tracks active sessions                    │
│  - TTYForwardManager: Terminal forwarding                    │
└─────────────────────┬───────────────────────────────────────┘
                      │ Spawns & Manages
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Node.js/Bun Server                        │
│  (TypeScript - web/src/server/)                             │
│  - server.ts: HTTP server & WebSocket handling              │
│  - pty-manager.ts: Native PTY process management            │
│  - session-manager.ts: Terminal session lifecycle           │
└─────────────────────┬───────────────────────────────────────┘
                      │ WebSocket/HTTP
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                      Web Frontend                            │
│  (TypeScript/LitElement - web/src/client/)                  │
│  - Terminal rendering with xterm.js                         │
│  - Real-time updates via WebSocket                          │
└─────────────────────────────────────────────────────────────┘
```

### Key Communication Flows

1. **Session Creation**: Client → POST /api/sessions → Server spawns PTY → Returns session ID
2. **Terminal I/O**: WebSocket at /api/sessions/:id/ws for bidirectional communication
3. **Buffer Protocol**: Binary messages with magic byte 0xBF for efficient terminal updates
4. **Log Aggregation**: Frontend logs → Server → Mac app → macOS unified logging

### Critical File Locations

- **Entry Points**:
  - Mac app: `mac/VibeTunnel/VibeTunnelApp.swift`
  - Server: `web/src/server/server.ts`
  - Web UI: `web/src/client/app.ts`
  - iOS app: `ios/VibeTunnel/VibeTunnelApp.swift`

- **Configuration**:
  - Mac version: `mac/VibeTunnel/version.xcconfig`
  - Web version: `web/package.json`
  - Build settings: `mac/VibeTunnel/Shared.xcconfig`

- **Terminal Management**:
  - PTY spawning: `web/src/server/pty/pty-manager.ts`
  - Session handling: `web/src/server/services/terminal-manager.ts`
  - Buffer optimization: `web/src/server/services/buffer-aggregator.ts`

## Critical Development Rules

### Release Process
When the user says "release" or asks to create a release, ALWAYS read and follow `docs/RELEASE.md` for the complete release process.

### ABSOLUTE CARDINAL RULES - VIOLATION MEANS IMMEDIATE FAILURE

- Never start server or the mac app yourself.
- Verify changes done to the mac app via xcodebuild, but do not start the mac app or server yourself.

1. **NEVER, EVER, UNDER ANY CIRCUMSTANCES CREATE A NEW BRANCH WITHOUT EXPLICIT USER PERMISSION**
   - If you are on a branch (not main), you MUST stay on that branch
   - The user will tell you when to create a new branch with commands like "create a new branch" or "switch to a new branch"
   - Creating branches without permission causes massive frustration and cleanup work
   - Even if changes seem unrelated to the current branch, STAY ON THE CURRENT BRANCH

2. **NEVER commit and/or push before the user has tested your changes!**
   - Always wait for user confirmation before committing
   - The user needs to verify changes work correctly first

3. **ABSOLUTELY FORBIDDEN: NEVER USE `git rebase --skip` EVER**
   - This command can cause data loss and repository corruption
   - If you encounter rebase conflicts, ask the user for help

4. **NEVER create duplicate files with version numbers or suffixes**
   - When refactoring or improving code, directly modify the existing files
   - DO NOT create new versions with different file names (e.g., file_v2.ts, file_new.ts)
   - Users hate having to manually clean up duplicate files

5. **Web Development Workflow - Development vs Production Mode**
   - **Production Mode**: Mac app embeds a pre-built web server during Xcode build
     - Every web change requires: clean → build → run (rebuilds embedded server)
     - Simply restarting serves STALE, CACHED version
   - **Development Mode** (recommended for web development):
     - Enable "Use Development Server" in VibeTunnel Settings → Debug
     - Mac app runs `pnpm run dev` instead of embedded server
     - Provides hot reload - web changes automatically rebuild without Mac app rebuild
     - Restart VibeTunnel server (not full rebuild) to pick up web changes
     
6. **Never kill all sessions**
   - You are running inside a session yourself; killing all sessions would terminate your own process

7. **NEVER rename docs.json to mint.json**
   - The Mintlify configuration file is called `docs.json` in this project
   - Do NOT rename it to mint.json even if you think Mintlify expects that
   - The file must remain as `docs.json`
   - For Mintlify documentation reference, see: https://mintlify.com/docs/llms.txt

8. **Test Session Management - CRITICAL**
   - NEVER kill sessions that weren't created by tests
   - You might be running inside a VibeTunnel session yourself
   - Use `TestSessionTracker` to track which sessions tests create
   - Only clean up sessions that match test naming patterns (start with "test-")
   - Killing all sessions would terminate your own Claude Code process

### Git Workflow Reminders
- Our workflow: start from main → create branch → make PR → merge → return to main
- PRs sometimes contain multiple different features and that's okay
- Always check current branch with `git branch` before making changes
- If unsure about branching, ASK THE USER FIRST
- **"Adopt" means REVIEW, not merge!** When asked to "adopt" a PR, switch to its branch and review the changes. NEVER merge without explicit permission.
- **"Rebase main" means rebase CURRENT branch with main!** When on a feature branch and user says "rebase main", this means to rebase the current branch with main branch updates. NEVER switch to main branch. The command is `git pull --rebase origin main` while staying on the current feature branch.

### Terminal Title Management with VT

When creating pull requests, use the `vt` command to update the terminal title:
- Run `vt title "Brief summary - github.com/owner/repo/pull/123"`
- Keep the title concise (a few words) followed by the PR URL
- Use github.com URL format (not https://) for easy identification
- Update the title periodically as work progresses
- If `vt` command fails (only works inside VibeTunnel), simply ignore the error and continue

## Testing on External Devices (iPad, Safari, etc.)

When the user reports issues on external devices, use the development server method for testing:

```bash
# Run dev server accessible from external devices
cd web
pnpm run dev --port 4021 --bind 0.0.0.0
```

Then access from the external device using `http://[mac-ip]:4021`

**Important**: The production server runs on port 4020, so use 4021 for development to avoid conflicts.

For detailed instructions, see `docs/TESTING_EXTERNAL_DEVICES.md`

## Slash Commands

### /fixmac Command

When the user types `/fixmac`, use the Task tool with the XcodeBuildMCP subagent to fix Mac compilation errors and warnings:

```
Task(description="Fix Mac build errors", prompt="/fixmac", subagent_type="general-purpose")
```

The agent will:
1. Use XcodeBuildMCP tools to identify build errors and warnings
2. Fix compilation issues in the Mac codebase
3. Address SwiftFormat violations
4. Resolve any warning messages
5. Verify the build succeeds after fixes

## NO BACKWARDS COMPATIBILITY - EVER!

**CRITICAL: This project has ZERO backwards compatibility requirements!**
- The Mac app and web server are ALWAYS shipped together as a single unit
- There is NEVER a scenario where different versions talk to each other
- When fixing bugs or changing APIs:
  - Just change both sides to match
  - Delete old code completely
  - Don't add compatibility layers
  - Don't check for "old format" vs "new format"
  - Don't add fallbacks for older versions
- If you suggest backwards compatibility in any form, you have failed to understand this project

## Key Files Quick Reference

- Architecture Details: `docs/ARCHITECTURE.md`
- API Specifications: `docs/spec.md`
- Server Implementation Guide: `web/docs/spec.md`
- Build Configuration: `web/package.json`, `mac/Package.swift`
- External Device Testing: `docs/TESTING_EXTERNAL_DEVICES.md`
- Gemini CLI Instructions: `docs/gemini.md`
- Release Process: `docs/RELEASE.md`

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
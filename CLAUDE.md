# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VibeTunnel is a macOS application that allows users to access their terminal sessions through any web browser. It consists of:
- Native macOS app (Swift/SwiftUI) in `mac/`
- iOS companion app in `ios/`
- Web frontend (TypeScript/LitElement) and Node.js/Bun server for terminal session management in `web/`

## Critical Development Rules

### ABSOLUTE CARDINAL RULES - VIOLATION MEANS IMMEDIATE FAILURE

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

### Git Workflow Reminders
- Our workflow: start from main → create branch → make PR → merge → return to main
- PRs sometimes contain multiple different features and that's okay
- Always check current branch with `git branch` before making changes
- If unsure about branching, ASK THE USER FIRST

### Terminal Title Management with VT

When creating pull requests, use the `vt` command to update the terminal title:
- Run `vt title "Brief summary - github.com/owner/repo/pull/123"`
- Keep the title concise (a few words) followed by the PR URL
- Use github.com URL format (not https://) for easy identification
- Update the title periodically as work progresses
- If `vt` command fails (only works inside VibeTunnel), simply ignore the error and continue

## Web Development Commands

**IMPORTANT**: The user has `pnpm run dev` running - DO NOT manually build the web project!

In the `web/` directory:

```bash
# Development (user already has this running)
pnpm run dev

# Code quality (MUST run before commit)
pnpm run lint          # Check for linting errors
pnpm run lint:fix      # Auto-fix linting errors
pnpm run format        # Format with Prettier
pnpm run typecheck     # Check TypeScript types

# Testing (only when requested)
pnpm run test
pnpm run test:coverage
pnpm run test:e2e
```

## macOS Development Commands

In the `mac/` directory:

```bash
# Build commands
./scripts/build.sh                    # Build release
./scripts/build.sh --configuration Debug  # Build debug
./scripts/build.sh --sign            # Build with code signing

# Other scripts
./scripts/clean.sh                   # Clean build artifacts
./scripts/lint.sh                    # Run linting
./scripts/create-dmg.sh             # Create installer
```

## Architecture Overview

### Terminal Sharing Protocol
1. **Session Creation**: `POST /api/sessions` spawns new terminal
2. **Input**: `POST /api/sessions/:id/input` sends keyboard/mouse input
3. **Output**:
   - SSE stream at `/api/sessions/:id/stream` (text)
   - WebSocket at `/buffers` (binary, efficient rendering)
4. **Resize**: `POST /api/sessions/:id/resize` (missing in some implementations)

### Key Entry Points
- **Mac App**: `mac/VibeTunnel/VibeTunnelApp.swift`
- **Web Frontend**: `web/src/client/app.ts`
- **Server**: `web/src/server/server.ts`
- **Process spawning and forwarding tool**:  `web/src/server/fwd.ts`
- **Server Management**: `mac/VibeTunnel/Core/Services/ServerManager.swift`

## Testing

- **Never run tests unless explicitly asked**
- Mac tests: Swift Testing framework in `VibeTunnelTests/`
- Web tests: Vitest in `web/src/test/`

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

## Key Files Quick Reference

- Architecture Details: `docs/ARCHITECTURE.md`
- API Specifications: `docs/spec.md`
- Server Implementation Guide: `web/spec.md`
- Build Configuration: `web/package.json`, `mac/Package.swift`
- External Device Testing: `docs/TESTING_EXTERNAL_DEVICES.md`

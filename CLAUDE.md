# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VibeTunnel is a macOS application that allows users to access their terminal sessions through any web browser. It consists of:
- Native macOS app (Swift/SwiftUI) in `mac/`
- iOS companion app in `ios/`
- Web frontend (TypeScript/LitElement) and Node.js/Bun server for terminal session management in `web/`

## Critical Development Rules

- **Never commit and/or push before the user has tested your changes!**
- **ABSOLUTELY SUPER IMPORTANT & CRITICAL**: NEVER USE git rebase --skip EVER
- **Never create a new branch/PR automatically when you are already on a branch**, even if the changes do not seem to fit into the existing PR. Only do that when explicitly asked. Our workflow is always start from main, make branch, make PR, merge. Then we go back to main and start something else. PRs sometimes contain different features and that's okay.
- **IMPORTANT**: When refactoring or improving code, directly modify the existing files. DO NOT create new versions with different file names. Users hate having to manually clean up duplicate files.

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

## Key Files Quick Reference

- Architecture Details: `docs/ARCHITECTURE.md`
- API Specifications: `docs/spec.md`
- Server Implementation Guide: `web/spec.md`
- Build Configuration: `web/package.json`, `mac/Package.swift`

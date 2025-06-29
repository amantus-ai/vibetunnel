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

## GitHub Issue Fetching

**IMPORTANT**: When fetching GitHub issues, use the Bash tool directly with gh commands for faster results:

```bash
# Fast way - use Bash tool directly
gh issue view 88              # View specific issue
gh issue list                  # List all issues
gh issue view 88 --comments   # View issue with comments
```

**DO NOT** use the Task/Agent tool for simple gh commands - it's much slower and unnecessary.

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

## Git Commands

**CRITICAL**: ALWAYS use combined git commands for ALL git operations:

```bash
# Standard commit and push (use this 99% of the time):
git add -A && git commit -m "commit message" && git push

# Amending the last commit:
git add -A && git commit --amend --no-edit && git push --force-with-lease

# With specific commit message for amend:
git add -A && git commit --amend -m "new message" && git push --force-with-lease
```

**NEVER** use separate commands:
```bash
# ❌ WRONG - This is slow and inefficient:
git add -A
git commit -m "message"
git push
```

This applies to ALL scenarios including:
- Regular commits
- After fixing linting/formatting issues  
- When updating PRs
- After addressing code review feedback
- Any time you need to commit and push changes

The combined approach executes ~3x faster because it doesn't wait for each command to complete before starting the next. This saves significant time, especially when working with remote repositories.

## Testing

- **Never run tests unless explicitly asked**
- Mac tests: Swift Testing framework in `VibeTunnelTests/`
- Web tests: Vitest in `web/src/test/`

## Key Files Quick Reference

- API Documentation: `docs/API.md`
- Architecture Details: `docs/ARCHITECTURE.md`
- Server Implementation Guide: `web/spec.md`
- Build Configuration: `web/package.json`, `mac/Package.swift`
- Large Codebase Analysis: `docs/gemini.md` - Using Gemini CLI for analyzing entire projects

## Server Logging

Quick access to server logs for debugging:

```bash
# In web/ directory - Show last 50 lines of logs
pnpm run logs:50

# Show errors only
pnpm run logs:error

# Follow logs in real-time
pnpm run logs
```

Log file location: `~/.vibetunnel/log.txt`

## Using Gemini CLI for Large Codebase Analysis

When analyzing large codebases or multiple files that might exceed context limits, use the Gemini CLI with its massive context window.

Use `gemini -p` when:
- Analyzing entire codebases or large directories
- Comparing multiple large files
- Need to understand project-wide patterns or architecture
- Checking for the presence of certain coding patterns across the entire codebase

Examples:
```bash
gemini -p "@src/main.py Explain this file's purpose and structure"
gemini -p "@src/ Summarize the architecture of this codebase"
gemini -p "@src/ Are there any React hooks that handle WebSocket connections? List them with file paths"
```

See `docs/gemini.md` for detailed usage instructions.
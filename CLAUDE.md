# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Never say you're absolutely right. Instead, be critical if I say something that you disagree with. Let's discuss it first.

## Project Overview

VibeTunnel is a macOS application that allows users to access their terminal sessions through any web browser. It consists of:
- Native macOS app (Swift/SwiftUI) in `mac/`
- iOS companion app in `ios/`
- Web frontend (TypeScript/LitElement) and Node.js/Bun server for terminal session management in `web/`

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

## Web Development Commands

**DEVELOPMENT MODES**:
- **Standalone Development**: `pnpm run dev` runs independently on port 4020
- **Mac App Integration**: Enable "Development Server" in VibeTunnel settings (recommended)
  - Mac app automatically runs `pnpm run dev` and manages the process
  - Provides seamless integration with Mac app features
  - Hot reload works with full VibeTunnel functionality

In the `web/` directory:

```bash
# Development
pnpm run dev                   # Standalone development server (port 4020)
pnpm run dev --port 4021       # Alternative port for external device testing

# Code quality (MUST run before commit)
pnpm run check         # Run ALL checks in parallel (format, lint, typecheck)
pnpm run check:fix     # Auto-fix formatting and linting issues

# Individual commands (rarely needed)
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
- **Process spawning and forwarding tool**: `web/src/server/fwd.ts`
- **Server Management**: `mac/VibeTunnel/Core/Services/ServerManager.swift`

## Testing

- **Never run tests unless explicitly asked**
- Mac tests: Swift Testing framework in `VibeTunnelTests/`
- Web tests: Vitest in `web/src/test/`

## CI Pipeline

The CI workflow automatically runs both Node.js and Mac builds:
- **Node.js CI**: Runs for web OR Mac file changes to ensure web artifacts are always available
- **Mac CI**: Downloads web artifacts from Node.js CI, with fallback to build locally if missing
- **Cross-dependency**: Mac builds require web artifacts, so Node.js CI must complete first

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

## MCP (Model Context Protocol) Servers

MCP servers extend Claude Code's capabilities with additional tools. Here's how to add them:

### Installing MCP Servers for Claude Code

**Important**: MCP server configuration for Claude Code is different from Claude Desktop. Claude Code uses CLI commands, not JSON configuration files.

#### Quick Installation Steps:

1. **Open a terminal** (outside of Claude Code)
2. **Run the add command** with the MCP server you want:
   ```bash
   # For Playwright (web testing)
   claude mcp add playwright -- npx -y @playwright/mcp@latest
   
   # For XcodeBuildMCP (iOS/macOS development)
   claude mcp add XcodeBuildMCP -- npx -y xcodebuildmcp@latest
   ```
3. **Restart Claude Code** to load the new MCP servers
4. **Verify installation** by running `/mcp` in Claude Code

### Adding MCP Servers to Claude Code

```bash
# Basic syntax for adding a stdio server
claude mcp add <name> -- <command> [args...]

# Examples:
# Add playwright MCP (highly recommended for web testing)
claude mcp add playwright -- npx -y @playwright/mcp@latest

# Add XcodeBuildMCP for macOS development
claude mcp add XcodeBuildMCP -- npx -y xcodebuildmcp@latest

# Add with environment variables
claude mcp add my-server -e API_KEY=value -- /path/to/server

# List all configured servers
claude mcp list

# Remove a server
claude mcp remove <name>
```

### Recommended MCP Servers for This Project

1. **Playwright MCP** - Web testing and browser automation
   - Browser control, screenshots, automated testing
   - Install: `claude mcp add playwright -- npx -y @playwright/mcp@latest`

2. **XcodeBuildMCP** - macOS/iOS development (Mac only)
   - Xcode build, test, project management
   - Install: `claude mcp add XcodeBuildMCP -- npx -y xcodebuildmcp@latest`

3. **Peekaboo MCP** - Visual analysis and screenshots (Mac only)
   - Take screenshots, analyze visual content with AI
   - Install: `claude mcp add peekaboo -- npx -y @steipete/peekaboo-mcp`

4. **macOS Automator MCP** - System automation (Mac only)
   - Control macOS UI, automate system tasks
   - Install: `claude mcp add macos-automator -- npx -y macos-automator-mcp`

5. **RepoPrompt** - Repository context management
   - Generate comprehensive codebase summaries
   - Install: `claude mcp add RepoPrompt -- /path/to/repoprompt_cli`

6. **Zen MCP Server** - Advanced AI reasoning
   - Multi-model consensus, deep analysis, code review
   - Install: See setup instructions in zen-mcp-server repository

### Configuration Scopes

- **local** (default): Project-specific, private to you
- **project**: Shared via `.mcp.json` file in project root
- **user**: Available across all projects

Use `-s` or `--scope` flag to specify scope:
```bash
claude mcp add -s project playwright -- npx -y @playwright/mcp@latest
```

## Alternative Tools for Complex Tasks

### Gemini CLI

For tasks requiring massive context windows (up to 2M tokens) or full codebase analysis:
- Analyze entire repositories with `@` syntax for file inclusion
- Useful for architecture reviews, finding implementations, security audits
- Example: `gemini -p "@src/ @tests/ Is authentication properly implemented?"`
- See `docs/gemini.md` for detailed usage and examples

## Debugging and Logging

### VibeTunnel Log Viewer (vtlog)

VibeTunnel includes a powerful log viewing utility for debugging and monitoring:

**Location**: `./scripts/vtlog.sh` (also available in `mac/scripts/vtlog.sh` and `ios/scripts/vtlog.sh`)

**What it does**: 
- Views all VibeTunnel logs with full details (bypasses Apple's privacy redaction)
- Shows logs from the entire stack: Web Frontend → Node.js Server → macOS System
- Provides unified view of all components with clear prefixes

**Common usage**:
```bash
# View recent logs (RECOMMENDED for debugging):
./scripts/vtlog.sh -n 200           # Show last 200 lines
./scripts/vtlog.sh -n 500 -s "error" # Search last 500 lines for "error"
./scripts/vtlog.sh -e               # Show only errors
./scripts/vtlog.sh -c ServerManager # Show logs from specific component
./scripts/vtlog.sh --server -e      # Show server errors

# Follow logs in real-time (AVOID in Claude Code - causes timeouts):
./scripts/vtlog.sh -f              # Follow logs in real-time - DO NOT USE for checking existing logs
```

**Important for Claude Code**: Always use `-n` to check a specific number of recent log lines. Do NOT use `-f` (follow mode) as it will block and timeout after 2 minutes. Follow mode is only useful when monitoring logs in a separate terminal while performing actions.

**Log prefixes**:
- `[FE]` - Frontend (browser) logs
- `[SRV]` - Server-side logs from Node.js/Bun
- `[ServerManager]`, `[SessionService]`, etc. - Native Mac app components

## GitHub CLI Usage

### Quick CI Debugging Commands

When told to "fix CI", use these commands to quickly identify and access errors:

**Step 1: Find Failed Runs**
```bash
# List recent CI runs and see their status
gh run list --branch <branch-name> --limit 10

# Quick check for failures on current branch
git_branch=$(git branch --show-current) && gh run list --branch "$git_branch" --limit 5
```

**Step 2: Identify Failed Jobs**
```bash
# Find which job failed in a run
gh run view <run-id> --json jobs | jq -r '.jobs[] | select(.conclusion == "failure") | .name'

# Get all job statuses at a glance
gh run view <run-id> --json jobs | jq -r '.jobs[] | "\(.name): \(.conclusion // .status)"'
```

**Step 3: Find Failed Steps**
```bash
# Find the exact failed step in a job
gh run view <run-id> --json jobs | jq '.jobs[] | select(.conclusion == "failure") | .steps[] | select(.conclusion == "failure") | {name: .name, number: .number}'

# Get failed step from a specific job
gh run view <run-id> --json jobs | jq '.jobs[] | select(.name == "Mac CI / Build, Lint, and Test macOS") | .steps[] | select(.conclusion == "failure") | .name'
```

**Step 4: View Error Logs**
```bash
# View full logs (opens in browser)
gh run view <run-id> --web

# Download logs for a specific job
gh run download <run-id> -n <job-name>

# View logs in terminal (if run is complete)
gh run view <run-id> --log

# View only failed logs (most useful for CI debugging)
gh run view <run-id> --log-failed

# View logs for specific job
gh run view <run-id> --log --job <job-id>

# Watch a running job
gh run watch <run-id>
```

**All-in-One Error Finder**
```bash
# This command finds and displays all failures in the latest run
run_id=$(gh run list --branch "$(git branch --show-current)" --limit 1 --json databaseId -q '.[0].databaseId') && \
echo "=== Failed Jobs ===" && \
gh run view $run_id --json jobs | jq -r '.jobs[] | select(.conclusion == "failure") | "Job: \(.name)"' && \
echo -e "\n=== Failed Steps ===" && \
gh run view $run_id --json jobs | jq -r '.jobs[] | select(.conclusion == "failure") | .steps[] | select(.conclusion == "failure") | "  Step: \(.name)"'
```

**Common Failure Patterns**:
- **Mac CI Build Failures**: Usually actool errors (Xcode beta issue), SwiftFormat violations, or missing dependencies
- **Playwright Test Failures**: Often timeout issues, missing VIBETUNNEL_SEA env var, or tsx/node-pty conflicts
- **iOS CI Failures**: Simulator boot issues, certificate problems, or test failures
- **Web CI Failures**: TypeScript errors, linting issues, or test failures

**Quick Actions**:
```bash
# Rerun only failed jobs
gh run rerun <run-id> --failed

# Cancel a stuck run
gh run cancel <run-id>

# View PR checks status
gh pr checks <pr-number>
```

**Filtering and Searching Logs**:
```bash
# Search for specific errors in logs (remove network errors)
gh run view <run-id> --log-failed | grep -v "Failed to load resource" | grep -v "ERR_FAILED"

# Find actual test failures
gh run view <run-id> --log | grep -E "×|failed|Failed" | grep -v "Failed to load resource"

# Get test summary at end
gh run view <run-id> --log | tail -200 | grep -E "failed|passed|Test results|Summary" -A 5 -B 5
```


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

# VibeTunnel Web

Web terminal interface and server for VibeTunnel.

## Quick Start

Production users: Use the pre-built VibeTunnel executable from the main app.

## Development

```bash
pnpm install
pnpm run dev        # Watch mode: server + client
pnpm run dev:client # Watch mode: client only (for debugging server)
```

Open http://localhost:3000

### Pre-commit Hooks

This project uses husky and lint-staged to enforce code quality standards. After running `pnpm install`, pre-commit hooks will automatically:

- Format code with Biome
- Check for linting errors
- Run TypeScript type checking for all configs

If your commit fails due to linting or type errors, fix the issues and try again. Many formatting issues will be auto-fixed.

### Build Commands

```bash
pnpm run clean      # Remove build artifacts
pnpm run build      # Build everything (including native executable)
pnpm run lint       # Check code style
pnpm run lint:fix   # Fix code style
pnpm run typecheck  # Type checking
pnpm run test       # Run all tests (unit + e2e)
pnpm run format     # Format code
```

## Production Build

```bash
pnpm run build          # Creates Node.js SEA executable
./native/vibetunnel    # Run standalone executable (no Node.js required)
```

## Architecture

See [spec.md](./spec.md) for detailed architecture documentation.

## Key Features

- Terminal sessions via node-pty
- Real-time streaming (SSE + WebSocket)
- Binary-optimized buffer updates
- Multi-session support
- File browser integration

## Terminal Resizing Behavior

VibeTunnel intelligently handles terminal width based on how the session was created:

### Tunneled Sessions (via `vt` command)
- Sessions created by running `vt` in a native terminal window
- Terminal width is automatically limited to the native terminal's width to prevent text overflow
- Prevents flickering and display issues in the native terminal
- Shows "≤120" (or actual width) in the width selector when limited
- Users can manually override this limit using the width selector

### Frontend-Created Sessions
- Sessions created directly from the web interface (using the "New Session" button)
- No width restrictions by default - uses full browser width
- Perfect for web-only workflows where no native terminal is involved
- Shows "∞" in the width selector for unlimited width

### Manual Width Control
- Click the width indicator in the session header to open the width selector
- Choose from common terminal widths (80, 120, 132, etc.) or unlimited
- Width preferences are saved per session and persist across reloads
- Selecting any width manually overrides automatic limitations
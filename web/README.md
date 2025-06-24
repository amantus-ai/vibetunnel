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
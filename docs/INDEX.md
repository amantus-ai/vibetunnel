# VibeTunnel Documentation

## Quick Navigation

### Getting Started
- [Quickstart](guides/quickstart.md) - Installation, first terminal
- [Architecture Overview](core/architecture.md) - System design
- [API Reference](core/api-reference.md) - Endpoints, WebSocket protocol

### Development
- [Development Guide](guides/development.md) - Setup, patterns, workflow
- [Testing Guide](guides/testing.md) - Unit, E2E, external devices
- [Deployment Guide](guides/deployment.md) - Production setup

### Platform Guides
- [macOS App](platform/macos.md) - Native app development
- [iOS Companion](platform/ios.md) - Mobile app guide
- [Web Frontend](platform/web.md) - TypeScript/Lit development

### Features
- [Authentication](features/authentication.md) - Security, tokens
- [Push Notifications](features/push-notifications.md) - Remote alerts
- [Terminal Features](features/terminal-features.md) - CJK, keyboard

### Reference
- [CLI Tools](reference/cli-tools.md) - vt, claude, gemini commands
- [Troubleshooting](reference/troubleshooting.md) - Common issues
- [Release Process](reference/release-process.md) - Publishing updates

## API Quick Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sessions` | POST | Create terminal session |
| `/api/sessions` | GET | List active sessions |
| `/api/sessions/:id` | GET | Session details |
| `/api/sessions/:id` | DELETE | Kill session |
| `/api/sessions/:id/ws` | WS | Terminal I/O stream |
| `/api/sessions/:id/resize` | POST | Resize terminal |
| `/api/auth/token` | POST | Generate auth token |
| `/api/health` | GET | Server health check |

## CLI Commands

| Task | Command | Description |
|------|---------|-------------|
| Start terminal | `vt` | Launch new session |
| View logs | `./scripts/vtlog.sh -n 100` | Last 100 log lines |
| Error logs | `./scripts/vtlog.sh -e` | Errors only |
| Run tests | `pnpm test` | Execute test suite |
| Build Mac | `cd mac && ./scripts/build.sh` | Build release |
| Build iOS | `cd ios && xcodebuild` | Build iOS app |
| Dev server | `cd web && pnpm dev` | Start dev server |

## WebSocket Protocol

### Message Types

| Type | Direction | Format | Purpose |
|------|-----------|--------|---------|
| `data` | Server→Client | Binary (0xBF prefix) | Terminal output |
| `input` | Client→Server | Text/Binary | User keystrokes |
| `resize` | Client→Server | JSON | Terminal resize |
| `ping` | Both | Text | Keep-alive |

### Binary Buffer Format
```
[0xBF][4-byte length][UTF-8 data]
```

## Project Structure

```
vibetunnel/
├── mac/           # macOS native app (Swift/SwiftUI)
├── ios/           # iOS companion app (Swift/SwiftUI)
├── web/           # Server & frontend (TypeScript)
│   ├── src/
│   │   ├── server/   # Node.js/Bun server
│   │   └── client/   # Web UI (Lit/TypeScript)
│   └── dist/      # Built artifacts
├── scripts/       # Build & utility scripts
└── docs/          # Documentation
```

## Key Files

| File | Purpose |
|------|---------|
| `mac/VibeTunnel/ServerManager.swift` | Server lifecycle |
| `web/src/server/server.ts` | HTTP/WebSocket server |
| `web/src/server/pty/pty-manager.ts` | Terminal management |
| `web/src/client/app.ts` | Web UI entry point |
| `ios/VibeTunnel/VibeTunnelApp.swift` | iOS app entry |

## Common Tasks

### Add New Feature
1. Check [Architecture](core/architecture.md) for component placement
2. Follow patterns in [Development Guide](guides/development.md)
3. Add tests per [Testing Guide](guides/testing.md)
4. Update API docs if needed

### Debug Issue
1. Check [Troubleshooting](reference/troubleshooting.md)
2. View logs: `./scripts/vtlog.sh -e`
3. Test in dev mode: `pnpm dev`
4. See [Platform Guides](platform/) for specific issues

### Release Update
1. Follow [Release Process](reference/release-process.md)
2. Test on all platforms
3. Update changelog
4. Create GitHub release

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Startup time | <2s | 1.5s |
| WebSocket latency | <10ms | 5ms |
| Memory usage | <100MB | 80MB |
| CPU idle | <1% | 0.5% |

## Security Model

- **Authentication**: Token-based with optional password
- **Transport**: WSS/HTTPS in production
- **Isolation**: Per-session PTY processes
- **Updates**: Signed & notarized binaries

## Quick Links

- [GitHub Repository](https://github.com/steipete/vibetunnel)
- [API Documentation](core/api-reference.md)
- [Contributing Guide](CONTRIBUTING.md)
- [License](../LICENSE)
# Development Guide

## Setup

### Prerequisites
- macOS 14.0+
- Xcode 16.0+
- Node.js 22.12 through 24.x
- Bun 1.0+
- Rustup (`native/vt-fwd/rust-toolchain.toml` pins the forwarder toolchain)

### Clone & Build

```bash
# Clone repository
git clone https://github.com/amantus-ai/vibetunnel.git
cd vibetunnel

# Install dependencies
(cd web && pnpm install)

# Build the macOS app, including the web assets and Rust forwarder
(cd mac && ./scripts/build.sh --configuration Debug)

# Build the iOS app separately
(cd ios && xcodebuild -project VibeTunnel-iOS.xcodeproj \
  -scheme VibeTunnel-iOS -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build)
```

## Project Structure

```
vibetunnel/
├── mac/                    # macOS app
│   ├── VibeTunnel/        # Swift sources
│   │   ├── Core/          # Business logic
│   │   └── Presentation/  # UI layer
│   └── scripts/           # Build scripts
├── ios/                    # iOS app
│   └── VibeTunnel/        # Swift sources
├── native/vt-fwd/          # Rust terminal forwarder
└── web/                    # Server & frontend
    ├── src/
    │   ├── server/        # Node.js server
    │   └── client/        # Web UI
    └── scripts/           # Utilities
```

## Code Patterns

### Swift (macOS/iOS)

**Observable Pattern**
```swift
// mac/VibeTunnel/Core/Services/ServerManager.swift
@MainActor
@Observable
class ServerManager {
    private(set) var isRunning = false
    private(set) var error: Error?
}
```

**Protocol-Oriented Design**
```swift
// mac/VibeTunnel/Core/Protocols/VibeTunnelServer.swift
@MainActor
protocol VibeTunnelServer: AnyObject {
    var isRunning: Bool { get }
    func start() async throws
    func stop() async
}
```

**Error Handling**
```swift
enum ServerError: LocalizedError {
    case portInUse(Int)
    case binaryNotFound(String)
    
    var errorDescription: String? {
        switch self {
        case .portInUse(let port):
            return "Port \(port) is already in use"
        case .binaryNotFound(let path):
            return "Server binary not found at \(path)"
        }
    }
}
```

### TypeScript (Web)

**Service Classes**
```typescript
// web/src/server/services/terminal-manager.ts
export class TerminalManager {
  private sessions = new Map<string, Session>();
  
  async createSession(options: SessionOptions): Promise<Session> {
    const session = new Session(options);
    this.sessions.set(session.id, session);
    return session;
  }
}
```

**Lit Components**
```typescript
// web/src/client/components/terminal-view.ts
@customElement('terminal-view')
export class TerminalView extends LitElement {
  @property({ type: String }) sessionId = '';
  @state() private connected = false;
  
  createRenderRoot() {
    return this; // No shadow DOM for Tailwind
  }
}
```

## Development Workflow

### Hot Reload Setup

**Web Development**
```bash
# Terminal 1: Run dev server
cd web && pnpm dev

# Terminal 2: Enable in Mac app
# Settings → Debug → Use Development Server
```

**Swift Development with Poltergeist**
```bash
# Install Poltergeist if available
poltergeist

# Auto-rebuilds on file changes
# Check menu bar for build status
```

### Testing

**Unit Tests**
```bash
# macOS
cd mac && xcodebuild test

# iOS  
cd ios && ./scripts/test-with-coverage.sh

# Web
cd web && pnpm test
```

**E2E Tests**
```bash
cd web && pnpm test:e2e
```

### Debugging

**View Logs**
```bash
./scripts/vtlog.sh -n 100    # Last 100 lines
./scripts/vtlog.sh -e         # Errors only
./scripts/vtlog.sh -c Server # Component filter
```

**Debug Server**
```bash
# Run server directly
cd web && pnpm dev:server

# With inspector
node --inspect dist/server/server.js
```

## Common Tasks

### Add New API Endpoint

1. Define in `web/src/server/routes/api.ts`
2. Add types in `web/src/shared/types.ts`
3. Update client in `web/src/client/services/api.ts`
4. Add tests in `web/tests/api.test.ts`

### Add New Menu Item

1. Update `mac/VibeTunnel/Presentation/MenuBarView.swift`
2. Add action in `mac/VibeTunnel/Core/Actions/`
3. Update settings if needed

### Modify Terminal Protocol

1. Update framing/types in `web/src/shared/ws-v3.ts`
2. Update server routing in `web/src/server/services/ws-v3-hub.ts`
3. Update clients:
   - Web: `web/src/client/services/terminal-socket-client.ts`
   - iOS: `ios/VibeTunnel/Services/BufferWebSocketClient.swift`
4. Add/adjust tests: `web/src/test/e2e/websocket-v3.e2e.test.ts`

## Build System

### macOS Build
```bash
cd mac
./scripts/build.sh                    # Release build
./scripts/build.sh --configuration Debug
./scripts/build.sh --no-sign          # Disable code signing
```

### Web Build
```bash
cd web
pnpm build                            # Production build, including the Rust forwarder
node scripts/build-fwd-rust.js        # Rust forwarder only
```

### Release Build
```bash
cd mac
./scripts/release.sh stable           # Full stable release
```

## Code Quality

### Linting
```bash
# Swift
cd mac && ./scripts/lint.sh

# TypeScript
cd web && pnpm lint
cd web && pnpm check:fix
```

### Formatting
```bash
# Swift (SwiftFormat)
swiftformat mac/ ios/

# TypeScript (Prettier)
cd web && pnpm format
```

## Performance

### Profiling
```bash
# Server performance
node --prof dist/server/server.js
node --prof-process isolate-*.log

# Client performance
# Use Chrome DevTools Performance tab
```

### Optimization Tips
- Use binary protocol for terminal data
- Batch WebSocket messages (16ms intervals)
- Lazy load terminal sessions
- Cache static assets with service worker

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port in use | `lsof -i :4020` then kill process |
| Build fails | Clean: `rm -rf node_modules dist` |
| Tests fail | Check Node/Bun version |
| Hot reload broken | Restart dev server |

## Contributing

1. Fork repository
2. Create feature branch
3. Follow code style
4. Add tests
5. Update documentation
6. Submit PR

## See Also
- [Architecture](../core/architecture.md)
- [API Reference](../core/api-reference.md)
- [Testing Guide](testing.md)
- [Release Process](../reference/release-process.md)

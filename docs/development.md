<!-- Generated: 2025-06-21 16:45:00 UTC -->
# VibeTunnel Development Guide

## Overview

VibeTunnel follows modern Swift 6 and TypeScript development practices with a focus on async/await patterns, protocol-oriented design, and reactive UI architectures. The codebase is organized into three main components: macOS app (Swift/SwiftUI), iOS app (Swift/SwiftUI), and web dashboard (TypeScript/Lit).

Key architectural principles:
- **Protocol-oriented design** for flexibility and testability
- **Async/await** throughout for clean asynchronous code
- **Observable pattern** for reactive state management
- **Dependency injection** via environment values in SwiftUI

## Code Style

### Swift Conventions

**Modern Swift 6 patterns** - From `mac/VibeTunnel/Core/Services/ServerManager.swift`:
```swift
@MainActor
@Observable
class ServerManager {
    @MainActor static let shared = ServerManager()
    
    private(set) var serverType: ServerType = .bun
    private(set) var isSwitchingServer = false
    
    var port: String {
        get { UserDefaults.standard.string(forKey: "serverPort") ?? "4020" }
        set { UserDefaults.standard.set(newValue, forKey: "serverPort") }
    }
}
```

**Error handling** - From `mac/VibeTunnel/Core/Protocols/VibeTunnelServer.swift`:
```swift
enum ServerError: LocalizedError {
    case binaryNotFound(String)
    case startupFailed(String)
    case portInUse(Int)
    case invalidConfiguration(String)
    
    var errorDescription: String? {
        switch self {
        case .binaryNotFound(let binary):
            return "Server binary not found: \(binary)"
        case .startupFailed(let reason):
            return "Server failed to start: \(reason)"
        }
    }
}
```

**SwiftUI view patterns** - From `mac/VibeTunnel/Presentation/Views/Settings/GeneralSettingsView.swift`:
```swift
struct GeneralSettingsView: View {
    @AppStorage("autostart")
    private var autostart = false
    
    @State private var isCheckingForUpdates = false
    
    private let startupManager = StartupManager()
    
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Launch at Login", isOn: launchAtLoginBinding)
                        Text("Automatically start VibeTunnel when you log in.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
```

### TypeScript Conventions

**Class-based services** - From `web/src/server/services/buffer-aggregator.ts`:
```typescript
interface BufferAggregatorConfig {
  terminalManager: TerminalManager;
  remoteRegistry: RemoteRegistry | null;
  isHQMode: boolean;
}

export class BufferAggregator {
  private config: BufferAggregatorConfig;
  private remoteConnections: Map<string, RemoteWebSocketConnection> = new Map();
  
  constructor(config: BufferAggregatorConfig) {
    this.config = config;
  }
  
  async handleClientConnection(ws: WebSocket): Promise<void> {
    console.log(chalk.blue('[BufferAggregator] New client connected'));
    // ...
  }
}
```

**Lit components** - From `web/src/client/components/vibe-terminal-buffer.ts`:
```typescript
@customElement('vibe-terminal-buffer')
export class VibeTerminalBuffer extends LitElement {
  // Disable shadow DOM for Tailwind compatibility
  createRenderRoot() {
    return this as unknown as HTMLElement;
  }
  
  @property({ type: String }) sessionId = '';
  @state() private buffer: BufferSnapshot | null = null;
  @state() private error: string | null = null;
}
```

## Common Patterns

### Service Architecture

**Protocol-based services** - Services define protocols for testability:
```swift
// mac/VibeTunnel/Core/Protocols/VibeTunnelServer.swift
@MainActor
protocol VibeTunnelServer: AnyObject {
    var isRunning: Bool { get }
    var port: String { get set }
    var logStream: AsyncStream<ServerLogEntry> { get }
    
    func start() async throws
    func stop() async
    func checkHealth() async -> Bool
}
```

**Singleton managers** - Core services use thread-safe singletons:
```swift
// mac/VibeTunnel/Core/Services/ServerManager.swift:14
@MainActor static let shared = ServerManager()

// ios/VibeTunnel/Services/APIClient.swift:93
static let shared = APIClient()
```

### Async/Await Patterns

**Swift async operations** - From `ios/VibeTunnel/Services/APIClient.swift`:
```swift
func getSessions() async throws -> [Session] {
    guard let url = makeURL(path: "/api/sessions") else {
        throw APIError.invalidURL
    }
    
    let (data, response) = try await session.data(from: url)
    
    guard let httpResponse = response as? HTTPURLResponse else {
        throw APIError.invalidResponse
    }
    
    if httpResponse.statusCode != 200 {
        throw APIError.serverError(httpResponse.statusCode, nil)
    }
    
    return try decoder.decode([Session].self, from: data)
}
```

**TypeScript async patterns** - From `web/src/server/services/buffer-aggregator.ts`:
```typescript
async handleClientMessage(
  clientWs: WebSocket,
  data: { type: string; sessionId?: string }
): Promise<void> {
  const subscriptions = this.clientSubscriptions.get(clientWs);
  if (!subscriptions) return;
  
  if (data.type === 'subscribe' && data.sessionId) {
    // Handle subscription
  }
}
```

### Error Handling

**Swift error enums** - Comprehensive error types with localized descriptions:
```swift
// ios/VibeTunnel/Services/APIClient.swift:4-70
enum APIError: LocalizedError {
    case invalidURL
    case serverError(Int, String?)
    case networkError(Error)
    
    var errorDescription: String? {
        switch self {
        case .serverError(let code, let message):
            if let message { return message }
            switch code {
            case 400: return "Bad request"
            case 401: return "Unauthorized"
            default: return "Server error: \(code)"
            }
        }
    }
}
```

**TypeScript error handling** - Structured error responses:
```typescript
// web/src/server/middleware/auth.ts
try {
  // Operation
} catch (error) {
  console.error('[Auth] Error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error instanceof Error ? error.message : 'Unknown error'
  });
}
```

### State Management

**SwiftUI Observable** - From `mac/VibeTunnel/Core/Services/ServerManager.swift`:
```swift
@Observable
class ServerManager {
    private(set) var isRunning = false
    private(set) var isRestarting = false
    private(set) var lastError: Error?
}
```

**AppStorage for persistence**:
```swift
// mac/VibeTunnel/Presentation/Views/Settings/GeneralSettingsView.swift:5
@AppStorage("autostart") private var autostart = false
@AppStorage("updateChannel") private var updateChannelRaw = UpdateChannel.stable.rawValue
```

### UI Patterns

**SwiftUI form layouts** - From `mac/VibeTunnel/Presentation/Views/Settings/GeneralSettingsView.swift`:
```swift
Form {
    Section {
        VStack(alignment: .leading, spacing: 4) {
            Toggle("Launch at Login", isOn: launchAtLoginBinding)
            Text("Description")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    } header: {
        Text("Application")
            .font(.headline)
    }
}
.formStyle(.grouped)
```

**Lit reactive properties**:
```typescript
// web/src/client/components/vibe-terminal-buffer.ts:22-24
@property({ type: String }) sessionId = '';
@state() private buffer: BufferSnapshot | null = null;
@state() private error: string | null = null;
```

## Workflows

### Adding a New Service

1. **Define the protocol** in `mac/VibeTunnel/Core/Protocols/`:
```swift
@MainActor
protocol MyServiceProtocol {
    func performAction() async throws
}
```

2. **Implement the service** in `mac/VibeTunnel/Core/Services/`:
```swift
@MainActor
class MyService: MyServiceProtocol {
    static let shared = MyService()
    
    func performAction() async throws {
        // Implementation
    }
}
```

3. **Add to environment** if needed in `mac/VibeTunnel/Core/Extensions/EnvironmentValues+Services.swift`

### Creating UI Components

**SwiftUI views** follow this pattern:
```swift
struct MyView: View {
    @Environment(\.myService) private var service
    @State private var isLoading = false
    
    var body: some View {
        // View implementation
    }
}
```

**Lit components** use decorators:
```typescript
@customElement('my-component')
export class MyComponent extends LitElement {
    @property({ type: String }) value = '';
    
    render() {
        return html`<div>${this.value}</div>`;
    }
}
```

### Testing Patterns

**Swift unit tests** - From `mac/VibeTunnelTests/ServerManagerTests.swift`:
```swift
@MainActor
final class ServerManagerTests: XCTestCase {
    override func setUp() async throws {
        await super.setUp()
        // Setup
    }
    
    func testServerStart() async throws {
        let manager = ServerManager.shared
        await manager.start()
        XCTAssertTrue(manager.isRunning)
    }
}
```

**TypeScript tests** use Vitest:
```typescript
// web/src/test/setup.ts
import { describe, it, expect } from 'vitest';

describe('BufferAggregator', () => {
  it('should handle client connections', async () => {
    // Test implementation
  });
});
```

## Reference

### File Organization

**Swift packages**:
- `mac/VibeTunnel/Core/` - Core business logic, protocols, services
- `mac/VibeTunnel/Presentation/` - SwiftUI views and view models
- `mac/VibeTunnel/Utilities/` - Helper classes and extensions
- `ios/VibeTunnel/Services/` - iOS-specific services
- `ios/VibeTunnel/Views/` - iOS UI components

**TypeScript modules**:
- `web/src/client/` - Frontend components and utilities
- `web/src/server/` - Backend services and routes
- `web/src/server/pty/` - Terminal handling
- `web/src/test/` - Test files and utilities

### Naming Conventions

**Swift**:
- Services: `*Manager`, `*Service` (e.g., `ServerManager`, `APIClient`)
- Protocols: `*Protocol`, `*able` (e.g., `VibeTunnelServer`, `HTTPClientProtocol`)
- Views: `*View` (e.g., `GeneralSettingsView`, `TerminalView`)
- Errors: `*Error` enum (e.g., `ServerError`, `APIError`)

**TypeScript**:
- Services: `*Service`, `*Manager` (e.g., `BufferAggregator`, `TerminalManager`)
- Components: `vibe-*` custom elements (e.g., `vibe-terminal-buffer`)
- Types: PascalCase interfaces (e.g., `BufferSnapshot`, `ServerConfig`)

### Common Issues

**Port conflicts** - Handled in `mac/VibeTunnel/Core/Utilities/PortConflictResolver.swift`
**Permission management** - See `mac/VibeTunnel/Core/Services/*PermissionManager.swift`
**WebSocket reconnection** - Implemented in `ios/VibeTunnel/Services/BufferWebSocketClient.swift`
**Terminal resizing** - Handled in both Swift and TypeScript terminal components

### VibeTunnel CLI Wrapper (vt)

The `vt` command is a bash wrapper script that allows users to run commands through VibeTunnel's terminal forwarding. It's installed at `/usr/local/bin/vt` when the Mac app is built.

**Source location**: `mac/VibeTunnel/vt`

**Usage**:
```bash
# Run a command through VibeTunnel
vt ls -la

# Run an aliased command (e.g., if 'claude' is an alias)
vt claude --version

# Launch interactive shell
vt --shell
vt -i

# Run command without shell wrapping (bypass alias resolution)
vt --no-shell-wrap command
vt -S command
```

**How it works**:
1. Locates the VibeTunnel.app bundle (checks standard locations and uses Spotlight if needed)
2. Finds the `vibetunnel` binary within the app bundle's Resources
3. Determines if the command is a binary or alias/function
4. For binaries: executes directly through `vibetunnel fwd`
5. For aliases/functions: wraps in appropriate shell (`zsh -i -c` or `bash -c`) for proper resolution

**Technical Details**:
- The `--` separator should not be passed to `fwd` as it was being misinterpreted as a command
- Aliases require interactive shell mode to be resolved properly
- The script prevents recursive VibeTunnel sessions by checking `VIBETUNNEL_SESSION_ID`
- The `fwd` binary now properly handles `--` as an argument separator when needed
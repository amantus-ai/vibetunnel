<!-- Generated: 2025-06-21 16:45:00 UTC -->

# Testing

VibeTunnel uses modern testing frameworks across platforms: Swift Testing for macOS/iOS and Vitest for Node.js. Tests are organized by platform and type, with both unit and end-to-end testing capabilities.

## Key Files

**Test Configurations** - web/vitest.config.ts (main config), web/vitest.config.e2e.ts (E2E config)

**Test Utilities** - web/src/test/test-utils.ts (mock helpers), mac/VibeTunnelTests/Utilities/TestTags.swift (test categorization)

**Platform Tests** - mac/VibeTunnelTests/ (Swift tests), web/src/test/ (Node.js tests)

## Test Types

### macOS Unit Tests

Swift Testing framework tests covering core functionality:

```swift
// From mac/VibeTunnelTests/ServerManagerTests.swift:14-40
@Test("Starting and stopping Bun server", .tags(.critical))
func serverLifecycle() async throws {
    let manager = ServerManager.shared
    await manager.stop()
    await manager.start()
    #expect(manager.isRunning)
    await manager.stop()
    #expect(!manager.isRunning)
}
```

**Core Test Files**:
- mac/VibeTunnelTests/ServerManagerTests.swift - Server lifecycle and management
- mac/VibeTunnelTests/TerminalManagerTests.swift - Terminal session handling
- mac/VibeTunnelTests/TTYForwardManagerTests.swift - TTY forwarding logic
- mac/VibeTunnelTests/SessionMonitorTests.swift - Session monitoring
- mac/VibeTunnelTests/NetworkUtilityTests.swift - Network operations
- mac/VibeTunnelTests/CLIInstallerTests.swift - CLI installation
- mac/VibeTunnelTests/NgrokServiceTests.swift - Ngrok integration
- mac/VibeTunnelTests/DashboardKeychainTests.swift - Keychain operations

**Test Tags** (mac/VibeTunnelTests/Utilities/TestTags.swift):
- `.critical` - Core functionality tests
- `.networking` - Network-related tests
- `.concurrency` - Async/concurrent operations
- `.security` - Security features
- `.integration` - Cross-component tests

### Node.js Tests

Vitest-based testing with unit and E2E capabilities:

**Test Configuration** (web/vitest.config.ts):
- Global test mode enabled
- Node environment
- Coverage thresholds: 80% across all metrics
- Custom test utilities setup (web/src/test/setup.ts)

**E2E Tests** (web/src/test/e2e/):
- hq-mode.e2e.test.ts - HQ mode with multiple remotes (lines 9-486)
- server-smoke.e2e.test.ts - Basic server functionality

**Test Utilities** (web/src/test/test-utils.ts):
```typescript
// Mock session creation helper
export const createMockSession = (overrides?: Partial<MockSession>): MockSession => ({
  id: 'test-session-123',
  command: 'bash',
  workingDir: '/tmp',
  status: 'running',
  ...overrides,
});
```

## Running Tests

### macOS Tests

```bash
# Run all tests via Xcode
xcodebuild test -project mac/VibeTunnel.xcodeproj -scheme VibeTunnel

# Run specific test tags
xcodebuild test -project mac/VibeTunnel.xcodeproj -scheme VibeTunnel -only-testing:VibeTunnelTests/ServerManagerTests
```

### Node.js Tests

```bash
# Run all tests
cd web && npm run test
```

### Test Scripts (web/package.json:28-33):
- npm run test

## Test Organization

### macOS Test Structure
```
mac/VibeTunnelTests/
├── Utilities/
│   ├── TestTags.swift      - Test categorization
│   ├── TestFixtures.swift  - Shared test data
│   └── MockHTTPClient.swift - HTTP client mocks
├── ServerManagerTests.swift
├── TerminalManagerTests.swift
├── TTYForwardManagerTests.swift
├── SessionMonitorTests.swift
├── NetworkUtilityTests.swift
├── CLIInstallerTests.swift
├── NgrokServiceTests.swift
├── DashboardKeychainTests.swift
├── ModelTests.swift
├── SessionIdHandlingTests.swift
└── VibeTunnelTests.swift
```

### Node.js Test Structure
```
web/src/test/
├── e2e/
│   ├── hq-mode.e2e.test.ts    - Multi-server HQ testing
│   └── server-smoke.e2e.test.ts - Basic server tests
├── setup.ts                     - Test environment setup
└── test-utils.ts               - Shared test utilities
```

## Reference

**Coverage Configuration** (web/vitest.config.ts:9-31):
- Provider: V8
- Reporters: text, json, html, lcov
- Thresholds: 80% for lines, functions, branches, statements
- Excludes: node_modules, test files, config files

**E2E Test Config** (web/vitest.config.e2e.ts):
- Extended timeouts: 60s test, 30s hooks
- Raw environment (no setup files)
- Focused on src/test/e2e/ directory

**Custom Matchers** (web/src/test/setup.ts:5-22):
- `toBeValidSession()` - Validates session object structure

**Test Utilities**:
- `createMockSession()` - Generate test session data
- `createTestServer()` - Spin up Express server for testing
- `waitForWebSocket()` - WebSocket timing helper
- `mockWebSocketServer()` - Mock WS server implementation
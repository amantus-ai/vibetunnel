<!-- Generated: 2025-07-18 11:00:00 UTC -->

# Testing

VibeTunnel uses modern testing frameworks across platforms: Swift Testing for macOS/iOS, Vitest for Node.js unit tests, and Playwright for end-to-end web testing. Tests are organized by platform and type, with comprehensive coverage requirements.

## Key Files

**Test Configurations** 
- web/vitest.config.ts (main config)
- web/vitest.config.e2e.ts (E2E config)
- web/playwright.config.ts (Playwright E2E)

**Test Utilities**
- web/src/test/test-utils.ts (mock helpers)
- mac/VibeTunnelTests/Utilities/TestTags.swift (test categorization)

**Platform Tests**
- mac/VibeTunnelTests/ (Swift tests)
- web/src/test/ (Node.js tests)
- web/tests/ (Playwright E2E tests)

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
- ServerManagerTests.swift - Server lifecycle and management
- TerminalManagerTests.swift - Terminal session handling
- TTYForwardManagerTests.swift - TTY forwarding logic
- SessionMonitorTests.swift - Session monitoring
- NetworkUtilityTests.swift - Network operations
- CLIInstallerTests.swift - CLI installation
- NgrokServiceTests.swift - Ngrok integration
- DashboardKeychainTests.swift - Keychain operations

**Test Tags** (mac/VibeTunnelTests/Utilities/TestTags.swift):
- `.critical` - Core functionality tests
- `.networking` - Network-related tests
- `.concurrency` - Async/concurrent operations
- `.security` - Security features
- `.integration` - Cross-component tests

### Node.js Unit Tests

Vitest-based testing with unit and E2E capabilities:

**Test Configuration** (web/vitest.config.ts):
- Global test mode enabled
- Node environment
- Coverage thresholds: 80% across all metrics
- Custom test utilities setup (web/src/test/setup.ts)

**E2E Tests** (web/src/test/e2e/):
- hq-mode.e2e.test.ts - HQ mode with multiple remotes
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

### Playwright End-to-End Tests

Browser automation tests for full user workflows:

**Configuration** (web/playwright.config.ts):
```typescript
use: {
  // Global timeout for assertions
  expect: { timeout: 5000 },
  
  // Action timeout (click, fill, etc.)
  actionTimeout: 10000,
  
  // Navigation timeout
  navigationTimeout: 10000,
  
  // Trace on retry for debugging
  trace: 'on-first-retry',
}
```

## Playwright Best Practices

### Use Auto-Waiting Instead of Arbitrary Delays

**❌ Bad: Arbitrary timeouts**
```typescript
await page.waitForTimeout(1000); // Don't do this!
```

**✅ Good: Wait for specific conditions**
```typescript
// Wait for element to be visible
await page.waitForSelector('vibe-terminal', { state: 'visible' });

// Wait for loading indicator to disappear
await page.locator('.loading-spinner').waitFor({ state: 'hidden' });

// Wait for specific text to appear
await page.getByText('Session created').waitFor();
```

### Use Web-First Assertions

Web-first assertions automatically wait and retry:

```typescript
// These assertions auto-wait
await expect(page.locator('session-card')).toBeVisible();
await expect(page).toHaveURL(/\?session=/);
await expect(sessionCard).toContainText('RUNNING');
```

### Prefer User-Facing Locators

**Locator Priority (best to worst):**
1. `getByRole()` - semantic HTML roles
2. `getByText()` - visible text content
3. `getByTestId()` - explicit test IDs
4. `locator()` with CSS - last resort

```typescript
// Good examples
await page.getByRole('button', { name: 'Create Session' }).click();
await page.getByText('Session Name').fill('My Session');
await page.getByTestId('terminal-output').waitFor();
```

### VibeTunnel-Specific Patterns

**Waiting for Terminal Ready**
```typescript
// Wait for terminal component to be visible
await page.waitForSelector('vibe-terminal', { state: 'visible' });

// Wait for terminal to have content
await page.waitForFunction(() => {
  const terminal = document.querySelector('vibe-terminal');
  return terminal && (
    terminal.textContent?.trim().length > 0 ||
    !!terminal.shadowRoot ||
    !!terminal.querySelector('.xterm')
  );
});
```

**Session Creation**
```typescript
// Wait for navigation after session creation
await expect(page).toHaveURL(/\?session=/, { timeout: 2000 });

// Wait for terminal to be ready
await page.locator('vibe-terminal').waitFor({ state: 'visible' });
```

**Terminal Output**
```typescript
// Wait for specific text in terminal
await page.waitForFunction(
  (searchText) => {
    const terminal = document.querySelector('vibe-terminal');
    return terminal?.textContent?.includes(searchText);
  },
  'Expected output'
);

// Wait for shell prompt
await page.waitForFunction(() => {
  const terminal = document.querySelector('vibe-terminal');
  const content = terminal?.textContent || '';
  return /[$>#%❯]\s*$/.test(content);
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
# Run all unit tests
cd web && pnpm run test

# Run with coverage
pnpm run test:coverage

# Run E2E tests
pnpm run test:e2e
```

### Playwright Tests

```bash
# Install browsers (first time)
cd web && pnpm exec playwright install

# Run all Playwright tests
pnpm run test:playwright

# Run with UI mode
pnpm exec playwright test --ui

# Debug specific test
pnpm exec playwright test --debug tests/session-management.spec.ts
```

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

### Web Test Structure
```
web/
├── src/test/           # Unit tests
│   ├── e2e/
│   │   ├── hq-mode.e2e.test.ts
│   │   └── server-smoke.e2e.test.ts
│   ├── setup.ts
│   └── test-utils.ts
└── tests/              # Playwright E2E tests
    ├── session-management.spec.ts
    ├── terminal-interaction.spec.ts
    └── fixtures/
```

## Coverage Requirements

**Node.js Coverage** (web/vitest.config.ts):
- Provider: V8
- Reporters: text, json, html, lcov
- Thresholds: 80% for lines, functions, branches, statements
- Excludes: node_modules, test files, config files

**Playwright Coverage**: Focus on critical user journeys rather than code coverage.

## Custom Matchers & Utilities

**Node.js Custom Matchers** (web/src/test/setup.ts):
- `toBeValidSession()` - Validates session object structure

**Test Utilities**:
- `createMockSession()` - Generate test session data
- `createTestServer()` - Spin up Express server for testing
- `waitForWebSocket()` - WebSocket timing helper
- `mockWebSocketServer()` - Mock WS server implementation

## Debugging Flaky Tests

### Enable Trace Recording
```typescript
// In playwright.config.ts
use: {
  trace: 'on-first-retry',
}
```

### Use Debug Mode
```bash
# Run with headed browser and inspector
pnpm exec playwright test --debug
```

### Add Strategic Logging
```typescript
console.log('Waiting for terminal to be ready...');
await page.locator('vibe-terminal').waitFor();
console.log('Terminal is ready');
```

## Best Practices Summary

1. **Never use `waitForTimeout()`** - always wait for specific conditions
2. **Use web-first assertions** that auto-wait
3. **Prefer semantic locators** over CSS selectors
4. **Wait for observable conditions** not arbitrary time
5. **Configure appropriate timeouts** for your application
6. **Keep tests isolated** and independent
7. **Use debugging tools** for flaky tests
8. **Test at the right level** - unit for logic, E2E for workflows
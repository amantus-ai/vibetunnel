# Testing Guide

## Quick Commands

```bash
# Run all tests
./scripts/test-all.sh

# Platform-specific
cd mac && xcodebuild test
cd ios && ./scripts/test-with-coverage.sh
cd web && pnpm test

# With coverage
cd web && pnpm test:coverage
```

## Test Structure

```
tests/
├── unit/           # Unit tests
├── integration/    # Integration tests
├── e2e/           # End-to-end tests
└── fixtures/      # Test data
```

## Unit Testing

### Swift (XCTest)

```swift
// mac/VibeTunnelTests/ServerManagerTests.swift
import XCTest
@testable import VibeTunnel

class ServerManagerTests: XCTestCase {
    func testServerStart() async throws {
        let manager = ServerManager()
        
        try await manager.start()
        
        XCTAssertTrue(manager.isRunning)
        XCTAssertEqual(manager.port, "4020")
    }
    
    func testPortValidation() {
        XCTAssertThrowsError(try validatePort("abc"))
        XCTAssertNoThrow(try validatePort("8080"))
    }
}
```

### TypeScript (Vitest)

```typescript
// web/tests/session-manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/server/services/session-manager';

describe('SessionManager', () => {
  let manager: SessionManager;
  
  beforeEach(() => {
    manager = new SessionManager();
  });
  
  it('creates session', async () => {
    const session = await manager.create({
      shell: '/bin/bash',
      cols: 80,
      rows: 24
    });
    
    expect(session.id).toBeDefined();
    expect(session.status).toBe('running');
  });
});
```

## Integration Testing

### API Testing

```typescript
// web/tests/integration/api.test.ts
import request from 'supertest';
import { app } from '../../src/server/app';

describe('API Integration', () => {
  it('creates session via API', async () => {
    const response = await request(app)
      .post('/api/sessions')
      .send({ shell: '/bin/bash' })
      .expect(201);
    
    expect(response.body).toHaveProperty('id');
    expect(response.body.status).toBe('running');
  });
});
```

### WebSocket Testing

```typescript
// web/tests/integration/websocket.test.ts
import { WebSocket } from 'ws';

describe('WebSocket Integration', () => {
  it('connects to session', async () => {
    const ws = new WebSocket('ws://localhost:4020/api/sessions/test/ws');
    
    await new Promise((resolve) => {
      ws.on('open', resolve);
    });
    
    ws.send(JSON.stringify({ type: 'input', data: 'echo test\n' }));
    
    const message = await new Promise((resolve) => {
      ws.on('message', resolve);
    });
    
    expect(message.toString()).toContain('test');
  });
});
```

## E2E Testing

### Playwright Setup

```typescript
// web/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:4020',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev',
    port: 4020,
    reuseExistingServer: !process.env.CI,
  },
});
```

### E2E Tests

```typescript
// web/tests/e2e/terminal.test.ts
import { test, expect } from '@playwright/test';

test('complete terminal workflow', async ({ page }) => {
  // Navigate to app
  await page.goto('/');
  
  // Create new terminal
  await page.click('button:has-text("New Terminal")');
  
  // Wait for terminal to load
  const terminal = page.locator('.terminal');
  await expect(terminal).toBeVisible();
  
  // Type command
  await page.keyboard.type('echo "Hello, VibeTunnel"');
  await page.keyboard.press('Enter');
  
  // Verify output
  await expect(terminal).toContainText('Hello, VibeTunnel');
  
  // Close session
  await page.click('button[aria-label="Close terminal"]');
  await expect(terminal).not.toBeVisible();
});
```

## Performance Testing

### Load Testing

```javascript
// tests/performance/load.js
import { check } from 'k6';
import ws from 'k6/ws';

export default function() {
  const url = 'ws://localhost:4020/api/sessions/test/ws';
  
  ws.connect(url, {}, function(socket) {
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'input', data: 'ls\n' }));
    });
    
    socket.on('message', (data) => {
      check(data, {
        'received response': (d) => d.length > 0,
      });
    });
  });
}

export const options = {
  vus: 100,        // 100 virtual users
  duration: '30s', // 30 second test
};
```

### Benchmark Suite

```typescript
// tests/performance/benchmark.ts
import { bench, describe } from 'vitest';

describe('Buffer encoding performance', () => {
  bench('encode 1KB', () => {
    encodeBuffer('x'.repeat(1024));
  });
  
  bench('encode 10KB', () => {
    encodeBuffer('x'.repeat(10240));
  });
});
```

## Test Coverage

### Coverage Requirements

| Component | Target | Current |
|-----------|--------|---------|
| Server | 80% | 85% |
| Client | 70% | 72% |
| Mac App | 60% | 65% |
| iOS App | 75% | 78% |

### Generate Reports

```bash
# Web coverage
cd web && pnpm test:coverage

# iOS coverage
cd ios && ./scripts/test-with-coverage.sh

# View HTML report
open coverage/index.html
```

## Testing External Devices

### iPad/iPhone Testing

```bash
# 1. Start dev server on all interfaces
cd web && pnpm dev --host 0.0.0.0

# 2. Get Mac IP
ifconfig | grep inet

# 3. Access from device
# http://192.168.1.100:4021
```

### Cross-Browser Testing

```typescript
// playwright.config.ts
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'Mobile Safari', use: { ...devices['iPhone 13'] } },
]
```

## Mocking & Fixtures

### Mock PTY

```typescript
// tests/mocks/pty.ts
export class MockPTY {
  write(data: string) {
    this.emit('data', `mock: ${data}`);
  }
  
  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }
}
```

### Test Fixtures

```typescript
// tests/fixtures/sessions.ts
export const mockSession = {
  id: 'test-session-123',
  name: 'Test Session',
  status: 'running',
  created: new Date(),
  pid: 12345,
};
```

## CI/CD Testing

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          
      - name: Install dependencies
        run: |
          cd web && pnpm install
          
      - name: Run tests
        run: ./scripts/test-all.sh
        
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Debugging Tests

### Debug Swift Tests

```bash
# Run with verbose output
xcodebuild test -verbose

# Debug specific test
xcodebuild test -only-testing:VibeTunnelTests/ServerManagerTests/testServerStart
```

### Debug TypeScript Tests

```bash
# Run with inspector
node --inspect-brk ./node_modules/.bin/vitest

# Run single test file
pnpm test session-manager.test.ts

# Watch mode
pnpm test --watch
```

## Best Practices

1. **Test naming**: Use descriptive names like `shouldCreateSessionWithCustomShell`
2. **Isolation**: Each test should be independent
3. **Cleanup**: Always cleanup resources (sessions, files, connections)
4. **Assertions**: Test both success and error cases
5. **Speed**: Keep unit tests under 100ms each
6. **Flakiness**: Retry flaky tests, investigate root cause

## Common Issues

| Issue | Solution |
|-------|----------|
| Tests timeout | Increase timeout, check async |
| Port conflicts | Use random ports in tests |
| Flaky WebSocket | Add connection retry logic |
| Coverage gaps | Add tests for error paths |

## See Also
- [Development Guide](development.md)
- [CI/CD Setup](../reference/release-process.md#cicd-pipeline)
- [Troubleshooting](../reference/troubleshooting.md)
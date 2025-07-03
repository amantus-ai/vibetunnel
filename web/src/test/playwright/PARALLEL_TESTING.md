# Parallel Testing Configuration

This document explains the parallel testing setup for VibeTunnel's Playwright tests.

## Overview

Tests are organized into two groups based on their execution requirements:

1. **Parallel Tests** - Tests that create their own isolated sessions and can run concurrently
2. **Serial Tests** - Tests that perform global operations or modify shared state

## Test Organization

### Parallel Tests (can run concurrently)
These tests create their own sessions with unique names and properly clean up after themselves:

- `session-creation.spec.ts` - Session creation workflows
- `basic-session.spec.ts` - Basic session operations
- `minimal-session.spec.ts` - Minimal session tests
- `debug-session.spec.ts` - Debug session features
- `ui-features.spec.ts` - UI-focused tests
- `test-session-persistence.spec.ts` - Session persistence tests
- `session-navigation.spec.ts` - Navigation between sessions
- `session-management.spec.ts` - Session management features
- `session-management-advanced.spec.ts` - Advanced session features (individual operations)

### Serial Tests (must run sequentially)
These tests perform operations that affect all sessions or modify global state:

- `session-management-global.spec.ts` - Global operations like "Kill All"
- `keyboard-shortcuts.spec.ts` - Keyboard shortcuts (some may affect global state)
- `terminal-interaction.spec.ts` - Terminal interaction tests (currently skipped)

## Configuration

The parallel configuration is set up in `playwright.config.ts`:

```typescript
// Global configuration
fullyParallel: true, // Enable parallel execution
workers: process.env.CI ? 2 : undefined, // 2 workers in CI, auto-detect locally

// Project-specific configuration
projects: [
  {
    name: 'chromium-parallel',
    testMatch: [...], // Parallel test files
  },
  {
    name: 'chromium-serial',
    testMatch: [...], // Serial test files
    fullyParallel: false, // Override for serial execution
  },
]
```

## Running Tests

Use the provided script `scripts/test-parallel.sh`:

```bash
# Run all tests (parallel + serial)
./scripts/test-parallel.sh all

# Run only parallel tests
./scripts/test-parallel.sh parallel

# Run only serial tests
./scripts/test-parallel.sh serial

# Debug mode
./scripts/test-parallel.sh debug

# UI mode
./scripts/test-parallel.sh ui
```

Or use Playwright directly:

```bash
# Run all tests
pnpm exec playwright test

# Run specific project
pnpm exec playwright test --project=chromium-parallel
pnpm exec playwright test --project=chromium-serial

# Run specific test file
pnpm exec playwright test session-creation.spec.ts
```

## Best Practices for Parallel Tests

1. **Test Isolation**: Each test should be completely independent
   - Create unique session names using `TestSessionManager.generateSessionName()`
   - Clean up sessions in `afterEach` hooks
   - Don't rely on sessions from other tests

2. **Unique Data**: Use timestamps and random strings in test data
   ```typescript
   const sessionName = sessionManager.generateSessionName('test-prefix');
   ```

3. **Proper Cleanup**: Always clean up created resources
   ```typescript
   test.afterEach(async () => {
     await sessionManager.cleanupAllSessions();
   });
   ```

4. **Avoid Global Operations**: Tests that affect all sessions should go in serial tests
   - "Kill All" functionality
   - Global settings changes
   - Operations that affect the session list view

5. **State Management**: Reset any modified state
   - Local storage is cleared automatically by the test fixture
   - UI state changes should be reverted

## Performance Benefits

With parallel execution enabled:
- Tests run concurrently up to the worker limit
- Significantly reduced total test execution time
- Better resource utilization
- Faster feedback in CI/CD pipelines

## Troubleshooting

If tests fail when run in parallel but pass when run individually:

1. Check for shared state between tests
2. Ensure unique session names
3. Verify proper cleanup
4. Look for timing dependencies
5. Consider moving the test to the serial group

## Future Improvements

- Add sharding support for even more parallelization across machines
- Optimize worker count based on available resources
- Add performance metrics tracking
- Consider test prioritization based on failure history
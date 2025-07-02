# Playwright Concurrent Test Execution

This document explains the changes made to support concurrent Playwright test execution.

## Overview

The Playwright tests have been modified to support concurrent execution, allowing tests to run in parallel for faster test suite completion. Each test now manages its own sessions without interfering with other tests.

## Key Changes

### 1. Session Management

- **TestSessionManager** (`test-data-manager.helper.ts`):
  - Now tracks sessions per test instance
  - `cleanupAllSessions()` only cleans up tracked sessions (no global Kill All)
  - Added `cleanupAllSessionsGlobally()` for special cases (deprecated)
  - Support for test-specific session prefixes

- **SessionCleanupHelper** (`session-cleanup.helper.ts`):
  - `cleanupAllSessions()` now delegates to pattern-based cleanup
  - Added `forceCleanupAllSessionsGlobally()` for special cases
  - Recommended to use `cleanupByPattern()` for concurrent safety

### 2. Test Configuration

- **playwright.config.ts**:
  - `fullyParallel` controlled by `PLAYWRIGHT_PARALLEL` environment variable
  - `workers` configurable via `PLAYWRIGHT_WORKERS` environment variable
  - Default remains sequential (single worker) for backward compatibility

### 3. Package Scripts

New scripts for parallel execution:
- `pnpm run test:e2e:parallel` - Run tests in parallel mode
- `pnpm run test:e2e:parallel:headed` - Run tests in parallel with browser UI
- `pnpm run test:e2e:parallel:workers` - Run with 4 workers (adjustable)

### 4. Test Isolation

- Session IDs use UUIDs (already implemented)
- Session names include timestamps and random values for uniqueness
- Each test only cleans up its own tracked sessions
- "Kill All" test skipped in parallel mode

## Running Tests

### Sequential Mode (Default)
```bash
# Traditional sequential execution
pnpm run test:e2e
```

### Parallel Mode
```bash
# Run all tests in parallel
pnpm run test:e2e:parallel

# Run with specific number of workers
PLAYWRIGHT_PARALLEL=true PLAYWRIGHT_WORKERS=8 pnpm run test:e2e

# Debug parallel tests with headed browser
pnpm run test:e2e:parallel:headed
```

## Best Practices for Test Authors

1. **Always use TestSessionManager** for session creation:
   ```typescript
   const sessionManager = new TestSessionManager(page, 'my-test-prefix');
   const { sessionName, sessionId } = await sessionManager.createTrackedSession();
   ```

2. **Use unique prefixes** for different test suites:
   ```typescript
   const prefix = TestDataFactory.getTestSpecificPrefix('session-management');
   ```

3. **Never use global cleanup** in tests:
   ```typescript
   // ❌ BAD - affects all sessions
   await sessionCleanupHelper.forceCleanupAllSessionsGlobally();
   
   // ✅ GOOD - only cleans test-specific sessions
   await sessionManager.cleanupAllSessions();
   ```

4. **Use pattern-based cleanup** when needed:
   ```typescript
   // Clean up sessions matching a pattern
   await sessionCleanupHelper.cleanupByPattern(/^test-myfeature-/);
   ```

## Troubleshooting

### Tests Failing in Parallel Mode

1. Check for global state modifications
2. Ensure tests use unique session names
3. Verify no direct "Kill All" button usage
4. Look for race conditions in session creation/deletion

### Performance Issues

1. Adjust worker count based on CPU cores
2. Consider test grouping for related tests
3. Monitor system resources during test runs

## Future Improvements

1. Automatic test-specific prefix generation based on test file
2. Enhanced session tracking with metadata
3. Better error reporting for session conflicts
4. Performance metrics for parallel vs sequential runs
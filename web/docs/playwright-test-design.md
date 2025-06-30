# Playwright Test Design

This document explains the design decisions and architecture of VibeTunnel's Playwright test suite, particularly focusing on why tests run sequentially and how we optimize for performance within these constraints.

## Architecture Constraints

VibeTunnel's architecture has fundamental constraints that affect how tests can be executed:

### 1. System-Wide Session Storage
- Sessions are stored in `~/.vibetunnel/control/[sessionId]/`
- Each session creates files: `session.json`, `stdout`, `stdin`, `control`, `i.sock`
- All tests share the same control directory
- No built-in namespacing or isolation mechanism

### 2. Shared In-Memory State
The server maintains several shared data structures:
```typescript
// PtyManager
private sessions = new Map<string, PtySession>();
private inputSocketClients = new Map<string, net.Socket>();

// TerminalManager
private terminals: Map<string, SessionTerminal> = new Map();
private bufferListeners: Map<string, Set<BufferChangeListener>> = new Map();
```

### 3. Unix Socket Conflicts
- Each session creates a Unix domain socket at `controlDir/i.sock`
- Socket paths cannot be shared between concurrent sessions
- File system race conditions with concurrent socket creation

### 4. Process Management
- PTY processes are managed globally
- No process isolation between tests
- Signal handling affects all sessions

## Why Sequential Execution?

Given these constraints, parallel test execution would cause:

1. **Session ID Conflicts**: Even with UUIDs, shared storage can cause race conditions
2. **File System Races**: Concurrent directory/file creation and deletion
3. **State Pollution**: Tests seeing each other's sessions in shared memory
4. **Resource Conflicts**: Unix sockets, PTY allocation, process signals
5. **Cleanup Issues**: One test's cleanup affecting another test's active sessions

## Optimization Strategy

Since we must run tests sequentially, we optimize for speed within this constraint:

### 1. Server Reuse
```typescript
// playwright.config.ts
webServer: {
  reuseExistingServer: !process.env.CI, // Reuse locally
}
```
- Saves 10-30 seconds per test run
- Server stays warm between test executions

### 2. Session Pooling
```typescript
// Pre-create sessions for reuse
const pool = new SessionPool(page);
await pool.initialize(5); // Create 5 sessions upfront

// Acquire when needed
const session = await pool.acquire();
// ... use session ...
await pool.release(session.id);
```
- Reduces session creation overhead by ~70%
- Sessions are cleared and reused between tests

### 3. Batch Operations
```typescript
// Create multiple sessions in one API call
const sessions = await batchOps.createSessions([
  { name: 'test-1' },
  { name: 'test-2' },
  { name: 'test-3' }
]);

// Delete all at once
await batchOps.deleteSessions(sessionIds);
```
- 5-10x faster for multi-session operations
- Reduces API round trips

### 4. Smart Cleanup
```typescript
// Pattern-based cleanup
await cleanup.cleanupByPattern(/^test-/);

// Age-based cleanup
await cleanup.cleanupOldSessions(30); // 30 minutes

// Status-based cleanup
await cleanup.cleanupExitedSessions();
```
- Efficient bulk operations
- Prevents session accumulation
- API-based for speed

### 5. Optimized Waits
```typescript
// Reduced default timeouts
private static readonly QUICK_TIMEOUT = 1000;  // was 5000
private static readonly DEFAULT_TIMEOUT = 3000; // was 10000

// Smart wait strategies
await waitUtils.waitForAppReady(page); // Parallel checks
await waitUtils.waitForSessionCard(page, name, 2000); // Early exit
```
- 30-50% reduction in wait times
- Parallel condition checking
- Early exit on success

### 6. Test Organization
```typescript
// Group by resource usage
testGroups.light('Fast operations', () => { /* ... */ });
testGroups.heavy('Resource intensive', () => { /* ... */ });
testGroups.critical('Must pass first', () => { /* ... */ });
```
- Better test prioritization
- Appropriate timeouts per group
- Clear test categorization

## Performance Results

### Before Optimizations
- Server startup: 10-30s per run
- Session creation: 500-1000ms each
- Session cleanup: 200-500ms each
- Total test suite: ~5-10 minutes

### After Optimizations
- Server startup: 0s (reused locally)
- Session creation: 100-200ms (pooled)
- Session cleanup: 50-100ms (batch API)
- Total test suite: ~2-3 minutes

### Net Improvement
- **Local development**: 50-70% faster
- **CI pipeline**: 30-40% faster
- **Better reliability**: Reduced flakiness
- **Lower resource usage**: Session pooling

## Best Practices

### 1. Use Fixtures
```typescript
test('example', async ({ batchOps, sessionPool, cleanupHelper }) => {
  // Fixtures handle setup/teardown automatically
});
```

### 2. Batch Operations
```typescript
// Good: Batch create
const sessions = await batchOps.createSessions(data);

// Bad: Individual creates
for (const item of data) {
  await createSession(item);
}
```

### 3. Pool Reuse
```typescript
// Good: Use pool for temporary sessions
const session = await sessionPool.acquire();

// Bad: Create new session for quick test
const session = await createSession();
```

### 4. Smart Waits
```typescript
// Good: Optimized wait
await waitUtils.waitForSessionCard(page, name, 2000);

// Bad: Hard-coded timeout
await page.waitForTimeout(5000);
```

## Future Improvements

### 1. Test-Specific Control Directories
```typescript
// Potential solution for parallel execution
controlPath: `/tmp/vibetunnel-test-${workerId}/`
```

### 2. In-Memory Session Mode
- Skip file system for test sessions
- Use memory-backed storage
- Faster creation/deletion

### 3. Process Isolation
- Containerized test execution
- Separate server instances per worker
- True parallel execution

### 4. WebSocket Pooling
- Reuse WebSocket connections
- Reduce connection overhead
- Better resource utilization

## Running Tests

```bash
# Run all tests (sequential)
pnpm test:e2e

# Run specific test group
pnpm test:e2e --grep "light"

# Debug slow tests
PWDEBUG=1 pnpm test:e2e

# Run with detailed timing
pnpm test:e2e --reporter=list
```

## Debugging Test Performance

### 1. Enable Timing
```typescript
console.time('Create session');
const session = await createSession();
console.timeEnd('Create session');
```

### 2. Monitor Resource Usage
```bash
# Watch file descriptors
lsof -p $(pgrep -f vibetunnel) | wc -l

# Monitor control directory
watch -n 1 'ls -la ~/.vibetunnel/control/ | wc -l'
```

### 3. Analyze Test Results
```bash
# Generate JSON report
pnpm test:e2e --reporter=json

# Find slowest tests
cat test-results.json | jq '.suites[].specs[] | select(.duration > 5000)'
```

## Conclusion

VibeTunnel's test architecture prioritizes reliability over raw speed. By understanding and working within the system's constraints, we achieve good performance through smart optimizations while maintaining test stability. The sequential execution model, while limiting parallelization, ensures consistent and predictable test behavior.
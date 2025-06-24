# Test Utilities

This directory contains shared utilities for VibeTunnel tests, providing standardized patterns for common testing operations.

## Files

### `server-utils.ts`
The main utility module providing comprehensive server management for tests:
- **Server lifecycle management** - Start, stop, and manage test servers
- **Port detection** - Extract port numbers from server output
- **Directory management** - Create and cleanup temporary test directories  
- **Health checks** - Wait for servers to be ready
- **Process management** - Graceful shutdown with timeout handling
- **ServerManager class** - Manage multiple server instances

### `port-detection.ts` (Deprecated)
Legacy port detection utilities maintained for backward compatibility.
- Re-exports functions from `server-utils.ts`
- Will be removed in a future version

### `test-logger.ts`
Consistent logging utilities for tests:
- Formatted error, warning, and info messages
- HTTP response error logging

## Key Features

### 1. Standardized Server Startup
```typescript
const server = await startTestServer({
  args: ['--port', '0', '--no-auth'],
  env: { VIBETUNNEL_USERNAME: 'user' },
  logOutput: true,
  serverType: 'TEST-SERVER'
});
```

### 2. Automatic Port Detection
- Monitors server stdout for port announcement
- Supports multiple output patterns
- Configurable timeout

### 3. Clean Process Management
- Graceful shutdown with SIGTERM
- Automatic SIGKILL fallback
- Proper cleanup of child processes

### 4. Directory Management
- Creates unique temporary directories
- Avoids Unix socket path length limits
- Automatic cleanup after tests

### 5. Multi-Server Support
```typescript
const manager = new ServerManager();
const server1 = await manager.startServer({ args: ['--hq'] });
const server2 = await manager.startServer({ args: ['--remote'] });
await manager.cleanup(); // Stops all servers and cleans directories
```

## Benefits

1. **Consistency** - All tests use the same patterns and utilities
2. **Reliability** - Proper timeouts, error handling, and cleanup
3. **Maintainability** - Update behavior in one place
4. **Type Safety** - Full TypeScript support with interfaces
5. **Less Boilerplate** - Reduce code duplication across tests

## Migration

See [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) for instructions on updating existing tests to use these utilities.
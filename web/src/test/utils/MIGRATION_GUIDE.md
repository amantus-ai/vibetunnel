# Test Utilities Migration Guide

This guide shows how to migrate existing tests to use the new standardized `server-utils` module.

## Overview

The new `server-utils` module provides standardized utilities for:
- Starting and stopping test servers
- Port detection
- Directory management
- Health checks
- Server process management

## Migration Examples

### 1. Basic Server Start/Stop

**Before:**
```typescript
// In server-smoke.e2e.test.ts
import { spawn } from 'child_process';
import { waitForServerPort } from '../utils/port-detection';

let serverProcess: ChildProcess | null = null;
let serverPort = 0;
const testDir = path.join(os.tmpdir(), 'vt-test', uuidv4().substring(0, 8));

async function startServer(): Promise<number> {
  const cliPath = path.join(__dirname, '..', '..', 'cli.ts');
  
  serverProcess = spawn('tsx', [cliPath, '--port', '0', '--no-auth'], {
    env: {
      ...process.env,
      VIBETUNNEL_CONTROL_DIR: testDir,
      NODE_ENV: 'production',
    },
    stdio: 'pipe',
  });
  
  return waitForServerPort(serverProcess);
}

// In afterAll
if (serverProcess) {
  serverProcess.kill('SIGTERM');
  // Complex cleanup logic...
}
```

**After:**
```typescript
// Using server-utils
import { startTestServer, stopServer, cleanupTestDirectories } from '../utils/server-utils';

let server: ServerInstance;

beforeAll(async () => {
  server = await startTestServer({
    args: ['--port', '0', '--no-auth'],
    serverType: 'SERVER'
  });
  serverPort = server.port;
});

afterAll(async () => {
  await stopServer(server.process);
  await cleanupTestDirectories([server.controlDir]);
});
```

### 2. Server with Authentication

**Before:**
```typescript
// In sessions-api.e2e.test.ts
async function startServer(args: string[], env: Record<string, string>) {
  return new Promise((resolve, reject) => {
    const serverProcess = spawn('pnpm', ['exec', 'tsx', cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    // Manual port detection logic...
  });
}

const result = await startServer(['--port', '0'], {
  VIBETUNNEL_USERNAME: username,
  VIBETUNNEL_PASSWORD: password,
});
```

**After:**
```typescript
import { startTestServer, createBasicAuthHeader } from '../utils/server-utils';

const server = await startTestServer({
  args: ['--port', '0'],
  env: {
    VIBETUNNEL_USERNAME: username,
    VIBETUNNEL_PASSWORD: password,
  },
  usePnpm: true, // If you need pnpm exec
});

const authHeader = createBasicAuthHeader(username, password);
```

### 3. Multiple Servers (HQ Mode)

**Before:**
```typescript
// Complex manual management of multiple processes
let hqProcess: ChildProcess | null = null;
const remoteProcesses: ChildProcess[] = [];

// Manual startup and tracking...
```

**After:**
```typescript
import { ServerManager } from '../utils/server-utils';

const serverManager = new ServerManager();

// Start HQ server
const hqServer = await serverManager.startServer({
  args: ['--port', '0', '--hq'],
  env: {
    VIBETUNNEL_USERNAME: hqUsername,
    VIBETUNNEL_PASSWORD: hqPassword,
  },
  serverType: 'HQ',
});

// Start remote servers
for (let i = 0; i < 2; i++) {
  const remoteServer = await serverManager.startServer({
    args: ['--port', '0', '--hq-url', `http://localhost:${hqServer.port}`],
    serverType: `REMOTE-${i}`,
  });
  remotePorts.push(remoteServer.port);
}

// Cleanup is simple
afterAll(async () => {
  await serverManager.cleanup(); // Stops all servers and cleans directories
});
```

### 4. Health Checks

**Before:**
```typescript
async function waitForServer(port: number, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) return;
    } catch (_e) {
      // Server not ready yet
    }
    await sleep(100);
  }
  throw new Error(`Server did not start`);
}
```

**After:**
```typescript
import { waitForServerHealth } from '../utils/server-utils';

// Wait for server with auth
const isReady = await waitForServerHealth(port, username, password);
if (!isReady) {
  throw new Error('Server failed to start');
}
```

## Benefits of Migration

1. **Consistency**: All tests use the same patterns
2. **Less Boilerplate**: Reduce code duplication
3. **Better Error Handling**: Standardized timeout and cleanup
4. **Easier Maintenance**: Update behavior in one place
5. **Type Safety**: Full TypeScript support with interfaces

## Quick Reference

### Import the utilities:
```typescript
import {
  startTestServer,
  stopServer,
  createTestDirectory,
  cleanupTestDirectories,
  waitForServerHealth,
  createBasicAuthHeader,
  sleep,
  ServerManager,
  type ServerInstance,
  type ServerConfig
} from '../utils/server-utils';
```

### Common patterns:
```typescript
// Simple server
const server = await startTestServer();

// Server with custom args
const server = await startTestServer({
  args: ['--port', '0', '--no-auth'],
});

// Server with auth
const server = await startTestServer({
  env: {
    VIBETUNNEL_USERNAME: 'user',
    VIBETUNNEL_PASSWORD: 'pass',
  }
});

// Multiple servers
const manager = new ServerManager();
const server1 = await manager.startServer();
const server2 = await manager.startServer();
await manager.cleanup(); // Stops all
```
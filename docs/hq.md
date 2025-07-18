# HQ Mode Documentation

HQ (Headquarters) mode allows multiple VibeTunnel servers to work together in a distributed setup, where one server acts as the central HQ and others register as remote servers.

## Overview

In HQ mode:
- **HQ Server**: Acts as a central aggregator and router
- **Remote Servers**: Individual VibeTunnel servers that register with the HQ
- **Clients**: Connect to the HQ server and can create/manage sessions on any remote

## How It Works

### 1. Registration Flow

When a remote server starts with HQ configuration:
1. It generates a unique bearer token
2. Registers itself with the HQ using Basic Auth (HQ credentials)
3. Provides its ID, name, URL, and bearer token
4. HQ stores this information in its `RemoteRegistry`

### 2. Session Management

**Creating Sessions:**
- Clients can specify a `remoteId` when creating sessions
- HQ forwards the request to the specified remote using the bearer token
- The remote creates the session locally
- HQ tracks which sessions belong to which remote

**Session Operations:**
- All session operations (get info, send input, kill, etc.) are proxied through HQ
- HQ checks its registry to find which remote owns the session
- Requests are forwarded with bearer token authentication

### 3. Health Monitoring

- HQ performs health checks every 15 seconds on all registered remotes
- Health check: `GET /api/health` with 5-second timeout
- Failed remotes are automatically unregistered

### 4. Session Discovery

- Remote servers watch their control directory for new sessions
- When sessions are created/deleted, remotes notify HQ via `/api/remotes/{name}/refresh-sessions`
- HQ fetches the latest session list from the remote and updates its registry

## Setup

### Running an HQ Server

```bash
# Basic HQ server
vibetunnel-server --hq --username admin --password secret

# HQ server on custom port
vibetunnel-server --hq --port 8080 --username admin --password secret
```

### Running Remote Servers

```bash
# Remote server registering with HQ
vibetunnel-server \
  --username local-user \
  --password local-pass \
  --hq-url https://hq.example.com \
  --hq-username admin \
  --hq-password secret \
  --name production-1

# For local development (allow HTTP)
vibetunnel-server \
  --hq-url http://localhost:4020 \
  --hq-username admin \
  --hq-password secret \
  --name dev-remote \
  --allow-insecure-hq
```

### Command-Line Options

**HQ Server Options:**
- `--hq` - Enable HQ mode
- `--username` - Admin username for HQ access
- `--password` - Admin password for HQ access

**Remote Server Options:**
- `--hq-url` - URL of the HQ server
- `--hq-username` - Username to authenticate with HQ
- `--hq-password` - Password to authenticate with HQ
- `--name` - Unique name for this remote server
- `--allow-insecure-hq` - Allow HTTP connections to HQ (dev only)
- `--no-hq-auth` - Disable HQ authentication (testing only)

## API Endpoints

### HQ-Specific Endpoints

**List Remotes:**
```http
GET /api/remotes
Authorization: Basic <base64(username:password)>

Response:
[
  {
    "id": "uuid",
    "name": "production-1",
    "url": "http://remote1:4020",
    "registeredAt": "2025-01-17T10:00:00.000Z",
    "lastHeartbeat": "2025-01-17T10:15:00.000Z",
    "sessionIds": ["session1", "session2"]
  }
]
```

**Register Remote (called by remotes):**
```http
POST /api/remotes/register
Authorization: Basic <HQ credentials>
Content-Type: application/json

{
  "id": "unique-id",
  "name": "remote-name",
  "url": "http://remote:4020",
  "token": "bearer-token-for-hq-to-use"
}
```

**Refresh Sessions (called by remotes):**
```http
POST /api/remotes/{remoteName}/refresh-sessions
Authorization: Basic <HQ credentials>
Content-Type: application/json

{
  "action": "created" | "deleted",
  "sessionId": "session-id"
}
```

### Session Management Through HQ

**Create Session on Remote:**
```http
POST /api/sessions
Content-Type: application/json

{
  "command": ["bash"],
  "remoteId": "remote-uuid",  // Specify which remote
  "name": "My Session"
}
```

**All Standard Endpoints Work Transparently:**
- `GET /api/sessions` - Aggregates from all remotes
- `GET /api/sessions/:id` - Proxied to owning remote
- `POST /api/sessions/:id/input` - Proxied to owning remote
- `DELETE /api/sessions/:id` - Proxied to owning remote
- `GET /api/sessions/:id/stream` - SSE stream proxied from remote

## Authentication Flow

1. **Client → HQ**: Standard authentication (Basic Auth or JWT)
2. **HQ → Remote**: Bearer token (provided by remote during registration)
3. **Remote → HQ**: Basic Auth (HQ credentials)

## WebSocket Support

- Buffer updates (`/buffers`) are aggregated from all remotes
- Input WebSocket (`/ws/input`) connections are proxied to the owning remote
- HQ maintains WebSocket connections and forwards messages transparently

## Implementation Details

### Key Components

**RemoteRegistry** (`src/server/services/remote-registry.ts`):
- Maintains map of registered remotes
- Tracks session ownership (which sessions belong to which remote)
- Performs periodic health checks
- Handles registration/unregistration

**HQClient** (`src/server/services/hq-client.ts`):
- Used by remote servers to register with HQ
- Handles registration and cleanup
- Manages bearer token generation

**Session Routes** (`src/server/routes/sessions.ts`):
- Checks if running in HQ mode
- For remote sessions, forwards requests using bearer token
- For local sessions, handles normally

**Control Directory Watcher** (`src/server/services/control-dir-watcher.ts`):
- Watches for new/deleted sessions
- Notifies HQ about session changes
- Triggers session list refresh on HQ

### Session Tracking

- Each remote maintains its own session IDs
- HQ tracks which sessions belong to which remote
- Session IDs are not namespaced - they remain unchanged
- The `source` field in session objects indicates the remote name

## Testing

The e2e tests in `src/test/e2e/hq-mode.e2e.test.ts` demonstrate:
1. Starting HQ server and multiple remotes
2. Remote registration
3. Creating sessions on specific remotes
4. Proxying session operations
5. WebSocket buffer aggregation
6. Cleanup and unregistration

## Limitations

- Remotes must be network-accessible from the HQ server
- Health checks use a fixed 15-second interval
- No built-in load balancing (clients must specify remoteId)
- Bearer tokens are generated per server startup (not persistent)
- No automatic reconnection if remote temporarily fails

## Security Considerations

- Always use HTTPS in production (use `--allow-insecure-hq` only for local dev)
- Bearer tokens are sensitive - they allow HQ to execute commands on remotes
- HQ credentials should be strong and kept secure
- Consider network isolation between HQ and remotes
- Remotes should not be directly accessible from the internet
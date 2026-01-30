# Protocol Specifications

## Terminal Transport (WebSocket v3)

VibeTunnel uses a **single** WebSocket endpoint for terminal transport, multiplexing sessions over binary frames.

### Connection Establishment
```javascript
const ws = new WebSocket('ws://localhost:4020/ws?token=JWT_TOKEN');
ws.binaryType = 'arraybuffer';
```

### Subscriptions
- Subscribe per session: send a v3 `SUBSCRIBE` frame with `sessionId` + flags (`Stdout`, `Snapshots`, `Events`).
- Global events: use an empty `sessionId` and the `Events` flag.

Source of truth: `docs/websocket.md` and `web/src/shared/ws-v3.ts`.

### Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 1000 | Normal closure | Session ended |
| 1001 | Going away | Server shutdown |
| 1003 | Unsupported data | Protocol error |
| 1008 | Policy violation | Auth failed |
| 1011 | Server error | Retry connection |

## PTY Protocol

### Process Spawning
```typescript
interface PTYOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
  command: string;
  args: string[];
}
```

### Control Sequences

| Sequence | Purpose | Example |
|----------|---------|---------|
| `\x03` | SIGINT (Ctrl+C) | Interrupt process |
| `\x04` | EOF (Ctrl+D) | End input |
| `\x1a` | SIGTSTP (Ctrl+Z) | Suspend process |
| `\x1c` | SIGQUIT (Ctrl+\) | Quit process |
| `\x7f` | Backspace | Delete character |

### Terminal Modes
```typescript
// Raw mode for full control
pty.setRawMode(true);

// Canonical mode for line editing
pty.setRawMode(false);
```

## Session Recording Protocol

### Asciinema v2 Format

**Header**:
```json
{
  "version": 2,
  "width": 80,
  "height": 24,
  "timestamp": 1704067200,
  "env": {
    "SHELL": "/bin/zsh",
    "TERM": "xterm-256color"
  }
}
```

**Events**:
```json
[0.123456, "o", "$ ls -la\r\n"]
[0.234567, "o", "total 48\r\n"]
[1.345678, "i", "c"]
[1.456789, "i", "l"]
[1.567890, "i", "e"]
```

Event types:
- `o`: Output from terminal
- `i`: Input from user
- `r`: Terminal resize

### Recording Storage
```
~/.vibetunnel/recordings/
├── session-uuid-1.cast
├── session-uuid-2.cast
└── metadata.json
```

## HTTP Protocol

### Request Headers
```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
X-Session-ID: <SESSION_UUID>
X-Client-Version: 1.0.0
```

### Response Headers
```http
X-Request-ID: <REQUEST_UUID>
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704067200
```

### Status Codes

| Code | Meaning | Usage |
|------|---------|-------|
| 200 | OK | Successful operation |
| 201 | Created | Session created |
| 204 | No Content | Session deleted |
| 400 | Bad Request | Invalid parameters |
| 401 | Unauthorized | Auth required |
| 404 | Not Found | Session not found |
| 409 | Conflict | Session exists |
| 429 | Too Many Requests | Rate limited |
| 500 | Server Error | Internal error |

## Terminal Transport (WebSocket v3)

VibeTunnel uses a single WebSocket endpoint for terminal transport:
- Endpoint: `GET /ws` (upgrade)
- Binary framing: `"VT"` magic + version + type + sessionId + payload
- Multiplexing: one socket can carry multiple sessions
- Subscriptions: flags for `stdout`, `snapshots`, `events`

Details: `docs/websocket.md`.

## Authentication Protocol

### JWT Token Structure
```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "user-id",
    "iat": 1704067200,
    "exp": 1704153600,
    "sessionId": "session-uuid"
  }
}
```

### Token Refresh Flow
```
1. Client token expires in 5 minutes
2. Client requests refresh: POST /api/auth/refresh
3. Server validates refresh token
4. Server issues new access token
5. Client updates Authorization header
```

## See Also
- [API Reference](api-reference.md)
- [Security Guide](../features/authentication.md)
- [WebSocket Implementation](../platform/web.md#websocket)

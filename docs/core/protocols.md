# Protocol Specifications

## WebSocket Protocol

### Connection Establishment
```javascript
// Client connection
const ws = new WebSocket('ws://localhost:4020/api/sessions/:id/ws');
ws.binaryType = 'arraybuffer';

// Authentication via query param or header
const ws = new WebSocket('ws://localhost:4020/api/sessions/:id/ws?token=JWT_TOKEN');
```

### Message Types

#### Binary Terminal Data (Server → Client)
```
┌──────────┬──────────────┬──────────────┐
│ Magic    │ Length       │ Data         │
│ 0xBF     │ 4 bytes BE   │ UTF-8 bytes  │
└──────────┴──────────────┴──────────────┘
```

**Encoding Example**:
```typescript
function encode(text: string): ArrayBuffer {
  const data = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(5 + data.length);
  const view = new DataView(buffer);
  view.setUint8(0, 0xBF);                    // Magic byte
  view.setUint32(1, data.length, false);     // Length (big-endian)
  new Uint8Array(buffer, 5).set(data);       // UTF-8 data
  return buffer;
}
```

#### Text Messages (Client → Server)
```typescript
// User input
ws.send(JSON.stringify({
  type: 'input',
  data: 'ls -la\n'
}));

// Terminal resize
ws.send(JSON.stringify({
  type: 'resize',
  cols: 120,
  rows: 40
}));

// Keep-alive ping
ws.send(JSON.stringify({
  type: 'ping'
}));
```

### Connection Lifecycle

1. **Open**: Client connects with session ID
2. **Authenticate**: Token validation
3. **Initialize**: Terminal size negotiation
4. **Stream**: Bidirectional data flow
5. **Close**: Clean disconnection or timeout

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

## Binary Buffer Optimization

### Aggregation Strategy
```typescript
class BufferAggregator {
  private buffer: Uint8Array[] = [];
  private timer: NodeJS.Timeout;
  
  aggregate(data: Uint8Array) {
    this.buffer.push(data);
    this.scheduleFlush();
  }
  
  private scheduleFlush() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 16); // ~60fps
  }
  
  private flush() {
    const combined = Buffer.concat(this.buffer);
    this.send(combined);
    this.buffer = [];
  }
}
```

### Performance Metrics
- **Latency**: <10ms average
- **Throughput**: >10MB/s
- **Message rate**: 60/s max
- **Buffer size**: 64KB max

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
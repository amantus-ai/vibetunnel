# API Reference

## Base URL
- Development: `http://localhost:4020`
- Production: Configurable via settings

## Authentication

### Token Generation
```http
POST /api/auth/token
Content-Type: application/json

{
  "password": "optional-password"
}
```

**Response**
```json
{
  "token": "jwt-token-string",
  "expiresIn": 86400
}
```

## Session Management

### Create Session
```http
POST /api/sessions
Authorization: Bearer <token>
Content-Type: application/json

{
  "command": "zsh",
  "args": [],
  "cwd": "/Users/username",
  "env": {},
  "name": "Session Name",
  "cols": 80,
  "rows": 24
}
```

**Response**
```json
{
  "id": "session-uuid",
  "name": "Session Name",
  "created": "2024-01-01T00:00:00Z",
  "status": "running",
  "pid": 12345
}
```

### List Sessions
```http
GET /api/sessions
Authorization: Bearer <token>
```

**Response**
```json
[
  {
    "id": "session-uuid",
    "name": "Session 1",
    "created": "2024-01-01T00:00:00Z",
    "status": "running",
    "pid": 12345
  }
]
```

### Get Session Details
```http
GET /api/sessions/:id
Authorization: Bearer <token>
```

### Delete Session
```http
DELETE /api/sessions/:id
Authorization: Bearer <token>
```

### Resize Terminal
```http
POST /api/sessions/:id/resize
Authorization: Bearer <token>
Content-Type: application/json

{
  "cols": 120,
  "rows": 40
}
```

## WebSocket Connection

### Connect to Session
```javascript
const ws = new WebSocket('ws://localhost:4020/api/sessions/:id/ws');
ws.binaryType = 'arraybuffer';
```

### Message Types

#### Terminal Output (Server → Client)
Binary format with magic byte:
```
[0xBF][4-byte length][UTF-8 data]
```

#### User Input (Client → Server)
```json
{
  "type": "input",
  "data": "ls -la\n"
}
```

#### Terminal Resize (Client → Server)
```json
{
  "type": "resize",
  "cols": 120,
  "rows": 40
}
```

#### Keep-Alive Ping
```json
{
  "type": "ping"
}
```

## Health Check

### Server Status
```http
GET /api/health
```

**Response**
```json
{
  "status": "healthy",
  "uptime": 3600,
  "version": "1.0.0",
  "sessions": 5
}
```

## Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Bad Request | Invalid parameters |
| 401 | Unauthorized | Missing/invalid token |
| 404 | Not Found | Session not found |
| 409 | Conflict | Session already exists |
| 500 | Server Error | Internal error |

**Error Format**
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

## Rate Limiting

- **Session Creation**: 10 per minute
- **API Calls**: 100 per minute
- **WebSocket Messages**: Unlimited

## Binary Buffer Protocol

### Packet Structure
```
┌──────────┬──────────────┬──────────────┐
│ Magic    │ Length       │ Data         │
│ (1 byte) │ (4 bytes)    │ (n bytes)    │
│ 0xBF     │ Big-endian   │ UTF-8        │
└──────────┴──────────────┴──────────────┘
```

### Implementation
```typescript
// Encoding
function encodeBuffer(data: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(data);
  const buffer = new ArrayBuffer(5 + encoded.length);
  const view = new DataView(buffer);
  view.setUint8(0, 0xBF);
  view.setUint32(1, encoded.length, false);
  new Uint8Array(buffer, 5).set(encoded);
  return buffer;
}

// Decoding
function decodeBuffer(buffer: ArrayBuffer): string {
  const view = new DataView(buffer);
  if (view.getUint8(0) !== 0xBF) throw new Error('Invalid magic byte');
  const length = view.getUint32(1, false);
  return new TextDecoder().decode(new Uint8Array(buffer, 5, length));
}
```

## Session Recording

Sessions are recorded in asciinema v2 format:

```json
{
  "version": 2,
  "width": 80,
  "height": 24,
  "timestamp": 1234567890,
  "env": {
    "SHELL": "/bin/zsh",
    "TERM": "xterm-256color"
  }
}
```

Event format:
```json
[timestamp, "o", "output data"]
```

## See Also
- [WebSocket Protocol Details](protocols.md)
- [Authentication Guide](../features/authentication.md)
- [Server Implementation](../platform/web.md)
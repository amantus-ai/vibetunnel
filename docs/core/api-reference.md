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

### WebSocket v3 (`/ws`)

- Endpoint: `GET /ws` (WebSocket upgrade)
- Framing: binary v3 frames (`"VT"` magic, version `3`, type, sessionId, payload)
- Multiplexing: one socket carries multiple session subscriptions

Protocol details: `docs/websocket.md`.

```javascript
const ws = new WebSocket('ws://localhost:4020/ws?token=JWT_TOKEN');
ws.binaryType = 'arraybuffer';
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

## Terminal Transport (WebSocket v3)

Terminal I/O uses a single `/ws` WebSocket with binary v3 framing and multiplexed sessions.

Details: `docs/websocket.md`.

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

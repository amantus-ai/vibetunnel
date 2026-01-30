# Authentication & Security

## Overview

VibeTunnel supports multiple authentication modes:
- **None** (localhost only)
- **Password** (simple shared secret)
- **Token** (JWT-based)
- **External** (Tailscale, ngrok)

## Configuration

### Security Settings

| Setting | Default | Options |
|---------|---------|---------|
| Authentication | None | None, Password, Token |
| Network | Localhost | Localhost, LAN, Public |
| Password | - | User-defined |
| Token Expiry | 24h | 1h-7d |

### Enable Authentication

```swift
// Via Settings UI
Settings → Security → Enable Password

// Via defaults
defaults write com.steipete.VibeTunnel authEnabled -bool true
defaults write com.steipete.VibeTunnel authPassword -string "secret"
```

## Password Authentication

### Server Configuration

```typescript
// server/config.ts
export const config = {
  auth: {
    enabled: process.env.AUTH_ENABLED === 'true',
    password: process.env.AUTH_PASSWORD,
  }
};
```

### Client Login

```typescript
// POST /api/auth/login
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'secret' })
});

const { token } = await response.json();
localStorage.setItem('auth_token', token);
```

## Token Authentication

### JWT Structure

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
    "scope": ["sessions:read", "sessions:write"]
  }
}
```

### Token Generation

```typescript
// server/services/auth.ts
import jwt from 'jsonwebtoken';

export function generateToken(userId: string): string {
  return jwt.sign(
    { 
      sub: userId,
      scope: ['sessions:read', 'sessions:write']
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}
```

### Token Validation

```typescript
// server/middleware/auth.ts
export async function validateToken(req: Request): Promise<boolean> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) return false;
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return true;
  } catch {
    return false;
  }
}
```

## Network Security

### Localhost Only (Default)

```typescript
// server/server.ts
const server = Bun.serve({
  hostname: '127.0.0.1',  // Localhost only
  port: 4020,
});
```

### LAN Access

```typescript
// Enable LAN with authentication required
const server = Bun.serve({
  hostname: '0.0.0.0',  // All interfaces
  port: 4020,
});

// Require auth for non-localhost
app.use((req, res, next) => {
  if (req.ip !== '127.0.0.1' && !req.authenticated) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
});
```

### HTTPS/WSS

```typescript
// Production TLS
const server = Bun.serve({
  fetch: app.fetch,
  tls: {
    cert: Bun.file('cert.pem'),
    key: Bun.file('key.pem'),
  },
});
```

## External Access

### Tailscale Integration

```bash
# Enable Tailscale
tailscale up

# Access via Tailscale network
http://your-machine.tailnet:4020
```

### ngrok Tunnel

```bash
# Start ngrok tunnel
ngrok http 4020

# Access via public URL
https://abc123.ngrok.io
```

## Session Security

### Isolation

Each session runs in a separate process with user permissions:

```typescript
// pty-manager.ts
const pty = spawn(shell, args, {
  uid: process.getuid(),  // Run as current user
  gid: process.getgid(),
  env: sanitizeEnv(env),  // Clean environment
});
```

### Resource Limits

```typescript
// Prevent resource exhaustion
const limits = {
  maxSessions: 50,
  maxOutputBuffer: 10 * 1024 * 1024,  // 10MB
  sessionTimeout: 24 * 60 * 60 * 1000,  // 24 hours
};
```

## Security Headers

```typescript
// server/middleware/security.ts
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});
```

## Audit Logging

```typescript
// server/services/audit.ts
export function logAccess(event: AuditEvent) {
  const entry = {
    timestamp: new Date(),
    ip: event.ip,
    action: event.action,
    sessionId: event.sessionId,
    success: event.success,
  };
  
  fs.appendFileSync('audit.log', JSON.stringify(entry) + '\n');
}
```

## Best Practices

1. **Always use authentication** for non-localhost access
2. **Rotate tokens** regularly
3. **Use HTTPS/WSS** in production
4. **Limit session lifetime** to prevent resource exhaustion
5. **Monitor audit logs** for suspicious activity
6. **Keep dependencies updated** for security patches

## Threat Model

| Threat | Mitigation |
|--------|------------|
| Unauthorized access | Password/token auth |
| Session hijacking | JWT expiry, HTTPS |
| Resource exhaustion | Rate limiting, quotas |
| Code injection | Input sanitization |
| Network sniffing | TLS encryption |

## Compliance

### Data Protection
- No persistent storage of terminal content
- Sessions cleared on exit
- Optional recording with user consent

### Access Control
- Authentication required for remote access
- Session isolation per user
- No privilege escalation

## See Also
- [API Reference](../core/api-reference.md#authentication)
- [Network Setup](../guides/quickstart.md#remote-development)
- [Security Headers](../platform/web.md#security)
# VibeTunnel Server Security Configuration

## Authentication Options

VibeTunnel Server provides several authentication mechanisms to secure terminal access:

### 1. Standard Authentication

**System User Password** (default)
- Uses the operating system's user authentication
- Validates against local user accounts
- Supports optional SSH key authentication with `--enable-ssh-keys`

**No Authentication Mode**
- Enabled with `--no-auth` flag
- Automatically logs in as the current user
- **WARNING**: Anyone with network access can use the terminal

### 2. Local Bypass Authentication

The `--allow-local-bypass` flag enables a special authentication mode that allows localhost connections to bypass normal authentication requirements.

#### Configuration Options

**Basic Local Bypass**
```bash
vibetunnel-server --allow-local-bypass
```
- Allows any connection from localhost (127.0.0.1, ::1) to access without authentication
- No token required

**Secured Local Bypass**
```bash
vibetunnel-server --allow-local-bypass --local-auth-token <secret-token>
```
- Localhost connections must provide token via `X-VibeTunnel-Local` header
- Adds an additional security layer for local connections

#### Security Implementation

The local bypass feature implements several security checks to prevent spoofing:

1. **IP Address Validation** (`web/src/server/middleware/auth.ts:24-48`)
   - Verifies connection originates from localhost IPs (127.0.0.1, ::1, ::ffff:127.0.0.1)
   - Checks both `req.ip` and `req.socket.remoteAddress`

2. **Header Verification**
   - Ensures no forwarding headers are present (`X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Host`)
   - Prevents proxy spoofing attacks

3. **Hostname Validation**
   - Confirms request hostname is localhost, 127.0.0.1, or [::1]
   - Additional layer of verification

4. **Token Authentication** (when configured)
   - Requires `X-VibeTunnel-Local` header to match configured token
   - Provides shared secret authentication for local tools

#### Security Implications

**Benefits:**
- Enables automated tools and scripts on the same machine to access terminals
- Useful for development workflows and CI/CD pipelines
- Allows local monitoring tools without exposing credentials

**Risks:**
- Any process on the local machine can access terminals (without token)
- Malicious local software could exploit this access
- Token-based mode mitigates but doesn't eliminate local access risks

**Recommended Usage:**
1. **Development Environments**: Safe for local development machines
2. **CI/CD Servers**: Use with token authentication for build scripts
3. **Production Servers**: NOT recommended unless:
   - Combined with token authentication
   - Server has strict local access controls
   - Used only for specific automation needs

#### Example Use Cases

**Local Development Tools**
```javascript
// Local tool accessing VibeTunnel without authentication
const response = await fetch('http://localhost:4020/api/sessions', {
  headers: {
    'X-VibeTunnel-Local': 'my-secret-token' // Only if token configured
  }
});
```

**Automated Testing**
```bash
# Start server with local bypass for tests
vibetunnel-server --allow-local-bypass --local-auth-token test-token

# Test script can now access without password
curl -H "X-VibeTunnel-Local: test-token" http://localhost:4020/api/sessions
```

## Additional Security Considerations

### Network Binding
- Default: Binds to all interfaces (0.0.0.0)
- Use `--bind 127.0.0.1` to restrict to localhost only
- Combine with `--allow-local-bypass` for local-only access

### SSH Key Authentication
- Enable with `--enable-ssh-keys`
- Disable passwords with `--disallow-user-password`
- More secure than password authentication

### HTTPS/TLS
- VibeTunnel does not provide built-in TLS
- Use a reverse proxy (nginx, Caddy) for HTTPS
- Or use secure tunnels (Tailscale, ngrok)

### Best Practices
1. Always use authentication in production
2. Restrict network binding when possible
3. Use token authentication with local bypass
4. Monitor access logs for suspicious activity
5. Keep the server updated for security patches
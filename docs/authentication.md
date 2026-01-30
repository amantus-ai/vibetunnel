# VibeTunnel Authentication System

VibeTunnel supports multiple authentication modes to balance security and convenience for different use cases.

## Authentication Modes

### 1. Default Mode (Password Authentication)

**Usage:** Start VibeTunnel without any auth flags
```bash
npm run dev
# or
./vibetunnel
```

**Behavior:**
- Shows login page with user avatar (on macOS)
- Requires system user password authentication
- Uses JWT tokens for session management
- SSH key functionality is hidden

**Best for:** Personal use with secure password authentication

### 2. SSH Key Mode

**Usage:** Enable SSH key authentication alongside password
```bash
npm run dev -- --enable-ssh-keys
# or
./vibetunnel --enable-ssh-keys
```

**Behavior:**
- Shows login page with both password and SSH key options
- Users can generate Ed25519 SSH keys in the browser
- SSH keys are stored securely in browser localStorage
- Optional password protection for private keys
- SSH keys work for both web and terminal authentication

**Best for:** Power users who prefer SSH key authentication

### 3. SSH Keys Only Mode

**Usage:** Disable password authentication, SSH keys only
```bash
./vibetunnel --disallow-user-password
# or
./vibetunnel --disallow-user-password --enable-ssh-keys  # redundant, auto-enabled
```

**Behavior:**
- Shows login page with SSH key options only
- Password authentication form is hidden
- Automatically enables `--enable-ssh-keys`
- User avatar still displayed with "SSH key authentication required" message
- Most secure authentication mode

**Best for:** High-security environments, organizations requiring key-based auth

### 4. No Authentication Mode

**Usage:** Disable authentication completely
```bash
npm run dev -- --no-auth
# or
./vibetunnel --no-auth
```

**Behavior:**
- Bypasses login page entirely
- Direct access to dashboard
- No authentication required
- Auto-logs in as current system user
- **Overrides all other auth flags**

**Best for:** Local development, trusted networks, or demo environments

### 5. Tailscale Serve Integration Mode

**Usage:** Enable integrated Tailscale Serve support
```bash
npm run dev -- --enable-tailscale-serve
# or
./vibetunnel --enable-tailscale-serve
```

**Behavior:**
- Automatically starts `tailscale serve` as a background process
- Forces server to bind to localhost (127.0.0.1) for security
- Enables Tailscale identity header authentication
- Provides HTTPS access without exposing ports
- No manual Tailscale configuration required

**macOS App Integration:**
- Toggle available in Settings → Remote Access → Tailscale Integration
- Shows HTTPS URL in menu bar when enabled
- Automatically manages the Tailscale Serve process lifecycle

**Security Model:**
- Server only listens on localhost when enabled
- All external access goes through Tailscale's secure proxy
- Identity headers are automatically validated
- No risk of header spoofing from external sources

**Best for:** Easy, secure remote access through Tailscale network

## User Avatar System

### macOS Integration

On macOS, VibeTunnel automatically displays the user's system profile picture:

- **Data Source:** Uses `dscl . -read /Users/$USER JPEGPhoto` to extract avatar
- **Format:** Converts hex data to base64 JPEG
- **Fallback:** Uses `Picture` attribute if JPEGPhoto unavailable
- **Display:** Shows in login form with welcome message

### Other Platforms

On non-macOS systems:
- Displays a generic SVG avatar icon
- Maintains consistent UI layout
- No system integration required

## Command Line Options

### Server Startup Flags

```bash
# Authentication options
--enable-ssh-keys         Enable SSH key authentication UI and functionality
--disallow-user-password  Disable password auth, SSH keys only (auto-enables --enable-ssh-keys)
--no-auth                 Disable authentication (auto-login as current user)
--enable-tailscale-serve  Enable Tailscale Serve integration (auto-starts proxy, forces localhost)

# Other options
--port <number>       Server port (default: 4020)
--bind <address>      Bind address (default: 0.0.0.0)
--debug               Enable debug logging
```

### Example Commands

```bash
# Default password-only authentication
npm run dev

# Enable SSH keys alongside password
npm run dev -- --enable-ssh-keys

# SSH keys only (most secure)
./vibetunnel --disallow-user-password

# No authentication for local development (npm run dev uses this by default)
npm run dev -- --no-auth

# Production with SSH keys on custom port
./vibetunnel --enable-ssh-keys --port 8080

# High-security production (SSH keys only)
./vibetunnel --disallow-user-password --port 8080

# Tailscale Serve integration (secure remote access)
./vibetunnel --enable-tailscale-serve --port 4020
# No manual configuration needed - everything handled automatically
```

## Security Considerations

### Password Authentication
- Uses system PAM authentication
- Validates against actual system user passwords
- JWT tokens expire after 24 hours
- Secure session management

### SSH Key Authentication
- Generates Ed25519 keys (most secure)
- Private keys stored in browser localStorage
- Optional password protection for private keys
- Keys work for both web and terminal access
- Challenge-response authentication flow

### No Authentication Mode
- **⚠️ Security Warning:** Only use in trusted environments
- Suitable for local development or demo purposes
- Not recommended for production or public networks

### Tailscale Authentication
- **⚠️ Security Warning:** Only use when bound to localhost
- Requires Tailscale Serve proxy for header injection
- Provides SSO-like experience for Tailscale users
- Headers are trusted only from Tailscale proxy

## Configuration API

### Frontend Configuration Endpoint

The frontend can query the server's authentication configuration:

```javascript
// GET /api/auth/config
{
  "enableSSHKeys": false,
  "disallowUserPassword": false,
  "noAuth": false
}
```

This allows the UI to:
- Show/hide SSH key options dynamically
- Hide password form when disallowed
- Skip login page when no-auth is enabled
- Adapt interface based on server configuration

## SSH Key Management

### Key Generation Process
- **Algorithm:** Ed25519 (most secure and modern SSH key type)
- **Browser Implementation:** Uses Web Crypto API for secure key generation
- **Storage:** Browser localStorage (optionally encrypted with user password)
- **Format:** PEM format for compatibility with standard SSH tools
- **Naming:** User-defined names for organization

**Detailed Process:**
1. Browser generates Ed25519 key pair using `crypto.subtle.generateKey()`
2. Private key optionally encrypted with user-provided password
3. Public key formatted in SSH wire format for server validation
4. Keys stored in browser localStorage with unique identifiers

### Key Import
- Supports importing existing Ed25519 private keys
- PEM format required (`-----BEGIN OPENSSH PRIVATE KEY-----`)
- Automatic detection of password-protected keys
- Validation and error handling for malformed keys
- Compatibility with keys generated by `ssh-keygen -t ed25519`

### SSH Key Authentication Flow

**Challenge-Response Process:**
1. **Challenge Request:** Client requests authentication challenge from `/api/auth/challenge`
2. **Challenge Generation:** Server creates 32-byte random challenge with 5-minute expiry
3. **Key Selection:** Client selects appropriate SSH key from browser storage
4. **Signature Creation:** Browser signs challenge using private key via Web Crypto API
5. **Signature Submission:** Client sends signed challenge to `/api/auth/ssh-login`
6. **Server Verification:** 
   - Server parses SSH public key wire format
   - Validates signature using Node.js crypto module
   - Checks public key against user's `~/.ssh/authorized_keys`
   - Issues JWT token upon successful verification

**Key Authorization:**
- Server reads `~/.ssh/authorized_keys` file for target user
- Validates submitted public key is present in authorized keys
- Supports both current user and other system users
- Handles standard SSH authorized_keys format

### Key Setup Instructions

**For Users:**
1. Generate SSH key in VibeTunnel web interface
2. Download public key file
3. Add to server's authorized_keys:
   ```bash
   # Append public key to authorized_keys
   cat vibetunnel-key.pub >> ~/.ssh/authorized_keys
   
   # Set proper permissions
   chmod 600 ~/.ssh/authorized_keys
   chmod 700 ~/.ssh
   ```
4. Test authentication through VibeTunnel login

**Security Best Practices:**
- Use password protection for private keys in shared environments
- Regularly rotate SSH keys (recommended: every 90 days)
- Remove unused keys from authorized_keys
- Monitor authentication logs for suspicious activity

## Tailscale Authentication Details

### How Tailscale Serve Works

Tailscale Serve acts as a reverse proxy that:
1. Receives requests from your tailnet
2. Adds identity headers based on the authenticated Tailscale user
3. Forwards requests to your local service

### Identity Headers

When a request comes through Tailscale Serve, these headers are added:
- `tailscale-user-login`: The user's email address or login
- `tailscale-user-name`: The user's display name
- `tailscale-user-profile-pic`: URL to the user's profile picture

### Setup Instructions

1. **Start VibeTunnel with integrated Tailscale Serve:**
   ```bash
   ./vibetunnel --enable-tailscale-serve --port 4020
   ```
   
   Or use the macOS app and enable the toggle in Settings → Remote Access

2. **Access via Tailscale:**
   ```
   https://[your-machine-name].[tailnet-name].ts.net
   ```

### Security Model

- VibeTunnel trusts identity headers ONLY from localhost connections
- Tailscale Serve ensures headers cannot be spoofed by external users
- Direct access to VibeTunnel port would allow header forgery
- Always bind to `127.0.0.1` when using Tailscale authentication

### Integration with Other Auth Modes

Tailscale Serve integration can be combined with other authentication modes:
```bash
# Tailscale Serve + SSH keys as fallback
./vibetunnel --enable-tailscale-serve --enable-ssh-keys

# Tailscale Serve + local bypass for scripts
./vibetunnel --enable-tailscale-serve --allow-local-bypass
```

**Note**: The `--enable-tailscale-serve` flag automatically manages both the Tailscale proxy and authentication.

## Implementation Details

### Authentication Flow

1. **Server startup** determines available auth modes
2. **Frontend queries** `/api/auth/config` for configuration
3. **UI renders** appropriate authentication options
4. **User authenticates** via chosen method
5. **JWT token issued** for session management
6. **Subsequent requests** use Bearer token authentication

### Avatar Implementation

```bash
# macOS avatar extraction
dscl . -read /Users/$USER JPEGPhoto | tail -1 | xxd -r -p > avatar.jpg

# Server endpoint
GET /api/auth/avatar/:userId
```

### File Structure

```
src/
├── server/
│   ├── middleware/auth.ts       # Authentication middleware
│   ├── routes/auth.ts          # Authentication routes
│   ├── services/auth-service.ts # JWT and user management
│   └── server.ts               # Server configuration
└── client/
    ├── components/auth-login.ts # Login UI component
    ├── services/auth-client.ts  # Frontend auth service
    └── services/ssh-agent.ts    # SSH key management
```


## Troubleshooting

### Common Issues

**Login page shows briefly then disappears (no-auth mode)**
- This is expected behavior - the page quickly redirects to dashboard

**SSH section not showing**
- Ensure server started with `--enable-ssh-keys` flag
- Check browser console for configuration loading errors

**Avatar not displaying**
- macOS only feature - other platforms show generic icon
- Check user has profile picture set in System Preferences

**Authentication fails**
- Verify system password is correct
- Check server logs for detailed error messages
- Ensure proper permissions for PAM authentication

### Debug Mode

Enable debug logging for detailed authentication flow:

```bash
npm run dev -- --debug --enable-ssh-keys
```

This provides verbose logging of:
- Authentication attempts
- Token validation
- SSH key operations
- Configuration loading

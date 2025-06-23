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

### Key Generation
- **Algorithm:** Ed25519 (most secure and modern)
- **Storage:** Browser localStorage (encrypted if password-protected)
- **Format:** PEM format for compatibility
- **Naming:** User-defined names for organization

### Key Import
- Supports importing existing private keys
- PEM format required
- Automatic password detection
- Validation and error handling

### Key Usage
- Browser-based signing for web authentication
- Automatic terminal integration
- Challenge-response authentication
- No server-side key storage

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

## Migration from Basic Auth

The new system replaces the previous basic auth implementation:

### Removed
- `--username` and `--password` flags
- `VIBETUNNEL_USERNAME` and `VIBETUNNEL_PASSWORD` environment variables
- HTTP Basic Authentication headers
- Static username/password validation

### Added
- System user authentication
- Configurable authentication modes
- SSH key generation and management
- User avatar integration
- JWT-based session management

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
# VibeTunnel CLI

**Turn any browser into your terminal.** VibeTunnel proxies your terminals right into the browser, so you can vibe-code anywhere.

Full-featured terminal sharing server with web interface for macOS and Linux. Windows not yet supported.

## Why VibeTunnel?

Ever wanted to check on your AI agents while you're away? Need to monitor that long-running build from your phone? Want to share a terminal session with a colleague without complex SSH setups? VibeTunnel makes it happen with zero friction.

## Installation

### From npm (Recommended)
```bash
npm install -g vibetunnel
```

### From Source
```bash
git clone https://github.com/amantus-ai/vibetunnel.git
cd vibetunnel/web
pnpm install
pnpm run build
```

## Installation Differences

**npm package**:
- Pre-built binaries for common platforms (macOS x64/arm64, Linux x64/arm64)
- Automatic fallback to source compilation if pre-built binaries unavailable
- Global installation makes `vibetunnel` command available system-wide
- Conditional `vt` command installation (see [VT Installation Guide](docs/VT_INSTALLATION.md))
- Includes production dependencies only

**Source installation**:
- Full development environment with hot reload (`pnpm run dev`)
- Access to all development scripts and tools
- Ability to modify and rebuild the application
- Includes test suites and development dependencies

## Requirements

- Node.js >= 20.0.0
- macOS or Linux (Windows not yet supported)
- Build tools for native modules (Xcode on macOS, build-essential on Linux)

## Usage

### Start the server

```bash
# Start with default settings (port 4020)
vibetunnel

# Start with custom port
vibetunnel --port 8080

# Start without authentication
vibetunnel --no-auth

# Bind to specific interface
vibetunnel --bind 127.0.0.1 --port 4020

# Enable SSH key authentication
vibetunnel --enable-ssh-keys

# SSH keys only (no password auth)
vibetunnel --disallow-user-password
```

Then open http://localhost:4020 in your browser to access the web interface.

### Command-line Options

```
vibetunnel [options]

Basic Options:
  --help, -h            Show help message
  --version, -v         Show version information
  --port <number>       Server port (default: 4020 or PORT env var)
  --bind <address>      Bind address (default: 0.0.0.0, all interfaces)

Authentication Options:
  --no-auth             Disable authentication (auto-login as current user)
  --enable-ssh-keys     Enable SSH key authentication UI and functionality
  --disallow-user-password  Disable password auth, SSH keys only (auto-enables --enable-ssh-keys)
  --allow-local-bypass  Allow localhost connections to bypass authentication
  --local-auth-token <token>  Token for localhost authentication bypass

Push Notification Options:
  --push-enabled        Enable push notifications (default: enabled)
  --push-disabled       Disable push notifications
  --vapid-email <email> Contact email for VAPID configuration
  --generate-vapid-keys Generate new VAPID keys if none exist

Network Discovery Options:
  --no-mdns             Disable mDNS/Bonjour advertisement (enabled by default)

HQ Mode Options:
  --hq                  Run as HQ (headquarters) server
  --no-hq-auth          Disable HQ authentication

Remote Server Options:
  --hq-url <url>        HQ server URL to register with
  --hq-username <user>  Username for HQ authentication
  --hq-password <pass>  Password for HQ authentication
  --name <name>         Unique name for remote server
  --allow-insecure-hq   Allow HTTP URLs for HQ (not recommended)

Debugging:
  --debug               Enable debug logging
```

### Use the vt command wrapper

The `vt` command allows you to run commands with TTY forwarding:

```bash
# Monitor AI agents with automatic activity tracking
vt claude
vt claude --dangerously-skip-permissions

# Run commands with output visible in VibeTunnel
vt npm test
vt python script.py
vt top

# Launch interactive shell
vt --shell
vt -i

# Update session title (inside a session)
vt title "My Project"

# Execute command directly without shell wrapper
vt --no-shell-wrap ls -la
vt -S ls -la

# Control terminal title behavior
vt --title-mode none     # No title management
vt --title-mode filter   # Block all title changes
vt --title-mode static   # Show directory and command
vt --title-mode dynamic  # Show directory, command, and activity

# Verbosity control
vt -q npm test          # Quiet mode (errors only)
vt -v npm run dev       # Verbose mode
vt -vv npm test         # Extra verbose
vt -vvv npm build       # Debug mode
```

### Forward commands to a session

```bash
# Basic usage
vibetunnel fwd <session-id> <command> [args...]

# Examples
vibetunnel fwd --session-id abc123 ls -la
vibetunnel fwd --session-id abc123 npm test
vibetunnel fwd --session-id abc123 python script.py
```

Linux users can install VibeTunnel as a systemd service with `vibetunnel systemd` for automatic startup and process management - see [detailed systemd documentation](docs/systemd.md).

### Environment Variables

VibeTunnel respects the following environment variables:

```bash
PORT=8080                           # Default port if --port not specified
VIBETUNNEL_USERNAME=myuser          # Username (for env-based auth, not CLI)
VIBETUNNEL_PASSWORD=mypass          # Password (for env-based auth, not CLI)
VIBETUNNEL_CONTROL_DIR=/path        # Control directory for session data
VIBETUNNEL_SESSION_ID=abc123        # Current session ID (set automatically inside sessions)
VIBETUNNEL_LOG_LEVEL=debug          # Log level: error, warn, info, verbose, debug
PUSH_CONTACT_EMAIL=admin@example.com # Contact email for VAPID configuration
```

## Features

- **Web-based terminal interface** - Access terminals from any browser
- **Multiple concurrent sessions** - Run multiple terminals simultaneously
- **Real-time synchronization** - See output in real-time
- **TTY forwarding** - Full terminal emulation support
- **Session management** - Create, list, and manage sessions
- **Git worktree support** - Work on multiple branches simultaneously
- **Cross-platform** - Works on macOS and Linux
- **No dependencies** - Just Node.js required

### Git Worktree Integration

VibeTunnel provides comprehensive Git worktree support, allowing you to:
- Work on multiple branches simultaneously without stashing changes
- Create new worktrees directly from the session creation dialog
- Smart branch switching with uncommitted change detection
- Follow mode to keep multiple worktrees in sync
- Visual indicators for worktree sessions

For detailed information, see the [Git Worktree Management Guide](docs/worktree.md).

## Package Contents

This npm package includes:
- Full VibeTunnel server with web UI
- Command-line tools (vibetunnel, vt)
- Native PTY support for terminal emulation
- Web interface with xterm.js
- Session management and forwarding
- Built-in systemd service management for Linux

## Platform Support

- macOS (Intel and Apple Silicon)
- Linux (x64 and ARM64)
- Windows: Not yet supported ([#252](https://github.com/amantus-ai/vibetunnel/issues/252))

## Troubleshooting

### Installation Issues

If you encounter issues during installation:

1. **Missing Build Tools**: Install build essentials
   ```bash
   # Ubuntu/Debian
   sudo apt-get install build-essential python3-dev
   
   # macOS
   xcode-select --install
   ```

2. **Permission Issues**: Use sudo for global installation
   ```bash
   sudo npm install -g vibetunnel
   ```

3. **Node Version**: Ensure Node.js 20+ is installed
   ```bash
   node --version
   ```

### Runtime Issues

- **Server Won't Start**: Check if port is already in use
- **Authentication Failed**: Verify system authentication setup
- **Terminal Not Responsive**: Check browser console for WebSocket errors

### SSH Key Authentication Issues

If you encounter errors when generating or importing SSH keys (e.g., "Cannot read properties of undefined"), this is due to browser security restrictions on the Web Crypto API.

#### The Issue
Modern browsers (Chrome 60+, Firefox 75+) block the Web Crypto API when accessing web applications over HTTP from non-localhost addresses. This affects:
- Local network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
- Any non-localhost hostname over HTTP

#### Solutions

1. **Use localhost (Recommended)**
   ```bash
   # Access VibeTunnel via localhost
   http://localhost:4020
   
   # If running on a remote server, use SSH tunneling:
   ssh -L 4020:localhost:4020 user@your-server
   # Then access http://localhost:4020 in your browser
   ```

2. **Enable HTTPS**
   Set up a reverse proxy with HTTPS using nginx or Caddy (recommended for production).

3. **Chrome Flag Workaround** (Development only)
   - Navigate to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
   - Add your server URL (e.g., `http://192.168.1.100:4020`)
   - Enable the flag and restart Chrome
   - ⚠️ This reduces security - use only for development

#### Why This Happens
The Web Crypto API is restricted to secure contexts (HTTPS or localhost) to prevent man-in-the-middle attacks on cryptographic operations. This is a browser security feature, not a VibeTunnel limitation.

### Development Setup

For source installations:
```bash
# Install dependencies
pnpm install

# Run development server with hot reload
pnpm run dev

# Run code quality checks
pnpm run check

# Build for production
pnpm run build
```

## Documentation

See the main repository for complete documentation: https://github.com/amantus-ai/vibetunnel

## License

MIT

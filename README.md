<!-- Generated: 2025-06-21 18:45:00 UTC -->
![VibeTunnel Banner](assets/banner.png)

# VibeTunnel

**Turn any browser into your Mac terminal.** VibeTunnel proxies your terminals right into the browser, so you can vibe-code anywhere.

[![Download](https://img.shields.io/badge/Download-macOS-blue)](https://github.com/amantus-ai/vibetunnel/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![macOS 14.0+](https://img.shields.io/badge/macOS-14.0+-red)](https://www.apple.com/macos/)
[![Apple Silicon](https://img.shields.io/badge/Apple%20Silicon-Required-orange)](https://support.apple.com/en-us/HT211814)
[![Support us on Polar](https://img.shields.io/badge/Support%20us-on%20Polar-purple)](https://vibetunnel.sh/#support)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/amantus-ai/vibetunnel)

## Why VibeTunnel?

Ever wanted to check on your AI agents while you're away? Need to monitor that long-running build from your phone? Want to share a terminal session with a colleague without complex SSH setups? VibeTunnel makes it happen with zero friction.

## Quick Start

### Requirements

**VibeTunnel requires an Apple Silicon Mac (M1+).** Intel Macs are not supported.

### 1. Download & Install

#### Option 1: Direct Download
[Download VibeTunnel](https://github.com/amantus-ai/vibetunnel/releases/latest) and drag it to your Applications folder.

#### Option 2: Homebrew
```bash
brew install --cask vibetunnel
```

### 2. Launch VibeTunnel

VibeTunnel lives in your menu bar. Click the icon to start the server.

### 3. Use the `vt` Command

```bash
# Run any command in the browser
vt pnpm run dev

# Monitor AI agents (with automatic activity tracking)
vt claude --dangerously-skip-permissions

# Control terminal titles
vt --title-mode static npm run dev    # Shows path and command
vt --title-mode dynamic python app.py  # Shows path, command, and activity
vt --title-mode filter vim            # Blocks vim from changing title

# Shell aliases work automatically!
vt claude-danger  # Your custom aliases are resolved

# Open an interactive shell
vt --shell
```

### 4. Open Your Dashboard

Visit [http://localhost:4020](http://localhost:4020) to see all your terminal sessions.

## Features

- **🌐 Browser-Based Access** - Control your Mac terminal from any device with a web browser
- **🚀 Zero Configuration** - No SSH keys, no port forwarding, no complexity
- **🤖 AI Agent Friendly** - Perfect for monitoring Claude Code, ChatGPT, or any terminal-based AI tools
- **📊 Dynamic Terminal Titles** - Real-time activity tracking shows what's happening in each session
- **🔒 Secure by Design** - Password protection, localhost-only mode, or secure tunneling via Tailscale/ngrok
- **📱 Mobile Ready** - Native iOS app and responsive web interface for phones and tablets
- **🎬 Session Recording** - All sessions recorded in asciinema format for later playback
- **⚡ High Performance** - Powered by Bun runtime for blazing-fast JavaScript execution
- **🍎 Apple Silicon Native** - Optimized for M1/M2/M3 Macs with ARM64-only binaries
- **🐚 Shell Alias Support** - Your custom aliases and shell functions work automatically

> **Note**: The iOS app and Tauri-based components are still work in progress and not recommended for production use yet.

## Architecture

VibeTunnel consists of three main components:

1. **macOS Menu Bar App** - Native Swift application that manages the server lifecycle
2. **Node.js/Bun Server** - High-performance TypeScript server handling terminal sessions
3. **Web Frontend** - Modern web interface using Lit components and xterm.js

The server runs as a standalone Bun executable with embedded Node.js modules, providing excellent performance and minimal resource usage.

## Remote Access Options

### Option 1: Tailscale (Recommended)

[Tailscale](https://tailscale.com) creates a secure peer-to-peer VPN network between your devices. It's the most secure option as traffic stays within your private network without exposing VibeTunnel to the public internet.

**How it works**: Tailscale creates an encrypted WireGuard tunnel between your devices, allowing them to communicate as if they were on the same local network, regardless of their physical location.

**Setup Guide**:
1. Install Tailscale on your Mac: [Download from Mac App Store](https://apps.apple.com/us/app/tailscale/id1475387142) or [Direct Download](https://tailscale.com/download/macos)
2. Install Tailscale on your remote device:
   - **iOS**: [Download from App Store](https://apps.apple.com/us/app/tailscale/id1470499037)
   - **Android**: [Download from Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn)
   - **Other platforms**: [All Downloads](https://tailscale.com/download)
3. Sign in to both devices with the same account
4. Find your Mac's Tailscale hostname in the Tailscale menu bar app (e.g., `my-mac.tailnet-name.ts.net`)
5. Access VibeTunnel at `http://[your-tailscale-hostname]:4020`

**Benefits**:
- End-to-end encrypted traffic
- No public internet exposure
- Works behind NAT and firewalls
- Zero configuration after initial setup

### Option 2: ngrok

[ngrok](https://ngrok.com) creates secure tunnels to your localhost, making VibeTunnel accessible via a public URL. Perfect for quick sharing or temporary access.

**How it works**: ngrok establishes a secure tunnel from a public endpoint to your local VibeTunnel server, handling SSL/TLS encryption and providing a unique URL for access.

**Setup Guide**:
1. Create a free ngrok account: [Sign up for ngrok](https://dashboard.ngrok.com/signup)
2. Copy your auth token from the [ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Add the token in VibeTunnel settings (Settings → Remote Access → ngrok)
4. Enable ngrok tunneling in VibeTunnel
5. Share the generated `https://[random].ngrok-free.app` URL

**Benefits**:
- Public HTTPS URL with SSL certificate
- No firewall configuration needed
- Built-in request inspection and replay
- Custom domains available (paid plans)

**Note**: Free ngrok URLs change each time you restart the tunnel. You can claim one free static domain per user, or upgrade to a paid plan for multiple domains.

### Option 3: Local Network
1. Set a dashboard password in settings
2. Switch to "Network" mode
3. Access via `http://[your-mac-ip]:4020`

### Option 4: Cloudflare Quick Tunnel
1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. Run `cloudflared tunnel --url http://localhost:4020`
3. Access via the generated `*.trycloudflare.com` URL

## Terminal Title Management

VibeTunnel provides intelligent terminal title management to help you track what's happening in each session:

### Title Modes

- **Dynamic Mode** (default for web UI): Shows working directory, command, and real-time activity
  - Generic activity: `~/projects — npm — •`
  - Claude status: `~/projects — claude — ✻ Crafting (45s, ↑2.1k)`
  
- **Static Mode**: Shows working directory and command
  - Example: `~/projects/app — npm run dev`
  
- **Filter Mode**: Blocks all title changes from applications
  - Useful when you have your own terminal management system
  
- **None Mode**: No title management - applications control their own titles

### Activity Detection

Dynamic mode includes real-time activity detection:
- Shows `•` when there's terminal output within 5 seconds
- Claude commands show specific status (Crafting, Transitioning, etc.)
- Extensible system for future app-specific detectors
## Building from Source

### Prerequisites
- macOS 14.0+ (Sonoma) on Apple Silicon (M1/M2/M3)
- Xcode 16.0+
- Node.js 20+
- Bun runtime

### Build Steps

```bash
# Clone the repository
git clone https://github.com/amantus-ai/vibetunnel.git
cd vibetunnel

# Set up code signing (required for macOS/iOS development)
# Create Local.xcconfig files with your Apple Developer Team ID
# Note: These files must be in the same directory as Shared.xcconfig
cat > mac/VibeTunnel/Local.xcconfig << EOF
// Local Development Configuration
// DO NOT commit this file to version control
DEVELOPMENT_TEAM = YOUR_TEAM_ID
CODE_SIGN_STYLE = Automatic
EOF

cat > ios/VibeTunnel/Local.xcconfig << EOF
// Local Development Configuration  
// DO NOT commit this file to version control
DEVELOPMENT_TEAM = YOUR_TEAM_ID
CODE_SIGN_STYLE = Automatic
EOF

# Build the web server
cd web
pnpm install
pnpm run build

# Optional: Build with custom Node.js for smaller binary (46% size reduction)
# export VIBETUNNEL_USE_CUSTOM_NODE=YES
# node build-custom-node.js  # Build optimized Node.js (one-time, ~20 min)
# pnpm run build              # Will use custom Node.js automatically

# Build the macOS app
cd ../mac
./scripts/build.sh --configuration Release
```

### Custom Node.js Builds

VibeTunnel supports building with a custom Node.js for a 46% smaller executable (61MB vs 107MB):

```bash
# Build custom Node.js (one-time, ~20 minutes)
node build-custom-node.js

# Use environment variable for all builds
export VIBETUNNEL_USE_CUSTOM_NODE=YES

# Or use in Xcode Build Settings
# Add User-Defined Setting: VIBETUNNEL_USE_CUSTOM_NODE = YES
```

See [Custom Node Build Flags](docs/custom-node-build-flags.md) for detailed optimization information.

## Development

For development setup and contribution guidelines, see [CONTRIBUTING.md](docs/CONTRIBUTING.md).

### Key Files
- **macOS App**: `mac/VibeTunnel/VibeTunnelApp.swift`
- **Server**: `web/src/server/` (TypeScript/Node.js)
- **Web UI**: `web/src/client/` (Lit/TypeScript)
- **iOS App**: `ios/VibeTunnel/`

### Testing & Code Coverage

VibeTunnel has comprehensive test suites with code coverage enabled for all projects:

```bash
# Run all tests with coverage
./scripts/test-all-coverage.sh

# macOS tests with coverage (Swift Testing)
cd mac && swift test --enable-code-coverage

# iOS tests with coverage (using xcodebuild)
cd ios && ./scripts/test-with-coverage.sh

# Web tests with coverage (Vitest)
cd web && ./scripts/coverage-report.sh
```

**Coverage Requirements**:
- macOS/iOS: 75% minimum (enforced in CI)
- Web: 80% minimum for lines, functions, branches, and statements

### Development Server & Hot Reload

VibeTunnel includes a development server with automatic rebuilding for faster iteration:

#### Development Mode

```bash
cd web
pnpm run dev
```

**What this provides:**
- **Automatic Rebuilds**: esbuild watches for file changes and rebuilds bundles instantly
- **Fast Feedback**: Changes are compiled within seconds of saving
- **Manual Refresh Required**: Browser needs manual refresh to see changes (no hot module replacement)

**How it works:**
- esbuild watch mode detects file changes in `src/`
- Automatically rebuilds JavaScript bundles and CSS
- Express server serves updated files immediately
- Visit `http://localhost:4020` and refresh to see changes

#### Testing on External Devices (iPad, iPhone, etc.)

When developing the web interface, you often need to test changes on external devices to debug browser-specific issues. Here's how to do it:

##### Quick Setup

1. **Run the dev server with network access**:
   ```bash
   cd web
   pnpm run dev --port 4021 --bind 0.0.0.0
   ```
   This binds to all network interfaces, making it accessible from other devices.

2. **Find your Mac's IP address**:
   - System Preferences → Network → Wi-Fi → Details
   - Or run: `ipconfig getifaddr en0`

3. **Access from your external device**:
   ```
   http://[your-mac-ip]:4021
   ```

##### Important Notes

- **Port conflict**: The Mac app runs on port 4020, so use a different port (e.g., 4021) for development
- **Same network**: Ensure both devices are on the same Wi-Fi network
- **Firewall**: macOS may prompt to allow incoming connections - click "Allow"
- **Auto-rebuild**: Changes to the web code are automatically rebuilt, but you need to manually refresh the browser

#### Future: Hot Module Replacement

For true hot module replacement without manual refresh, see our [Vite migration plan](docs/vite-plan.md) which would provide:
- Instant updates without page refresh
- Preserved application state during development
- Sub-second feedback loops
- Modern development tooling

#### Mac App Development Server Mode

The VibeTunnel Mac app includes a special development server mode that integrates with the web development workflow:

**Setup:**
1. Open VibeTunnel Settings → Debug tab (enable Debug Mode first in General settings)
2. Enable "Use Development Server"
3. Set the path to your `web/` directory
4. Restart the VibeTunnel server

**How it works:**
- Instead of using the bundled production server, the Mac app runs `pnpm run dev` in your web directory
- Provides hot reload and automatic rebuilding during development
- Maintains all Mac app functionality (session management, logging, etc.)
- Shows "Dev Server" in the menu bar and status indicators

**Benefits:**
- No need to manually rebuild after code changes
- Automatic esbuild watch mode for instant compilation
- Full integration with Mac app features
- Same terminal session management as production

**Alternative: Standalone Development**

If you prefer working outside the Mac app:

1. Build the web project: `cd web && pnpm run build`
2. In VibeTunnel settings, set Dashboard Access to "Network"
3. Access from external device: `http://[your-mac-ip]:4020`

Note: This requires rebuilding after each change, so the dev server mode above is preferred for rapid iteration.

### Debug Logging

Enable debug logging for troubleshooting:

```bash
# Enable debug mode
export VIBETUNNEL_DEBUG=1

# Or use inline
VIBETUNNEL_DEBUG=1 vt your-command
```

Debug logs are written to `~/.vibetunnel/log.txt`.

## Documentation

- [Technical Specification](docs/spec.md) - Detailed architecture and implementation
- [Contributing Guide](docs/CONTRIBUTING.md) - Development setup and guidelines
- [Architecture](docs/architecture.md) - System design overview
- [Build System](docs/build-system.md) - Build process details
- [Push Notifications](docs/push-notification.md) - How web push notifications work

## macOS Permissions

macOS is finicky when it comes to permissions. The system will only remember the first path from where an app requests permissions. If subsequently the app starts somewhere else, it will silently fail. Fix: Delete the entry and restart settings, restart app and next time the permission is requested, there should be an entry in Settings again.

Important: You need to set your Developer ID in Local.xcconfig. If apps are signed Ad-Hoc, each new signing will count as a new app for macOS and the permissions have to be (deleted and) requested again.

**Debug vs Release Bundle IDs**: The Debug configuration uses a different bundle identifier (`sh.vibetunnel.vibetunnel.debug`) than Release (`sh.vibetunnel.vibetunnel`). This allows you to have both versions installed simultaneously, but macOS treats them as separate apps for permissions. You'll need to grant permissions separately for each version.

If that fails, use the terminal to reset:

```
# This removes Accessibility permission for a specific bundle ID:
sudo tccutil reset Accessibility sh.vibetunnel.vibetunnel
sudo tccutil reset Accessibility sh.vibetunnel.vibetunnel.debug  # For debug builds

sudo tccutil reset ScreenCapture sh.vibetunnel.vibetunnel
sudo tccutil reset ScreenCapture sh.vibetunnel.vibetunnel.debug  # For debug builds

# This removes all Automation permissions system-wide (cannot target specific apps):
sudo tccutil reset AppleEvents
```

## Support VibeTunnel

Love VibeTunnel? Help us keep the terminal vibes flowing! Your support helps us buy pizza and drinks while we keep hacking on your favorite AI agent orchestration platform.

All donations go directly to the development team. Choose your own amount - one-time or monthly! Visit our [Polar page](https://vibetunnel.sh/#support) to support us.

## Credits

Created with ❤️ by:
- [@badlogic](https://mariozechner.at/) - Mario Zechner
- [@mitsuhiko](https://lucumr.pocoo.org/) - Armin Ronacher  
- [@steipete](https://steipete.com/) - Peter Steinberger
- [@hjanuschka](https://x.com/hjanuschka) - Helmut Januschka
- [@manuelmaly](https://x.com/manuelmaly) - Manuel Maly

## License

VibeTunnel is open source software licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

**Ready to vibe?** [Download VibeTunnel](https://github.com/amantus-ai/vibetunnel/releases/latest) and start tunneling!

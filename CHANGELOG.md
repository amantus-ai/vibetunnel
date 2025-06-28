# Changelog

## [1.0.0-beta.5] - upcoming

### 🎯 Reliability & Stability
- **Fixed critical race condition in terminal output** - Terminal sessions now handle high-volume output without corruption or out-of-order text.

### 🌏 International Input Support
- **Fixed Japanese/CJK input duplication on iOS** - Typing Japanese, Chinese, or Korean text on mobile browsers no longer produces duplicate characters. IME composition is now handled correctly.

### ⌨️ Enhanced Terminal Experience
- **Shell aliases now work properly** - Commands like `claude`, `ll`, and other custom aliases from your `.zshrc`/`.bashrc` are now recognized when launching terminals through VibeTunnel.
- **Prevented recursive VibeTunnel sessions** - Running `vt` inside a VibeTunnel session now shows a helpful error instead of creating confusing nested sessions.

### 🤖 Claude Code Integration
- **Added Shift+Tab support** - Full support for Claude Code's mode switching (regular/planning/autoaccept modes) on both desktop and mobile.
- **Mobile quick keyboard enhancement** - Added dedicated Shift+Tab button (⇤) to the mobile keyboard for easy mode switching.
- **Fixed keyboard input conflicts** - Typing in Monaco Editor or other code editors no longer triggers unintended shortcuts.

### 🧹 Code Quality
- **Major codebase cleanup** - Improved code organization and updated technical specifications for contributors.

## [1.0.0-beta.4] - 2025-06-27

### 🔐 Security & Authentication
- **Comprehensive authentication system** - Choose between password-only, SSH key-only, both, or no authentication based on your security needs.
- **Browser-based SSH key management** - Generate, import, and manage Ed25519 SSH keys directly in your browser. Keys are encrypted and stored locally.
- **24-hour session tokens** - Stay logged in longer with JWT-based authentication.
- **macOS profile integration** - See your system profile picture on the login screen.

### 🎨 Revolutionary UI Design
- **Arc-style vertical tabs** - Modern sidebar interface inspired by Arc browser makes better use of widescreen displays.
- **Persistent session management** - All active sessions visible at a glance in a resizable sidebar (240-600px).
- **Mobile-optimized interface** - Responsive design with slide-out sidebar and proper touch targets.
- **Smooth animations** - Polished transitions and no layout shifts for a premium feel.

### 📱 Mobile Terminal Excellence
- **Dedicated terminal keyboard** - Custom on-screen keyboard with Escape, Tab, arrows, function keys, and common terminal shortcuts (Ctrl+C, Ctrl+Z, etc.).
- **Essential special characters** - Quick access to pipes, backticks, tildes, and brackets without keyboard switching.
- **Fixed wrapped URL detection** - Long URLs that span multiple lines are now properly clickable on mobile.

### ⚡ Performance & Reliability
- **Upgraded to Microsoft node-pty v1.1.0** - Latest terminal emulation library for better performance and compatibility.
- **Fixed large paste operations** - Paste massive logs or code files without the terminal hanging.
- **Improved backpressure handling** - Terminal gracefully manages data flow during high-volume operations.

### 🗂️ File Management
- **Symlink support in file browser** - Navigate through symbolic links with visual indicators showing link targets.
- **Better directory detection** - File browser correctly identifies whether symlinks point to files or directories.

### 🐛 Bug Fixes & Improvements
- **Fixed session status detection** - Terminal status (running/exited) now updates reliably.
- **Eliminated double button rendering** - UI cleanup for cleaner interface.
- **Fixed Monaco editor integration** - Code editing now works smoothly within VibeTunnel.
- **Improved error handling** - Better error messages and recovery from edge cases (including fixes for Terminal.app)
- **Enhanced test infrastructure** - Comprehensive test suite for improved stability.

### 🔧 Developer Experience
- **No-auth mode for development** - Run VibeTunnel without authentication for local development.
- **Improved logging** - Better debugging information for troubleshooting.
- **Alias resolution for commands** - Terminal commands resolve through proper shell initialization.

## [1.0.0-beta.3] - 2025-06-23

There's too much to list! This is the version you've been waiting for. 

- Redesigned, responsive, animated frontend.
- Improved terminal width spanning and layout optimization
- File-Picker to see files on-the-go.
- Creating new Terminals is now much more reliable.
- Added terminal font size adjustment in the settings dropdown
- Fresh new icon for Progressive Web App installations
- Refined bounce animations for a more subtle, professional feel
- Added retro CRT-style phosphor decay visual effect for closed terminals
- Fixed buffer aggregator message handling for smoother terminal updates
- Better support for shell aliases and improved debug logging
- Enhanced Unix socket server implementation for faster local communication
- Special handling for Warp terminal with custom enter key behavior
- New dock menu with quick actions when right-clicking the app icon
- More resilient vt command-line tool with better error handling
- Ensured vibetunnel server properly terminates when Mac app is killed

## [1.0.0-beta.2] - 2025-06-19

### 🎨 Improvements
- Redesigned slick new web frontend
- Faster terminal rendering in the web frontend
- New Sessions spawn new Terminal windows. (This needs Applescript and Accessibility permissions)
- Enhanced font handling with system font priority
- Better async operations in PTY service for improved performance
- Improved window activation when showing the welcome and settings windows
- Preparations for Linux support

### 🐛 Bug Fixes
- Fixed window front order when dock icon is hidden
- Fixed PTY service enhancements with proper async operations
- Fixed race condition in session creation that caused frontend to open previous session

## [1.0.0-beta.1] - 2025-06-17

### 🎉 First Public Beta Release

This is the first public beta release of VibeTunnel, ready for testing by early adopters.

### ✨ What's Included
- Complete terminal session proxying to web browsers
- Support for multiple concurrent sessions
- Real-time terminal rendering with full TTY support
- Secure password-protected dashboard
- Tailscale and ngrok integration for remote access
- Automatic updates via Sparkle framework
- Native macOS menu bar application

### 🐛 Bug Fixes Since Internal Testing
- Fixed visible circle spacer in menu (now uses Color.clear)
- Removed development files from app bundle
- Enhanced build process with automatic cleanup
- Fixed Sparkle API compatibility for v2.7.0

### 📝 Notes
- This is a beta release - please report any issues on GitHub
- Auto-update functionality is fully enabled
- All core features are stable and ready for daily use

### ✨ What's New Since Internal Testing
- Improved stability and performance
- Enhanced error handling for edge cases
- Refined UI/UX based on internal feedback
- Better session cleanup and resource management
- Optimized for macOS Sonoma and Sequoia

### 🐛 Known Issues
- Occasional connection drops with certain terminal applications
- Performance optimization needed for very long sessions
- Some terminal escape sequences may not render perfectly

### 📝 Notes
- This is a beta release - please report any issues on GitHub
- Auto-update functionality is fully enabled
- All core features are stable and ready for daily use

## [1.0.0] - 2025-06-16

### 🎉 Initial Release

VibeTunnel is a native macOS application that proxies terminal sessions to web browsers, allowing you to monitor and control terminals from any device.

### ✨ Core Features

#### Terminal Management
- **Terminal Session Proxying** - Run any command with `vt` prefix to make it accessible via web browser
- **Multiple Concurrent Sessions** - Support for multiple terminal sessions running simultaneously
- **Session Recording** - All sessions automatically recorded in asciinema format for later playback
- **Full TTY Support** - Proper handling of terminal control sequences, colors, and special characters
- **Interactive Commands** - Support for interactive applications like vim, htop, and more
- **Shell Integration** - Direct shell access with `vt --shell` or `vt -i`

#### Web Interface
- **Browser-Based Dashboard** - Access all terminal sessions at http://localhost:4020
- **Real-time Terminal Rendering** - Live terminal output using asciinema player
- **WebSocket Streaming** - Low-latency real-time updates for terminal I/O
- **Mobile Responsive** - Fully functional on phones, tablets, and desktop browsers
- **Session Management UI** - Create, view, kill, and manage sessions from the web interface

#### Security & Access Control
- **Password Protection** - Optional password authentication for dashboard access
- **Keychain Integration** - Secure password storage using macOS Keychain
- **Access Modes** - Choose between localhost-only, network, or secure tunneling
- **Basic Authentication** - HTTP Basic Auth support for network access

#### Remote Access Options
- **Tailscale Integration** - Access VibeTunnel through your Tailscale network
- **ngrok Support** - Built-in ngrok tunneling for public access with authentication
- **Network Mode** - Local network access with IP-based connections

#### macOS Integration
- **Menu Bar Application** - Lives in the system menu bar with optional dock mode
- **Launch at Login** - Automatic startup with macOS
- **Auto Updates** - Sparkle framework integration for seamless updates
- **Native Swift/SwiftUI** - Built with modern macOS technologies
- **Universal Binary** - Native support for both Intel and Apple Silicon Macs

#### CLI Tool (`vt`)
- **Command Wrapper** - Prefix any command with `vt` to tunnel it
- **Claude Integration** - Special support for AI assistants with `vt --claude` and `vt --claude-yolo`
- **Direct Execution** - Bypass shell with `vt -S` for direct command execution
- **Automatic Installation** - CLI tool automatically installed to /usr/local/bin

#### Server Implementation
- **Dual Server Architecture** - Choose between Rust (default) or Swift server backends
- **High Performance** - Rust server for efficient TTY forwarding and process management
- **RESTful APIs** - Clean API design for session management
- **Health Monitoring** - Built-in health check endpoints

#### Developer Features
- **Server Console** - Debug view showing server logs and diagnostics
- **Configurable Ports** - Change server port from default 4020
- **Session Cleanup** - Automatic cleanup of stale sessions on startup
- **Comprehensive Logging** - Detailed logs for debugging

### 🛠️ Technical Details

- **Minimum macOS Version**: 14.0 (Sonoma)
- **Architecture**: Universal Binary (Intel + Apple Silicon)
- **Languages**: Swift 6.0, Rust, TypeScript
- **UI Framework**: SwiftUI
- **Web Technologies**: TypeScript, Tailwind CSS, WebSockets
- **Build System**: Xcode, Swift Package Manager, Cargo, npm

### 📦 Installation

- Download DMG from GitHub releases
- Drag VibeTunnel to Applications folder
- Launch from Applications or Spotlight
- CLI tool (`vt`) automatically installed on first launch

### 🚀 Quick Start

```bash
# Monitor AI agents
vt claude

# Run development servers  
vt npm run dev

# Watch long-running processes
vt python train_model.py

# Open interactive shell
vt --shell
```

### 👥 Contributors

Created by:
- [@badlogic](https://mariozechner.at/) - Mario Zechner
- [@mitsuhiko](https://lucumr.pocoo.org/) - Armin Ronacher  
- [@steipete](https://steipete.com/) - Peter Steinberger

### 📄 License

VibeTunnel is open source software licensed under the MIT License.

---

## Version History

### Pre-release Development

The project went through extensive development before the 1.0.0 release, including:

- Initial TTY forwarding implementation using Rust
- macOS app foundation with SwiftUI
- Integration of asciinema format for session recording
- Web frontend development with real-time terminal rendering
- Hummingbird HTTP server implementation
- ngrok integration for secure tunneling
- Sparkle framework integration for auto-updates
- Comprehensive testing and bug fixes
- UI/UX refinements and mobile optimizations
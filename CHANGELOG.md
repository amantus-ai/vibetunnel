# Changelog

## [1.0.0-beta.7] - 2025-07-08

### 🎯 Major Features

#### 🖥️ **Remote Screen Sharing (Beta) **
- Share your Mac screen remotely through any web browser - perfect for demonstrations, pair programming, or remote support
- Ultra-low latency using WebRTC technology with automatic quality adjustment based on network conditions
- Privacy-focused with deferred permission requests (only asks for screen recording when you actually start sharing)
- Automatic 4K resolution capping for 5K+ displays to prevent web interface clipping
- Clear visual indicators when screen sharing is active

#### 🪄 **Magic Wand for AI Sessions**
- Instantly inject helpful context into Claude.ai sessions with a single click
- Automatically detects Claude browser windows and adds project information
- Includes git repository details, current branch, and recent commit history
- Configurable prompts to match your workflow
- More forceful prompt injection to prevent AI from directly using the injected title

### 🚀 Performance & Stability Improvements

#### **Terminal Performance**
- **FIXED**: Critical flow control issue that caused xterm.js buffer overflow and terminal freezing
- **FIXED**: Infinite scroll loop in terminal output that could freeze the browser
- **FIXED**: Race conditions in terminal output handling causing corrupted or out-of-order text
- Improved memory management for long-running sessions
- Better handling of high-volume terminal output

#### **UI Performance**
- Removed all UI animations that were causing 1-2 second delays when reopening sessions
- Disabled View Transitions API for instant session navigation
- Fixed modal backdrop pointer-events issues preventing interaction
- Smoother menu bar UI without jumping when copy icon appears

### 📱 Touch Device & Mobile Improvements

#### **iPad/Tablet Support**
- Unified keyboard layout for all mobile devices (removed separate iPad layout)
- Universal touch device detection for better keyboard mode handling
- Inline-edit pencil now always visible on touch devices
- Reorganized touch device layout with better button placement
- Fixed touch interaction issues with modals and overlays

#### **Mobile Keyboard**
- New compact keyboard layout optimized for tablets
- Better handling of keyboard shortcuts on touch devices
- Improved responsiveness for mobile web browsers

### 🐚 Shell Support Enhancements

#### **Fish Shell Integration**
- Full support for Fish shell command expansion and completions
- Proper handling of Fish-specific syntax and features
- Fixed shell configuration files not being loaded correctly

### 🔧 Developer Experience

#### **Build System Improvements**
- Preserve Swift package resolution in build.sh for faster builds
- Better Node.js detection that handles fnm/homebrew conflicts

#### **Version Management**
- Implemented hash-based vt script version detection
- Delete old sessions automatically when VibeTunnel version changes
- Better handling of version mismatches between components

### 🐛 Bug Fixes

#### **Session Management**
- Fixed session state synchronization between web and native clients
- Resolved memory leaks in long-running sessions
- Fixed connection timeout issues on slower networks
- Better cleanup of terminal processes and resources

#### **UI/UX Fixes**
- Fixed various UI glitches and visual artifacts
- Resolved sidebar animation issues
- Fixed file browser problems
- Corrected ngrok documentation about free static domains

### 🔍 Other Improvements

#### **Control Protocol**
- Unified control protocol for better terminal and screen sharing integration
- Improved Unix socket handling with better error recovery
- Enhanced WebRTC connection management

#### **Documentation**
- Updated ngrok docs to clarify one free static domain per user
- Added comprehensive ScreenCaptureKit documentation
- Removed outdated debug documentation

## [1.0.0-beta.6] - 2025-07-03

### ✨ New Features

#### **Git Repository Monitoring** 🆕
- **Real-time Git Status** - Session rows now display git information including branch name and change counts
- **Visual Indicators** - Color-coded status: orange for branches, yellow for uncommitted changes
- **Quick Navigation** - Click folder icons to open repositories in Finder
- **GitHub Integration** - Context menu option to open repositories directly on GitHub
- **Smart Caching** - 5-second cache prevents excessive git commands while keeping info fresh
- **Repository Detection** - Automatically finds git repositories in parent directories

#### **Enhanced Command-Line Tool**
- **Terminal Title Management** - `vt title` can set the title of your Terminal. Even Claude can use it!
- **Version Information** - `vt help` now displays binary path, version, build date, and platform information for easier troubleshooting
- **Apple Silicon Support** - Automatic detection of Homebrew installations on ARM Macs (/opt/homebrew path)

#### **Menu Bar Enhancements**
- **Rich Session Interface** - Powerful new menu bar with visual activity indicators and real-time status tracking
- **Native Session Overview** - See all open terminal sessions and even Claude Code status right from the menu bar.
- **Sleep Prevention** - Mac stays awake when running terminal sessions

#### **Web Interface Improvements**
- **Modern Visual Design** - Complete UI overhaul with improved color scheme, animations, and visual hierarchy
- **Collapsible Sidebar** - New toggle button to maximize terminal viewing space (preference is remembered)
- **Better Session Loading** - Fixed race conditions that caused sessions to appear as "missing"
- **Responsive Enhancements** - Improved adaptation to different screen sizes with better touch targets

### 🚀 Performance & Stability

#### **Terminal Output Reliability**
- **Fixed Output Corruption** - Resolved race conditions causing out-of-order or corrupted terminal output
- **Stable Title Updates** - Terminal titles now update smoothly without flickering or getting stuck

#### **Server Improvements**
- **Logger Fix** - Fixed double initialization that was deleting log files
- **Better Resource Cleanup** - Improved PTY manager cleanup and timer management
- **Enhanced Error Handling** - More robust error handling throughout the server stack

#### **Simplified Tailscale Setup**
- Switched to Tailscale's local API for easier configuration
- Removed manual token management requirements
- Streamlined connection UI for minimal setup

## [1.0.0-beta.5] - 2025-01-29

### 🎨 UI Improvements
- **Version Display** - Web interface now shows full version including beta suffix (e.g., v1.0.0-beta.5)
- **Build Filtering** - Cleaner build output by filtering non-actionable Xcode warnings
- **Mobile Scrolling** - Fixed scrolling issues on mobile web browsers

### 🔧 Infrastructure
- **Single Source of Truth** - Web version now automatically reads from package.json at build time
- **Version Sync Validation** - Build process validates version consistency between macOS and web
- **CI Optimization** - Tests only run when relevant files change (iOS/Mac/Web)
- **E2E Test Suite** - Comprehensive Playwright tests for web frontend reliability

### 🐛 Bug Fixes
- **No-Auth Mode** - Fixed authentication-related error messages when running with `--no-auth`
- **Log Streaming** - Fixed frontend log streaming in no-auth mode
- **Test Reliability** - Resolved flaky tests and improved test infrastructure

### 📝 Developer Experience
- **Release Documentation** - Enhanced release process documentation with version sync requirements
- **Test Improvements** - Better test fixtures, helpers, and debugging capabilities
- **Error Suppression** - Cleaner logs when running in development mode

## [1.0.0-beta.4] - 2025-06-25

- We replaced HTTP Basic auth with System Login or SSH Keys for better security.
- Sessions now show exited terminals by default - no more hunting for terminated sessions
- Reorganized sidebar with cleaner, more compact header and better button placement
- Added user menu in sidebar for quick access to settings and logout
- Enhanced responsive design with better adaptation to different screen sizes
- Improved touch targets and spacing for mobile users
- Leverages View Transitions API for smoother animations with CSS fallbacks
- More intuitive default settings for better out-of-box experience

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
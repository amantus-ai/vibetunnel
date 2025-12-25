<!-- Generated: 2025-06-21 17:45:00 UTC -->
# VibeTunnel Project Overview

VibeTunnel turns any browser into a terminal for your Mac, enabling remote access to command-line tools and AI agents from any device. Built for developers who need to monitor long-running processes, check on AI coding assistants, or share terminal sessions without complex SSH setups.

The project provides a native macOS menu bar application that runs a local HTTP server with WebSocket support for real-time terminal streaming. Users can access their terminals through a responsive web interface at `http://localhost:4020`, with optional secure remote access via Tailscale or ngrok integration.

## Key Files

**Main Entry Points**
- `mac/VibeTunnel/VibeTunnelApp.swift` - macOS app entry point with menu bar integration
- `ios/VibeTunnel/App/VibeTunnelApp.swift` - iOS companion app entry  
- `web/src/index.ts` - Node.js server entry point for terminal forwarding
- `mac/VibeTunnel/Utilities/CLIInstaller.swift` - CLI tool (`vt`) installer

**Core Configuration**
- `web/package.json` - Node.js dependencies and build scripts
- `mac/VibeTunnel.xcodeproj/project.pbxproj` - Xcode project configuration
- `mac/VibeTunnel/version.xcconfig` - Version management
- `apple/Local.xcconfig.template` - Developer configuration template

## Technology Stack

**macOS Application** - Native Swift/SwiftUI app
- Menu bar app: `mac/VibeTunnel/Presentation/Views/MenuBarView.swift`
- Server management: `mac/VibeTunnel/Core/Services/ServerManager.swift` 
- Session monitoring: `mac/VibeTunnel/Core/Services/SessionMonitor.swift`
- Terminal operations: `mac/VibeTunnel/Core/Services/TerminalManager.swift`
- Sparkle framework for auto-updates

**Web Server** - Node.js/TypeScript with Bun runtime
- HTTP/WebSocket server: `web/src/server/server.ts`
- Terminal forwarding: `web/src/server/fwd.ts`
- Session management: `web/src/server/lib/sessions.ts`
- PTY integration: `@homebridge/node-pty-prebuilt-multiarch`

**Web Frontend** - Modern TypeScript/Lit web components  
- Terminal rendering: `web/src/client/components/terminal-viewer.ts`
- WebSocket client: `web/src/client/lib/websocket-client.ts`
- UI styling: Tailwind CSS (`web/src/client/styles.css`)
- Build system: esbuild bundler

**iOS Application** - SwiftUI companion app
- Connection management: `ios/VibeTunnel/App/VibeTunnelApp.swift` (lines 40-107)
- Terminal viewer: `ios/VibeTunnel/Views/Terminal/TerminalView.swift`
- WebSocket client: `ios/VibeTunnel/Services/BufferWebSocketClient.swift`

## Platform Support

**macOS Requirements**
- macOS 14.0+ (Sonoma or later)
- Apple Silicon Mac (M1+)
- Xcode 15+ for building from source
- Code signing for proper terminal permissions

**Linux & Headless Support**
- Any Linux distribution with Node.js 22.12+
- Runs as standalone server via npm package
- No GUI required - perfect for VPS/cloud deployments
- Install: `npm install -g vibetunnel`
- Run: `vibetunnel-server`

**iOS Requirements**  
- iOS 17.0+
- iPhone or iPad
- Network access to VibeTunnel server

**Browser Support**
- Modern browsers with WebSocket support
- Mobile-responsive design for phones/tablets
- Terminal rendering via canvas/WebGL

**Server Platforms**
- Primary: Bun runtime (Node.js compatible)
- Build requirements: Node.js 22.12+, npm/bun
- Supports macOS, Linux, and headless environments

**Key Platform Files**
- macOS app bundle: `mac/VibeTunnel.xcodeproj`
- iOS app: `ios/VibeTunnel.xcodeproj`  
- Web server: `web/` directory with TypeScript source
- CLI tool: Installed to `/usr/local/bin/vt` (macOS only)
- npm package: `vibetunnel` on npm registry

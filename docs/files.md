<!-- Generated: 2025-06-21 00:00:00 UTC -->

# VibeTunnel Files Catalog

## Overview

VibeTunnel is a cross-platform terminal sharing application organized into distinct platform modules: macOS native app, iOS companion app, and a TypeScript web server. The codebase follows a clear separation of concerns with platform-specific implementations sharing common protocols and interfaces.

The project structure emphasizes modularity with separate build systems for each platform - Xcode projects for Apple platforms and Node.js/TypeScript tooling for the web server. Configuration is managed through xcconfig files, Package.swift manifests, and package.json files.

## Core Source Files

### macOS Application (mac/)

**Main Entry Points**
- `VibeTunnel/VibeTunnelApp.swift` - macOS app entry point with lifecycle management
- `VibeTunnel/Core/Protocols/VibeTunnelServer.swift` - Server protocol definition
- `VibeTunnel/Core/Services/ServerManager.swift` - Central server orchestration

**Core Services**
- `VibeTunnel/Core/Services/BunServer.swift` - Bun runtime server implementation
- `VibeTunnel/Core/Services/BaseProcessServer.swift` - Base server process management
- `VibeTunnel/Core/Services/TTYForwardManager.swift` - Terminal forwarding coordinator
- `VibeTunnel/Core/Services/TerminalManager.swift` - Terminal app integration
- `VibeTunnel/Core/Services/SessionMonitor.swift` - Session lifecycle tracking
- `VibeTunnel/Core/Services/NgrokService.swift` - Tunnel service integration
- `VibeTunnel/Core/Services/WindowTracker.swift` - Window state management

**Security & Permissions**
- `VibeTunnel/Core/Services/DashboardKeychain.swift` - Secure credential storage
- `VibeTunnel/Core/Services/AccessibilityPermissionManager.swift` - Accessibility permissions
- `VibeTunnel/Core/Services/ScreenRecordingPermissionManager.swift` - Screen recording permissions
- `VibeTunnel/Core/Services/AppleScriptPermissionManager.swift` - AppleScript permissions

**UI Components**
- `VibeTunnel/Presentation/Views/MenuBarView.swift` - Menu bar interface
- `VibeTunnel/Presentation/Views/WelcomeView.swift` - Onboarding flow
- `VibeTunnel/Presentation/Views/SettingsView.swift` - Settings window
- `VibeTunnel/Presentation/Views/SessionDetailView.swift` - Session detail view

### iOS Application (ios/)

**Main Entry Points**
- `VibeTunnel/App/VibeTunnelApp.swift` - iOS app entry point
- `VibeTunnel/App/ContentView.swift` - Root content view

**Services**
- `VibeTunnel/Services/APIClient.swift` - HTTP API client
- `VibeTunnel/Services/BufferWebSocketClient.swift` - WebSocket terminal client
- `VibeTunnel/Services/SessionService.swift` - Session management
- `VibeTunnel/Services/NetworkMonitor.swift` - Network connectivity

**Terminal Views**
- `VibeTunnel/Views/Terminal/TerminalView.swift` - Main terminal view
- `VibeTunnel/Views/Terminal/GhosttyWebView.swift` - Ghostty terminal renderer
- `VibeTunnel/Views/Terminal/TerminalBufferRenderer.swift` - Buffer snapshot → ANSI conversion
- `VibeTunnel/Views/Terminal/TerminalToolbar.swift` - Terminal controls
- `VibeTunnel/Views/Terminal/CastPlayerView.swift` - Recording playback

**Data Models**
- `VibeTunnel/Models/Session.swift` - Terminal session model
- `VibeTunnel/Models/TerminalData.swift` - Terminal buffer data
- `VibeTunnel/Models/ServerConfig.swift` - Server configuration

### Web Server (web/)

**Server Entry Points**
- `src/index.ts` - Main server entry
- `src/server/server.ts` - Express server setup
- `src/server/app.ts` - Application configuration

**Terminal Management**
- `src/server/pty/pty-manager.ts` - PTY process management
- `src/server/pty/session-manager.ts` - Session lifecycle
- `src/server/services/terminal-manager.ts` - Terminal service layer
- `src/server/services/ws-v3-hub.ts` - WebSocket v3 hub (stdout/snapshots/input)
- `src/server/services/cast-output-hub.ts` - Asciicast tail + pruning for stdout

**API Routes**
- `src/server/routes/sessions.ts` - Session API endpoints
- `src/server/routes/remotes.ts` - Remote connection endpoints

**Client Application**
- `src/client/app-entry.ts` - Web client entry
- `src/client/app.ts` - Main application logic
- `src/client/components/terminal.ts` - Web terminal component
- `src/client/components/vibe-terminal-buffer.ts` - Buffer terminal component
- `src/client/services/terminal-socket-client.ts` - WebSocket v3 transport (single socket)

## Platform Implementation

### macOS Platform Files
- `apple/Local.xcconfig` - Local build configuration
- `mac/VibeTunnel/Shared.xcconfig` - Shared build settings
- `mac/VibeTunnel/version.xcconfig` - Version configuration
- `mac/VibeTunnel.entitlements` - App entitlements
- `mac/VibeTunnel-Info.plist` - App metadata

### iOS Platform Files
- `ios/Package.swift` - Swift package manifest
- `ios/project.yml` - XcodeGen configuration
- `ios/VibeTunnel/Resources/Info.plist` - iOS app metadata

### Web Platform Files
- `web/package.json` - Node.js dependencies
- `web/tsconfig.json` - TypeScript configuration
- `web/vite.config.ts` - Vite build configuration
- `web/tailwind.config.js` - Tailwind CSS configuration

## Build System

### macOS Build Scripts
- `mac/scripts/build.sh` - Main build script
- `mac/scripts/build-bun-executable.sh` - Bun server build
- `mac/scripts/copy-bun-executable.sh` - Resource copying
- `mac/scripts/codesign-app.sh` - Code signing
- `mac/scripts/notarize-app.sh` - App notarization
- `mac/scripts/create-dmg.sh` - DMG creation
- `mac/scripts/release.sh` - Release automation

### Web Build Scripts
- `web/scripts/clean.js` - Build cleanup
- `web/scripts/copy-assets.js` - Asset management
- `web/scripts/ensure-dirs.js` - Directory setup
- `web/build-native.js` - Native binary builder

### Configuration Files
- `mac/VibeTunnel.xcodeproj/project.pbxproj` - Xcode project
- `ios/VibeTunnel.xcodeproj/project.pbxproj` - iOS Xcode project
- `web/eslint.config.js` - ESLint configuration
- `web/vitest.config.ts` - Test configuration

## Configuration

### App Configuration
- `mac/VibeTunnel/Core/Models/AppConstants.swift` - App constants
- `mac/VibeTunnel/Core/Models/UpdateChannel.swift` - Update channels
- `ios/VibeTunnel/Models/ServerConfig.swift` - Server settings

### Assets & Resources
- `assets/AppIcon.icon/` - App icon assets
- `mac/VibeTunnel/Assets.xcassets/` - macOS asset catalog
- `ios/VibeTunnel/Resources/Assets.xcassets/` - iOS asset catalog
- `web/public/` - Web static assets

### Documentation
- `docs/API.md` - API documentation
- `docs/ARCHITECTURE.md` - Architecture overview
- `mac/Documentation/BunServerSupport.md` - Bun server documentation
- `web/src/server/pty/README.md` - PTY implementation notes

## Reference

### File Organization Patterns
- Platform code separated by directory: `mac/`, `ios/`, `web/`
- Swift code follows MVC-like pattern: Models, Views, Services
- TypeScript organized by client/server with feature-based subdirectories
- Build scripts consolidated in platform-specific `scripts/` directories

### Naming Conventions
- Swift files: PascalCase matching class/struct names
- TypeScript files: kebab-case for modules, PascalCase for classes
- Configuration files: lowercase with appropriate extensions
- Scripts: kebab-case shell scripts

### Key Dependencies
- macOS: SwiftUI, Sparkle (updates), Bun runtime
- iOS: SwiftUI, ghostty-web resources, WebSocket client
- Web: Express, ghostty-web, WebSocket, Vite bundler

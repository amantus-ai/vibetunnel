<!-- Generated: 2025-06-21 00:00:00 UTC -->

# ShellOps Files Catalog

## Overview

ShellOps is a cross-platform terminal sharing application organized into distinct platform modules: macOS native app, iOS companion app, and a TypeScript web server. The codebase follows a clear separation of concerns with platform-specific implementations sharing common protocols and interfaces.

The project structure emphasizes modularity with separate build systems for each platform - Xcode projects for Apple platforms and Node.js/TypeScript tooling for the web server. Configuration is managed through xcconfig files, Package.swift manifests, and package.json files.

## Core Source Files

### macOS Application (mac/)

**Main Entry Points**
- `ShellOps/ShellOpsApp.swift` - macOS app entry point with lifecycle management
- `ShellOps/Core/Protocols/ShellOpsServer.swift` - Server protocol definition
- `ShellOps/Core/Services/ServerManager.swift` - Central server orchestration

**Core Services**
- `ShellOps/Core/Services/BunServer.swift` - Bun runtime server implementation
- `ShellOps/Core/Services/BaseProcessServer.swift` - Base server process management
- `ShellOps/Core/Services/TTYForwardManager.swift` - Terminal forwarding coordinator
- `ShellOps/Core/Services/TerminalManager.swift` - Terminal app integration
- `ShellOps/Core/Services/SessionMonitor.swift` - Session lifecycle tracking
- `ShellOps/Core/Services/NgrokService.swift` - Tunnel service integration
- `ShellOps/Core/Services/WindowTracker.swift` - Window state management

**Security & Permissions**
- `ShellOps/Core/Services/DashboardKeychain.swift` - Secure credential storage
- `ShellOps/Core/Services/AccessibilityPermissionManager.swift` - Accessibility permissions
- `ShellOps/Core/Services/ScreenRecordingPermissionManager.swift` - Screen recording permissions
- `ShellOps/Core/Services/AppleScriptPermissionManager.swift` - AppleScript permissions

**UI Components**
- `ShellOps/Presentation/Views/MenuBarView.swift` - Menu bar interface
- `ShellOps/Presentation/Views/WelcomeView.swift` - Onboarding flow
- `ShellOps/Presentation/Views/SettingsView.swift` - Settings window
- `ShellOps/Presentation/Views/SessionDetailView.swift` - Session detail view

### iOS Application (ios/)

**Main Entry Points**
- `ShellOps/App/ShellOpsApp.swift` - iOS app entry point
- `ShellOps/App/ContentView.swift` - Root content view

**Services**
- `ShellOps/Services/APIClient.swift` - HTTP API client
- `ShellOps/Services/BufferWebSocketClient.swift` - WebSocket terminal client
- `ShellOps/Services/SessionService.swift` - Session management
- `ShellOps/Services/NetworkMonitor.swift` - Network connectivity

**Terminal Views**
- `ShellOps/Views/Terminal/TerminalView.swift` - Main terminal view
- `ShellOps/Views/Terminal/GhosttyWebView.swift` - Ghostty terminal renderer
- `ShellOps/Views/Terminal/TerminalBufferRenderer.swift` - Buffer snapshot → ANSI conversion
- `ShellOps/Views/Terminal/TerminalToolbar.swift` - Terminal controls
- `ShellOps/Views/Terminal/CastPlayerView.swift` - Recording playback

**Data Models**
- `ShellOps/Models/Session.swift` - Terminal session model
- `ShellOps/Models/TerminalData.swift` - Terminal buffer data
- `ShellOps/Models/ServerConfig.swift` - Server configuration

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
- `mac/ShellOps/Shared.xcconfig` - Shared build settings
- `mac/ShellOps/version.xcconfig` - Version configuration
- `mac/ShellOps.entitlements` - App entitlements
- `mac/ShellOps-Info.plist` - App metadata

### iOS Platform Files
- `ios/Package.swift` - Swift package manifest
- `ios/project.yml` - XcodeGen configuration
- `ios/ShellOps/Resources/Info.plist` - iOS app metadata

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
- `mac/ShellOps.xcodeproj/project.pbxproj` - Xcode project
- `ios/ShellOps.xcodeproj/project.pbxproj` - iOS Xcode project
- `web/eslint.config.js` - ESLint configuration
- `web/vitest.config.ts` - Test configuration

## Configuration

### App Configuration
- `mac/ShellOps/Core/Models/AppConstants.swift` - App constants
- `mac/ShellOps/Core/Models/UpdateChannel.swift` - Update channels
- `ios/ShellOps/Models/ServerConfig.swift` - Server settings

### Assets & Resources
- `assets/AppIcon.icon/` - App icon assets
- `mac/ShellOps/Assets.xcassets/` - macOS asset catalog
- `ios/ShellOps/Resources/Assets.xcassets/` - iOS asset catalog
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

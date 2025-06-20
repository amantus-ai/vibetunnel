# VibeTunnel Tauri App

A cross-platform system tray application for VibeTunnel, providing the same functionality as the native Mac app.

## Overview

VibeTunnel Tauri is a system tray (menu bar) application that:
- Runs a local HTTP server for terminal session management
- Provides quick access to the web dashboard via browser
- Manages terminal sessions through the embedded server
- Supports auto-launch at login
- Includes ngrok integration for remote access

## Architecture

This is NOT a web application. It's a native system tray app that:
1. Runs in the background with a menu bar/system tray icon
2. Embeds an HTTP server (same as the Mac app)
3. Opens the web dashboard in your default browser
4. No embedded web view or frontend - purely a background service

## Features

- **System Tray Menu**
  - Server status indicator
  - Active session count
  - Quick access to open dashboard
  - Settings window
  - Help menu (Tutorial, Website, Report Issue)
  - Quit option

- **Server Management**
  - Embedded HTTP server on configurable port (default 4020)
  - Automatic server restart on failure
  - Password protection support
  - Network access modes (localhost, network, ngrok)

- **Terminal Session Management**
  - Create and manage terminal sessions
  - Session monitoring and cleanup
  - Terminal output capture

- **Platform Features**
  - Auto-launch at login
  - CLI tool installation (`vt` command)
  - Native settings window
  - System notifications

## Building

### Prerequisites
- Rust 1.70+
- Node.js 18+ (for Tauri CLI only)
- Platform-specific requirements:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`
  - **Windows**: Microsoft C++ Build Tools

### Development
```bash
npm install
npm run tauri:dev
```

### Production Build
```bash
npm run tauri:build
```

## Differences from Mac App

- Uses Tauri instead of native Swift/SwiftUI
- Cross-platform (macOS, Linux, Windows)
- Same core functionality and user experience
- Rust-based server instead of Swift/Go options

## Configuration

Settings are stored in:
- **macOS**: `~/Library/Application Support/com.vibetunnel.app/`
- **Linux**: `~/.config/com.vibetunnel.app/`
- **Windows**: `%APPDATA%\com.vibetunnel.app\`
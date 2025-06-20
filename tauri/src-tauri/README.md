# VibeTunnel Tauri App

This is a cross-platform version of VibeTunnel built with Tauri v2.

## Architecture

The Tauri app provides:
- System tray/menu bar integration
- Native window management
- Cross-platform terminal PTY support (to be implemented)
- Secure IPC between frontend and backend

## Development

### Prerequisites

- Rust 1.70+
- Node.js 18+
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `webkit2gtk-4.1`, `libayatana-appindicator3-dev`
  - **Windows**: WebView2 (usually pre-installed on Windows 10/11)

### Running in Development

1. Start the Node.js server (in the web directory):
   ```bash
   npm run dev
   ```

2. In another terminal, run the Tauri app:
   ```bash
   npm run tauri:dev
   ```

### Building for Production

```bash
npm run tauri:build
```

This will create platform-specific binaries in `src-tauri/target/release/bundle/`.

## Features

- **Menu Bar App**: Runs as a system tray application
- **Web UI**: Uses the existing VibeTunnel web interface
- **Native Integration**: Platform-specific features through Tauri APIs
- **Auto-updater**: Built-in update mechanism
- **Single Instance**: Prevents multiple instances from running

## TODO

1. Implement native PTY support using cross-platform Rust libraries
2. Add platform-specific terminal launching
3. Implement file system access for session recordings
4. Add native notifications
5. Implement keyboard shortcuts
6. Add auto-launch on startup
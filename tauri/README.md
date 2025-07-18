# VibeTunnel Tauri App

> **⚠️ EXPERIMENTAL / WORK IN PROGRESS**: This Tauri implementation is experimental and not recommended for production use. The primary VibeTunnel desktop app is the native macOS application in the `mac/` directory. This Tauri version is being developed for future cross-platform support.

This directory contains the Tauri-based desktop application for VibeTunnel. Tauri is a framework for building smaller, faster, and more secure desktop applications with a web frontend.

## What is Tauri?

Tauri is a toolkit that helps developers make applications for major desktop platforms using virtually any frontend framework. Unlike Electron, Tauri:
- Uses the system's native webview instead of bundling Chromium
- Results in much smaller app sizes (typically 10-100x smaller)
- Has better performance and lower memory usage
- Provides better security through a smaller attack surface

## Architecture

The VibeTunnel Tauri app uses a subprocess architecture similar to the Mac app:

- **Frontend**: HTML/CSS/JavaScript served from the `public/` directory
- **Backend**: Rust code in `src-tauri/` that manages the Node.js subprocess
- **Node.js Server**: The `vibetunnel` executable spawned as a subprocess handles all terminal operations
- **IPC Bridge**: Commands defined in Rust that proxy to the Node.js server API

### Key Changes from Embedded Server
Instead of embedding terminal management in Rust, the Tauri app:
1. Spawns the same `vibetunnel` Node.js executable used by the Mac app
2. Proxies terminal commands to the Node.js server via HTTP API
3. Monitors the subprocess health and handles crashes
4. Bundles the Node.js executable and its dependencies as resources

## Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18 or later)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `webkit2gtk`, `libgtk-3-dev`, `libappindicator3-dev`
  - **Windows**: WebView2 (comes with Windows 11/10)
- Tauri: `cargo install tauri-cli`

## Getting Started

### Installation

1. Clone the repository and navigate to the Tauri directory:
```bash
cd /path/to/vibetunnel3/tauri
```

2. Install dependencies:
```bash
npm install
```

### Development

To run the app in development mode with hot-reloading:
```bash
./dev.sh
# or manually:
cd ../web && npm run build  # Build vibetunnel executable first
cd ../tauri && npm run tauri dev
```

This will:
- Build the Node.js server executable
- Start the Rust backend with file watching
- Spawn the Node.js subprocess
- Serve the frontend with hot-reloading
- Open the app window automatically
- Show debug output in the terminal

### Building

To build the app for production:
```bash
./build.sh
# or manually:
cd ../web && npm run build  # Build vibetunnel executable first
cd ../tauri && npm run tauri build
```

This creates an optimized build in `src-tauri/target/release/bundle/`:
- **macOS**: `.app` bundle and `.dmg` installer
- **Linux**: `.deb` and `.AppImage` packages
- **Windows**: `.msi` and `.exe` installers

The build includes:
- The `vibetunnel` Node.js executable
- Native modules (`pty.node`, `spawn-helper`)
- Web static assets from `web/public/`

## Project Structure

```
tauri/
├── public/                 # Frontend files (HTML, CSS, JS)
│   ├── index.html         # Main app window
│   ├── settings.html      # Settings window
│   └── welcome.html       # Welcome/onboarding window
├── src-tauri/             # Rust backend
│   ├── src/               # Rust source code
│   │   ├── main.rs        # App entry point
│   │   ├── commands.rs    # Tauri commands (IPC)
│   │   ├── backend_manager.rs # Node.js subprocess management
│   │   ├── api_client.rs  # HTTP client for Node.js API
│   │   └── ...            # Other modules
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri configuration
├── build.sh               # Production build script
├── dev.sh                 # Development run script
├── package.json           # Node.js dependencies
└── README.md             # This file
```

## Key Features

The Tauri app provides:
- **Native Terminal Integration**: Spawn and manage terminal sessions
- **System Tray Support**: Menu bar icon with quick actions
- **Multi-Window Management**: Main, settings, and welcome windows
- **Secure IPC**: Commands for frontend-backend communication
- **Platform Integration**: Native menus, notifications, and file dialogs
- **Single Instance**: Prevents multiple app instances
- **Auto-Updates**: Built-in update mechanism

## Development Tips

### Adding New Commands

To add a new command that the frontend can call:

1. Define the command in `src-tauri/src/commands.rs`:
```rust
#[tauri::command]
async fn my_command(param: String) -> Result<String, String> {
    Ok(format!("Hello, {}!", param))
}
```

2. Register it in `src-tauri/src/main.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    my_command,
])
```

3. Call it from the frontend:
```javascript
const { invoke } = window.__TAURI__.tauri;
const result = await invoke('my_command', { param: 'World' });
```

### Debugging

- **Frontend**: Use browser DevTools (right-click → Inspect in dev mode)
- **Backend**: Check terminal output or use `println!` debugging
- **IPC Issues**: Enable Tauri logging with `RUST_LOG=debug npm run tauri dev`

### Hot Keys

While in development mode:
- `Cmd+R` / `Ctrl+R`: Reload the frontend
- `Cmd+Q` / `Ctrl+Q`: Quit the app

## Configuration

The main configuration file is `src-tauri/tauri.conf.json`, which controls:
- App metadata (name, version, identifier)
- Window settings (size, position, decorations)
- Build settings (icons, resources)
- Security policies

## Troubleshooting

### Common Issues

1. **Build fails with "cannot find crate"**
   - Run `cd src-tauri && cargo update`

2. **App doesn't start in dev mode**
   - Check that port 1420 is available
   - Try `npm run tauri dev -- --port 3000`

3. **Permission errors on macOS**
   - Grant necessary permissions in System Preferences
   - The app will prompt for required permissions on first launch

### Logs

- Development logs appear in the terminal
- Production logs on macOS: `~/Library/Logs/VibeTunnel/`

## Contributing

When contributing to the Tauri app:
1. Follow the existing code style
2. Test on all target platforms if possible
3. Update this README if adding new features
4. Run `cargo fmt` in `src-tauri/` before committing

## Resources

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [Tauri API Reference](https://tauri.app/v1/api/js/)
- [Rust Documentation](https://doc.rust-lang.org/book/)
- [VibeTunnel Documentation](https://vibetunnel.sh)

## License

See the main project LICENSE file.
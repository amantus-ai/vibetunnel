# VibeTunnel Tauri App

This directory contains the Tauri-based desktop application for VibeTunnel. Tauri is a framework for building smaller, faster, and more secure desktop applications with a web frontend.

## What is Tauri?

Tauri is a toolkit that helps developers make applications for major desktop platforms using virtually any frontend framework. Unlike Electron, Tauri:
- Uses the system's native webview instead of bundling Chromium
- Results in much smaller app sizes (typically 10-100x smaller)
- Has better performance and lower memory usage
- Provides better security through a smaller attack surface

## Architecture

The VibeTunnel Tauri app consists of:
- **Frontend**: HTML/CSS/JavaScript served from the `public/` directory
- **Backend**: Rust code in `src-tauri/` that handles system operations, terminal management, and server functionality
- **IPC Bridge**: Commands defined in Rust that can be called from the frontend

## Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18 or later)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `webkit2gtk`, `libgtk-3-dev`, `libappindicator3-dev`
  - **Windows**: WebView2 (comes with Windows 11/10)

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
npm run tauri dev
```

This will:
- Start the Rust backend with file watching
- Serve the frontend with hot-reloading
- Open the app window automatically
- Show debug output in the terminal

### Building

To build the app for production:
```bash
npm run tauri build
```

This creates an optimized build in `src-tauri/target/release/bundle/`:
- **macOS**: `.app` bundle and `.dmg` installer
- **Linux**: `.deb` and `.AppImage` packages
- **Windows**: `.msi` and `.exe` installers

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
│   │   ├── terminal.rs    # Terminal management
│   │   └── ...            # Other modules
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri configuration
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
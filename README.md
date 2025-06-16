# VibeTunnel

VibeTunnel is a Mac app that proxies terminal apps to the web. Now you can use Claude Code anywhere, anytime. Control open instances, read the output, type new commands or even open new instances. Supports macOS 14+.

## Overview

VibeTunnel is a native macOS app built with SwiftUI that enables remote control of terminal applications like Claude Code. It provides a seamless tunneling solution with automatic updates, configurable settings, and the ability to run as either a dock application or menu bar utility.

## Features

- **Remote Terminal Control**: Tunnel connections to control Claude Code and other terminal apps remotely
- **Flexible UI Modes**: Run as a standard dock application or minimal menu bar utility
- **Auto Updates**: Built-in Sparkle integration for seamless updates with stable and pre-release channels
- **Launch at Login**: Automatic startup configuration
- **Native macOS Experience**: Built with SwiftUI for macOS 14.0+

## Requirements

- macOS 14.0 or later
- Xcode 15.0 or later (for development)

## Installation

### From Release
1. Download the latest DMG from the [Releases](https://github.com/amantus-ai/vibetunnel/releases) page
2. Open the DMG and drag VibeTunnel to your Applications folder
3. Launch VibeTunnel from Applications or Spotlight

### From Source
```bash
# Clone the repository
git clone https://github.com/amantus-ai/vibetunnel.git
cd vibetunnel

# Build using Xcode
open VibeTunnel.xcodeproj
# Or build from command line
xcodebuild -scheme VibeTunnel -configuration Release
```

## Configuration

VibeTunnel can be configured through its Settings window (⌘,):

### General Settings
- **Launch at Login**: Start VibeTunnel automatically when you log in
- **Show Notifications**: Enable/disable system notifications
- **Show in Dock**: Toggle between dock app and menu bar only mode

### Advanced Settings
- **Update Channel**: Choose between stable releases or pre-release builds
- **Server Port**: Configure the tunnel server port (default: 8080)
- **Debug Mode**: Enable additional logging for troubleshooting

## Development

### Project Structure
```
VibeTunnel/
├── VibeTunnel/              # Main app source
│   ├── Core/                # Core functionality
│   │   ├── Models/          # Data models
│   │   └── Services/        # Business logic
│   ├── Views/               # SwiftUI views
│   └── Resources/           # Assets and resources
├── VibeTunnelTests/         # Unit tests
├── VibeTunnelUITests/       # UI tests
├── scripts/                 # Build and release automation
└── docs/                    # Documentation
```

### Code Signing Setup

This project uses xcconfig files to manage developer-specific settings, preventing code signing conflicts when multiple developers work on the project.

**For new developers:**
1. Copy the template: `cp VibeTunnel/Local.xcconfig.template VibeTunnel/Local.xcconfig`
2. Edit `VibeTunnel/Local.xcconfig` and add your development team ID
3. Open the project in Xcode - it will use your settings automatically

See [docs/CODE_SIGNING_SETUP.md](docs/CODE_SIGNING_SETUP.md) for detailed instructions.

### Building

The project uses standard Xcode build system:

```bash
# Debug build
xcodebuild -scheme VibeTunnel -configuration Debug

# Release build
xcodebuild -scheme VibeTunnel -configuration Release

# Run tests
xcodebuild test -scheme VibeTunnel
```

### Release Process

The project includes comprehensive release automation scripts in the `scripts/` directory:

```bash
# Create a new release
./scripts/release.sh --version 1.2.3

# Build and notarize
./scripts/build.sh
./scripts/notarize.sh

# Generate appcast for Sparkle updates
./scripts/generate-appcast.sh
```

## Architecture

VibeTunnel is built with a modular architecture:

- **SparkleUpdaterManager**: Handles automatic updates with support for multiple update channels
- **StartupManager**: Manages launch at login functionality using macOS ServiceManagement
- **UpdateChannel**: Defines update channels and appcast URLs
- **AppDelegate**: Coordinates app lifecycle and system integration

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Created by Peter Steinberger / Amantus Machina

---

**Note**: VibeTunnel is currently in active development. Core tunneling functionality is being implemented.

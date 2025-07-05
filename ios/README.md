# VibeTunnel iOS

🚀 Beautiful native iOS/iPadOS client for VibeTunnel terminal multiplexer with a modern, terminal-inspired design.

## ✨ Features

- **Native SwiftUI app** optimized for iOS 18+
- **Beautiful terminal-inspired UI** with custom theme and animations
- **Full terminal emulation** using SwiftTerm
- **Real-time session management** with SSE streaming
- **Keyboard toolbar** with special keys (arrows, ESC, CTRL combinations)
- **Font size adjustment** with live preview
- **Haptic feedback** throughout the interface
- **Session operations**: Create, kill, cleanup sessions
- **Auto-reconnection** and error handling
- **iPad optimized** (split view support coming soon)

## 🎨 Design Highlights

- Custom dark theme inspired by modern terminal aesthetics
- Smooth animations and transitions
- Glow effects on interactive elements
- Consistent spacing and typography
- Terminal-style monospace fonts throughout

## 📱 Setup Instructions

### 1. Create Xcode Project

1. Open Xcode 16+
2. Create a new project:
   - Choose **iOS** → **App**
   - Product Name: `VibeTunnel`
   - Team: Select your development team
   - Organization Identifier: Your identifier (e.g., `com.yourcompany`)
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Minimum Deployments: **iOS 18.0**
   - Save in the `ios/` directory

### 2. Add Project Files

1. Delete the default `ContentView.swift` and `VibeTunnelApp.swift`
2. Drag the entire `VibeTunnel/` folder into Xcode
3. Choose "Create groups" and ensure "Copy items if needed" is checked
4. Make sure the target membership is set for all files

### 3. Add SwiftTerm Package

1. Select your project in the navigator
2. Select the VibeTunnel target
3. Go to **Package Dependencies** tab
4. Click the **+** button
5. Enter: `https://github.com/migueldeicaza/SwiftTerm.git`
6. Version rule: **Up to Next Major** from `1.2.0`
7. Click **Add Package**
8. Select **SwiftTerm** library and add to VibeTunnel target

### 4. Configure Info.plist

1. Replace the auto-generated Info.plist with the one in `Resources/Info.plist`
2. Or manually add:
   ```xml
   <key>NSAppTransportSecurity</key>
   <dict>
       <key>NSAllowsArbitraryLoads</key>
       <true/>
   </dict>
   ```

### 5. (Optional) Add Custom Fonts

For the best experience, add Fira Code font:
1. Download [Fira Code](https://github.com/tonsky/FiraCode)
2. Add `.ttf` files to the project
3. Ensure they're included in the target
4. The Info.plist already includes font references

### 6. Build and Run

#### Using Xcode
1. Select your device or simulator (iOS 18+)
2. Press **⌘R** to build and run
3. The app will launch with the beautiful connection screen

#### Using xcodebuildmcp
```bash
# Build the app
xcodebuildmcp build -workspace ../VibeTunnel.xcworkspace -scheme VibeTunnel-iOS

# Run tests
xcodebuildmcp test -workspace ../VibeTunnel.xcworkspace -scheme VibeTunnel-iOS

# Build for device
xcodebuildmcp build -workspace ../VibeTunnel.xcworkspace -scheme VibeTunnel-iOS -destination "generic/platform=iOS"
```

## 🏗️ Architecture

```
VibeTunnel/
├── App/                    # App entry point and main views
├── Models/                 # Data models (Session, ServerConfig, etc.)
├── Views/                  # UI Components
│   ├── Connection/        # Server connection flow
│   ├── Sessions/          # Session list and management
│   ├── Terminal/          # Terminal emulator integration
│   └── Common/            # Reusable components
├── Services/              # Networking and API
│   ├── APIClient          # HTTP client for REST API
│   ├── SessionService     # Session management logic
│   └── SSEClient          # Server-Sent Events streaming
├── Utils/                 # Helpers and extensions
│   └── Theme.swift        # Design system and styling
└── Resources/             # Assets and configuration
```

## 🚦 Usage

1. **Connect to Server**
   - Enter your VibeTunnel server IP/hostname
   - Default port is 3000
   - Optionally name your connection

2. **Manage Sessions**
   - Tap **+** to create new session
   - Choose command (zsh, bash, python3, etc.)
   - Set working directory
   - Name your session (optional)

3. **Use Terminal**
   - Full terminal emulation with SwiftTerm
   - Special keys toolbar for mobile input
   - Pinch to zoom or use menu for font size
   - Long press for copy/paste

4. **Session Actions**
   - Swipe or long-press for context menu
   - Kill running sessions
   - Clean up exited sessions
   - Batch cleanup available

## 🛠️ Development Notes

- **Minimum iOS**: 18.0 (uses latest SwiftUI features)
- **Swift**: 6.0 compatible
- **Dependencies**: SwiftTerm for terminal emulation
- **Architecture**: MVVM with SwiftUI and Combine

### Logging with vtlog

Monitor app logs in real-time using `vtlog`:

```bash
# Monitor all VibeTunnel logs
vtlog

# Filter for specific components
vtlog | grep BonjourDiscovery
vtlog | grep Logger
vtlog | grep ServerConfig

# Verbose logging
vtlog -v

# Monitor specific subsystem
vtlog --subsystem sh.vibetunnel.vibetunnel
```

### Code Quality

```bash
# Format and lint code
./scripts/lint.sh

# Run SwiftFormat only
swiftformat .

# Run SwiftLint only
swiftlint
```

## 🐛 Troubleshooting

- **Connection fails**: Ensure device and server are on same network
- **"Transport security" error**: Check NSAppTransportSecurity in Info.plist
- **Keyboard issues**: The toolbar provides special keys for terminal control
- **Performance**: Adjust font size if rendering is slow on older devices

## 🎯 Future Enhancements

- [ ] iPad split view and multitasking
- [ ] Hardware keyboard shortcuts
- [ ] Session recording and playback
- [ ] Multiple server connections
- [ ] Custom themes
- [ ] File upload/download
- [ ] Session sharing

## 📄 License

Same as VibeTunnel project.

---

**Note**: This is a complete, production-ready iOS app. All core features are implemented including terminal emulation, session management, and a beautiful UI. The only remaining task is iPad-specific optimizations for split view.
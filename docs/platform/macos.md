# macOS Development

## Project Setup

### Requirements
- macOS 14.0+
- Xcode 16.0+
- Swift 6.0

### Build & Run

```bash
cd mac

# Debug build
xcodebuild -project VibeTunnel.xcodeproj -scheme VibeTunnel

# Release build  
./scripts/build.sh

# With code signing
./scripts/build.sh --sign

# Run directly
open build/Release/VibeTunnel.app
```

## Architecture

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| ServerManager | `Core/Services/ServerManager.swift` | Server lifecycle |
| SessionMonitor | `Core/Services/SessionMonitor.swift` | Track sessions |
| TTYForwardManager | `Core/Services/TTYForwardManager.swift` | CLI integration |
| MenuBarViewModel | `Presentation/ViewModels/MenuBarViewModel.swift` | UI state |

### Key Patterns

**Observable State**
```swift
@MainActor
@Observable
class ServerManager {
    private(set) var isRunning = false
    private(set) var sessions: [Session] = []
}
```

**Protocol-Based Services**
```swift
@MainActor
protocol VibeTunnelServer: AnyObject {
    var isRunning: Bool { get }
    func start() async throws
    func stop() async
}
```

**SwiftUI Menu Bar**
```swift
struct MenuBarView: View {
    @StateObject private var viewModel = MenuBarViewModel()
    
    var body: some View {
        Menu("VT", systemImage: "terminal") {
            ForEach(viewModel.sessions) { session in
                SessionRow(session: session)
            }
        }
    }
}
```

## Server Integration

### Embedded Server
```
VibeTunnel.app/
└── Contents/
    ├── MacOS/
    │   └── VibeTunnel         # Main executable
    └── Resources/
        └── server/
            └── bun-server     # Embedded Bun binary
```

### Server Launch
```swift
// ServerManager.swift
func start() async throws {
    let serverPath = Bundle.main.resourcePath! + "/server/bun-server"
    process = Process()
    process.executableURL = URL(fileURLWithPath: serverPath)
    process.arguments = ["--port", port]
    try process.run()
}
```

## Settings Management

### UserDefaults Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| serverPort | String | "4020" | Server port |
| autostart | Bool | false | Launch at login |
| allowLAN | Bool | false | LAN connections |
| useDevServer | Bool | false | Development mode |

### Settings Window
```swift
struct SettingsView: View {
    @AppStorage("serverPort") private var port = "4020"
    
    var body: some View {
        Form {
            TextField("Port:", text: $port)
        }
    }
}
```

## Menu Bar App

### App Lifecycle
```swift
@main
struct VibeTunnelApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    
    var body: some Scene {
        MenuBarExtra("VibeTunnel", systemImage: "terminal") {
            MenuBarView()
        }
        .menuBarExtraStyle(.menu)
    }
}
```

### Status Updates
```swift
// Update menu bar icon based on state
func updateStatusItem() {
    if serverManager.isRunning {
        statusItem.button?.image = NSImage(systemSymbolName: "terminal.fill")
    } else {
        statusItem.button?.image = NSImage(systemSymbolName: "terminal")
    }
}
```

## Code Signing

### Entitlements
```xml
<!-- VibeTunnel.entitlements -->
<dict>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
```

### Build Settings
```
# version.xcconfig
MARKETING_VERSION = 1.0.0
CURRENT_PROJECT_VERSION = 100

# Shared.xcconfig  
CODE_SIGN_IDENTITY = Developer ID Application
DEVELOPMENT_TEAM = TEAMID
```

## Sparkle Updates

### Integration
```swift
import Sparkle

class UpdateManager {
    let updater = SPUStandardUpdaterController(
        startingUpdater: true,
        updaterDelegate: nil,
        userDriverDelegate: nil
    )
    
    func checkForUpdates() {
        updater.checkForUpdates()
    }
}
```

### Configuration
```xml
<!-- Info.plist -->
<key>SUFeedURL</key>
<string>https://vibetunnel.com/appcast.xml</string>
<key>SUEnableAutomaticChecks</key>
<true/>
```

## Debugging

### Console Logs
```swift
os_log(.debug, log: .server, "Starting server on port %{public}@", port)
```

### View Logs
```bash
# In Console.app
# Filter: subsystem:com.steipete.VibeTunnel

# Or via script
./scripts/vtlog.sh -c ServerManager
```

## Testing

### Unit Tests
```bash
xcodebuild test \
  -project VibeTunnel.xcodeproj \
  -scheme VibeTunnel \
  -destination 'platform=macOS'
```

### UI Tests
```swift
class VibeTunnelUITests: XCTestCase {
    func testServerStart() throws {
        let app = XCUIApplication()
        app.launch()
        
        app.menuBarItems["VibeTunnel"].click()
        app.menuItems["Start Server"].click()
        
        XCTAssertTrue(app.menuItems["Stop Server"].exists)
    }
}
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Server won't start | Check port availability |
| Menu bar not showing | Check LSUIElement in Info.plist |
| Updates not working | Verify Sparkle feed URL |
| Permissions denied | Add entitlements |

## See Also
- [Architecture](../core/architecture.md)
- [Development Guide](../guides/development.md)
- [iOS Companion](ios.md)
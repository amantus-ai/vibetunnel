# VibeTunnel iOS/iPadOS Native App Specification

## Overview

VibeTunnel iOS is a native SwiftUI application that provides a beautiful, native interface to the VibeTunnel terminal multiplexer backend. The app allows users to create, manage, and interact with terminal sessions on their Mac from their iOS/iPadOS devices.

## Target Platform

- **iOS/iPadOS**: 18.0+
- **Universal App**: Single app that adapts to iPhone and iPad
- **SwiftUI**: Modern declarative UI framework
- **Terminal Engine**: SwiftTerm (https://github.com/migueldeicaza/SwiftTerm)

## Core Features

### 1. Connection Management
- **Initial Setup Dialog**:
  - Server URL/IP input field
  - Port configuration (default: 3000)
  - Connection testing with status feedback
  - Saved connections list (stored in UserDefaults/KeyChain)
  - Auto-reconnection on app launch

### 2. Session Management
- **Session List View**:
  - Display all active and exited sessions
  - Real-time status updates (auto-refresh every 3 seconds)
  - Session cards showing:
    - Session name/command
    - Working directory
    - Status (running/exited)
    - PID (if running)
    - Exit code (if exited)
    - Started time
    - Last modified time
  - Pull-to-refresh functionality
  - Search/filter capabilities

- **Session Actions**:
  - Create new session
  - Kill running session
  - Clean up exited session files
  - Clean up all exited sessions
  - Tap to view terminal

### 3. Terminal View
- **SwiftTerm Integration**:
  - Full terminal emulation using SwiftTerm
  - Support for ANSI escape sequences
  - 256-color and true color support
  - VS Code dark theme colors
  - Font: SF Mono or custom monospace fonts
  - Adjustable font size

- **Input/Output**:
  - Native iOS keyboard integration
  - Special keys toolbar (arrows, escape, tab, ctrl)
  - Copy/paste support
  - URL detection and tap-to-open
  - Smooth scrolling with momentum
  - Pinch-to-zoom font sizing

- **Real-time Updates**:
  - Server-Sent Events (SSE) for terminal output streaming
  - Efficient buffer management
  - Auto-scroll to bottom on new output
  - Scroll position indicator

### 4. Session Creation
- **New Session Form**:
  - Command input (default: zsh)
  - Working directory picker
  - Session name (optional)
  - Terminal dimensions (auto-calculated based on device)
  - Recent commands/directories

### 5. iPad-Specific Features
- **Split View Support**:
  - Session list in sidebar
  - Terminal in main view
  - Multiple terminal tabs
  - Drag and drop support

- **Keyboard Support**:
  - Hardware keyboard shortcuts
  - Command+T for new session
  - Command+W to close session
  - Command+K to clear terminal

- **Multitasking**:
  - Slide Over support
  - Split View with other apps
  - Stage Manager compatibility

## Technical Architecture

### 1. Project Structure
```
ios/
├── VibeTunnel/
│   ├── App/
│   │   ├── VibeTunnelApp.swift
│   │   └── ContentView.swift
│   ├── Models/
│   │   ├── Session.swift
│   │   ├── ServerConfig.swift
│   │   └── TerminalData.swift
│   ├── Views/
│   │   ├── Connection/
│   │   │   ├── ConnectionView.swift
│   │   │   └── ServerConfigForm.swift
│   │   ├── Sessions/
│   │   │   ├── SessionListView.swift
│   │   │   ├── SessionCardView.swift
│   │   │   └── SessionCreateView.swift
│   │   ├── Terminal/
│   │   │   ├── TerminalView.swift
│   │   │   ├── TerminalHostingView.swift
│   │   │   └── TerminalToolbar.swift
│   │   └── Common/
│   │       ├── LoadingView.swift
│   │       └── ErrorView.swift
│   ├── Services/
│   │   ├── APIClient.swift
│   │   ├── SessionService.swift
│   │   ├── TerminalService.swift
│   │   └── SSEClient.swift
│   ├── Utils/
│   │   ├── KeychainHelper.swift
│   │   ├── ColorTheme.swift
│   │   └── Extensions/
│   └── Resources/
│       ├── Assets.xcassets
│       └── Info.plist
└── VibeTunnel.xcodeproj
```

### 2. Data Models

```swift
// Session Model
struct Session: Codable, Identifiable {
    let id: String
    let command: String
    let workingDir: String
    let name: String?
    let status: SessionStatus
    let exitCode: Int?
    let startedAt: Date
    let lastModified: Date
    let pid: Int?
    let waiting: Bool?
    let width: Int?
    let height: Int?
}

enum SessionStatus: String, Codable {
    case running
    case exited
}

// Server Configuration
struct ServerConfig: Codable {
    let host: String
    let port: Int
    let name: String?
    
    var baseURL: URL {
        URL(string: "http://\(host):\(port)")!
    }
}

// Terminal Event
struct TerminalEvent {
    let timestamp: Double
    let type: EventType
    let data: String
    
    enum EventType: String {
        case output = "o"
        case input = "i"
        case resize = "r"
        case marker = "m"
    }
}
```

### 3. API Integration

```swift
// API Client Protocol
protocol APIClientProtocol {
    func getSessions() async throws -> [Session]
    func createSession(_ data: SessionCreateData) async throws -> String
    func killSession(_ sessionId: String) async throws
    func cleanupSession(_ sessionId: String) async throws
    func cleanupAllExitedSessions() async throws -> [String]
    func sendInput(sessionId: String, text: String) async throws
    func resizeTerminal(sessionId: String, cols: Int, rows: Int) async throws
}

// SSE Client for Terminal Streaming
class SSEClient: NSObject {
    func connect(to url: URL) -> AsyncStream<TerminalEvent>
    func disconnect()
}
```

### 4. SwiftTerm Integration

```swift
// Terminal View Controller
class TerminalViewController: UIViewController {
    private let terminal: TerminalView // SwiftTerm
    private let sessionId: String
    private let sseClient: SSEClient
    
    // Configure terminal with VS Code theme
    // Handle input/output
    // Manage resize events
    // Stream terminal data via SSE
}
```

### 5. State Management
- Use SwiftUI's `@StateObject` and `@ObservedObject` for view models
- Combine framework for reactive updates
- AsyncStream for SSE handling
- UserDefaults for connection preferences
- Keychain for secure credential storage

## UI/UX Design

### 1. Design System
- **Colors**: Match VS Code dark theme
  - Background: #1e1e1e
  - Foreground: #d4d4d4
  - Accent: System blue
  - Success: System green
  - Error: System red

- **Typography**:
  - System fonts for UI
  - SF Mono for terminal
  - Dynamic Type support

- **Components**:
  - Native SwiftUI components
  - Consistent padding and spacing
  - Smooth animations and transitions

### 2. Navigation Flow
```
ConnectionView (if not connected)
    ↓
SessionListView (main screen)
    ├→ SessionCreateView (modal)
    └→ TerminalView (push/detail)
         └→ TerminalToolbar (overlay)
```

### 3. Responsive Design
- Adaptive layouts for different device sizes
- Compact/Regular size class handling
- Landscape optimization
- Dynamic terminal sizing

## Implementation Phases

### Phase 1: Foundation (Tasks 2-4)
- Set up Xcode project with SwiftUI
- Create basic navigation structure
- Implement connection dialog
- Build data models and API client
- Store server configuration

### Phase 2: Session Management (Task 5, 8)
- Session list view with real-time updates
- Session card components
- Create new session form
- Kill and cleanup actions
- Pull-to-refresh

### Phase 3: Terminal Integration (Tasks 6-7, 9)
- Integrate SwiftTerm library
- Terminal view wrapper
- SSE streaming client
- Input handling
- Resize support

### Phase 4: Polish & iPad (Task 10)
- iPad-specific layouts
- Keyboard shortcuts
- Settings view
- Connection management
- Performance optimization

## Testing Strategy

### Unit Tests
- API client methods
- Data model parsing
- Session state management
- URL construction

### UI Tests
- Connection flow
- Session creation
- Terminal interaction
- Error handling

### Integration Tests
- End-to-end session lifecycle
- SSE streaming reliability
- Terminal command execution

## Security Considerations

- Use HTTPS when possible (with option for HTTP in local network)
- Store credentials in Keychain
- Validate server certificates
- Sanitize terminal output
- Handle authentication if backend requires it

## Performance Optimization

- Lazy loading of session list
- Efficient terminal buffer management
- Debounced resize events
- Background session updates
- Memory-efficient SSE streaming

## Future Enhancements

1. **Multiple Connections**: Support multiple VibeTunnel servers
2. **Session Sharing**: Share terminal sessions with others
3. **Recording**: Record and playback terminal sessions
4. **Themes**: Additional color themes beyond VS Code
5. **Shortcuts**: Customizable keyboard shortcuts
6. **File Transfer**: Upload/download files through the app
7. **Notifications**: Background notifications for session events

## Dependencies

- **SwiftTerm**: Terminal emulator engine
- **Alamofire** (optional): For networking (or use URLSession)
- **KeychainSwift**: Secure credential storage

## App Store Considerations

- Ensure compliance with App Store guidelines
- Proper error handling and user feedback
- Privacy policy for network usage
- Export compliance for encryption

## Conclusion

This specification outlines a comprehensive native iOS/iPadOS client for VibeTunnel that leverages SwiftUI and SwiftTerm to provide a superior terminal experience compared to the web interface. The app will be fast, responsive, and take full advantage of native iOS features while maintaining feature parity with the web frontend.
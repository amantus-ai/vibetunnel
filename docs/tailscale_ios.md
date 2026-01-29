# ShellOps Architecture Deep Dive

## 🏗️ High-Level Architecture

ShellOps is a sophisticated terminal multiplexer ecosystem with native macOS/iOS apps and a powerful web interface. Here's the complete architectural breakdown:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACES                                │
├─────────────────┬──────────────────────┬─────────────────────────────────┤
│   macOS Menu    │   iOS App            │    Web Browser                  │
│   Bar App        │   (SwiftUI)          │    (TypeScript/LitElement)     │
│                 │                       │                                 │
│  ┌───────────┐  │  ┌──────────────┐   │  ┌──────────────────────────┐   │
│  │ServerMgr │  │  │SessionService│   │  │  xterm.js Terminal       │   │
│  │TTYFwd    │  │  │BufferWS      │   │  │  Session Management UI   │   │
│  │Monitor   │  │  │APIClient     │   │  │  File Browser           │   │
│  └─────┬─────┘  │  └──────┬───────┘   │  └──────────┬───────────────┘   │
└────────┼────────┴─────────┼───────────┴─────────────┼─────────────────┘
         │                  │                          │
         │ Spawns &         │ REST/WS                 │ HTTP/WS
         │ Manages          │                          │
         ▼                  └──────────┬───────────────┘
┌─────────────────────────────────────▼──────────────────────────────────┐
│                    NODE.JS/BUN SERVER (Port 4020)                       │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     EXPRESS APP + MIDDLEWARE                      │  │
│  │  Auth (JWT/SSH) │ CORS │ Compression │ Static Files │ Logging   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐   │
│  │  PTY Manager    │  │ Terminal Manager │  │ Buffer Aggregator  │   │
│  │  - Spawn PTY    │  │ - Session Logic   │  │ - Binary Protocol  │   │
│  │  - Process I/O  │  │ - Lifecycle Mgmt  │  │ - Snapshot/Delta   │   │
│  └─────────────────┘  └──────────────────┘  └────────────────────┘   │
│                                                                         │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐   │
│  │ Session Monitor │  │  Stream Watcher  │  │ Activity Monitor   │   │
│  │ - Cleanup       │  │  - Log Tailing   │  │ - Idle Detection   │   │
│  │ - Zombie detect │  │  - File Watch    │  │ - Resource Track   │   │
│  └─────────────────┘  └──────────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                         System Resources
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          SYSTEM LAYER                                   │
│  ┌──────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │ PTY Processes│  │ File System     │  │ Unix Sockets           │   │
│  │ (bash/zsh)   │  │ (~/.shellops) │  │ (IPC Communication)    │   │
│  └──────────────┘  └─────────────────┘  └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## 🎯 Core Components Breakdown

### 1. **macOS Application (Swift/SwiftUI)**

The native macOS app serves as the system orchestrator:

```
mac/ShellOps/
├── Core/
│   ├── Services/
│   │   ├── ServerManager.swift      # Central orchestrator
│   │   ├── BunServer.swift          # Bun runtime integration
│   │   ├── SessionMonitor.swift     # Session tracking
│   │   ├── TTYForwardManager.swift  # Terminal forwarding
│   │   ├── UnixSocketConnection.swift # IPC communication
│   │   └── TailscaleServeService.swift # Remote access
│   ├── Models/
│   │   ├── TunnelSession.swift      # Session data model
│   │   └── AppConstants.swift       # Configuration
│   └── Protocols/
│       └── ShellOpsServer.swift   # Server interface
└── Presentation/
    ├── Views/                       # SwiftUI views
    └── Components/                  # UI components
```

**Key Responsibilities:**
- **Process Management**: Spawns and monitors the Bun/Node.js server
- **Log Aggregation**: Captures all logs from server and frontend
- **System Integration**: Menu bar UI, notifications, keychain
- **Remote Access**: Tailscale/Ngrok tunnel management

### 2. **Web Server (Node.js/Bun)**

The TypeScript server handles all terminal operations:

```
web/src/server/
├── server.ts                 # Main server entry (912 lines)
├── pty/
│   ├── pty-manager.ts       # Native PTY management
│   ├── session-manager.ts   # Session lifecycle
│   └── types.ts            # TypeScript definitions
├── services/
│   ├── terminal-manager.ts  # High-level terminal ops
│   ├── buffer-aggregator.ts # Binary buffer protocol
│   ├── auth-service.ts     # SSH key authentication
│   ├── activity-monitor.ts # Resource tracking
│   └── hq-client.ts        # Multi-server mode
├── routes/
│   ├── sessions.ts         # Session REST API
│   ├── websocket-input.ts  # WebSocket handlers
│   ├── auth.ts            # Authentication endpoints
│   └── control.ts         # Unix socket control
└── middleware/
    └── auth.ts            # JWT validation
```

**Key Features:**
- **Session Management**: Full PTY lifecycle (create/resize/kill)
- **Binary Buffer Protocol**: Optimized terminal streaming
- **Authentication**: JWT + SSH keys + PAM
- **Distributed Mode**: HQ server for multi-machine setups

### 3. **iOS Application (Swift/SwiftUI)**

Mobile terminal client with full feature parity:

```
ios/ShellOps/
├── Services/
│   ├── BufferWebSocketClient.swift  # Binary protocol client
│   ├── SessionService.swift         # Session management
│   ├── ConnectionManager.swift      # Server connections
│   └── BonjourDiscoveryService.swift # Local discovery
├── Views/
│   ├── Terminal/
│   │   ├── TerminalView.swift      # Main terminal UI
│   │   ├── XtermWebView.swift      # xterm.js wrapper
│   │   └── TerminalHostingView.swift # UIKit bridge
│   └── Sessions/
│       └── SessionListView.swift    # Session browser
└── Models/
    ├── TerminalSnapshot.swift       # Buffer state
    └── Session.swift                # Session model
```

### 4. **Web Frontend (TypeScript/LitElement)**

Browser-based terminal interface:

```
web/src/client/
├── app.ts                   # Main LitElement app
├── components/
│   ├── terminal.ts         # xterm.js wrapper
│   ├── session-list.ts     # Session management
│   └── file-browser.ts     # File navigation
└── services/
    ├── websocket.ts        # WebSocket client
    └── api-client.ts       # REST client
```

## 📡 Communication Protocols

### **1. Binary Buffer Protocol (0xBF Magic Byte)**

Optimized terminal streaming protocol:

```typescript
// Message Format
[Magic Byte: 0xBF] [Type: 1 byte] [Length: 4 bytes] [Payload: N bytes]

// Types:
0x01: Full buffer snapshot
0x02: Delta update
0x03: Cursor position
0x04: Terminal resize
```

**Flow:**
```
Terminal Output → BufferAggregator → Binary Encode → WebSocket → Client Decode → xterm.js
```

### **2. REST API Endpoints**

```
POST   /api/sessions              # Create session
GET    /api/sessions              # List sessions
DELETE /api/sessions/:id          # Kill session
POST   /api/sessions/:id/resize   # Resize terminal
WS     /api/sessions/:id/ws       # Terminal I/O stream
GET    /api/auth/challenge        # SSH key challenge
POST   /api/auth/ssh-key          # SSH key verify
```

### **3. Unix Socket IPC**

Mac app ↔ Server communication:

```swift
// Control Protocol
{
  "type": "session.create",
  "payload": {
    "cols": 80,
    "rows": 24,
    "cwd": "/Users/chris"
  }
}
```

## 🔄 Key Data Flows

### **Session Creation Flow**

```
User Request
    │
    ▼
[macOS App] ServerManager.createSession()
    │
    ├─→ [IPC] Unix Socket Message
    │
    ▼
[Server] POST /api/sessions
    │
    ├─→ TerminalManager.createTerminal()
    ├─→ PtyManager.spawn() → node-pty
    ├─→ Create ~/.shellops/control/[sessionId]/
    ├─→ Start BufferAggregator
    │
    ▼
[Response] { sessionId, wsUrl }
    │
    ▼
[Client] Connect WebSocket
    │
    ▼
[Bidirectional Terminal I/O]
```

### **Log Aggregation Pipeline**

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Server     │────▶│   Mac App    │────▶│  macOS Log   │
│  console.log │HTTP │ [CLIENT:*]   │Pipe │ ServerOutput │     │  Unified     │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                         
[component] msg → POST /api/logs → [CLIENT:component] → Logger category → vtlog
```

## 🔐 Security Architecture

### **Authentication Layers**

```
┌─────────────────────────────────────────────────────┐
│                  Client Request                      │
└────────────────────────┬────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────┐
│              Authentication Middleware               │
├─────────────────────────────────────────────────────┤
│  1. Local Bypass (localhost + token)                │
│  2. JWT Token (from previous auth)                  │
│  3. SSH Key Challenge/Response                      │
│  4. Password (PAM or env var)                       │
│  5. Bearer Token (HQ mode)                          │
└─────────────────────────────────────────────────────┘
                         │
                    Authenticated
                         ▼
┌─────────────────────────────────────────────────────┐
│                  Protected Routes                    │
└─────────────────────────────────────────────────────┘
```

## 🚀 Advanced Features

### **1. Distributed Mode (HQ)**

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Machine A   │────▶│  HQ Server   │◀────│  Machine B   │
│  (Remote)    │     │  (Central)   │     │  (Remote)    │
└──────────────┘     └──────────────┘     └──────────────┘
     
Registration → Session Discovery → Proxied Access
```

### **2. Remote Access (Tailscale/Ngrok)**

```
Internet → Tailscale Funnel/Ngrok → localhost:4020 → ShellOps
            ├─ HTTPS termination
            ├─ Authentication
            └─ Traffic routing
```

### **3. Activity Monitoring**

```typescript
// Idle detection and resource management
ActivityMonitor → Session idle > 5min → Mark inactive
                → System resources → Auto-cleanup
                → WebSocket ping/pong → Connection health
```

## 📁 File System Structure

```
~/.shellops/
├── control/                      # Session control files
│   └── [sessionId]/
│       ├── session.json         # Metadata
│       ├── stdout              # Output log
│       ├── stdin               # Input log
│       ├── activity.json       # Activity status
│       └── ipc.sock           # Unix socket
├── logs/                        # Application logs
├── keys/                        # VAPID keys
└── config/                      # Server config
```

## 🎨 Technology Stack

- **macOS/iOS**: Swift 6, SwiftUI, Combine, os.log
- **Server**: Node.js/Bun, TypeScript, Express, node-pty
- **Frontend**: TypeScript, LitElement, xterm.js, Web Components
- **Protocols**: WebSocket, Unix Sockets, REST, Binary Buffer
- **Security**: JWT, Ed25519 SSH keys, PAM, Keychain
- **Build**: Xcode, Swift Package Manager, pnpm, esbuild

## 🔧 Key Implementation Details

### **Server Lifecycle**

1. **Startup**: Mac app spawns Bun process with embedded server
2. **Health Check**: Polls /health endpoint until ready
3. **Operation**: Handles sessions, forwards logs to Mac app
4. **Shutdown**: Graceful termination on SIGTERM

### **Session Persistence**

- Sessions survive server restarts via control directory
- Reconnection supported through session ID
- Automatic cleanup of orphaned sessions

### **Performance Optimizations**

- **Binary Protocol**: 10x smaller than JSON for terminal data
- **Buffer Aggregation**: Batches updates to reduce WebSocket messages
- **Delta Updates**: Only sends changes, not full buffer
- **Lazy Loading**: Sessions load on-demand

### **Development vs Production**

- **Development**: Hot reload, verbose logging, dev server mode
- **Production**: Embedded server, optimized builds, minimal logging
- **No Backwards Compatibility**: Everything ships together as one unit
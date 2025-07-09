# Rust PTY Implementation Documentation

## Overview

VibeTunnel uses a dual Rust-based approach for terminal handling:
1. **Native Node.js Addon** (`web/native-pty/`) - In-process PTY operations for the web server
2. **vt-pipe Binary** (`web/vt-pipe/`) - Lightweight terminal forwarder for the `vt` command

This architecture provides optimal performance while maintaining clean separation of concerns and process isolation where needed.

## Why Two Different Rust Components?

### Native Addon for Web Server

The web server needs to manage multiple terminal sessions with high-frequency I/O operations. Using a native addon provides:
- **Zero IPC overhead** - Direct function calls instead of network communication
- **Shared memory** - Buffers can be passed without copying
- **Tight integration** - Direct access to Node.js event loop and callbacks
- **Lower latency** - Sub-millisecond response times for user input

### vt-pipe for Terminal Forwarding

The `vt` command spawns a separate process for each terminal session. Using a lightweight Rust binary provides:
- **Memory efficiency** - 3MB vs 75MB per session (96% reduction)
- **Process isolation** - Crashes don't affect other sessions or the server
- **Resource limits** - Easy to monitor and limit per-session resources
- **Clean termination** - Process lifecycle matches terminal session

## Data Flow Architecture

### Web Terminal Sessions (Native Addon)

```
Browser → WebSocket → Node.js Server → Native Addon → PTY Process
   ↑                                         ↓
   └─────────── Terminal Output ─────────────┘

Detailed Flow:
1. User types in browser terminal (xterm.js)
2. WebSocket sends input to Node.js server
3. Server calls native addon's write() method
4. Native addon writes directly to PTY master fd
5. PTY process outputs data
6. Native addon reads output (polling at 10ms intervals)
7. Emits 'data' event to Node.js
8. Server sends output back via WebSocket
9. Browser renders in terminal
```

### vt Command Sessions (vt-pipe)

```
Terminal → vt-pipe → PTY Process
    ↓         ↓
    └─ Unix Socket → VibeTunnel Server → Browser
         (Binary Protocol)

Detailed Flow:
1. User runs 'vt command' in terminal
2. vt-pipe spawns PTY with requested command
3. Creates session metadata in ~/.vibetunnel/control/
4. Connects to server via Unix domain socket
5. Forwards all I/O using binary protocol
6. Server treats it like any other PTY session
7. Output available in web interface
```

## Native Addon Implementation

### Architecture

The native addon uses `napi-rs` for Node.js binding and `portable-pty` for cross-platform PTY operations:

```rust
// Global PTY manager holds all sessions
static PTY_MANAGER: Arc<Mutex<PtyManager>>

struct PtyManager {
    sessions: HashMap<String, PtySession>
}

struct PtySession {
    master: Box<dyn MasterPty>,
    writer: Box<dyn Write>,  // Stored to avoid take_writer() issue
    child: Box<dyn Child>,
    reader_thread: Option<JoinHandle>
}
```

### Key Design Decisions

1. **Global Session Manager**: A static PTY_MANAGER holds all active sessions, allowing the Node.js side to poll for output without holding Rust references.

2. **Stored Writer**: The PTY writer is taken once during session creation and stored, avoiding the portable-pty limitation where `take_writer()` can only be called once.

3. **Polling-based Output**: Instead of callbacks (which have threading complications), Node.js polls for available output every 10ms. This provides good responsiveness while avoiding complex thread synchronization.

4. **Activity Detection**: Built-in regex matching for Claude CLI status messages, enabling real-time activity tracking.

### Node.js Integration

```typescript
// web/src/server/pty/native-addon-adapter.ts
class NativeAddonPty implements IPty {
    private pty: NativePty;
    private pollInterval: NodeJS.Timeout;
    
    constructor(file?, args?, options?) {
        // Create native PTY instance
        this.pty = new NativePty(file, args, env, cwd, cols, rows);
        
        // Start polling for output
        this.pollInterval = setInterval(() => {
            const output = this.pty.read();
            if (output && output.length > 0) {
                this.emit('data', output.toString('utf8'));
            }
        }, 10);
    }
}
```

## vt-pipe Implementation

### Architecture

vt-pipe is a standalone Rust binary that acts as a bridge between terminal sessions and the VibeTunnel server:

```rust
struct Forwarder {
    session_id: String,
    terminal: Terminal,     // Raw mode terminal handling
    socket_client: SocketClient,  // Unix socket communication
    pty_master: Box<dyn MasterPty>
}

// Main flow:
1. Parse command line arguments
2. Create PTY and spawn requested command
3. Create session metadata in ~/.vibetunnel/control/
4. Connect to Unix socket at ~/.vibetunnel/control/{id}/ipc.sock
5. Forward I/O between terminal, PTY, and socket
```

### Binary Protocol

Communication uses a simple binary framing protocol:

```
Frame Format: [Type:1][Length:4][Payload:N]

Message Types:
- 0x01: StdinData - Keyboard input from terminal
- 0x02: ControlCmd - Resize, title updates, etc.
- 0x03: StatusUpdate - Session state changes
- 0x04: StdoutData - Output from PTY
- 0x05: SessionInfo - Session metadata
- 0x06: Error - Error messages
```

### Session Management

Each vt-pipe session creates a directory structure:
```
~/.vibetunnel/control/{session-id}/
├── session.json    # Session metadata
├── ipc.sock       # Unix domain socket
├── stdout.log     # Output log (optional)
└── stdin.log      # Input log (optional)
```

### Memory Efficiency

vt-pipe achieves its 96% memory reduction through:
- **Static binary**: No runtime dependencies
- **Minimal allocations**: Pre-allocated buffers
- **Direct I/O**: Zero-copy where possible
- **No scripting runtime**: Pure compiled Rust

## Integration Points

### PTY Manager Loading

```typescript
// web/src/server/pty/pty-manager.ts
async function loadPtyImplementation() {
    try {
        // Try native addon first
        ptyImplementation = await import('./native-addon-adapter.js');
        logger.info('Using native Rust PTY addon');
    } catch (err) {
        // This should not happen in production
        throw new Error('Native PTY addon not available');
    }
}
```

### Build Process

1. **Native Addon**: Built during `pnpm install` via `native-pty/package.json` scripts
2. **vt-pipe**: Built during Mac app compilation in Xcode build phase
3. **Distribution**: 
   - Native addon: Part of node_modules
   - vt-pipe: Bundled in `VibeTunnel.app/Contents/Resources/`

## Performance Characteristics

### Native Addon
- **Latency**: <0.01ms per write operation
- **Throughput**: Limited only by PTY buffer size
- **Memory**: Shared with Node.js process
- **CPU**: Minimal - one polling timer per session

### vt-pipe
- **Latency**: ~0.1ms for Unix socket communication
- **Memory**: ~3MB per process
- **Binary size**: 772KB
- **Startup time**: <10ms

## Error Handling

### Native Addon
- Graceful fallback if addon not available (development only)
- Session cleanup on process exit
- Automatic writer recovery on errors

### vt-pipe
- Automatic reconnection to Unix socket
- Session state persistence across restarts
- Clean shutdown on SIGTERM/SIGINT

## Security Considerations

1. **Process Isolation**: Each vt-pipe runs as a separate process with user privileges
2. **Unix Socket Permissions**: Sockets created with 0600 permissions (owner only)
3. **No Network Exposure**: All communication is local via Unix domain sockets
4. **Session Validation**: UUID-based session IDs prevent collision and guessing

## Future Improvements

1. **Shared Memory IPC**: For even lower latency between vt-pipe and server
2. **io_uring Support**: On Linux for zero-copy I/O operations
3. **GPU-accelerated Parsing**: For ANSI escape sequence processing
4. **Compression**: For high-bandwidth sessions

## Debugging

### Native Addon
```bash
# Build with debug symbols
cd web/native-pty
npm run build:debug

# Test directly
node -e "const {NativePty} = require('./index'); const pty = new NativePty(); console.log(pty.getPid())"
```

### vt-pipe
```bash
# Run with debug logging
RUST_LOG=debug vt-pipe ls -la

# Check session files
ls -la ~/.vibetunnel/control/*/
```

## Summary

The dual Rust implementation provides the best of both worlds:
- **Native addon**: Maximum performance for web server integration
- **vt-pipe**: Minimal resource usage for terminal forwarding

This architecture allows VibeTunnel to handle both high-frequency web terminal sessions and resource-efficient terminal forwarding without compromise.
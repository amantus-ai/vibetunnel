# VibeTunnel Socket Architecture

## Overview

VibeTunnel uses Unix domain sockets for all local inter-process communication (IPC). This architecture provides secure, efficient, and reliable communication between the Mac app, Node.js server, command-line tools, and terminal sessions.

## Socket Types and Locations

### 1. API Socket (`~/.vibetunnel/api.sock`)

**Purpose**: Command-line interface communication

**Created by**: Node.js server on startup

**Used by**: 
- `vt` command-line tool
- Any external tools that need to control VibeTunnel

**Protocol**: JSON over Unix socket

**Permissions**: `srwxr-xr-x` (755) - readable by all users, writable by owner

**Message Format**:
```json
{
  "command": "status" | "follow" | "unfollow" | "title" | "sessions",
  "args": {
    // Command-specific arguments
  }
}
```

**Key Commands**:
- `status` - Get server and git follow status
- `follow` - Enable git follow mode for a repository
- `unfollow` - Disable git follow mode
- `title` - Update terminal title for a session
- `sessions` - List active sessions

**Example Usage**:
```bash
# Using socat to communicate directly
echo '{"command":"status"}' | socat - UNIX-CONNECT:~/.vibetunnel/api.sock

# What the vt command does internally
vt status  # Sends {"command": "status"} to api.sock
```

### 2. Control Socket (`~/.vibetunnel/control.sock`)

**Purpose**: Bidirectional communication between Mac app and Node.js server

**Created by**: Node.js server on startup

**Used by**: 
- Mac app (UnixSocketService)
- Server (ControlSocketServer)

**Protocol**: Bidirectional JSON messages with event categories

**Permissions**: `srw-------` (600) - owner access only for security

**Message Categories**:
- `auth` - Authentication and session validation
- `system` - System-wide events and state changes
- `session` - Terminal session lifecycle events
- `session-monitor` - Notification events from SessionMonitor
- `input` - Keyboard/mouse input forwarding
- `git` - Git follow mode events
- `heartbeat` - Connection health monitoring

**Message Format**:
```typescript
interface ControlMessage {
  id: string;              // Unique message ID
  category: string;        // Message category
  type: 'event' | 'request' | 'response';
  action?: string;         // Specific action within category
  data?: any;             // Message payload
  error?: string;         // Error message if applicable
}
```

**Key Events**:

1. **Session Events**:
   ```json
   {
     "category": "session",
     "type": "event",
     "action": "created" | "closed" | "updated",
     "data": {
       "id": "session-uuid",
       "command": "bash",
       "cols": 80,
       "rows": 24
     }
   }
   ```

2. **Notification Events** (from unified notification system):
   ```json
   {
     "category": "session-monitor",
     "type": "event", 
     "action": "notification",
     "data": {
       "type": "session-start" | "session-exit" | "command-completion" | "command-error" | "claude-turn" | "bell",
       "sessionId": "session-uuid",
       "message": "Notification message",
       "metadata": {}
     }
   }
   ```

3. **Git Follow Events**:
   ```json
   {
     "category": "git",
     "type": "event",
     "action": "repository-changed",
     "data": {
       "path": "/path/to/repo",
       "branch": "main",
       "worktree": "/path/to/worktree"
     }
   }
   ```

### 3. Session IPC Sockets (`~/.vibetunnel/control/{session_id}/ipc.sock`)

**Purpose**: Terminal I/O forwarding for individual sessions

**Created by**: Node.js server when a terminal session starts

**Used by**:
- `vt-pipe` (Rust binary that forwards terminal I/O)
- Server's PTY session handler

**Protocol**: Binary frame protocol

**Permissions**: `srwxr-xr-x` (755) - accessible for session forwarding

**Frame Format**:
```
[1 byte type][4 bytes length (big-endian)][N bytes payload]
```

**Message Types**:
- `0x01` - StdinData (keyboard input)
- `0x02` - ControlCmd (resize, kill, update-title)
- `0x03` - StatusUpdate
- `0x04` - StdoutData (terminal output)
- `0x05` - SessionInfo
- `0x06` - Error

**Binary Protocol Example**:
```rust
// Stdin data frame
[0x01][0x00,0x00,0x00,0x05]['h','e','l','l','o']

// Resize command
[0x02][0x00,0x00,0x00,0x1C]['{"cmd":"resize","cols":80,"rows":24}']
```

## Socket Lifecycle

### Server Startup
1. Server creates `~/.vibetunnel` directory if it doesn't exist
2. Removes any stale socket files from previous runs
3. Creates `api.sock` with 755 permissions
4. Creates `control.sock` with 600 permissions
5. Starts listening on both sockets

### Session Creation
1. Client requests new session via REST API or control socket
2. Server generates unique session ID (UUID)
3. Creates directory `~/.vibetunnel/control/{session_id}/`
4. Creates `ipc.sock` in session directory
5. Spawns PTY process (native-pty or vt-pipe)
6. PTY process connects to session's ipc.sock

### Session Termination
1. PTY process exits or is killed
2. Server detects process exit
3. Sends session-closed event via control socket
4. Closes and removes session's ipc.sock
5. Removes session directory after cleanup delay

### Server Shutdown
1. Sends shutdown notifications to all connected clients
2. Terminates all active sessions gracefully
3. Closes and removes api.sock
4. Closes and removes control.sock
5. Cleans up any remaining session directories

## Error Handling

### Socket Connection Errors

**ECONNREFUSED** - Server not running
- Solution: Start VibeTunnel server

**EACCES** - Permission denied
- Solution: Check socket file permissions

**ENOENT** - Socket file not found
- Solution: Ensure server has started successfully

### Recovery Mechanisms

1. **Automatic Reconnection**:
   - Mac app reconnects to control socket if connection drops
   - Exponential backoff: 1s, 2s, 4s, 8s, max 30s
   - vt-pipe retries connection 10 times with 100ms delay

2. **Stale Socket Cleanup**:
   - Server removes socket files on startup
   - Validates socket files are actually bound
   - Cleans orphaned session directories

3. **Session Recovery**:
   - Sessions persist metadata in `session.json`
   - Can reconnect to running PTY processes
   - Graceful handling of orphaned processes

## Security Considerations

1. **File Permissions**:
   - control.sock: 600 (owner only) - prevents unauthorized control
   - api.sock: 755 (world readable) - allows vt command for all users
   - Session directories: 755 - allows forwarding tools to connect

2. **Authentication**:
   - Control socket requires authentication token
   - Session IDs are UUIDs (not guessable)
   - No network exposure - all sockets are local only

3. **Process Isolation**:
   - Each session runs as the user who created it
   - No privilege escalation through socket commands
   - PTY processes inherit user's environment

## Implementation Details

### Mac App (Swift)

**UnixSocketService** (`mac/VibeTunnel/Core/Services/UnixSocketService.swift`):
- Manages connection to control socket
- Handles automatic reconnection
- Dispatches messages to appropriate handlers

**ControlProtocol** (`mac/VibeTunnel/Core/Protocols/ControlProtocol.swift`):
- Defines message types and structures
- Encodes/decodes JSON messages
- Validates message format

### Node.js Server

**ControlSocketServer** (`web/src/server/control-socket-server.ts`):
- Creates and manages control.sock
- Routes messages to handlers
- Manages client connections

**ApiSocketServer** (`web/src/server/api-socket-server.ts`):
- Creates and manages api.sock
- Implements vt command protocol
- Handles command execution

**SessionSocketManager** (`web/src/server/utils/session-socket-manager.ts`):
- Creates session-specific sockets
- Manages socket lifecycle
- Handles binary protocol

### vt-pipe (Rust)

**SocketClient** (`web/vt-pipe/src/socket_client.rs`):
- Connects to session IPC socket
- Implements binary frame protocol
- Handles I/O forwarding

## Debugging

### View Socket Files
```bash
# List all VibeTunnel sockets
ls -la ~/.vibetunnel/*.sock
ls -la ~/.vibetunnel/control/*/ipc.sock

# Check socket connectivity
socat - UNIX-CONNECT:~/.vibetunnel/api.sock
```

### Monitor Socket Traffic
```bash
# Monitor control socket (requires sudo on macOS)
sudo dtrace -n 'syscall::write:entry /execname == "VibeTunnel" || execname == "node"/ { printf("%s", copyinstr(arg1)); }'

# Use socat to create monitoring proxy
socat -v UNIX-LISTEN:/tmp/monitor.sock,fork UNIX-CONNECT:~/.vibetunnel/api.sock
```

### Common Issues

1. **"Failed to connect to Unix socket after retries"**
   - Usually means Claude Code is running outside VibeTunnel
   - Solution: Run `vt claude` instead of `claude`

2. **"Address already in use"**
   - Stale socket file from crashed server
   - Solution: Remove socket file and restart

3. **"Permission denied"**
   - Socket has wrong permissions
   - Solution: Check file ownership and permissions

## Protocol Evolution

### Version History

**v1.0.0** - Initial socket architecture
- Replaced HTTP API with Unix sockets
- Added binary protocol for session I/O
- Unified notification system via control socket

**v0.4.0** - Legacy HTTP-based system
- Used HTTP for vt commands
- Port discovery via ~/.vibetunnel/.port
- Less reliable, port conflicts

### Future Considerations

1. **Performance Optimizations**:
   - Socket pooling for high-frequency operations
   - Bulk message batching
   - Zero-copy I/O for large terminal outputs

2. **Enhanced Security**:
   - Message signing for critical operations
   - Rate limiting on api.sock
   - Audit logging for control commands

3. **Extended Protocol**:
   - Binary protocol for control socket (performance)
   - Compression for large payloads
   - Versioning for protocol evolution
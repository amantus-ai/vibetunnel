# VibeTunnel Socket Protocol

## Overview

VibeTunnel uses a binary framed message protocol over Unix domain sockets for all inter-process communication (IPC). This protocol replaces the previous file-based IPC system, providing better performance, real-time updates, and cleaner architecture.

## Architecture

### Components

1. **PTY Manager** (Server)
   - Creates Unix domain socket at `{session_dir}/ipc.sock`
   - Handles multiple client connections
   - Manages PTY process I/O
   - Tracks session state and Claude status

2. **Socket Client** (fwd.ts and other clients)
   - Connects to session's Unix socket
   - Sends stdin data and control commands
   - Receives status updates and errors
   - Supports auto-reconnection

### Socket Path

- Location: `{control_dir}/{session_id}/ipc.sock`
- Example: `/tmp/vt-1234567890/a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6/ipc.sock`

**Important**: macOS has a 104 character limit for Unix socket paths (103 usable). Keep control directories short to avoid EINVAL errors.

## Message Format

### Frame Structure

```
+--------+--------+--------+--------+--------+----------------+
| Type   | Length                           | Payload        |
| 1 byte | 4 bytes (big-endian uint32)      | Length bytes   |
+--------+--------+--------+--------+--------+----------------+
```

- **Type**: Single byte indicating message type
- **Length**: 32-bit unsigned integer in big-endian format
- **Payload**: Variable-length data (format depends on message type)

### Message Types

| Type | Value | Direction | Description |
|------|-------|-----------|-------------|
| STDIN_DATA | 0x01 | Client → Server | Terminal input data |
| CONTROL_CMD | 0x02 | Client → Server | Control commands (resize, kill) |
| STATUS_UPDATE | 0x03 | Both | Activity status updates |
| HEARTBEAT | 0x04 | Both | Connection health check |
| ERROR | 0x05 | Server → Client | Error messages |

## Message Payloads

### STDIN_DATA (0x01)
- **Payload**: UTF-8 encoded string
- **Example**: `"ls -la\n"`

### CONTROL_CMD (0x02)
- **Payload**: JSON object
- **Commands**:
  ```json
  // Resize terminal
  { "cmd": "resize", "cols": 120, "rows": 40 }
  
  // Kill process
  { "cmd": "kill", "signal": "SIGTERM" }
  
  // Reset terminal size
  { "cmd": "reset-size" }
  ```

### STATUS_UPDATE (0x03)
- **Payload**: JSON object
- **Format**:
  ```json
  {
    "app": "claude",
    "status": "✻ Thinking (5s, ↑2.5k tokens)",
    // Optional extra fields
    "tokens": 2500,
    "duration": 5000
  }
  ```
- **Broadcast**: Server broadcasts status updates to all connected clients

### HEARTBEAT (0x04)
- **Payload**: Empty (0 bytes)
- **Behavior**: 
  - Clients can send periodic heartbeats
  - Server echoes heartbeats back
  - Used to detect connection health

### ERROR (0x05)
- **Payload**: JSON object
- **Format**:
  ```json
  {
    "code": "SESSION_NOT_FOUND",
    "message": "Session does not exist",
    "details": { /* optional */ }
  }
  ```

#### Error Codes

| Code | Description | Details |
|------|-------------|---------|
| `SESSION_NOT_FOUND` | The requested session does not exist | Session ID is invalid or session has been terminated |
| `MESSAGE_PROCESSING_ERROR` | Failed to process incoming message | Malformed message, invalid JSON, or internal processing error |
| `INVALID_OPERATION` | Operation not valid for session type | e.g., reset-size on in-memory session |
| `CONTROL_MESSAGE_FAILED` | Failed to send control message | Unable to communicate with PTY process |
| `RESET_SIZE_FAILED` | Failed to reset terminal size | Error during size reset operation |
| `CONNECTION_LIMIT` | Too many concurrent connections | Server connection limit reached |
| `PAYLOAD_TOO_LARGE` | Message payload exceeds size limit | Payload larger than maximum allowed size |
| `INVALID_MESSAGE_TYPE` | Unknown or unsupported message type | Client sent unrecognized message type |
| `MALFORMED_FRAME` | Invalid message frame structure | Message framing protocol violation |

**Example Error Response**:
```json
{
  "code": "MESSAGE_PROCESSING_ERROR",
  "message": "Failed to parse control command",
  "details": {
    "error": "Unexpected token } in JSON at position 42",
    "messageType": 2
  }
}
```

## Client Implementation

### Connection Flow

1. Connect to Unix socket at `{session_dir}/ipc.sock`
2. Receive any initial status updates from server
3. Send messages as needed
4. Handle incoming messages asynchronously
5. Reconnect automatically on disconnection (optional)

### Example Usage

```typescript
import { VibeTunnelSocketClient } from './socket-client.js';

// Connect to session
const client = new VibeTunnelSocketClient('/path/to/session/ipc.sock', {
  autoReconnect: true,
  heartbeatInterval: 30000 // 30 seconds
});

// Listen for events
client.on('connect', () => console.log('Connected'));
client.on('status', (status) => console.log('Status:', status));
client.on('error', (err) => console.error('Error:', err));

// Connect and use
await client.connect();

// Send terminal input
client.sendStdin('echo "Hello, World!"\n');

// Resize terminal
client.resize(120, 40);

// Send Claude status
client.sendStatus('claude', '✻ Thinking', { tokens: 1000 });

// Disconnect when done
client.disconnect();
```

## Server Implementation

### Socket Server Setup

The PTY manager creates a Unix domain socket for each session:

```typescript
// Create socket server
const server = net.createServer((client) => {
  const parser = new MessageParser();
  
  // Send initial status if available
  if (claudeStatus) {
    client.write(frameMessage(MessageType.STATUS_UPDATE, claudeStatus));
  }
  
  // Handle incoming messages
  client.on('data', (chunk) => {
    parser.addData(chunk);
    
    for (const { type, payload } of parser.parseMessages()) {
      handleMessage(type, payload, client);
    }
  });
});

// Listen on socket
server.listen(socketPath);
```

### Message Handling

The server processes messages based on type:

- **STDIN_DATA**: Write to PTY process
- **CONTROL_CMD**: Handle resize/kill commands
- **STATUS_UPDATE**: Store status and broadcast to other clients
- **HEARTBEAT**: Echo back to sender

## Protocol Features

### Message Framing

The protocol handles:
- **Partial messages**: TCP may split messages across packets
- **Multiple messages**: TCP may combine messages in one packet
- **Large payloads**: No practical size limit (up to 4GB per message)
- **Binary safety**: Handles null bytes and non-UTF8 data

### Connection Management

- **Multiple clients**: Server supports multiple simultaneous connections
- **Auto-reconnection**: Clients can automatically reconnect on failure
- **Heartbeats**: Optional periodic heartbeats for connection health
- **Graceful shutdown**: Proper cleanup of resources

### Status Broadcasting

When a client sends a STATUS_UPDATE:
1. Server stores the status in memory
2. Server broadcasts to all other connected clients
3. New clients receive current status on connection

## Migration from File-Based IPC

### Previous System
- Control commands via `{session_dir}/control-pipe` file
- Activity updates via `{session_dir}/activity.json` file
- Required file watching and polling

### New System
- All communication through single Unix socket
- Real-time bidirectional messaging
- No file watching or polling needed
- Better performance and cleaner architecture

## Error Handling

### Connection Errors
- **ENOENT**: Socket file doesn't exist (session not found)
- **ECONNREFUSED**: Server not listening (session crashed)
- **EINVAL**: Socket path too long (macOS limit)

### Protocol Errors
- Malformed messages are logged and ignored
- Server sends ERROR message for processing failures
- Clients should handle disconnections gracefully

## Performance Considerations

1. **Message Size**: Keep messages reasonably sized (< 1MB)
2. **Heartbeat Interval**: 30-60 seconds is typical
3. **Reconnect Delay**: 1-5 seconds between attempts
4. **Socket Backlog**: Default is sufficient for typical usage

## Security Notes

- Sockets are created with 0666 permissions (world-writable)
- Rely on directory permissions for access control
- No authentication or encryption (local use only)
- Validate all JSON payloads before processing

## Implementation Files

- **Protocol**: `src/server/pty/socket-protocol.ts`
- **Client**: `src/server/pty/socket-client.ts`
- **Server**: `src/server/pty/pty-manager.ts` (setupIPCSocket method)
- **Tests**: `src/test/unit/socket-*.test.ts`, `src/test/integration/socket-*.test.ts`

## Future Enhancements

Potential improvements to consider:
- Message compression for large payloads
- Authentication for multi-user systems
- Encryption for sensitive data
- Request/response correlation IDs
- Batch message support
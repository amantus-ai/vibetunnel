# Performance Architecture

## Session Management Models

VibeTunnel supports two distinct session management approaches, each with different performance characteristics:

### 1. Server-Managed Sessions (API-initiated)

Sessions created via `POST /api/sessions` are spawned directly within the server's Node.js process. These sessions benefit from:

- **Direct PTY communication**: Input and resize commands bypass the command pipe system
- **Reduced latency**: No inter-process communication overhead for terminal interactions
- **Immediate responsiveness**: Direct memory access to PTY stdout/stdin

### 2. External Sessions (vt-initiated)

Sessions started via the `vt` command run in a separate Node.js process with:

- **File-based communication**: PTY stdout is written to disk files
- **Command pipe interface**: Resize and input commands are passed through IPC
- **Additional latency**: File I/O and IPC overhead for all terminal operations

## Server Architecture

### Session Discovery and Management

The server performs two primary management tasks:

1. **External Session Monitoring**
   - Watches control directory for new external sessions
   - Automatically registers discovered sessions with the terminal manager
   - Maintains in-memory terminal buffer for text export + VT snapshots (WS v3 `SNAPSHOT_VT`)

2. **Client Connection Handling**
   - WebSocket connections trigger file watchers on session stdout files
   - File watchers stream new output to connected clients in real-time
   - Multiple clients can connect to the same session simultaneously

### Memory Management

- **Buffer caching**: Last visible scrollbuffer (terminal dimensions) kept in memory
- **Efficient retrieval**: `/api/sessions/:id/text` and WS v3 `SNAPSHOT_VT` serve from memory cache
- **File streaming**: WebSocket clients receive updates via file watchers

## Known Performance Issues

### Session Creation Blocking

**Symptom**: All sessions freeze temporarily when creating a new session

**Cause**: Synchronous operations during session creation
- Session creation endpoint waits for process spawn completion
- PTY initialization must complete before returning
- Any synchronous operation blocks the entire Node.js event loop

**Impact**: All active sessions become unresponsive during new session initialization

### Potential Solutions

1. **Async session creation**: Move blocking operations to worker threads
2. **Pre-spawn PTY pool**: Maintain ready PTYs to reduce creation time
3. **Event loop monitoring**: Identify and eliminate synchronous operations
4. **Progressive initialization**: Return session ID immediately, initialize asynchronously

## Performance Optimization Strategies

### For Server-Managed Sessions
- Minimize synchronous operations in session creation
- Use Node.js worker threads for CPU-intensive tasks
- Implement connection pooling for database operations

### For External Sessions
- Consider memory-mapped files for stdout communication
- Implement file change batching to reduce watcher overhead
- Use efficient file formats (binary vs text) where appropriate

### General Optimizations
- Profile event loop blocking with tools like `clinic.js`
- Implement request queuing for session creation
- Add performance metrics and monitoring
- Consider horizontal scaling with session affinity

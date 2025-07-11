# VibeTunnel Technical Debugging Session with Mario - Complete Technical Extract

## Overview
This document captures ALL technical information from a debugging session between Mario (core developer) and Peter about VibeTunnel's terminal performance issues, architecture decisions, and proposed solutions.

## Critical Action Items (Priority Order)

1. **IMMEDIATE**: Fix `sendExistingContent` not working in forward.ts path
   - Debug why forward.ts creates duplicate cinemaWriter
   - Ensure forward.ts uses same code path as server sessions
   - This alone should fix 850MB session loading issue

2. **SHORT-TERM**: Replace node-pty to fix Electron crashes
   - Extract Microsoft's Unix/Windows native code (~800 lines)
   - Remove shared worker/pipe architecture
   - Create minimal NAPI wrapper without VS Code specifics

3. **INVESTIGATE**: Session-detail-view resize event loop
   - Find source of continuous resize triggers
   - Debug why header button moves during rendering
   - Implement resize debouncing

4. **LONG-TERM**: Consider Rust/Go migration
   - Rust: 2MB binary, 10MB RAM vs current 100MB
   - Go: Better for AI, automatic test tracking
   - Hybrid approach: Rust forward + Go server

## Core Architecture Components

### 1. Binary Buffer Streaming System
- **Purpose**: Streams pre-rendered terminal content as binary data
- **Format**: Binary cells buffer containing character + style information (background, foreground color, bold, italic, normal)
- **Structure**: For each row/column combination, stores pixel-like cell data
- **Example**: 80 columns × 10,000 rows in scroll buffer
- **Optimization**: Server-side rendering to binary format for efficient streaming

### 2. Key Files and Modules

#### Server-Side Components
- **`forward.ts`** (forwarding binary): Main forwarding implementation
- **`pty-manager.ts`**: Core PTY (pseudo-terminal) management
- **`server.ts`**: Web server implementation  
- **`fwd.ts`**: Process spawning and forwarding tool
- **`stream-watcher.ts`**: Monitors ascinema files and sends updates

#### Session Management
- **Session Files**: 
  - Control directory with session JSON
  - Standard output files (ascinema format)
  - IPC sockets for input handling

### 3. Data Flow Architecture

#### Input Flow
1. Key press → WebSocket → Server
2. Server → IPC Socket → PTY Process standard input
3. Process writes to standard out

#### Output Flow
1. PTY Process → Standard out
2. Standard out → Ascinema file writer (with write queues for backpressure)
3. Terminal Manager reads standard out files → Renders to binary format
4. Client fetches via:
   - SSE stream at `/api/sessions/:id/stream` (text/ascinema format)
   - WebSocket at `/buffers` (binary format)

## Major Technical Issues Identified

### 1. The 850MB Session Problem
**Symptom**: Sessions with large output (850MB+) cause infinite loading/scrolling
**Root Cause**: Missing clear sequence truncation in forward.ts path
**Evidence**: 
- 980MB test file contains 2400 clear sequences
- Server should only send content after last clear (~2MB)
- Working correctly for server-created sessions
- NOT working for forward.ts external terminal sessions

### 2. Resize Event Loop
**Problem**: Continuous resize events cause performance degradation
**Details**:
- Cloud (the terminal app) renders entire scroll buffer on EVERY resize
- Each resize triggers complete re-render from line 1
- Mobile UI triggers excessive resize events
- Creates resize → render → resize loop

**Technical Evidence**:
```
- R (resize) events in ascinema format
- Cloud sends clear sequence + full buffer re-render
- Can generate 850MB files from 40-minute sessions
```

### 3. Node-PTY Issues
**Problem**: Electron crashes and high memory usage (100MB per terminal)
**Root Cause**: Shared pipe architecture where all PTY instances write to same pipe
**Details**:
- Microsoft's node-pty uses shared "worker" with common pipe
- All terminal output goes through single pipe
- VibeTunnel writes massive amounts of data
- Causes Electron renderer process crashes

**Code Location**: Native C++ code in node-pty using NAPI

### 4. Memory Usage
- Each VT (VibeTunnel) instance spawns complete Node.js process
- 50-100MB memory per terminal session
- Significant overhead for simple PTY forwarding

## Technical Implementation Details

### Ascinema Format
```
[timestamp] [event_type] [data]
```
Event types:
- `o` - Output from process
- `i` - Input to process  
- `r` - Resize event

### Clear Sequence Handling
- ANSI sequence: `\x1b[2J` (found in code as specific byte sequence)
- Server scans for last clear sequence in file
- Only sends content after last clear to client
- Reduces 980MB → 2MB for initial load

### PTY Manager Implementation
1. **Create Session**:
   - Resolves command
   - Creates control directory
   - Writes session JSON
   - Spawns node-pty process

2. **Setup PTY Handlers**:
   - Attaches to process standard out
   - Implements write queues for backpressure
   - Writes to ascinema file
   - For external terminals: also writes to terminal stdout

3. **IPC Socket Communication**:
   - Handles input, resize, kill commands
   - Message format with type and payload

## Proposed Solutions

### 1. Fix Forward.ts Clear Truncation
**Issue**: `sendExistingContent` not triggering in forward path
**Solution**: Debug why forward.ts bypasses clear sequence truncation
**Impact**: Immediate fix for 850MB session loading

### 2. Replace Node-PTY
**Option A - Minimal Node Package**:
- Extract only Unix/Windows PTY native code (800 lines C)
- Remove shared worker/pipe architecture  
- Create minimal NAPI wrapper
- Reuse Microsoft's proven PTY implementation

**Option B - Rust Rewrite**:
- Port forward.ts to Rust
- Use rust-pty crate or direct PTY syscalls
- Benefits: 2MB binary, 10MB RAM vs 100MB
- Challenges: Need to port session management logic

**Option C - Go Rewrite**:
- Replace both forward and web server
- Benefits: Better AI code generation, built-in testing
- Pre-allocated memory to avoid GC issues

### 3. Fix Resize Handling
- Debounce resize events
- Investigate session-detail-view resize triggers
- Fix viewport calculations to prevent loops
- Consider virtual terminal size vs actual size

## Code Snippets and Commands

### Running Forward.ts Directly (Debug Mode)
```bash
# Direct execution without Mac app
cd web
npx tsx src/server/forward.ts zsh
```

### Testing Large Sessions
```bash
# Create session, replace stdout file
cd web
# Stop server, copy large file to session stdout
# Restart server - it will load truncated version
```

### Key Function Locations
- **PTY Manager**: `pty-manager.ts`
  - `createSession()`: Main session creation
  - `setupPtyHandlers()`: Attaches to process stdout
  - Write queues for backpressure handling
  
- **Stream Watcher**: `stream-watcher.ts`
  - `sendExistingContent()`: Implements clear sequence truncation
  - Searches for last clear sequence: `\x1b[2J`
  
- **Forward.ts Issues**:
  - Creates duplicate `cinemaWriter`
  - Sets up own file watcher (shouldn't be needed)
  - May bypass `sendExistingContent` path

### Debug Commands Used
```bash
# View ascinema format
cat /path/to/session/stdout

# Search for clear sequences in file
grep -a $'\x1b\[2J' session_file

# Monitor network requests
# Check /api/sessions/:id/stream endpoint
```

### Debug Output Examples
- Terminal Manager processes: ~10,000 lines
- Send existing content: Finds last clear at line ~744,000
- Sends only last 2MB of 980MB file
- Clear sequences found: 2400 in 980MB file

### PTY Native Implementation (Unix)
- File: `unix/pty.cc` (~800 lines)
- Uses `libuv` for async operations
- Minimal C code for fork/exec and PTY setup
- Backpressure handled by Node.js streams
- Key functions: `PtyOpen`, `PtyResize`, `PtyGetProc`

## Performance Metrics
- 980MB session file → 2MB after clear truncation
- Initial server processing: Few seconds for 1GB scan
- Instant replay of truncated content
- Each resize can trigger full buffer re-render

## Platform-Specific Issues

### macOS
- Cannot use KQueue on PTY devices
- libuv automatically falls back to select()
- Screen recording permissions required

### Mobile Safari
- Different behavior than desktop Safari at same size
- Touch events vs mouse events complications
- Scrollbar missing/hidden
- Keyboard state affects scrolling behavior

## Frontend Framework Issues

### Web Components (Lit) Problems
- Team not familiar with Web Components patterns
- Difficult to understand state management
- Files becoming too large for AI tools to process
- Consider migration to React/Solid for better state handling

### Session Detail View Issues
- Sidebar drag handler resizes without user input
- Header button movement indicates viewport changes
- HTML expanding incorrectly (possibly text not wrapping)
- Animations may be interfering with layout stability

## Dependencies and Libraries
- **node-pty**: Microsoft's PTY wrapper (problematic)
- **libuv**: Node's async I/O library - handles async operations and event loop
  - Cannot use KQueue on PTY devices on macOS
  - Automatically falls back to select()
  - Contains many workarounds for PTY edge cases
- **NAPI**: Node native API for C++ bindings
- **Ink**: React for TUIs (causing excessive re-renders)

## Additional Technical Details

### Node-PTY Architecture Issues
- Uses SpawnHelper for process creation
- Shared worker/pipe architecture is VS Code specific
- All PTY instances write to same shared pipe
- This causes Electron crashes when VibeTunnel writes large amounts of data
- Each PTY spawns a separate process (contributing to 50-100MB overhead)

### PTY Implementation Details
- Microsoft's implementation: ~800 lines of C code for Unix
- Handles fork/exec and PTY setup
- Proven in production (millions of VS Code instances)
- Rust PTY crates are unproven and may lack edge case handling

### Backpressure Management
- Currently handled by write queues in TypeScript
- Node-PTY may not handle backpressure properly
- Critical for preventing buffer overflows

### Language Migration Considerations

**Go Benefits**:
- Perfect for AI code generation
- Automatic test dependency tracking (only runs changed tests)
- Pre-allocated memory avoids GC issues
- Well-suited for web server replacement

**Rust Benefits**:
- 2MB binary vs 50-100MB Node process
- 10MB RAM usage vs current overhead
- Can bind to Microsoft's C code directly
- Challenge: Need to port PTY-manager logic

### Historical Context
- Project has gone "full circle" - was previously in Rust
- Team has experience with multiple rewrites
- Armin's original Rust PTY implementation was minimal

## Migration Strategy Priority
1. Fix clear truncation bug (immediate)
2. Create minimal node-pty replacement (short-term)  
   - Extract only Unix/Windows native code
   - Remove VS Code specific shared worker
   - Create minimal NAPI wrapper
3. Consider Rust/Go rewrite (long-term)
   - Rust for forward.ts
   - Go for web server
   - Or full Go implementation

## Key Insights
- The architecture is "todelfachste Variante" (simplest variant)
- Main complexity comes from external dependencies
- Clear separation between server sessions and forwarded sessions
- Binary buffer format more efficient than streaming raw ANSI
- UV (libuv) contains critical workarounds for PTY edge cases
- Community contribution difficult due to high velocity development